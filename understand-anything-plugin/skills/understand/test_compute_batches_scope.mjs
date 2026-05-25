#!/usr/bin/env node
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";

const __dirname = dirname(fileURLToPath(import.meta.url));
const COMPUTE_BATCHES = join(__dirname, "compute-batches.mjs");

const root = join(tmpdir(), `ua-scope-batches-${Date.now()}`);
mkdirSync(join(root, ".understand-anything", "intermediate"), { recursive: true });
mkdirSync(join(root, "repos", "GlobalLine", "src"), { recursive: true });
mkdirSync(join(root, "repos", "Sql", "src"), { recursive: true });
writeFileSync(join(root, "repos", "GlobalLine", "src", "a.ts"), "export const a = 1;\n");
writeFileSync(join(root, "repos", "GlobalLine", "src", "b.ts"), "import { a } from './a.js';\n");
writeFileSync(join(root, "repos", "Sql", "src", "q.ts"), "export const q = 1;\n");

writeFileSync(
  join(root, ".understand-anything", "intermediate", "scan-result.json"),
  JSON.stringify({
    files: [
      { path: "repos/GlobalLine/src/a.ts", fileCategory: "code" },
      { path: "repos/GlobalLine/src/b.ts", fileCategory: "code" },
      { path: "repos/Sql/src/q.ts", fileCategory: "code" },
    ],
    importMap: {
      "repos/GlobalLine/src/b.ts": ["repos/GlobalLine/src/a.ts"],
      // Deliberately cross-scope edge — must be dropped by advice-aware batching:
      "repos/Sql/src/q.ts": ["repos/GlobalLine/src/a.ts"],
    },
  }),
);

writeFileSync(
  join(root, ".understand-anything", "intermediate", "advice-context.json"),
  JSON.stringify({
    files: [
      { path: ".understandadvice", scope: ".", appliesTo: ["**/*"], content: "root", source: "root" },
      { path: "repos/GlobalLine/.understandadvice", scope: "repos/GlobalLine", appliesTo: ["repos/GlobalLine/**/*"], content: "gl", source: "nested" },
      { path: "repos/Sql/.understandadvice", scope: "repos/Sql", appliesTo: ["repos/Sql/**/*"], content: "sql", source: "nested" },
    ],
    combinedProjectAdvice: "",
  }),
);

const result = spawnSync(process.execPath, [COMPUTE_BATCHES, root], { encoding: "utf-8" });
assert.equal(result.status, 0, `compute-batches.mjs failed:\n${result.stderr}`);

const batches = JSON.parse(
  readFileSync(join(root, ".understand-anything", "intermediate", "batches.json"), "utf-8"),
).batches;

function scopeOf(filePath) {
  if (filePath.startsWith("repos/GlobalLine/")) return "repos/GlobalLine";
  if (filePath.startsWith("repos/Sql/")) return "repos/Sql";
  return ".";
}

for (const batch of batches) {
  const scopes = new Set(batch.files.map((f) => scopeOf(f.path)));
  assert.equal(
    scopes.size,
    1,
    `Batch ${batch.batchIndex} crosses advice scopes: ${[...scopes].join(", ")}`,
  );
  assert.equal(
    batch.primaryAdviceScope,
    [...scopes][0],
    `Batch ${batch.batchIndex} missing or wrong primaryAdviceScope`,
  );
}

const glBatch = batches.find((b) => b.files.some((f) => f.path.startsWith("repos/GlobalLine/")));
assert.ok(glBatch, "no GlobalLine batch");
assert.equal(glBatch.primaryAdviceScope, "repos/GlobalLine", "GlobalLine batch missing scope tag");

rmSync(root, { recursive: true, force: true });
console.log("PASS: compute-batches respects advice scopes");
