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
  process.stderr.write("Usage: node apply-regenerate-merge.mjs <input.json>\n");
  process.exit(1);
}

const input = JSON.parse(readFileSync(inputPath, "utf-8"));
const previous = JSON.parse(readFileSync(input.previousGraphPath, "utf-8"));
const current = JSON.parse(readFileSync(input.currentGraphPath, "utf-8"));
const patches = (input.patchPaths ?? [])
  .filter((path) => existsSync(path))
  .map((path) => JSON.parse(readFileSync(path, "utf-8")));

const merged = core.mergeGraphWithCarryForward({
  previous,
  current,
  patches,
  removedSourcePaths: input.removedSourcePaths ?? [],
});
const invalidatedTargets = patches.flatMap((patch) => patch.invalidations.map((item) => item.target));
const diff = core.compareGraphs(previous, merged, { invalidatedTargets });

writeFileSync(input.outputGraphPath, JSON.stringify(merged, null, 2), "utf-8");
writeFileSync(input.outputDiffPath, JSON.stringify(diff, null, 2), "utf-8");

process.stdout.write(JSON.stringify({
  outputGraphPath: input.outputGraphPath,
  outputDiffPath: input.outputDiffPath,
  addedNodes: diff.addedNodeIds.length,
  removedNodes: diff.removedNodeIds.length,
  carriedForwardNodes: diff.carriedForwardNodeIds.length,
}, null, 2));
