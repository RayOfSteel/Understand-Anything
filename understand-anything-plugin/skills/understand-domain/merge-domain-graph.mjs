#!/usr/bin/env node
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pluginRoot = resolve(__dirname, "../..");
const require = createRequire(resolve(pluginRoot, "package.json"));

let core;
try {
  core = await import(pathToFileURL(require.resolve("@understand-anything/core")).href);
} catch {
  core = await import(pathToFileURL(resolve(pluginRoot, "packages/core/dist/index.js")).href);
}

const [inputPath] = process.argv.slice(2);
if (!inputPath) {
  process.stderr.write("Usage: node merge-domain-graph.mjs <input.json>\n");
  process.exit(1);
}

const input = JSON.parse(readFileSync(inputPath, "utf-8"));
const previous = existsSync(input.previousDomainGraphPath)
  ? JSON.parse(readFileSync(input.previousDomainGraphPath, "utf-8"))
  : null;
const current = JSON.parse(readFileSync(input.currentDomainAnalysisPath, "utf-8"));
const patches = (input.patchPaths ?? [])
  .filter((path) => existsSync(path))
  .map((path) => JSON.parse(readFileSync(path, "utf-8")));

const merged = core.mergeDomainGraph({ previous, current, patches });
writeFileSync(input.outputDomainGraphPath, JSON.stringify(merged, null, 2), "utf-8");
process.stdout.write(JSON.stringify({
  outputDomainGraphPath: input.outputDomainGraphPath,
  nodes: merged.nodes.length,
  edges: merged.edges.length,
}, null, 2));
