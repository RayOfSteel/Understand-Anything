#!/usr/bin/env node
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pluginRoot = resolve(__dirname, "../..");
const require = createRequire(resolve(pluginRoot, "package.json"));

let core;
try {
  core = await import(pathToFileURL(require.resolve("@understand-anything/core")).href);
} catch {
  core = await import(pathToFileURL(resolve(pluginRoot, "packages/core/dist/index.js")).href);
}

const [command, projectRoot, payloadPath] = process.argv.slice(2);

if (!command || !projectRoot || !payloadPath) {
  process.stderr.write("Usage: node archive-run.mjs <init|snapshot|finalize> <project-root> <payload.json>\n");
  process.exit(1);
}

const payload = JSON.parse(readFileSync(payloadPath, "utf-8"));

if (command === "init") {
  const archive = core.createAttemptArchive(projectRoot, payload);
  process.stdout.write(JSON.stringify(archive, null, 2));
} else if (command === "snapshot") {
  core.archiveRuntimeDirectories(projectRoot, payload.attemptDir);
  process.stdout.write(JSON.stringify({ snapshotted: true, attemptDir: payload.attemptDir }, null, 2));
} else if (command === "finalize") {
  const manifest = core.finalizeAttemptManifest(payload.manifestPath, payload.update);
  process.stdout.write(JSON.stringify(manifest, null, 2));
} else {
  process.stderr.write(`Unknown command: ${command}\n`);
  process.exit(1);
}
