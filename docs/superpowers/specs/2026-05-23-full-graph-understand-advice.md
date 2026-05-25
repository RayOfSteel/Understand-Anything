# Full Graph Understand Advice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build native Understand Anything support for auto-loaded advice files so one large target such as `.data/ado` can still produce one physical `.understand-anything/knowledge-graph.json`.

**Architecture:** Add a core advice loader modeled after `.understandignore`, then inject loaded advice into scanner, batch, architecture, and tour prompts. Keep the public `/understand` output contract unchanged: internal analysis may be advice-scoped, but the final persisted artifact remains one validated `knowledge-graph.json`.

**Tech Stack:** TypeScript core package, Vitest, Markdown skill and agent prompts, Python merge script tests with `unittest`.

---

## Pre-execution Update Notes (added 2026-05-25 before execution)

These notes capture drift between this plan as written and current `main` (commit `470cc01`). Apply before starting Task 1.

1. **Plugin path moved.** All `understand-anything-plugin/` references in this file have already been rewritten to `understand-anything-plugin/`. No `tools/` directory exists.
2. **PR #204 (`a59a573`) extracted batching into a new Phase 1.5.** The orchestrator now calls [`compute-batches.mjs`](../../../understand-anything-plugin/skills/understand/compute-batches.mjs) (Louvain community detection) before Phase 2. The prose "Batch the file list from Phase 1 into groups of 20-30 files each" that **Task 4 Step 1** instructs us to replace **no longer exists** in [SKILL.md](../../../understand-anything-plugin/skills/understand/SKILL.md). Phase 2's current opening is just `Load .understand-anything/intermediate/batches.json (produced by Phase 1.5). Iterate the batches[] array.`
   - **Design decision required before Task 4:** where does advice-aware batching live?
     - **Option A (recommended):** push advice scopes into `compute-batches.mjs` as a constraint — Louvain assigns each file a community, but communities must not cross advice-scope boundaries. Code change in one file, batching stays semantic.
     - **Option B:** add a post-process pass in SKILL.md after Phase 1.5 that re-groups `batches.json` entries by most-specific advice scope before iteration. No core code change; batching becomes less semantic.
   - Either way, Task 4 Step 1 needs rewriting against the new layout. The `batch-<index>.json` output contract is unchanged, so Task 6 (merge provenance) is unaffected.
3. **`merge-batch-graphs.py` was extended (+99 lines) by PR #204.** Task 6 still appends `annotate_advice_provenance` before `main()` prints the report — the insertion point is still valid; just verify the new code doesn't conflict with the existing additions.
4. **ESLint baseline now enforced in CI** (commit `a1261b4`). Add `pnpm --dir understand-anything-plugin lint` to Task 8 verification steps so the new TS files clear it.
5. **Execution order:** This spec should run **before** the regenerate plan at `docs/superpowers/plans/2026-05-25-understand-regenerate-workflow.md`. That plan's Phase 2 sidecar wiring assumes a stable batching/merge contract — landing advice first avoids re-rebasing it.
6. **Phase 0.6 numbering** is free: current SKILL.md ends sub-phases at `Phase 0.5 — Ignore Configuration`. The `[Phase N/7]` progress contract is unaffected because sub-phases don't claim a `/7` slot.

---

## File Structure

Implementation target note:
- The editable Understand Anything plugin source is mirrored into `understand-anything-plugin/` so feature work can be tracked and committed by this repository.
- The source mirror excludes local build/dependency output (`dist/`, `node_modules/`, coverage/cache directories).
- `.data/ado/.understand-anything/advice.md` remains a local runtime file because `.data/` is intentionally ignored.

- Create `understand-anything-plugin/packages/core/src/advice-loader.ts`
  - Loads root and nested advice files.
  - Generates a starter advice file.
  - Calculates advice applicable to a project-relative file path.
- Create `understand-anything-plugin/packages/core/src/__tests__/advice-loader.test.ts`
  - Tests root, project, nested advice loading and path matching.
- Modify `understand-anything-plugin/packages/core/src/index.ts`
  - Exports advice loader APIs.
- Modify `understand-anything-plugin/packages/core/src/types.ts`
  - Adds optional node `meta` for persisted provenance.
- Modify `understand-anything-plugin/skills/understand/SKILL.md`
  - Adds advice setup/load phase.
  - Passes advice into scanner, file analyzer, architecture analyzer, and tour builder.
  - Groups batches by most-specific advice scope before falling back to normal 20-30 file batching.
- Modify `understand-anything-plugin/agents/project-scanner.md`
  - Defines advice as non-filtering guidance.
- Modify `understand-anything-plugin/agents/file-analyzer.md`
  - Uses applicable advice as a grounded extraction hint and records advice provenance on file-level nodes.
- Modify `understand-anything-plugin/agents/architecture-analyzer.md`
  - Uses advice scopes as layer hints.
- Modify `understand-anything-plugin/agents/tour-builder.md`
  - Uses advice scopes to select meaningful tour stops across a large full graph.
- Modify `understand-anything-plugin/skills/understand/merge-batch-graphs.py`
  - Adds deterministic node/edge provenance from `advice-context.json`.
- Modify `understand-anything-plugin/skills/understand/test_merge_batch_graphs.py`
  - Tests advice provenance annotation.
- Optional local runtime file generated by the feature, not committed because `.data/` is ignored:
  - `.data/ado/.understand-anything/advice.md`

---

### Task 1: Add Core Advice Loader

**Files:**
- Create: `understand-anything-plugin/packages/core/src/advice-loader.ts`
- Test: `understand-anything-plugin/packages/core/src/__tests__/advice-loader.test.ts`

- [ ] **Step 1: Write failing tests for advice loading**

Create `understand-anything-plugin/packages/core/src/__tests__/advice-loader.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  adviceForPath,
  generateStarterAdviceFile,
  loadAdviceContext,
} from "../advice-loader";

describe("advice-loader", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `advice-loader-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("loads .understand-anything/advice.md and root .understandadvice", () => {
    mkdirSync(join(testDir, ".understand-anything"), { recursive: true });
    writeFileSync(join(testDir, ".understand-anything", "advice.md"), "Project advice");
    writeFileSync(join(testDir, ".understandadvice"), "Root advice");

    const context = loadAdviceContext(testDir);

    expect(context.files.map((file) => file.path)).toEqual([
      ".understand-anything/advice.md",
      ".understandadvice",
    ]);
    expect(context.combinedProjectAdvice).toContain("Project advice");
    expect(context.combinedProjectAdvice).toContain("Root advice");
  });

  it("loads nested .understandadvice files with subtree scopes", () => {
    mkdirSync(join(testDir, "repos", "GlobalLine"), { recursive: true });
    mkdirSync(join(testDir, "repos", "Sql"), { recursive: true });
    writeFileSync(join(testDir, ".understandadvice"), "All repositories");
    writeFileSync(join(testDir, "repos", "GlobalLine", ".understandadvice"), "GlobalLine advice");
    writeFileSync(join(testDir, "repos", "Sql", ".understandadvice"), "Sql advice");

    const context = loadAdviceContext(testDir);

    expect(context.files.map((file) => file.path)).toEqual([
      ".understandadvice",
      "repos/GlobalLine/.understandadvice",
      "repos/Sql/.understandadvice",
    ]);
    expect(context.files.find((file) => file.path.endsWith("GlobalLine/.understandadvice"))?.scope).toBe("repos/GlobalLine");
  });

  it("returns applicable advice ordered from broad to specific", () => {
    mkdirSync(join(testDir, "repos", "GlobalLine", "Server"), { recursive: true });
    writeFileSync(join(testDir, ".understandadvice"), "All repositories");
    writeFileSync(join(testDir, "repos", "GlobalLine", ".understandadvice"), "GlobalLine advice");
    writeFileSync(join(testDir, "repos", "GlobalLine", "Server", ".understandadvice"), "Server advice");

    const context = loadAdviceContext(testDir);
    const matches = adviceForPath(context, "repos/GlobalLine/Server/start.proj");

    expect(matches.map((file) => file.content)).toEqual([
      "All repositories",
      "GlobalLine advice",
      "Server advice",
    ]);
  });

  it("does not apply sibling advice", () => {
    mkdirSync(join(testDir, "repos", "GlobalLine"), { recursive: true });
    mkdirSync(join(testDir, "repos", "Sql"), { recursive: true });
    writeFileSync(join(testDir, "repos", "GlobalLine", ".understandadvice"), "GlobalLine advice");
    writeFileSync(join(testDir, "repos", "Sql", ".understandadvice"), "Sql advice");

    const context = loadAdviceContext(testDir);
    const matches = adviceForPath(context, "repos/Sql/src/Readme.md");

    expect(matches.map((file) => file.content)).toEqual(["Sql advice"]);
  });

  it("generates starter advice with detected ADO repository hints", () => {
    mkdirSync(join(testDir, ".data", "ado", "tfsonprem", "repos"), { recursive: true });
    mkdirSync(join(testDir, ".data", "ado", "tfsintegrations", "repos"), { recursive: true });

    const starter = generateStarterAdviceFile(testDir);

    expect(starter).toContain("# Understand Advice");
    expect(starter).toContain(".data/ado/tfsonprem/repos");
    expect(starter).toContain(".data/ado/tfsintegrations/repos");
    expect(starter).toContain("Use existing graph edge types");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```powershell
pnpm --dir understand-anything-plugin --filter @understand-anything/core test -- advice-loader.test.ts
```

Expected: FAIL because `../advice-loader` does not exist.

- [ ] **Step 3: Implement the advice loader**

Create `understand-anything-plugin/packages/core/src/advice-loader.ts`:

```ts
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

const NESTED_ADVICE_FILE = ".understandadvice";
const PROJECT_ADVICE_FILE = join(".understand-anything", "advice.md");

const SKIPPED_DIRECTORIES = new Set([
  ".git",
  ".understand-anything",
  "node_modules",
  "vendor",
  "venv",
  ".venv",
  "__pycache__",
  "dist",
  "build",
  "out",
  "coverage",
  ".next",
  ".cache",
  ".turbo",
  "target",
  "obj",
]);

export interface AdviceFile {
  path: string;
  scope: string;
  appliesTo: string[];
  content: string;
  source: "project" | "root" | "nested";
}

export interface AdviceContext {
  files: AdviceFile[];
  combinedProjectAdvice: string;
}

function toPosix(path: string): string {
  return path.split(sep).join("/");
}

function normalizeScope(projectRoot: string, absoluteAdvicePath: string): string {
  const raw = toPosix(relative(projectRoot, dirname(absoluteAdvicePath)));
  return raw === "" ? "." : raw;
}

function adviceFile(projectRoot: string, absolutePath: string, source: AdviceFile["source"]): AdviceFile {
  const path = toPosix(relative(projectRoot, absolutePath));
  const scope = source === "project" ? "." : normalizeScope(projectRoot, absolutePath);
  const appliesTo = scope === "." ? ["**/*"] : [`${scope}/**/*`];
  return {
    path,
    scope,
    appliesTo,
    content: readFileSync(absolutePath, "utf-8").trim(),
    source,
  };
}

function walkForNestedAdvice(projectRoot: string, currentDir: string, out: AdviceFile[]): void {
  for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
      walkForNestedAdvice(projectRoot, join(currentDir, entry.name), out);
      continue;
    }

    if (!entry.isFile() || entry.name !== NESTED_ADVICE_FILE) continue;

    const absolutePath = join(currentDir, entry.name);
    const relativePath = toPosix(relative(projectRoot, absolutePath));
    if (relativePath === NESTED_ADVICE_FILE) continue;
    out.push(adviceFile(projectRoot, absolutePath, "nested"));
  }
}

export function loadAdviceContext(projectRoot: string): AdviceContext {
  const root = resolve(projectRoot);
  const files: AdviceFile[] = [];

  const projectAdvicePath = join(root, PROJECT_ADVICE_FILE);
  if (existsSync(projectAdvicePath)) {
    files.push(adviceFile(root, projectAdvicePath, "project"));
  }

  const rootAdvicePath = join(root, NESTED_ADVICE_FILE);
  if (existsSync(rootAdvicePath)) {
    files.push(adviceFile(root, rootAdvicePath, "root"));
  }

  walkForNestedAdvice(root, root, files);

  files.sort((a, b) => a.path.localeCompare(b.path));

  return {
    files,
    combinedProjectAdvice: files
      .filter((file) => file.scope === ".")
      .map((file) => `## ${file.path}\n\n${file.content}`)
      .join("\n\n"),
  };
}

export function adviceForPath(context: AdviceContext, relativePath: string): AdviceFile[] {
  const normalized = toPosix(relativePath);
  return context.files
    .filter((file) => file.scope === "." || normalized === file.scope || normalized.startsWith(`${file.scope}/`))
    .sort((a, b) => {
      if (a.scope === b.scope) return a.path.localeCompare(b.path);
      if (a.scope === ".") return -1;
      if (b.scope === ".") return 1;
      return a.scope.split("/").length - b.scope.split("/").length;
    });
}

export function generateStarterAdviceFile(projectRoot: string): string {
  const root = resolve(projectRoot);
  const detectedBoundaries: string[] = [];

  for (const candidate of [
    ".data/ado/tfsonprem/repos",
    ".data/ado/tfsintegrations/repos",
    "packages",
    "apps",
    "src",
  ]) {
    if (existsSync(join(root, candidate))) {
      detectedBoundaries.push(candidate);
    }
  }

  const boundaryLines =
    detectedBoundaries.length === 0
      ? "- Treat each top-level application, package, service, or source mirror as its own analysis slice."
      : detectedBoundaries.map((boundary) => `- Treat \`${boundary}\` children as candidate repository or product slices.`).join("\n");

  return `# Understand Advice

This file gives Understand Anything project-specific guidance. It does not exclude files. Use .understandignore for filtering.

## Project Boundaries

${boundaryLines}

## Relationship Guidance

- Use existing graph edge types such as imports, depends_on, configures, deploys, routes, defines_schema, reads_from, writes_to, publishes, subscribes, transforms, and related.
- Prefer deterministic file evidence over naming guesses.
- Treat config, manifest, service wrapper, pipeline, SQL, and build files as first-class graph evidence.

## Noise Guidance

- Keep source-controlled deployable assets even when they are generated from another engine or platform.
- Down-rank generated, vendor, runtime, cache, and binary payloads unless a local advice file says they are source-of-truth inputs.
`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```powershell
pnpm --dir understand-anything-plugin --filter @understand-anything/core test -- advice-loader.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add understand-anything-plugin/packages/core/src/advice-loader.ts understand-anything-plugin/packages/core/src/__tests__/advice-loader.test.ts
git commit -m "feat(ua): add understand advice loader"
```

---

### Task 2: Export Advice APIs And Persist Node Provenance Type

**Files:**
- Modify: `understand-anything-plugin/packages/core/src/index.ts`
- Modify: `understand-anything-plugin/packages/core/src/types.ts`
- Test: `understand-anything-plugin/packages/core/src/__tests__/advice-loader.test.ts`

- [ ] **Step 1: Write a failing export assertion**

Append to `understand-anything-plugin/packages/core/src/__tests__/advice-loader.test.ts`:

```ts
import * as core from "../index";

describe("advice-loader public exports", () => {
  it("exports advice helpers from the core package index", () => {
    expect(core.loadAdviceContext).toBeTypeOf("function");
    expect(core.generateStarterAdviceFile).toBeTypeOf("function");
    expect(core.adviceForPath).toBeTypeOf("function");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```powershell
pnpm --dir understand-anything-plugin --filter @understand-anything/core test -- advice-loader.test.ts
```

Expected: FAIL because the helpers are not exported from `index.ts`.

- [ ] **Step 3: Export advice helpers**

Add this block near the ignore exports in `understand-anything-plugin/packages/core/src/index.ts`:

```ts
export {
  adviceForPath,
  generateStarterAdviceFile,
  loadAdviceContext,
  type AdviceContext,
  type AdviceFile,
} from "./advice-loader.js";
```

- [ ] **Step 4: Add node meta typing**

Modify `GraphNode` in `understand-anything-plugin/packages/core/src/types.ts` by adding:

```ts
  meta?: Record<string, unknown>;
```

The resulting interface section must include:

```ts
export interface GraphNode {
  id: string;
  type: NodeType;
  name: string;
  filePath?: string;
  lineRange?: [number, number];
  summary: string;
  tags: string[];
  complexity: "simple" | "moderate" | "complex";
  languageNotes?: string;
  domainMeta?: DomainMeta;
  knowledgeMeta?: KnowledgeMeta;
  meta?: Record<string, unknown>;
}
```

- [ ] **Step 5: Run focused tests and type build**

Run:

```powershell
pnpm --dir understand-anything-plugin --filter @understand-anything/core test -- advice-loader.test.ts
pnpm --dir understand-anything-plugin --filter @understand-anything/core build
```

Expected: both commands PASS.

- [ ] **Step 6: Commit**

```powershell
git add understand-anything-plugin/packages/core/src/index.ts understand-anything-plugin/packages/core/src/types.ts understand-anything-plugin/packages/core/src/__tests__/advice-loader.test.ts
git commit -m "feat(ua): export understand advice APIs"
```

---

### Task 3: Add Advice Setup To The Understand Skill

**Files:**
- Modify: `understand-anything-plugin/skills/understand/SKILL.md`

- [ ] **Step 1: Add a Phase 0.6 section after Phase 0.5 Ignore Configuration**

Insert this section after Phase 0.5:

```markdown
---

## Phase 0.6 — Advice Configuration

Set up and load Understand advice before scanning. Advice files guide analysis and batching; they do not exclude files. Use `.understandignore` for filtering.

1. Check for advice files:
   - `$PROJECT_ROOT/.understand-anything/advice.md`
   - `$PROJECT_ROOT/.understandadvice`
   - nested `.understandadvice` files below `$PROJECT_ROOT`
2. If none exist, generate `$PROJECT_ROOT/.understand-anything/advice.md`:
   ```bash
   node --input-type=module -e "
   import { mkdirSync, writeFileSync } from 'node:fs';
   import { join } from 'node:path';
   import { pathToFileURL } from 'node:url';
   const corePath = process.argv[1];
   const projectRoot = process.argv[2];
   const core = await import(pathToFileURL(corePath).href);
   const outDir = join(projectRoot, '.understand-anything');
   mkdirSync(outDir, { recursive: true });
   writeFileSync(join(outDir, 'advice.md'), core.generateStarterAdviceFile(projectRoot), 'utf-8');
   " "$PLUGIN_ROOT/packages/core/dist/index.js" "$PROJECT_ROOT"
   ```
   Report:
   > Generated `.understand-anything/advice.md` with project-specific analysis guidance. Please review it, then confirm to continue.
   Wait for user confirmation before proceeding.
3. If at least one advice file exists, report:
   > Found Understand advice files. Review them if needed, then confirm to continue.
   Wait for user confirmation before proceeding.
4. Load advice context:
   ```bash
   node --input-type=module -e "
   import { mkdirSync, writeFileSync } from 'node:fs';
   import { join } from 'node:path';
   import { pathToFileURL } from 'node:url';
   const corePath = process.argv[1];
   const projectRoot = process.argv[2];
   const core = await import(pathToFileURL(corePath).href);
   const context = core.loadAdviceContext(projectRoot);
   const outDir = join(projectRoot, '.understand-anything', 'intermediate');
   mkdirSync(outDir, { recursive: true });
   writeFileSync(join(outDir, 'advice-context.json'), JSON.stringify(context, null, 2), 'utf-8');
   console.log(JSON.stringify({ adviceFiles: context.files.length, paths: context.files.map(f => f.path) }, null, 2));
   " "$PLUGIN_ROOT/packages/core/dist/index.js" "$PROJECT_ROOT"
   ```
5. Store the loaded JSON as `$ADVICE_CONTEXT`.
6. Store this rendered prompt block as `$ADVICE_DIRECTIVE`:
   ```markdown
   > **Understand advice directive**: Use the loaded advice files as project-specific guidance for scoping, batching, and relationship interpretation. Advice never overrides source evidence. Do not invent files, nodes, or edges from advice alone. Use only existing graph node and edge types.
   ```
```

- [ ] **Step 2: Add advice to Phase 1 scanner dispatch**

In Phase 1, inside the "Additional context from main session" block, add:

```markdown
> Understand advice:
> ```json
> $ADVICE_CONTEXT
> ```
>
> $ADVICE_DIRECTIVE
```

- [ ] **Step 3: Add advice to Phase 4 and Phase 5 prompts**

In Phase 4 architecture context, add:

```markdown
> Understand advice:
> ```json
> $ADVICE_CONTEXT
> ```
>
> Treat advice scopes as layer hints when supported by the graph topology.
>
> $ADVICE_DIRECTIVE
```

In Phase 5 tour context, add:

```markdown
> Understand advice:
> ```json
> $ADVICE_CONTEXT
> ```
>
> Use advice scopes to ensure the tour includes important project areas from the full graph.
>
> $ADVICE_DIRECTIVE
```

- [ ] **Step 4: Run a Markdown sanity check**

Run:

```powershell
rg -n "Phase 0.6|ADVICE_CONTEXT|ADVICE_DIRECTIVE|advice-context.json" understand-anything-plugin/skills/understand/SKILL.md
```

Expected: output includes all four terms.

- [ ] **Step 5: Commit**

```powershell
git add understand-anything-plugin/skills/understand/SKILL.md
git commit -m "feat(ua): load understand advice during analysis"
```

---

### Task 4: Make Compute-Batches Advice-Aware While Keeping One Final Graph

> **Note (added 2026-05-25):** PR #204 (`a59a573`) introduced [`compute-batches.mjs`](../../../understand-anything-plugin/skills/understand/compute-batches.mjs) as Phase 1.5. Batching decisions live there now — not in SKILL.md prose. This task pushes advice-scope awareness into Louvain itself rather than re-grouping its output (which would discard Louvain's semantic clustering).
>
> **Strategy:** drop cross-scope import edges before running Louvain. Disconnected subgraphs naturally produce separate communities → batches respect scope without losing within-scope semantic cohesion. Tag every batch with `primaryAdviceScope` so the orchestrator can pick the right advice files for each dispatch.

**Files:**
- Modify: `understand-anything-plugin/skills/understand/compute-batches.mjs`
- Create: `understand-anything-plugin/skills/understand/test_compute_batches_scope.mjs`
- Modify: `understand-anything-plugin/skills/understand/SKILL.md`
- Modify: `understand-anything-plugin/agents/file-analyzer.md`

- [ ] **Step 1: Write a failing scope-isolation test**

Create `understand-anything-plugin/skills/understand/test_compute_batches_scope.mjs`:

```js
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```powershell
node understand-anything-plugin/skills/understand/test_compute_batches_scope.mjs
```

Expected: FAIL — `Batch N crosses advice scopes` or `missing primaryAdviceScope`, because `compute-batches.mjs` has no scope awareness yet.

- [ ] **Step 3: Make `compute-batches.mjs` scope-aware**

Edit `understand-anything-plugin/skills/understand/compute-batches.mjs`:

**3a. Load advice context.** In `main()`, after `const scan = JSON.parse(readFileSync(scanPath, 'utf-8'));` and before the `extractExports` call, add:

```js
// Optional: load Phase 0.6 advice context if present.
let adviceContext = null;
const advicePath = join(projectRoot, '.understand-anything', 'intermediate', 'advice-context.json');
if (existsSync(advicePath)) {
  try {
    adviceContext = JSON.parse(readFileSync(advicePath, 'utf-8'));
    process.stderr.write(`Loaded advice context: ${adviceContext.files?.length ?? 0} files\n`);
  } catch (err) {
    process.stderr.write(
      `Warning: compute-batches: advice-context.json unreadable (${err.message}) ` +
      `— falling back to scope-unaware batching\n`,
    );
  }
}
```

**3b. Add a `buildScopeMap` helper.** Place it next to `runLouvain` (above it):

```js
/**
 * Most-specific advice scope per code file. When no advice matches a file → root scope ".".
 * When adviceContext is null → every file gets scope "." (current/pre-advice behavior).
 */
function buildScopeMap(codeFiles, ctx) {
  const m = new Map();
  if (!ctx) {
    for (const f of codeFiles) m.set(f.path, '.');
    return m;
  }
  for (const f of codeFiles) {
    const matches = core.adviceForPath(ctx, f.path);
    // adviceForPath returns broad-to-specific; last entry is most-specific.
    const primary = matches.length ? matches[matches.length - 1].scope : '.';
    m.set(f.path, primary);
  }
  return m;
}
```

**3c. Make `runLouvain` drop cross-scope edges.** Change its signature and edge loop:

```js
function runLouvain(codeFiles, importMap, scopeMap) {
  if (process.env.UA_COMPUTE_BATCHES_FORCE_LOUVAIN_THROW === '1') {
    throw new Error('forced throw via UA_COMPUTE_BATCHES_FORCE_LOUVAIN_THROW');
  }
  const g = new Graph({ type: 'undirected', allowSelfLoops: false });
  for (const f of codeFiles) g.addNode(f.path);
  for (const [src, targets] of Object.entries(importMap)) {
    if (!g.hasNode(src)) continue;
    const srcScope = scopeMap.get(src);
    for (const tgt of targets) {
      if (!g.hasNode(tgt) || src === tgt || g.hasEdge(src, tgt)) continue;
      // Advice-aware: cross-scope import edges do not influence community membership.
      if (scopeMap.get(tgt) !== srcScope) continue;
      g.addEdge(src, tgt);
    }
  }
  const cs = louvain(g);
  return new Map(Object.entries(cs));
}
```

**3d. Pass the scope map into the Louvain call.** Replace the existing `runLouvain(codeFiles, importMap)` with:

```js
const scopeMap = buildScopeMap(codeFiles, adviceContext);
// ...
perFileCommunity = runLouvain(codeFiles, importMap, scopeMap);
```

Also update the `countBasedAssignment` fallback path to keep scope respect — wrap the fallback so it runs per-scope:

```js
} catch (err) {
  process.stderr.write(
    `Warning: compute-batches: Louvain failed (${err.message}) ` +
    `— falling back to count-based grouping (12 files/batch, scope-respecting) ` +
    `— module semantic boundaries lost\n`,
  );
  perFileCommunity = new Map();
  const filesByScope = new Map();
  for (const f of codeFiles) {
    const scope = scopeMap.get(f.path) ?? '.';
    if (!filesByScope.has(scope)) filesByScope.set(scope, []);
    filesByScope.get(scope).push(f);
  }
  for (const [scope, scopeFiles] of filesByScope) {
    const partial = countBasedAssignment(scopeFiles, 12);
    for (const [path, cid] of partial) perFileCommunity.set(path, `${scope}::${cid}`);
  }
  algorithm = 'count-fallback';
}
```

**3e. Tag every bare batch with `primaryAdviceScope`.** After `codeBatchObjsBare` and `nonCodeBatchObjsBare` are built, before `mergeSmallBatches` is called:

```js
for (const b of codeBatchObjsBare) {
  const scopes = new Set(b.files.map((f) => scopeMap.get(f.path) ?? '.'));
  b.primaryAdviceScope = scopes.size === 1 ? [...scopes][0] : '.';
}
for (const b of nonCodeBatchObjsBare) {
  // Non-code groups are already directory-clustered; derive scope from any file.
  const firstPath = b.files[0]?.path ?? '';
  b.primaryAdviceScope = adviceContext
    ? (core.adviceForPath(adviceContext, firstPath).at(-1)?.scope ?? '.')
    : '.';
}
```

**3f. Make `mergeSmallBatches` partition by scope.** Replace the body of `mergeSmallBatches`:

```js
function mergeSmallBatches(bareBatches) {
  const MIN_BATCH_SIZE = 3;
  const MAX_MERGE_TARGET = 25;

  const keepers = [];
  const smallByScope = new Map();
  for (const b of bareBatches) {
    if (b.mergeable && b.files.length < MIN_BATCH_SIZE) {
      const scope = b.primaryAdviceScope ?? '.';
      if (!smallByScope.has(scope)) smallByScope.set(scope, []);
      smallByScope.get(scope).push(b);
    } else {
      keepers.push(b);
    }
  }

  if (smallByScope.size === 0) {
    return keepers.map((b, i) => ({
      batchIndex: i + 1,
      files: b.files,
      primaryAdviceScope: b.primaryAdviceScope ?? '.',
    }));
  }

  const miscBatches = [];
  let totalPooled = 0;
  for (const [scope, smalls] of smallByScope) {
    const pooledFiles = smalls
      .flatMap((b) => b.files)
      .sort((a, b) => a.path.localeCompare(b.path));
    totalPooled += pooledFiles.length;
    for (let i = 0; i < pooledFiles.length; i += MAX_MERGE_TARGET) {
      miscBatches.push({
        files: pooledFiles.slice(i, i + MAX_MERGE_TARGET),
        primaryAdviceScope: scope,
      });
    }
  }

  process.stderr.write(
    `Info: compute-batches: merged small batches per advice scope ` +
    `(${smallByScope.size} scopes, ${totalPooled} files) into ${miscBatches.length} misc batches ` +
    `— singletons and orphans consolidated within scope\n`,
  );

  const final = [...keepers, ...miscBatches];
  return final.map((b, i) => ({
    batchIndex: i + 1,
    files: b.files,
    primaryAdviceScope: b.primaryAdviceScope ?? '.',
  }));
}
```

**3g. Carry `primaryAdviceScope` through the second-pass enrichment.** In the `mergedBareBatches.map(b => { ... })` block that builds the final `batches` array, include the field in the returned object:

```js
return {
  batchIndex: b.batchIndex,
  files: b.files,
  primaryAdviceScope: b.primaryAdviceScope ?? '.',
  batchImportData,
  neighborMap,
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run:

```powershell
node understand-anything-plugin/skills/understand/test_compute_batches_scope.mjs
```

Expected: PASS — `PASS: compute-batches respects advice scopes`.

- [ ] **Step 5: Add batch advice to the file-analyzer dispatch prompt**

In the Phase 2 file-analyzer dispatch prompt (in [SKILL.md](../../../understand-anything-plugin/skills/understand/SKILL.md)), after the pre-resolved import data block, add:

```markdown
> Applicable advice for this batch (scope: `<batch.primaryAdviceScope>`):
> ```json
> <advice files from $ADVICE_CONTEXT whose scope equals the batch's primaryAdviceScope OR is an ancestor of it (broad to specific)>
> ```
>
> $ADVICE_DIRECTIVE
```

The orchestrator computes the matching advice files by reading `batch.primaryAdviceScope` from `batches.json` (Phase 1.5 output) and selecting `$ADVICE_CONTEXT.files` whose `scope` equals `batch.primaryAdviceScope` OR is an ancestor (root `.` or a path prefix). This mirrors the broad-to-specific ordering already produced by `core.adviceForPath`.

- [ ] **Step 6: Update file-analyzer guidance**

Add this section to `understand-anything-plugin/agents/file-analyzer.md` after the language directive section:

```markdown
**Understand advice:** If the dispatch prompt includes applicable advice files, use them as analysis guidance for this batch. Advice can tell you that XML manifests, SQL metadata rows, native project files, service wrappers, or runtime config strings are important. Advice is not evidence by itself. Every node and edge must still be grounded in files from `batchFiles`, `batchImportData`, or deterministic extraction output.

When creating file-level nodes, include advice provenance if applicable:

```json
"meta": {
  "adviceFiles": ["repos/GlobalLine/.understandadvice"],
  "adviceScopes": ["repos/GlobalLine"]
}
```

Do not add `meta.adviceFiles` to function or class nodes unless the prompt explicitly marks the function or class as part of an advised runtime mechanism and the file evidence supports that claim.
```

- [ ] **Step 7: Verify everything is wired**

Run:

```powershell
node understand-anything-plugin/skills/understand/test_compute_batches_scope.mjs
rg -n "primaryAdviceScope|Applicable advice for this batch|meta.adviceFiles|adviceScopes" understand-anything-plugin/skills/understand/SKILL.md understand-anything-plugin/skills/understand/compute-batches.mjs understand-anything-plugin/agents/file-analyzer.md
```

Expected: scope-isolation test passes; ripgrep output includes `primaryAdviceScope` in both `compute-batches.mjs` and `SKILL.md`, plus the existing batching and provenance terms.

- [ ] **Step 8: Commit**

```powershell
git add understand-anything-plugin/skills/understand/compute-batches.mjs understand-anything-plugin/skills/understand/test_compute_batches_scope.mjs understand-anything-plugin/skills/understand/SKILL.md understand-anything-plugin/agents/file-analyzer.md
git commit -m "feat(ua): make compute-batches respect advice scopes"
```

---

### Task 5: Teach Scanner, Architecture, And Tour Agents How To Use Advice

**Files:**
- Modify: `understand-anything-plugin/agents/project-scanner.md`
- Modify: `understand-anything-plugin/agents/architecture-analyzer.md`
- Modify: `understand-anything-plugin/agents/tour-builder.md`

- [ ] **Step 1: Add scanner advice rules**

Add this section to `understand-anything-plugin/agents/project-scanner.md` after the language directive:

```markdown
**Understand advice:** If the dispatch prompt includes advice context, use it only to improve the synthesized project description and to name obvious project boundaries. Advice must not change deterministic file discovery, file filtering, language detection, line counts, or import resolution. `.understandignore` controls filtering; advice does not.
```

- [ ] **Step 2: Add architecture advice rules**

Add this section to `understand-anything-plugin/agents/architecture-analyzer.md` after the language directive:

```markdown
**Understand advice:** If the dispatch prompt includes advice context, treat advice scopes as candidate layer boundaries. Prefer graph topology and directory structure over advice when they conflict. Use advice to avoid flattening large multi-repository mirrors into one generic layer.
```

- [ ] **Step 3: Add tour advice rules**

Add this section to `understand-anything-plugin/agents/tour-builder.md` after the language directive:

```markdown
**Understand advice:** If the dispatch prompt includes advice context, use it to choose representative tour stops across the full graph. For large source mirrors, include at least one stop from each high-value advice scope that has file-level nodes in the graph, unless the graph evidence shows that scope is generated or vendor-only.
```

- [ ] **Step 4: Verify agent prompt updates**

Run:

```powershell
rg -n "Understand advice" understand-anything-plugin/agents/project-scanner.md understand-anything-plugin/agents/architecture-analyzer.md understand-anything-plugin/agents/tour-builder.md
```

Expected: each agent file contains one `Understand advice` section.

- [ ] **Step 5: Commit**

```powershell
git add understand-anything-plugin/agents/project-scanner.md understand-anything-plugin/agents/architecture-analyzer.md understand-anything-plugin/agents/tour-builder.md
git commit -m "feat(ua): guide analyzers with understand advice"
```

---

### Task 6: Add Deterministic Advice Provenance During Merge

**Files:**
- Modify: `understand-anything-plugin/skills/understand/merge-batch-graphs.py`
- Modify: `understand-anything-plugin/skills/understand/test_merge_batch_graphs.py`

- [ ] **Step 1: Add failing tests for advice provenance**

Append to `understand-anything-plugin/skills/understand/test_merge_batch_graphs.py`:

```py
class AdviceProvenanceTests(unittest.TestCase):
    def test_advice_files_for_path_returns_broad_to_specific(self) -> None:
        context = {
            "files": [
                {"path": ".understandadvice", "scope": ".", "content": "root"},
                {"path": "repos/GlobalLine/.understandadvice", "scope": "repos/GlobalLine", "content": "gl"},
                {"path": "repos/GlobalLine/Server/.understandadvice", "scope": "repos/GlobalLine/Server", "content": "server"},
            ]
        }

        matches = mbg.advice_files_for_path(context, "repos/GlobalLine/Server/start.proj")

        self.assertEqual([m["path"] for m in matches], [
            ".understandadvice",
            "repos/GlobalLine/.understandadvice",
            "repos/GlobalLine/Server/.understandadvice",
        ])

    def test_annotates_nodes_and_cross_scope_edges(self) -> None:
        project_root = Path(self._testMethodName)
        try:
            intermediate = project_root / ".understand-anything" / "intermediate"
            intermediate.mkdir(parents=True)
            (intermediate / "advice-context.json").write_text(
                json.dumps({
                    "files": [
                        {"path": ".understandadvice", "scope": ".", "content": "root"},
                        {"path": "repos/GlobalLine/.understandadvice", "scope": "repos/GlobalLine", "content": "gl"},
                        {"path": "repos/Sql/.understandadvice", "scope": "repos/Sql", "content": "sql"},
                    ]
                }),
                encoding="utf-8",
            )
            assembled = {
                "nodes": [
                    _file_node("repos/GlobalLine/start.proj"),
                    _file_node("repos/Sql/src/Readme.md"),
                ],
                "edges": [
                    {
                        "source": "file:repos/GlobalLine/start.proj",
                        "target": "file:repos/Sql/src/Readme.md",
                        "type": "related",
                        "direction": "forward",
                        "weight": 0.5,
                    }
                ],
            }

            nodes, edges = mbg.annotate_advice_provenance(assembled, project_root)

            self.assertEqual(nodes, 2)
            self.assertEqual(edges, 1)
            gl_node = assembled["nodes"][0]
            sql_node = assembled["nodes"][1]
            self.assertEqual(gl_node["meta"]["primaryAdviceScope"], "repos/GlobalLine")
            self.assertEqual(sql_node["meta"]["primaryAdviceScope"], "repos/Sql")
            self.assertTrue(assembled["edges"][0]["meta"]["crossAdviceScope"])
        finally:
            if project_root.exists():
                import shutil
                shutil.rmtree(project_root)
```

Also add these imports near the top if they are not present:

```py
import json
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```powershell
python understand-anything-plugin/skills/understand/test_merge_batch_graphs.py -v
```

Expected: FAIL because `advice_files_for_path` and `annotate_advice_provenance` do not exist.

- [ ] **Step 3: Implement provenance helpers**

Add these functions to `understand-anything-plugin/skills/understand/merge-batch-graphs.py` before `main()`:

```py
def load_advice_context(project_root: Path) -> dict[str, Any] | None:
    path = project_root / ".understand-anything" / "intermediate" / "advice-context.json"
    if not path.is_file():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(data.get("files"), list):
        return None
    return data


def advice_files_for_path(context: dict[str, Any], file_path: str) -> list[dict[str, Any]]:
    matches: list[dict[str, Any]] = []
    normalized = file_path.replace("\\", "/")
    for item in context.get("files", []):
        if not isinstance(item, dict):
            continue
        scope = item.get("scope")
        if not isinstance(scope, str) or not scope:
            continue
        if scope == "." or normalized == scope or normalized.startswith(f"{scope}/"):
            matches.append(item)

    def sort_key(item: dict[str, Any]) -> tuple[int, str]:
        scope = item.get("scope", ".")
        if scope == ".":
            return (0, item.get("path", ""))
        return (len(scope.split("/")), item.get("path", ""))

    return sorted(matches, key=sort_key)


def _node_file_path(node: dict[str, Any]) -> str | None:
    value = node.get("filePath")
    if isinstance(value, str) and value:
        return value.replace("\\", "/")
    node_id = node.get("id")
    if isinstance(node_id, str) and node_id.startswith("file:"):
        return node_id[len("file:"):].replace("\\", "/")
    return None


def annotate_advice_provenance(assembled: dict[str, Any], project_root: Path) -> tuple[int, int]:
    context = load_advice_context(project_root)
    if context is None:
        return 0, 0

    primary_scope_by_node_id: dict[str, str] = {}
    annotated_nodes = 0
    for node in assembled.get("nodes", []):
        if not isinstance(node, dict):
            continue
        file_path = _node_file_path(node)
        if not file_path:
            continue
        matches = advice_files_for_path(context, file_path)
        if not matches:
            continue
        scopes = [m.get("scope") for m in matches if isinstance(m.get("scope"), str)]
        paths = [m.get("path") for m in matches if isinstance(m.get("path"), str)]
        primary_scope = scopes[-1]
        primary_scope_by_node_id[node.get("id", "")] = primary_scope
        meta = node.get("meta")
        if not isinstance(meta, dict):
            meta = {}
            node["meta"] = meta
        meta["adviceFiles"] = paths
        meta["adviceScopes"] = scopes
        meta["primaryAdviceScope"] = primary_scope
        annotated_nodes += 1

    annotated_edges = 0
    for edge in assembled.get("edges", []):
        if not isinstance(edge, dict):
            continue
        src_scope = primary_scope_by_node_id.get(edge.get("source", ""))
        tgt_scope = primary_scope_by_node_id.get(edge.get("target", ""))
        if not src_scope or not tgt_scope or src_scope == tgt_scope:
            continue
        meta = edge.get("meta")
        if not isinstance(meta, dict):
            meta = {}
            edge["meta"] = meta
        meta["crossAdviceScope"] = True
        meta["sourceAdviceScope"] = src_scope
        meta["targetAdviceScope"] = tgt_scope
        annotated_edges += 1

    return annotated_nodes, annotated_edges
```

- [ ] **Step 4: Call provenance annotation from `main()`**

In `main()`, after import recovery and before printing the report, add:

```py
    advice_nodes, advice_edges = annotate_advice_provenance(assembled, project_root)
    if advice_nodes or advice_edges:
        report.append("")
        report.append("Advice provenance:")
        report.append(f"  Annotated {advice_nodes} nodes with advice scope metadata")
        report.append(f"  Annotated {advice_edges} cross-scope edges")
```

- [ ] **Step 5: Run merge tests**

Run:

```powershell
python understand-anything-plugin/skills/understand/test_merge_batch_graphs.py -v
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add understand-anything-plugin/skills/understand/merge-batch-graphs.py understand-anything-plugin/skills/understand/test_merge_batch_graphs.py
git commit -m "feat(ua): preserve advice provenance in merged graphs"
```

---

### Task 7: Add ADO-Specific Starter Advice Path For The First Full Graph Run

**Files:**
- Runtime generated: `.data/ado/.understand-anything/advice.md`
- No committed source file unless the user chooses to preserve the generated local advice elsewhere.

- [ ] **Step 1: Generate starter advice for `.data/ado`**

Run after Tasks 1-6 are implemented and built:

```powershell
pnpm --dir understand-anything-plugin --filter @understand-anything/core build
node --input-type=module -e "import { mkdirSync, writeFileSync } from 'node:fs'; import { join } from 'node:path'; import { pathToFileURL } from 'node:url'; const core = await import(pathToFileURL(process.argv[1]).href); const projectRoot = process.argv[2]; const outDir = join(projectRoot, '.understand-anything'); mkdirSync(outDir, { recursive: true }); writeFileSync(join(outDir, 'advice.md'), core.generateStarterAdviceFile(projectRoot), 'utf-8');" "understand-anything-plugin/packages/core/dist/index.js" ".data/ado"
```

Expected: `.data/ado/.understand-anything/advice.md` exists.

- [ ] **Step 2: Replace the starter content with ADO research-backed guidance**

Open `.data/ado/.understand-anything/advice.md` and replace its content with:

```markdown
# Understand Advice

This file guides full-graph analysis for the local ADO source mirror. It does not exclude files. Use .understandignore for filtering.

## Project Boundaries

- Treat `tfsonprem/repos/GlobalLine/src/Server` as the GlobalLine server slice.
- Treat `tfsonprem/repos/GlobalLine/src/Desktop` as the GlobalLine desktop slice.
- Treat `tfsonprem/repos/Kernel/src` as the native Kernel slice.
- Treat `tfsonprem/repos/Sql/src` as the SQL/database asset slice.
- Treat `tfsonprem/repos/Application/src` as the application script/XML slice.
- Treat `tfsintegrations/repos/GenericCam/src` as the GenericCam integration slice.
- Treat `tfsonprem/repos/TdmApi/src/rest-service` as the WSAPISRV/TdmApi service slice.
- Treat `tfsonprem/repos/MachineControlConnect/src` as the MachineControlConnect slice.

## Relationship Guidance

- Use existing graph edge types only.
- For GlobalLine Server, treat `ServiceConfiguration.config`, `InterfaceModulesConfiguration.config`, Web.config `configSource`, component service executables, and WCF/API host config as graph evidence.
- For GlobalLine Desktop, treat `.info` files, `ModuleStartUri`, widget layout XML, `.custom` MSBuild files, `PlugIn.properties`, and server client references as graph evidence.
- For Kernel, treat `.sln`, `.vcxproj`, include directories, import libraries, NuGet package specs, sys/sysu/sysmore outputs, and TdmApi copy aliases as graph evidence.
- For Sql, treat `Oracle/**`, `SqlServer/**`, `Tools/**`, `.azure-pipelines/**`, `TMS_VERSION.MOD`, `TMS_TABLEBASEEXPDATA`, `DATA_TABLESCOPYTOMASTER`, `TMS_MENUEX.PROGRAM`, `TMS_SYS`, and `SYS_ENV` as graph evidence.
- For Application, treat `.app`, `.scr`, `.msg`, `.tpl`, service wrappers, embedded SQL names, message IDs, table IDs, and script calls as graph evidence.
- For GenericCam, treat mode selection, plugin app config, package references, TDMGlobalLine/TDMV4 boundaries, and mapping contracts as graph evidence.
- For TdmApi, treat Maven profiles, final jar names, package excludes, runtime properties, service wrappers, database config, and MQTT topic config as graph evidence.
- For MachineControlConnect, treat `MCC.ini`, config classes, connector activation, MQTT topics, and TdmApi subservice activation as graph evidence.

## Noise Guidance

- Down-rank generated, vendor, binary, runtime cache, IDE, and pipeline work-output paths.
- Do not discard checked-in SqlServer SQL files wholesale; many are generated from Oracle, but some are asymmetric and deployable.
- Do not discard Kernel `sysmore` references when they explain runtime packaging, but avoid expanding vendored JRE, Python, and third-party library internals unless directly referenced.
```

- [ ] **Step 3: Create an ADO `.understandignore` before the first full graph run**

Create `.data/ado/.understandignore` with:

```gitignore
**/.git/
**/.vs/
**/node_modules/
**/bin/
**/obj/
**/dist/
**/build/
**/out/
**/.cache/
**/*.dll
**/*.exe
**/*.pdb
**/*.zip
**/*.tar
**/*.gz
**/*.7z
**/*.msi
**/*.nupkg
**/sysmore/JRE*/
**/sysmore/Python*/
**/sysmore/LIBS*/
**/installer/dependencies/node/
**/installer/dependencies/dbeaver/
```

- [ ] **Step 4: Verify local advice files load**

Run:

```powershell
node --input-type=module -e "import { pathToFileURL } from 'node:url'; const core = await import(pathToFileURL(process.argv[1]).href); const context = core.loadAdviceContext(process.argv[2]); console.log(JSON.stringify({ count: context.files.length, paths: context.files.map(f => f.path) }, null, 2));" "understand-anything-plugin/packages/core/dist/index.js" ".data/ado"
```

Expected: output includes `.understand-anything/advice.md` and any nested `.understandadvice` files if added later.

- [ ] **Step 5: No commit for ignored ADO runtime files**

Run:

```powershell
git check-ignore -v .data/ado/.understand-anything/advice.md .data/ado/.understandignore
```

Expected: both files are ignored by the repository-level `.gitignore` rule for `.data/`.

---

### Task 8: Full Verification

**Files:**
- Verify build and tests across the modified plugin.
- Verify a small fixture can produce one graph with advice provenance.

- [ ] **Step 1: Run core tests**

```powershell
pnpm --dir understand-anything-plugin --filter @understand-anything/core test
```

Expected: PASS.

- [ ] **Step 2: Run core build**

```powershell
pnpm --dir understand-anything-plugin --filter @understand-anything/core build
```

Expected: PASS.

- [ ] **Step 3: Run merge tests**

```powershell
python understand-anything-plugin/skills/understand/test_merge_batch_graphs.py -v
```

Expected: PASS.

- [ ] **Step 4: Run plugin build**

```powershell
pnpm --dir understand-anything-plugin build
```

Expected: PASS.

- [ ] **Step 5: Verify generated graph contract on a tiny fixture**

Create a temporary fixture:

```powershell
$fixture = Join-Path $env:TEMP "ua-advice-fixture"
Remove-Item -Recurse -Force $fixture -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force "$fixture\src" | Out-Null
New-Item -ItemType Directory -Force "$fixture\.understand-anything" | Out-Null
New-Item -ItemType Directory -Force "$fixture\.understand-anything\intermediate" | Out-Null
Set-Content -Path "$fixture\.understandadvice" -Value "# Advice`n`nTreat src as the application slice."
Set-Content -Path "$fixture\README.md" -Value "# Advice Fixture"
Set-Content -Path "$fixture\src\index.ts" -Value "export function main() { return 'ok'; }"
Set-Content -Path "$fixture\.understand-anything\intermediate\advice-context.json" -Value (@'
{
  "files": [
    {
      "path": ".understandadvice",
      "scope": ".",
      "appliesTo": ["**/*"],
      "content": "# Advice\n\nTreat src as the application slice.",
      "source": "root"
    }
  ],
  "combinedProjectAdvice": "## .understandadvice\n\n# Advice\n\nTreat src as the application slice."
}
'@)
Set-Content -Path "$fixture\.understand-anything\intermediate\batch-1.json" -Value (@'
{
  "nodes": [
    {
      "id": "file:src/index.ts",
      "type": "file",
      "name": "index.ts",
      "filePath": "src/index.ts",
      "summary": "Fixture entry point.",
      "tags": ["entry-point", "fixture", "typescript"],
      "complexity": "simple"
    }
  ],
  "edges": []
}
'@)
Set-Content -Path "$fixture\.understand-anything\intermediate\scan-result.json" -Value (@'
{
  "importMap": {
    "src/index.ts": []
  }
}
'@)
python understand-anything-plugin/skills/understand/merge-batch-graphs.py $fixture
Get-Content "$fixture\.understand-anything\intermediate\assembled-graph.json" -Raw
```

Expected: assembled graph contains node `meta.adviceFiles` with `.understandadvice`.

- [ ] **Step 6: Commit**

```powershell
git add understand-anything-plugin
git commit -m "test(ua): verify advice-aware full graph workflow"
```

---

## Self-Review Checklist

- Spec coverage: The plan implements auto-loaded advice, advice-aware batching, one physical final graph, provenance, and first-run ADO guidance.
- Placeholder scan: No task depends on an unspecified file path, edge type, or future schema change.
- Type consistency: Advice uses `AdviceContext`, `AdviceFile`, `adviceFiles`, `adviceScopes`, and `primaryAdviceScope` consistently across TypeScript, prompts, and Python merge.
- Scope check: This plan keeps the feature focused on advice loading and full-graph quality. It does not implement bespoke ADO parsers; those can follow after the advice mechanism works.
