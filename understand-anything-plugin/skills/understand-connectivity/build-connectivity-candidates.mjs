#!/usr/bin/env node
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readFileSync, writeFileSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pluginRoot = resolve(__dirname, "../..");
const require = createRequire(resolve(pluginRoot, "package.json"));

let core;
try {
  core = await import(pathToFileURL(require.resolve("@understand-anything/core")).href);
} catch {
  core = await import(pathToFileURL(resolve(pluginRoot, "packages/core/dist/index.js")).href);
}

const [projectRoot, graphPath, outputPath, limitArg] = process.argv.slice(2);
if (!projectRoot || !graphPath || !outputPath) {
  process.stderr.write(
    "Usage: node build-connectivity-candidates.mjs <project-root> <graph.json> <output.json> [limit]\n",
  );
  process.exit(1);
}

const graph = JSON.parse(readFileSync(graphPath, "utf-8"));
const limit = limitArg ? Number(limitArg) : 25;

// Collect every node with a filePath as a target for basename reference search.
// Map filePath → list of nodeIds (multiple nodes can share a filePath, e.g. a
// file node and its contained function nodes).
const pathToNodeIds = new Map();
for (const node of graph.nodes ?? []) {
  if (!node.filePath) continue;
  if (!pathToNodeIds.has(node.filePath)) pathToNodeIds.set(node.filePath, []);
  pathToNodeIds.get(node.filePath).push(node.id);
}

const targetPaths = [...pathToNodeIds.keys()];
process.stderr.write(`Walking project for basename references on ${targetPaths.length} unique paths...\n`);
const refCountsByPath = core.countBasenameReferences(projectRoot, targetPaths);

// Re-key from filePath → ReferenceCount into nodeId → ReferenceCount.
const referenceCounts = new Map();
for (const [filePath, refCount] of refCountsByPath) {
  for (const nodeId of pathToNodeIds.get(filePath) ?? []) {
    referenceCounts.set(nodeId, refCount);
  }
}

const candidates = core.buildConnectivityCandidates(graph, { limit, referenceCounts });
writeFileSync(outputPath, JSON.stringify({ version: "1.0.0", candidates }, null, 2), "utf-8");
process.stdout.write(JSON.stringify({
  candidates: candidates.length,
  outputPath,
  referencedPaths: [...refCountsByPath.values()].filter(r => r.count > 0).length,
  zeroReferencePaths: [...refCountsByPath.values()].filter(r => r.count === 0).length,
}, null, 2));
