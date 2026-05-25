# Understand Regenerate Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add durable Understand Anything regenerate workflows that preserve run artifacts, merge accepted semantic graph content forward, support interactive injections, preserve domain graph entries, and prioritize disconnected graph areas for follow-up investigation.

**Architecture:** Add reusable core modules for attempt archives, deterministic substrate manifests, graph patches, graph diffs, domain merges, and connectivity candidates. Wire those modules into small skill-side CLI scripts and update the Markdown orchestrator/agent contracts so `/understand`, `/understand-domain`, and a new `/understand-connectivity` flow share the same merge and non-loss behavior.

**Tech Stack:** TypeScript core package, Vitest, Node.js ESM skill helper scripts, Python merge script remains in place, Markdown skill and agent prompts.

---

## Pre-execution Update Notes (added 2026-05-25 before execution)

These notes capture drift between this plan as written and current `main` (commit `470cc01`). Apply before starting Task 1.

1. **Plugin path moved.** All `understand-anything-plugin/` references in this file have already been rewritten to `understand-anything-plugin/`. No `tools/` directory exists.
2. **PR #204 (`a59a573`) added Phase 1.5 (`compute-batches.mjs`) upstream of this plan's changes.** Impact assessment:
   - **Task 9 Step 5** (Phase 2 analyzer dispatch prompt + sidecars) — Phase 2 still iterates batches; the `batchIndex` variable is now sourced from `batches.json`, but the prompt-edit insertion point is unchanged ([SKILL.md:295-339](../../../understand-anything-plugin/skills/understand/SKILL.md#L295-L339)). ✓
   - **Task 9 Step 6** (regenerate merge after `merge-batch-graphs.py`) — `merge-batch-graphs.py` is still invoked at the end of Phase 2 ([SKILL.md:343](../../../understand-anything-plugin/skills/understand/SKILL.md#L343)). Insertion point is still valid. ✓
   - **No changes needed** to compute-batches.mjs for the regenerate workflow itself. Sidecars (`batch-<N>.patch.json`, `batch-<N>.deferred-work.json`) are produced by the file-analyzer agent, not the batching script.
3. **Execution order:** Land the advice spec at `docs/superpowers/specs/2026-05-23-full-graph-understand-advice.md` **first**, then this plan. Advice changes how batching groups files (Task 4 in the advice spec), and this plan adds per-batch sidecars — easier to layer regenerate sidecars onto an advice-aware batching contract than to rebase after.
4. **ESLint baseline now enforced in CI** (commit `a1261b4`). Add `pnpm --dir understand-anything-plugin lint` to Task 13 verification.
5. **`[Phase N/7]` progress contract:** Task 9 inserts step `3.1` *inside* Phase 0 rather than adding a new top-level phase, so the `N/7` strings stay correct. Verify during Task 9 that no inserted block accidentally renumbers a top-level phase.
6. **PR #199 (`0566ea8`) — agent `model` field.** Both `model: inherit` and `model: claude-...` are now omitted from agent frontmatter (see [CLAUDE.md](../../../CLAUDE.md)). Task 10 only adds prose to existing agent files; do **not** add a `model:` field to any new or edited agent frontmatter.

---

## Scope Check

The design spec spans archive storage, regenerate merge, interactive checkpoints, domain continuity, and connectivity recovery. These are implemented as one vertical slice because they share the same graph patch, invalidation, diff, and archive primitives. The rollout still lands in small commits so the implementation can stop after any task with working, testable software.

## File Structure

- Create `understand-anything-plugin/packages/core/src/regenerate/types.ts`
  - Shared attempt archive, injection, deferred work, graph patch, substrate, diff, and connectivity types.
- Create `understand-anything-plugin/packages/core/src/regenerate/attempt-archive.ts`
  - Creates `.understand-anything/runs/<attempt-id>/`, writes manifests, writes JSON artifacts, and snapshots runtime directories.
- Create `understand-anything-plugin/packages/core/src/regenerate/substrate-manifest.ts`
  - Computes current source hashes and decides when prior deterministic cache can be reused.
- Create `understand-anything-plugin/packages/core/src/regenerate/graph-merge.ts`
  - Applies graph patches and merges current graph output with prior accepted semantic content.
- Create `understand-anything-plugin/packages/core/src/regenerate/graph-diff.ts`
  - Produces graph-vs-graph added/removed/carried-forward/regression summaries.
- Create `understand-anything-plugin/packages/core/src/regenerate/domain-merge.ts`
  - Preserves prior domain/flow/step entries while refreshing matching entries from new domain analysis.
- Create `understand-anything-plugin/packages/core/src/regenerate/connectivity.ts`
  - Builds and ranks isolated or weakly connected graph candidates for investigation.
- Create tests under `understand-anything-plugin/packages/core/src/regenerate/__tests__/`.
- Modify `understand-anything-plugin/packages/core/src/index.ts`
  - Export regenerate APIs.
- Create `understand-anything-plugin/skills/understand/archive-run.mjs`
  - CLI wrapper for attempt archive init/snapshot/finalize.
- Create `understand-anything-plugin/skills/understand/apply-regenerate-merge.mjs`
  - CLI wrapper for graph patch merge and graph diff report generation.
- Create `understand-anything-plugin/skills/understand-domain/merge-domain-graph.mjs`
  - CLI wrapper for domain graph continuity merge.
- Create `understand-anything-plugin/skills/understand-connectivity/SKILL.md`
  - New targeted/autonomous connectivity recovery workflow.
- Create `understand-anything-plugin/skills/understand-connectivity/build-connectivity-candidates.mjs`
  - CLI wrapper for candidate ranking.
- Modify `understand-anything-plugin/skills/understand/SKILL.md`
  - Add `--preserve-run`, `--regenerate`, `--interactive`, `--connectivity-pass`, and `--budget`.
  - Load prior attempt artifacts and preserve current run artifacts before cleanup.
  - Add interactive checkpoints at orchestrator phase transitions.
- Modify `understand-anything-plugin/skills/understand-domain/SKILL.md`
  - Merge `domain-analysis.json` into existing `domain-graph.json` rather than overwriting.
- Modify `understand-anything-plugin/agents/file-analyzer.md`
  - Accept prior artifacts, injections, and deferred work; emit sidecars when supplied.
- Modify `understand-anything-plugin/agents/assemble-reviewer.md`
  - Review merged regenerate context without treating absence as deletion evidence.
- Modify `understand-anything-plugin/agents/domain-analyzer.md`
  - Treat existing domain graph entries as accepted context and emit current analysis only.

---

### Task 1: Add Shared Regenerate Types

**Files:**
- Create: `understand-anything-plugin/packages/core/src/regenerate/types.ts`
- Test: `understand-anything-plugin/packages/core/src/regenerate/__tests__/types.test.ts`

- [ ] **Step 1: Write failing type-shape tests**

Create `understand-anything-plugin/packages/core/src/regenerate/__tests__/types.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type {
  AttemptManifest,
  DeferredWorkRecord,
  GraphPatch,
  InjectionRecord,
  SubstrateManifest,
} from "../types.js";

describe("regenerate shared types", () => {
  it("allows an attempt manifest with preserve and regenerate flags", () => {
    const manifest: AttemptManifest = {
      attemptId: "2026-05-25T120000Z-regenerate",
      kind: "regenerate",
      projectRoot: ".",
      createdAt: "2026-05-25T12:00:00.000Z",
      flags: ["--preserve-run", "--regenerate"],
      status: "running",
      promoted: false,
    };

    expect(manifest.kind).toBe("regenerate");
    expect(manifest.flags).toContain("--preserve-run");
  });

  it("models injections, deferred work, graph patches, and substrate", () => {
    const injection: InjectionRecord = {
      id: "inj-001",
      createdAt: "2026-05-25T12:00:00.000Z",
      source: "interactive-checkpoint",
      appliesTo: ["analyze"],
      text: "Look for resource loader config edges.",
      status: "open",
    };

    const deferred: DeferredWorkRecord = {
      id: "dw-001",
      phase: "analyze",
      scope: "batch-007",
      kind: "deferred-work",
      summary: "Inspect XML service wrappers.",
      evidencePaths: ["Application/service.xml"],
      nextAgentInstruction: "Map service names to executable modules.",
      reasonDeferred: "batch scope",
      status: "open",
    };

    const patch: GraphPatch = {
      version: "1.0.0",
      targetGraph: "knowledge",
      source: "connectivity-pass",
      nodes: [],
      edges: [],
      invalidations: [],
    };

    const substrate: SubstrateManifest = {
      version: "1.0.0",
      generatedAt: "2026-05-25T12:00:00.000Z",
      coreVersion: "0.1.0",
      extractorVersion: "extract-structure.mjs",
      parserVersions: { "tree-sitter-typescript": "0.23.2" },
      files: {
        "src/index.ts": {
          path: "src/index.ts",
          contentHash: "abc",
          sizeBytes: 10,
        },
      },
    };

    expect(injection.status).toBe("open");
    expect(deferred.status).toBe("open");
    expect(patch.targetGraph).toBe("knowledge");
    expect(substrate.files["src/index.ts"].contentHash).toBe("abc");
  });
});
```

- [ ] **Step 2: Run the failing test**

Run:

```powershell
pnpm --dir understand-anything-plugin --filter @understand-anything/core test -- regenerate/__tests__/types.test.ts
```

Expected: FAIL because `../types.js` does not exist.

- [ ] **Step 3: Create the shared type file**

Create `understand-anything-plugin/packages/core/src/regenerate/types.ts`:

```ts
import type { GraphEdge, GraphNode } from "../types.js";

export type AttemptKind = "full" | "regenerate" | "connectivity" | "domain";
export type AttemptStatus = "running" | "completed" | "failed";
export type PhaseName =
  | "preflight"
  | "scan"
  | "analyze"
  | "merge"
  | "assemble-review"
  | "architecture"
  | "tour"
  | "validate"
  | "domain"
  | "connectivity"
  | "promote";

export interface AttemptManifest {
  attemptId: string;
  kind: AttemptKind;
  projectRoot: string;
  baseAttemptId?: string;
  createdAt: string;
  completedAt?: string;
  flags: string[];
  status: AttemptStatus;
  promoted: boolean;
  failureReason?: string;
}

export interface InjectionRecord {
  id: string;
  createdAt: string;
  source: "interactive-checkpoint" | "user-correction" | "regenerate-argument";
  appliesTo: PhaseName[];
  text: string;
  status: "open" | "applied" | "superseded";
}

export interface DeferredWorkRecord {
  id: string;
  phase: PhaseName;
  scope: string;
  kind: "deferred-work";
  summary: string;
  evidencePaths: string[];
  nextAgentInstruction: string;
  reasonDeferred: string;
  status: "open" | "resolved" | "superseded" | "still-open" | "split";
}

export interface InvalidationRecord {
  id: string;
  target: string;
  reason:
    | "user-correction"
    | "source-file-removed"
    | "schema-invalid"
    | "superseded-by-canonical"
    | "accepted-regenerate-report";
  replacement?: string;
}

export interface GraphPatch {
  version: "1.0.0";
  targetGraph: "knowledge" | "domain";
  source: "user-correction" | "connectivity-pass" | "domain-merge" | "regenerate";
  nodes: GraphNode[];
  edges: GraphEdge[];
  invalidations: InvalidationRecord[];
}

export interface SubstrateFile {
  path: string;
  contentHash: string;
  sizeBytes: number;
}

export interface SubstrateManifest {
  version: "1.0.0";
  generatedAt: string;
  coreVersion: string;
  extractorVersion: string;
  parserVersions: Record<string, string>;
  files: Record<string, SubstrateFile>;
}

export interface GraphDiffReport {
  version: "1.0.0";
  generatedAt: string;
  previousNodeCount: number;
  nextNodeCount: number;
  previousEdgeCount: number;
  nextEdgeCount: number;
  addedNodeIds: string[];
  removedNodeIds: string[];
  carriedForwardNodeIds: string[];
  addedEdgeKeys: string[];
  removedEdgeKeys: string[];
  carriedForwardEdgeKeys: string[];
  invalidatedTargets: string[];
  warnings: string[];
}

export interface ConnectivityCandidate {
  nodeIds: string[];
  score: number;
  reasons: string[];
  meaningfulDegree: number;
  cheapDegree: number;
  primaryNodeName: string;
  /** Times the node's basename stem appears as a string in OTHER files. Higher = more likely a missed reference. */
  referenceCount?: number;
  /** Sample paths where references were found (capped, for human triage). */
  referenceSamples?: string[];
}
```

- [ ] **Step 4: Run the type-shape test**

Run:

```powershell
pnpm --dir understand-anything-plugin --filter @understand-anything/core test -- regenerate/__tests__/types.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```powershell
git add understand-anything-plugin/packages/core/src/regenerate/types.ts understand-anything-plugin/packages/core/src/regenerate/__tests__/types.test.ts
git commit -m "feat(ua): add regenerate shared types"
```

---

### Task 2: Add Attempt Archive Utilities

**Files:**
- Create: `understand-anything-plugin/packages/core/src/regenerate/attempt-archive.ts`
- Test: `understand-anything-plugin/packages/core/src/regenerate/__tests__/attempt-archive.test.ts`

- [ ] **Step 1: Write failing archive tests**

Create `understand-anything-plugin/packages/core/src/regenerate/__tests__/attempt-archive.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  archiveRuntimeDirectories,
  createAttemptArchive,
  createAttemptId,
  finalizeAttemptManifest,
  writeAttemptJson,
} from "../attempt-archive.js";

describe("attempt archive", () => {
  let root: string;

  beforeEach(() => {
    root = join(tmpdir(), `ua-attempt-${Date.now()}`);
    mkdirSync(root, { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("creates deterministic safe attempt IDs", () => {
    const id = createAttemptId(new Date("2026-05-25T12:34:56.000Z"), "regenerate");
    expect(id).toBe("2026-05-25T123456Z-regenerate");
  });

  it("creates manifest and phase directories", () => {
    const archive = createAttemptArchive(root, {
      kind: "regenerate",
      flags: ["--regenerate"],
      projectRoot: ".",
      createdAt: "2026-05-25T12:00:00.000Z",
    });

    expect(existsSync(join(archive.attemptDir, "manifest.json"))).toBe(true);
    expect(existsSync(join(archive.attemptDir, "scan"))).toBe(true);
    expect(existsSync(join(archive.attemptDir, "final"))).toBe(true);
  });

  it("writes JSON artifacts and snapshots runtime directories", () => {
    const archive = createAttemptArchive(root, {
      kind: "full",
      flags: ["--preserve-run"],
      projectRoot: ".",
      createdAt: "2026-05-25T12:00:00.000Z",
    });
    const intermediate = join(root, ".understand-anything", "intermediate");
    mkdirSync(intermediate, { recursive: true });
    writeFileSync(join(intermediate, "scan-result.json"), "{\"ok\":true}");

    writeAttemptJson(archive.attemptDir, "feedback/inj-001.json", { id: "inj-001" });
    archiveRuntimeDirectories(root, archive.attemptDir);

    expect(existsSync(join(archive.attemptDir, "feedback", "inj-001.json"))).toBe(true);
    expect(existsSync(join(archive.attemptDir, "intermediate", "scan-result.json"))).toBe(true);
  });

  it("finalizes manifest status without losing initial fields", () => {
    const archive = createAttemptArchive(root, {
      kind: "connectivity",
      flags: ["--budget", "10"],
      projectRoot: ".",
      createdAt: "2026-05-25T12:00:00.000Z",
    });

    finalizeAttemptManifest(archive.manifestPath, {
      status: "completed",
      promoted: true,
      completedAt: "2026-05-25T12:05:00.000Z",
    });

    const manifest = JSON.parse(readFileSync(archive.manifestPath, "utf-8"));
    expect(manifest.kind).toBe("connectivity");
    expect(manifest.status).toBe("completed");
    expect(manifest.promoted).toBe(true);
  });
});
```

- [ ] **Step 2: Run the failing archive test**

Run:

```powershell
pnpm --dir understand-anything-plugin --filter @understand-anything/core test -- regenerate/__tests__/attempt-archive.test.ts
```

Expected: FAIL because `attempt-archive.ts` does not exist.

- [ ] **Step 3: Implement archive utilities**

Create `understand-anything-plugin/packages/core/src/regenerate/attempt-archive.ts`:

```ts
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { AttemptKind, AttemptManifest, AttemptStatus } from "./types.js";

const UA_DIR = ".understand-anything";
const RUNS_DIR = "runs";
const PHASE_DIRS = [
  "feedback",
  "injections",
  "deferred-work",
  "scan",
  "batches",
  "merge",
  "projections",
  "domain",
  "validation",
  "diffs",
  "final",
];

export interface CreateAttemptOptions {
  kind: AttemptKind;
  flags: string[];
  projectRoot: string;
  createdAt?: string;
  baseAttemptId?: string;
}

export interface AttemptArchive {
  attemptId: string;
  attemptDir: string;
  manifestPath: string;
  manifest: AttemptManifest;
}

export function createAttemptId(date: Date, kind: AttemptKind): string {
  const stamp = date.toISOString().replace(/:/g, "").replace(/\.\d{3}Z$/, "Z");
  return `${stamp}-${kind}`;
}

function ensureDir(path: string): void {
  if (!existsSync(path)) mkdirSync(path, { recursive: true });
}

export function createAttemptArchive(projectRoot: string, options: CreateAttemptOptions): AttemptArchive {
  const createdAt = options.createdAt ?? new Date().toISOString();
  const attemptId = createAttemptId(new Date(createdAt), options.kind);
  const attemptDir = join(projectRoot, UA_DIR, RUNS_DIR, attemptId);
  ensureDir(attemptDir);
  for (const dir of PHASE_DIRS) ensureDir(join(attemptDir, dir));

  const manifest: AttemptManifest = {
    attemptId,
    kind: options.kind,
    projectRoot: options.projectRoot,
    baseAttemptId: options.baseAttemptId,
    createdAt,
    flags: options.flags,
    status: "running",
    promoted: false,
  };

  const manifestPath = join(attemptDir, "manifest.json");
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf-8");
  return { attemptId, attemptDir, manifestPath, manifest };
}

export function writeAttemptJson(attemptDir: string, relativePath: string, value: unknown): void {
  const outputPath = join(attemptDir, relativePath);
  ensureDir(dirname(outputPath));
  writeFileSync(outputPath, JSON.stringify(value, null, 2), "utf-8");
}

export function archiveRuntimeDirectories(
  projectRoot: string,
  attemptDir: string,
  runtimeDirs = ["intermediate", "tmp"],
): void {
  for (const runtimeDir of runtimeDirs) {
    const source = join(projectRoot, UA_DIR, runtimeDir);
    if (!existsSync(source)) continue;
    const target = join(attemptDir, runtimeDir);
    cpSync(source, target, { recursive: true, force: true });
  }
}

export function finalizeAttemptManifest(
  manifestPath: string,
  update: {
    status: AttemptStatus;
    promoted: boolean;
    completedAt?: string;
    failureReason?: string;
  },
): AttemptManifest {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as AttemptManifest;
  const next: AttemptManifest = {
    ...manifest,
    status: update.status,
    promoted: update.promoted,
    completedAt: update.completedAt ?? new Date().toISOString(),
    failureReason: update.failureReason,
  };
  writeFileSync(manifestPath, JSON.stringify(next, null, 2), "utf-8");
  return next;
}
```

- [ ] **Step 4: Run the archive test**

Run:

```powershell
pnpm --dir understand-anything-plugin --filter @understand-anything/core test -- regenerate/__tests__/attempt-archive.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```powershell
git add understand-anything-plugin/packages/core/src/regenerate/attempt-archive.ts understand-anything-plugin/packages/core/src/regenerate/__tests__/attempt-archive.test.ts
git commit -m "feat(ua): add attempt archive utilities"
```

---

### Task 3: Add Deterministic Substrate Manifests

**Files:**
- Create: `understand-anything-plugin/packages/core/src/regenerate/substrate-manifest.ts`
- Test: `understand-anything-plugin/packages/core/src/regenerate/__tests__/substrate-manifest.test.ts`

- [ ] **Step 1: Write failing substrate tests**

Create `understand-anything-plugin/packages/core/src/regenerate/__tests__/substrate-manifest.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  buildSubstrateManifest,
  isSubstrateCacheReusable,
} from "../substrate-manifest.js";

describe("substrate manifest", () => {
  let root: string;

  beforeEach(() => {
    root = join(tmpdir(), `ua-substrate-${Date.now()}`);
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "index.ts"), "export const value = 1;\n");
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("hashes current source files with extractor metadata", () => {
    const manifest = buildSubstrateManifest(root, ["src/index.ts"], {
      coreVersion: "0.1.0",
      extractorVersion: "extract-structure.mjs",
      parserVersions: { "tree-sitter-typescript": "0.23.2" },
      generatedAt: "2026-05-25T12:00:00.000Z",
    });

    expect(manifest.files["src/index.ts"].contentHash).toHaveLength(64);
    expect(manifest.files["src/index.ts"].sizeBytes).toBeGreaterThan(0);
    expect(manifest.extractorVersion).toBe("extract-structure.mjs");
  });

  it("reuses cache only when hashes and extractor metadata match", () => {
    const first = buildSubstrateManifest(root, ["src/index.ts"], {
      coreVersion: "0.1.0",
      extractorVersion: "extract-structure.mjs",
      parserVersions: {},
      generatedAt: "2026-05-25T12:00:00.000Z",
    });
    const same = buildSubstrateManifest(root, ["src/index.ts"], {
      coreVersion: "0.1.0",
      extractorVersion: "extract-structure.mjs",
      parserVersions: {},
      generatedAt: "2026-05-25T12:01:00.000Z",
    });
    const changedExtractor = { ...same, extractorVersion: "new-extractor" };

    expect(isSubstrateCacheReusable(first, same)).toEqual({ reusable: true, reasons: [] });
    expect(isSubstrateCacheReusable(first, changedExtractor).reusable).toBe(false);
  });
});
```

- [ ] **Step 2: Run the failing substrate test**

Run:

```powershell
pnpm --dir understand-anything-plugin --filter @understand-anything/core test -- regenerate/__tests__/substrate-manifest.test.ts
```

Expected: FAIL because `substrate-manifest.ts` does not exist.

- [ ] **Step 3: Implement substrate manifest functions**

Create `understand-anything-plugin/packages/core/src/regenerate/substrate-manifest.ts`:

```ts
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { SubstrateManifest } from "./types.js";

export interface BuildSubstrateOptions {
  coreVersion: string;
  extractorVersion: string;
  parserVersions: Record<string, string>;
  generatedAt?: string;
}

export interface CacheReuseResult {
  reusable: boolean;
  reasons: string[];
}

function sha256(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

export function buildSubstrateManifest(
  projectRoot: string,
  filePaths: string[],
  options: BuildSubstrateOptions,
): SubstrateManifest {
  const files: SubstrateManifest["files"] = {};

  for (const filePath of [...filePaths].sort()) {
    const absolutePath = join(projectRoot, filePath);
    const content = readFileSync(absolutePath);
    const stat = statSync(absolutePath);
    files[filePath.replace(/\\/g, "/")] = {
      path: filePath.replace(/\\/g, "/"),
      contentHash: sha256(content),
      sizeBytes: stat.size,
    };
  }

  return {
    version: "1.0.0",
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    coreVersion: options.coreVersion,
    extractorVersion: options.extractorVersion,
    parserVersions: options.parserVersions,
    files,
  };
}

export function isSubstrateCacheReusable(
  previous: SubstrateManifest,
  current: SubstrateManifest,
): CacheReuseResult {
  const reasons: string[] = [];

  if (previous.coreVersion !== current.coreVersion) {
    reasons.push(`core version changed: ${previous.coreVersion} -> ${current.coreVersion}`);
  }
  if (previous.extractorVersion !== current.extractorVersion) {
    reasons.push(`extractor version changed: ${previous.extractorVersion} -> ${current.extractorVersion}`);
  }
  if (JSON.stringify(previous.parserVersions) !== JSON.stringify(current.parserVersions)) {
    reasons.push("parser versions changed");
  }

  const previousPaths = Object.keys(previous.files).sort();
  const currentPaths = Object.keys(current.files).sort();
  if (JSON.stringify(previousPaths) !== JSON.stringify(currentPaths)) {
    reasons.push("file set changed");
  }

  for (const path of currentPaths) {
    const oldFile = previous.files[path];
    const newFile = current.files[path];
    if (!oldFile) continue;
    if (oldFile.contentHash !== newFile.contentHash) {
      reasons.push(`content hash changed: ${path}`);
    }
  }

  return { reusable: reasons.length === 0, reasons };
}
```

- [ ] **Step 4: Run the substrate test**

Run:

```powershell
pnpm --dir understand-anything-plugin --filter @understand-anything/core test -- regenerate/__tests__/substrate-manifest.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```powershell
git add understand-anything-plugin/packages/core/src/regenerate/substrate-manifest.ts understand-anything-plugin/packages/core/src/regenerate/__tests__/substrate-manifest.test.ts
git commit -m "feat(ua): add deterministic substrate manifests"
```

---

### Task 4: Add Graph Patch Merge And Diff

**Files:**
- Create: `understand-anything-plugin/packages/core/src/regenerate/graph-merge.ts`
- Create: `understand-anything-plugin/packages/core/src/regenerate/graph-diff.ts`
- Test: `understand-anything-plugin/packages/core/src/regenerate/__tests__/graph-merge.test.ts`
- Test: `understand-anything-plugin/packages/core/src/regenerate/__tests__/graph-diff.test.ts`

- [ ] **Step 1: Write failing graph merge tests**

Create `understand-anything-plugin/packages/core/src/regenerate/__tests__/graph-merge.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { KnowledgeGraph } from "../../types.js";
import { applyGraphPatch, mergeGraphWithCarryForward } from "../graph-merge.js";
import type { GraphPatch } from "../types.js";

function graph(nodes: KnowledgeGraph["nodes"], edges: KnowledgeGraph["edges"] = []): KnowledgeGraph {
  return {
    version: "1.0.0",
    project: {
      name: "fixture",
      languages: ["typescript"],
      frameworks: [],
      description: "fixture",
      analyzedAt: "2026-05-25T12:00:00.000Z",
      gitCommitHash: "abc",
    },
    nodes,
    edges,
    layers: [],
    tour: [],
  };
}

describe("graph regenerate merge", () => {
  it("keeps current nodes and carries forward prior semantic nodes", () => {
    const previous = graph([
      { id: "file:src/a.ts", type: "file", name: "a.ts", filePath: "src/a.ts", summary: "old", tags: ["old"], complexity: "simple" },
      { id: "concept:resource-loader", type: "concept", name: "Resource Loader", summary: "accepted concept", tags: ["resources"], complexity: "moderate" },
    ]);
    const current = graph([
      { id: "file:src/a.ts", type: "file", name: "a.ts", filePath: "src/a.ts", summary: "new", tags: ["new"], complexity: "simple" },
    ]);

    const merged = mergeGraphWithCarryForward({ previous, current, patches: [], removedSourcePaths: [] });

    expect(merged.nodes.find((node) => node.id === "file:src/a.ts")?.summary).toBe("new");
    expect(merged.nodes.find((node) => node.id === "concept:resource-loader")?.summary).toBe("accepted concept");
  });

  it("does not carry forward source-anchored nodes whose source file was removed", () => {
    const previous = graph([
      { id: "file:src/removed.ts", type: "file", name: "removed.ts", filePath: "src/removed.ts", summary: "old", tags: ["old"], complexity: "simple" },
    ]);
    const current = graph([]);

    const merged = mergeGraphWithCarryForward({
      previous,
      current,
      patches: [],
      removedSourcePaths: ["src/removed.ts"],
    });

    expect(merged.nodes).toHaveLength(0);
  });

  it("applies graph patches and invalidations", () => {
    const base = graph([
      { id: "file:src/a.ts", type: "file", name: "a.ts", filePath: "src/a.ts", summary: "A", tags: ["a"], complexity: "simple" },
      { id: "file:src/b.ts", type: "file", name: "b.ts", filePath: "src/b.ts", summary: "B", tags: ["b"], complexity: "simple" },
    ], [
      { source: "file:src/a.ts", target: "file:src/b.ts", type: "related", direction: "forward", weight: 0.5 },
    ]);
    const patch: GraphPatch = {
      version: "1.0.0",
      targetGraph: "knowledge",
      source: "user-correction",
      nodes: [],
      edges: [
        { source: "file:src/a.ts", target: "file:src/b.ts", type: "imports", direction: "forward", weight: 0.7 },
      ],
      invalidations: [
        {
          id: "inv-related",
          target: "edge:file:src/a.ts->file:src/b.ts:related:forward",
          reason: "user-correction",
        },
      ],
    };

    const merged = applyGraphPatch(base, patch);

    expect(merged.edges.map((edge) => edge.type)).toEqual(["imports"]);
  });
});
```

- [ ] **Step 2: Write failing graph diff tests**

Create `understand-anything-plugin/packages/core/src/regenerate/__tests__/graph-diff.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { KnowledgeGraph } from "../../types.js";
import { compareGraphs } from "../graph-diff.js";

function graph(nodeIds: string[], edges: KnowledgeGraph["edges"] = []): KnowledgeGraph {
  return {
    version: "1.0.0",
    project: {
      name: "fixture",
      languages: ["typescript"],
      frameworks: [],
      description: "fixture",
      analyzedAt: "2026-05-25T12:00:00.000Z",
      gitCommitHash: "abc",
    },
    nodes: nodeIds.map((id) => ({
      id,
      type: "file",
      name: id,
      filePath: id.replace(/^file:/, ""),
      summary: id,
      tags: ["fixture"],
      complexity: "simple",
    })),
    edges,
    layers: [],
    tour: [],
  };
}

describe("graph diff", () => {
  it("reports added, removed, and carried-forward content", () => {
    const previous = graph(["file:a.ts", "file:b.ts"], [
      { source: "file:a.ts", target: "file:b.ts", type: "imports", direction: "forward", weight: 0.7 },
    ]);
    const next = graph(["file:b.ts", "file:c.ts"], [
      { source: "file:b.ts", target: "file:c.ts", type: "imports", direction: "forward", weight: 0.7 },
    ]);

    const report = compareGraphs(previous, next, {
      generatedAt: "2026-05-25T12:00:00.000Z",
      invalidatedTargets: ["file:a.ts"],
    });

    expect(report.addedNodeIds).toEqual(["file:c.ts"]);
    expect(report.removedNodeIds).toEqual(["file:a.ts"]);
    expect(report.carriedForwardNodeIds).toEqual(["file:b.ts"]);
    expect(report.invalidatedTargets).toEqual(["file:a.ts"]);
  });
});
```

- [ ] **Step 3: Run failing graph tests**

Run:

```powershell
pnpm --dir understand-anything-plugin --filter @understand-anything/core test -- regenerate/__tests__/graph-merge.test.ts regenerate/__tests__/graph-diff.test.ts
```

Expected: FAIL because `graph-merge.ts` and `graph-diff.ts` do not exist.

- [ ] **Step 4: Implement graph merge**

Create `understand-anything-plugin/packages/core/src/regenerate/graph-merge.ts`:

```ts
import type { GraphEdge, GraphNode, KnowledgeGraph } from "../types.js";
import type { GraphPatch, InvalidationRecord } from "./types.js";

export function edgeKey(edge: GraphEdge): string {
  return `edge:${edge.source}->${edge.target}:${edge.type}:${edge.direction}`;
}

function invalidationTargets(patches: GraphPatch[]): Set<string> {
  return new Set(patches.flatMap((patch) => patch.invalidations.map((item) => item.target)));
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/");
}

function shouldCarryNode(node: GraphNode, removedSourcePaths: Set<string>, invalidated: Set<string>): boolean {
  if (invalidated.has(node.id)) return false;
  if (node.filePath && removedSourcePaths.has(normalizePath(node.filePath))) return false;
  return true;
}

function shouldCarryEdge(edge: GraphEdge, nodeIds: Set<string>, invalidated: Set<string>): boolean {
  if (invalidated.has(edgeKey(edge))) return false;
  return nodeIds.has(edge.source) && nodeIds.has(edge.target);
}

function applyInvalidations(graph: KnowledgeGraph, invalidations: InvalidationRecord[]): KnowledgeGraph {
  const invalidated = new Set(invalidations.map((item) => item.target));
  return {
    ...graph,
    nodes: graph.nodes.filter((node) => !invalidated.has(node.id)),
    edges: graph.edges.filter((edge) => !invalidated.has(edgeKey(edge))),
  };
}

export function applyGraphPatch(base: KnowledgeGraph, patch: GraphPatch): KnowledgeGraph {
  const pruned = applyInvalidations(base, patch.invalidations);
  const nodesById = new Map<string, GraphNode>();
  for (const node of pruned.nodes) nodesById.set(node.id, node);
  for (const node of patch.nodes) nodesById.set(node.id, node);

  const edgesByKey = new Map<string, GraphEdge>();
  for (const edge of pruned.edges) edgesByKey.set(edgeKey(edge), edge);
  for (const edge of patch.edges) edgesByKey.set(edgeKey(edge), edge);

  const nodeIds = new Set(nodesById.keys());
  return {
    ...base,
    nodes: [...nodesById.values()],
    edges: [...edgesByKey.values()].filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target)),
  };
}

export interface MergeGraphOptions {
  previous: KnowledgeGraph;
  current: KnowledgeGraph;
  patches: GraphPatch[];
  removedSourcePaths: string[];
}

export function mergeGraphWithCarryForward(options: MergeGraphOptions): KnowledgeGraph {
  const invalidated = invalidationTargets(options.patches);
  const removedSourcePaths = new Set(options.removedSourcePaths.map(normalizePath));
  const nodesById = new Map<string, GraphNode>();

  for (const node of options.current.nodes) nodesById.set(node.id, node);
  for (const node of options.previous.nodes) {
    if (nodesById.has(node.id)) continue;
    if (!shouldCarryNode(node, removedSourcePaths, invalidated)) continue;
    nodesById.set(node.id, {
      ...node,
      meta: {
        ...(node.meta ?? {}),
        regenerate: {
          carriedForward: true,
        },
      },
    });
  }

  const nodeIds = new Set(nodesById.keys());
  const edgesByKey = new Map<string, GraphEdge>();
  for (const edge of options.current.edges) {
    if (shouldCarryEdge(edge, nodeIds, invalidated)) edgesByKey.set(edgeKey(edge), edge);
  }
  for (const edge of options.previous.edges) {
    const key = edgeKey(edge);
    if (edgesByKey.has(key)) continue;
    if (!shouldCarryEdge(edge, nodeIds, invalidated)) continue;
    edgesByKey.set(key, {
      ...edge,
      meta: {
        ...(edge.meta ?? {}),
        regenerate: {
          carriedForward: true,
        },
      },
    });
  }

  let merged: KnowledgeGraph = {
    ...options.current,
    nodes: [...nodesById.values()],
    edges: [...edgesByKey.values()],
  };

  for (const patch of options.patches) {
    merged = applyGraphPatch(merged, patch);
  }

  return merged;
}
```

- [ ] **Step 5: Implement graph diff**

Create `understand-anything-plugin/packages/core/src/regenerate/graph-diff.ts`:

```ts
import type { KnowledgeGraph } from "../types.js";
import type { GraphDiffReport } from "./types.js";
import { edgeKey } from "./graph-merge.js";

export interface CompareGraphOptions {
  generatedAt?: string;
  invalidatedTargets?: string[];
}

function sortedDifference(left: Set<string>, right: Set<string>): string[] {
  return [...left].filter((item) => !right.has(item)).sort();
}

function sortedIntersection(left: Set<string>, right: Set<string>): string[] {
  return [...left].filter((item) => right.has(item)).sort();
}

export function compareGraphs(
  previous: KnowledgeGraph,
  next: KnowledgeGraph,
  options: CompareGraphOptions = {},
): GraphDiffReport {
  const previousNodeIds = new Set(previous.nodes.map((node) => node.id));
  const nextNodeIds = new Set(next.nodes.map((node) => node.id));
  const previousEdgeKeys = new Set(previous.edges.map(edgeKey));
  const nextEdgeKeys = new Set(next.edges.map(edgeKey));

  const removedNodeIds = sortedDifference(previousNodeIds, nextNodeIds);
  const removedEdgeKeys = sortedDifference(previousEdgeKeys, nextEdgeKeys);
  const warnings: string[] = [];

  if (removedNodeIds.length > 0) {
    warnings.push(`${removedNodeIds.length} node(s) removed or invalidated`);
  }
  if (removedEdgeKeys.length > 0) {
    warnings.push(`${removedEdgeKeys.length} edge(s) removed or invalidated`);
  }

  return {
    version: "1.0.0",
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    previousNodeCount: previous.nodes.length,
    nextNodeCount: next.nodes.length,
    previousEdgeCount: previous.edges.length,
    nextEdgeCount: next.edges.length,
    addedNodeIds: sortedDifference(nextNodeIds, previousNodeIds),
    removedNodeIds,
    carriedForwardNodeIds: sortedIntersection(previousNodeIds, nextNodeIds),
    addedEdgeKeys: sortedDifference(nextEdgeKeys, previousEdgeKeys),
    removedEdgeKeys,
    carriedForwardEdgeKeys: sortedIntersection(previousEdgeKeys, nextEdgeKeys),
    invalidatedTargets: [...(options.invalidatedTargets ?? [])].sort(),
    warnings,
  };
}
```

- [ ] **Step 6: Run graph tests**

Run:

```powershell
pnpm --dir understand-anything-plugin --filter @understand-anything/core test -- regenerate/__tests__/graph-merge.test.ts regenerate/__tests__/graph-diff.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```powershell
git add understand-anything-plugin/packages/core/src/regenerate/graph-merge.ts understand-anything-plugin/packages/core/src/regenerate/graph-diff.ts understand-anything-plugin/packages/core/src/regenerate/__tests__/graph-merge.test.ts understand-anything-plugin/packages/core/src/regenerate/__tests__/graph-diff.test.ts
git commit -m "feat(ua): merge regenerate graph patches"
```

---

### Task 5: Add Domain Merge Continuity

**Files:**
- Create: `understand-anything-plugin/packages/core/src/regenerate/domain-merge.ts`
- Test: `understand-anything-plugin/packages/core/src/regenerate/__tests__/domain-merge.test.ts`

- [ ] **Step 1: Write failing domain merge tests**

Create `understand-anything-plugin/packages/core/src/regenerate/__tests__/domain-merge.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { KnowledgeGraph } from "../../types.js";
import { mergeDomainGraph } from "../domain-merge.js";

function domainGraph(nodes: KnowledgeGraph["nodes"], edges: KnowledgeGraph["edges"] = []): KnowledgeGraph {
  return {
    version: "1.0.0",
    project: {
      name: "fixture",
      languages: ["typescript"],
      frameworks: [],
      description: "domain fixture",
      analyzedAt: "2026-05-25T12:00:00.000Z",
      gitCommitHash: "abc",
    },
    nodes,
    edges,
    layers: [],
    tour: [],
  };
}

describe("domain graph merge", () => {
  it("carries forward prior domain entries that new analysis does not mention", () => {
    const previous = domainGraph([
      { id: "domain:orders", type: "domain", name: "Orders", summary: "Old orders", tags: ["orders"], complexity: "moderate" },
      { id: "flow:create-order", type: "flow", name: "Create Order", summary: "Existing flow", tags: ["orders"], complexity: "moderate" },
    ]);
    const current = domainGraph([
      { id: "domain:shipping", type: "domain", name: "Shipping", summary: "New shipping", tags: ["shipping"], complexity: "simple" },
    ]);

    const merged = mergeDomainGraph({ previous, current, patches: [] });

    expect(merged.nodes.map((node) => node.id).sort()).toEqual([
      "domain:orders",
      "domain:shipping",
      "flow:create-order",
    ]);
  });

  it("refreshes matching entries from current analysis", () => {
    const previous = domainGraph([
      { id: "domain:orders", type: "domain", name: "Orders", summary: "Old", tags: ["old"], complexity: "moderate" },
    ]);
    const current = domainGraph([
      { id: "domain:orders", type: "domain", name: "Orders", summary: "New", tags: ["new"], complexity: "complex" },
    ]);

    const merged = mergeDomainGraph({ previous, current, patches: [] });

    expect(merged.nodes[0].summary).toBe("New");
    expect(merged.nodes[0].tags).toEqual(["new"]);
  });

  it("preserves dashboard domain edge invariants", () => {
    const current = domainGraph([
      { id: "domain:orders", type: "domain", name: "Orders", summary: "Orders", tags: ["orders"], complexity: "moderate" },
      { id: "flow:create-order", type: "flow", name: "Create Order", summary: "Create", tags: ["orders"], complexity: "moderate" },
      { id: "step:create-order:validate", type: "step", name: "Validate", summary: "Validate", tags: ["orders"], complexity: "simple" },
    ], [
      { source: "domain:orders", target: "flow:create-order", type: "contains_flow", direction: "forward", weight: 1 },
      { source: "flow:create-order", target: "step:create-order:validate", type: "flow_step", direction: "forward", weight: 0.1 },
    ]);

    const merged = mergeDomainGraph({ previous: null, current, patches: [] });

    expect(merged.edges.map((edge) => edge.type)).toEqual(["contains_flow", "flow_step"]);
  });
});
```

- [ ] **Step 2: Run the failing domain test**

Run:

```powershell
pnpm --dir understand-anything-plugin --filter @understand-anything/core test -- regenerate/__tests__/domain-merge.test.ts
```

Expected: FAIL because `domain-merge.ts` does not exist.

- [ ] **Step 3: Implement domain merge**

Create `understand-anything-plugin/packages/core/src/regenerate/domain-merge.ts`:

```ts
import type { EdgeType, GraphEdge, GraphNode, KnowledgeGraph } from "../types.js";
import type { GraphPatch } from "./types.js";
import { applyGraphPatch, edgeKey } from "./graph-merge.js";

const DOMAIN_NODE_TYPES = new Set(["domain", "flow", "step"]);
const DOMAIN_EDGE_TYPES = new Set<EdgeType>(["contains_flow", "flow_step", "cross_domain"]);

export interface MergeDomainOptions {
  previous: KnowledgeGraph | null;
  current: KnowledgeGraph;
  patches: GraphPatch[];
}

function isDomainNode(node: GraphNode): boolean {
  return DOMAIN_NODE_TYPES.has(node.type);
}

function isDomainEdge(edge: GraphEdge): boolean {
  return DOMAIN_EDGE_TYPES.has(edge.type);
}

export function mergeDomainGraph(options: MergeDomainOptions): KnowledgeGraph {
  const nodesById = new Map<string, GraphNode>();
  const edgesByKey = new Map<string, GraphEdge>();

  if (options.previous) {
    for (const node of options.previous.nodes.filter(isDomainNode)) {
      nodesById.set(node.id, {
        ...node,
        meta: {
          ...(node.meta ?? {}),
          domainMerge: { carriedForward: true },
        },
      });
    }
    for (const edge of options.previous.edges.filter(isDomainEdge)) {
      edgesByKey.set(edgeKey(edge), {
        ...edge,
        meta: {
          ...(edge.meta ?? {}),
          domainMerge: { carriedForward: true },
        },
      });
    }
  }

  for (const node of options.current.nodes.filter(isDomainNode)) nodesById.set(node.id, node);
  for (const edge of options.current.edges.filter(isDomainEdge)) edgesByKey.set(edgeKey(edge), edge);

  let merged: KnowledgeGraph = {
    ...options.current,
    nodes: [...nodesById.values()],
    edges: [...edgesByKey.values()],
    layers: [],
    tour: [],
  };

  for (const patch of options.patches) {
    merged = applyGraphPatch(merged, patch);
  }

  const nodeIds = new Set(merged.nodes.map((node) => node.id));
  return {
    ...merged,
    edges: merged.edges.filter((edge) => isDomainEdge(edge) && nodeIds.has(edge.source) && nodeIds.has(edge.target)),
    layers: [],
    tour: [],
  };
}
```

- [ ] **Step 4: Run the domain test**

Run:

```powershell
pnpm --dir understand-anything-plugin --filter @understand-anything/core test -- regenerate/__tests__/domain-merge.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```powershell
git add understand-anything-plugin/packages/core/src/regenerate/domain-merge.ts understand-anything-plugin/packages/core/src/regenerate/__tests__/domain-merge.test.ts
git commit -m "feat(ua): preserve domain graph entries"
```

---

### Task 6: Rank Connectivity Candidates By Basename Reference Count

> **Why this matters:** A "lonely" graph node with zero edges but many string mentions of its basename across the codebase is almost certainly a missed reference — the analyzer just didn't follow the chain. A node with zero edges AND zero string mentions is more likely dead code or a true orphan. Ranking by reference count surfaces **high-impact missing edges first**, with low-hanging fruit (a few mentions) following, and zero-mention orphans tagged separately.
>
> **Reusable primitive:** The basename-grep helper `countBasenameReferences` introduced here is generic — once it exists, it can also help file-analyzer find non-import references inside a batch, graph-reviewer validate orphan claims, and `/understand-connectivity --target` triage. See the "Reusing the reference-count primitive" note at the end of this task; those are follow-ups, not in-scope work.

**Files:**
- Create: `understand-anything-plugin/packages/core/src/reference-search.ts`
- Test: `understand-anything-plugin/packages/core/src/__tests__/reference-search.test.ts`
- Create: `understand-anything-plugin/packages/core/src/regenerate/connectivity.ts`
- Test: `understand-anything-plugin/packages/core/src/regenerate/__tests__/connectivity.test.ts`

- [ ] **Step 1: Write failing reference-search test**

Create `understand-anything-plugin/packages/core/src/__tests__/reference-search.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { countBasenameReferences } from "../reference-search.js";

describe("countBasenameReferences", () => {
  let root: string;

  beforeEach(() => {
    root = join(tmpdir(), `ua-refsearch-${Date.now()}`);
    mkdirSync(join(root, "src"), { recursive: true });
    mkdirSync(join(root, "config"), { recursive: true });
    writeFileSync(join(root, "src", "ResourceLoader.cs"), "public class ResourceLoader {}");
    writeFileSync(join(root, "src", "Other.cs"), "using ResourceLoader; var l = new ResourceLoader();");
    writeFileSync(join(root, "src", "Third.cs"), "var loader = ResourceLoader.Instance;");
    writeFileSync(join(root, "config", "settings.json"), "{ \"loader\": \"ResourceLoader\" }");
    writeFileSync(join(root, "README.md"), "No mention here.");
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("counts basename matches in files OTHER than the source file", () => {
    const counts = countBasenameReferences(root, ["src/ResourceLoader.cs"]);
    const entry = counts.get("src/ResourceLoader.cs");
    expect(entry?.count).toBeGreaterThanOrEqual(3); // Other.cs, Third.cs, settings.json
    expect(entry?.samples.some((s) => s.includes("Other.cs"))).toBe(true);
    expect(entry?.samples.some((s) => s === "src/ResourceLoader.cs")).toBe(false); // self excluded
  });

  it("returns zero for files no one mentions", () => {
    writeFileSync(join(root, "src", "Lonely.cs"), "class Lonely {}");
    const counts = countBasenameReferences(root, ["src/Lonely.cs"]);
    expect(counts.get("src/Lonely.cs")?.count).toBe(0);
  });
});
```

- [ ] **Step 2: Run the failing reference-search test**

Run:

```powershell
pnpm --dir understand-anything-plugin --filter @understand-anything/core test -- reference-search.test.ts
```

Expected: FAIL because `reference-search.ts` does not exist.

- [ ] **Step 3: Implement the reference-search primitive**

Create `understand-anything-plugin/packages/core/src/reference-search.ts`:

```ts
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, extname, join, relative, sep } from "node:path";

const SKIPPED_DIRECTORIES = new Set([
  ".git", ".understand-anything", "node_modules", "vendor", "venv", ".venv",
  "__pycache__", "dist", "build", "out", "coverage", ".next", ".cache",
  ".turbo", "target", "obj", ".vs",
]);

const BINARY_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".ico", ".webp",
  ".woff", ".woff2", ".ttf", ".otf", ".eot",
  ".pdf", ".zip", ".tar", ".gz", ".7z",
  ".exe", ".dll", ".pdb", ".so", ".dylib",
  ".nupkg", ".jar", ".class",
  ".mp3", ".mp4", ".wav", ".webm", ".mov",
]);

const MAX_FILE_BYTES = 1024 * 1024; // 1 MB — skip very large files.

export interface ReferenceCount {
  count: number;
  /** Sample of files where the basename appeared. Capped at `samplesPerKey`. */
  samples: string[];
}

export interface CountBasenameReferencesOptions {
  /** Max sample paths per key. Default 5. */
  samplesPerKey?: number;
  /** Additional file extensions to treat as binary. */
  extraBinaryExtensions?: string[];
}

function toPosix(path: string): string {
  return path.split(sep).join("/");
}

function isTextFile(filePath: string, binarySet: Set<string>): boolean {
  return !binarySet.has(extname(filePath).toLowerCase());
}

function walk(currentDir: string, out: string[]): void {
  for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
      walk(join(currentDir, entry.name), out);
      continue;
    }
    if (!entry.isFile()) continue;
    out.push(join(currentDir, entry.name));
  }
}

/**
 * For each input project-relative file path, return the number of OTHER files
 * that mention its basename stem as a substring, plus a few sample paths.
 *
 * Walks the project ONCE regardless of how many target paths are passed. Pure
 * substring scan — does not parse syntax. Sufficient for the "is this lonely
 * node grep-discoverable?" heuristic. Skips binary extensions, files > 1 MB,
 * and standard junk directories.
 */
export function countBasenameReferences(
  projectRoot: string,
  targetPaths: string[],
  options: CountBasenameReferencesOptions = {},
): Map<string, ReferenceCount> {
  const samplesPerKey = options.samplesPerKey ?? 5;
  const binarySet = new Set([...BINARY_EXTENSIONS, ...(options.extraBinaryExtensions ?? [])]);

  const stemToTargets = new Map<string, string[]>();
  for (const targetPath of targetPaths) {
    const stem = basename(targetPath, extname(targetPath));
    if (!stem) continue;
    if (!stemToTargets.has(stem)) stemToTargets.set(stem, []);
    stemToTargets.get(stem)!.push(targetPath);
  }

  const results = new Map<string, ReferenceCount>();
  for (const target of targetPaths) results.set(target, { count: 0, samples: [] });
  if (stemToTargets.size === 0) return results;

  const allFiles: string[] = [];
  walk(projectRoot, allFiles);

  for (const absolutePath of allFiles) {
    if (!isTextFile(absolutePath, binarySet)) continue;
    let size: number;
    try { size = statSync(absolutePath).size; } catch { continue; }
    if (size > MAX_FILE_BYTES) continue;

    const relativePath = toPosix(relative(projectRoot, absolutePath));
    let content: string;
    try { content = readFileSync(absolutePath, "utf-8"); } catch { continue; }

    for (const [stem, targetsForStem] of stemToTargets) {
      if (!content.includes(stem)) continue;
      for (const target of targetsForStem) {
        if (relativePath === toPosix(target)) continue; // exclude self
        const result = results.get(target)!;
        result.count += 1;
        if (result.samples.length < samplesPerKey) result.samples.push(relativePath);
      }
    }
  }

  return results;
}
```

- [ ] **Step 4: Run reference-search test to verify pass**

Run:

```powershell
pnpm --dir understand-anything-plugin --filter @understand-anything/core test -- reference-search.test.ts
```

Expected: PASS.

- [ ] **Step 5: Write failing connectivity tests (heuristic + reference count)**

Create `understand-anything-plugin/packages/core/src/regenerate/__tests__/connectivity.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { KnowledgeGraph } from "../../types.js";
import { buildConnectivityCandidates } from "../connectivity.js";

function graph(): KnowledgeGraph {
  return {
    version: "1.0.0",
    project: {
      name: "fixture",
      languages: ["xml", "csharp"],
      frameworks: [],
      description: "fixture",
      analyzedAt: "2026-05-25T12:00:00.000Z",
      gitCommitHash: "abc",
    },
    nodes: [
      { id: "resource:Application/Resource Files/foo.xml", type: "resource", name: "Resource Files", filePath: "Application/Resource Files/foo.xml", summary: "Resource keys", tags: ["resource"], complexity: "simple" },
      { id: "file:Application/src/ResourceLoader.cs", type: "file", name: "ResourceLoader.cs", filePath: "Application/src/ResourceLoader.cs", summary: "Loads resources", tags: ["loader"], complexity: "moderate" },
      { id: "file:Application/src/OneOffHelper.cs", type: "file", name: "OneOffHelper.cs", filePath: "Application/src/OneOffHelper.cs", summary: "Helper", tags: ["helper"], complexity: "simple" },
      { id: "document:docs/readme.md", type: "document", name: "readme.md", filePath: "docs/readme.md", summary: "Readme", tags: ["documentation"], complexity: "simple" },
    ],
    edges: [
      { source: "document:docs/readme.md", target: "file:Application/src/ResourceLoader.cs", type: "documents", direction: "forward", weight: 0.5 },
    ],
    layers: [],
    tour: [],
  };
}

describe("connectivity candidates", () => {
  it("falls back to heuristic ranking when no reference counts supplied", () => {
    const candidates = buildConnectivityCandidates(graph(), { limit: 10 });
    expect(candidates[0].nodeIds).toEqual(["resource:Application/Resource Files/foo.xml"]);
    expect(candidates[0].reasons.join(" ")).toContain("high-signal name");
  });

  it("ranks many-reference nodes above few-reference nodes when counts supplied", () => {
    const referenceCounts = new Map<string, { count: number; samples: string[] }>([
      ["file:Application/src/OneOffHelper.cs", { count: 25, samples: ["a.cs", "b.cs"] }],
      ["resource:Application/Resource Files/foo.xml", { count: 0, samples: [] }],
      ["file:Application/src/ResourceLoader.cs", { count: 2, samples: ["x.cs"] }],
    ]);
    const candidates = buildConnectivityCandidates(graph(), { limit: 10, referenceCounts });

    expect(candidates[0].nodeIds).toEqual(["file:Application/src/OneOffHelper.cs"]);
    expect(candidates[0].referenceCount).toBe(25);
    expect(candidates[0].reasons.some((r) => r.includes("string references"))).toBe(true);
  });

  it("tags zero-reference orphans as likely dead-code rather than ranking them up", () => {
    const referenceCounts = new Map<string, { count: number; samples: string[] }>([
      ["resource:Application/Resource Files/foo.xml", { count: 0, samples: [] }],
    ]);
    const candidates = buildConnectivityCandidates(graph(), { limit: 10, referenceCounts });
    const orphan = candidates.find((c) => c.nodeIds.includes("resource:Application/Resource Files/foo.xml"));
    expect(orphan?.reasons.some((r) => r.includes("no string references"))).toBe(true);
  });
});
```

- [ ] **Step 6: Run the failing connectivity test**

Run:

```powershell
pnpm --dir understand-anything-plugin --filter @understand-anything/core test -- regenerate/__tests__/connectivity.test.ts
```

Expected: FAIL because `connectivity.ts` does not exist.

- [ ] **Step 7: Implement candidate ranking with reference-count weighting**

Create `understand-anything-plugin/packages/core/src/regenerate/connectivity.ts`:

```ts
import type { EdgeType, KnowledgeGraph } from "../types.js";
import type { ConnectivityCandidate } from "./types.js";
import type { ReferenceCount } from "../reference-search.js";

const MEANINGFUL_EDGE_TYPES = new Set<EdgeType>([
  "imports", "calls", "configures", "reads_from", "writes_to",
  "routes", "defines_schema", "deploys", "triggers", "documents",
  "contains_flow", "flow_step", "cross_domain", "depends_on", "serves",
  "provisions", "migrates", "tested_by",
]);

const HIGH_SIGNAL_TERMS = [
  "resource", "configuration", "config", "script", "template",
  "message", "service", "mapping", "loader", "registry",
  "route", "schema", "pipeline",
];

const LOW_SIGNAL_EXTENSIONS = [".png", ".jpg", ".jpeg", ".gif", ".ico", ".woff", ".woff2", ".pdf", ".zip"];

export interface ConnectivityOptions {
  limit?: number;
  /**
   * Optional: nodeId → ReferenceCount produced by `countBasenameReferences`.
   * When provided, drives ranking — high-reference nodes shoot to the top
   * (high-impact missing edges); zero-reference nodes get a separate "likely
   * orphan/dead code" tag rather than competing with missed-reference candidates.
   */
  referenceCounts?: Map<string, ReferenceCount>;
}

function normalized(value: string): string {
  return value.toLowerCase();
}

function hasLowSignalExtension(filePath?: string): boolean {
  if (!filePath) return false;
  const lower = filePath.toLowerCase();
  return LOW_SIGNAL_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/**
 * Bounded reward per missing reference.
 *   0 refs        →   0  (handled separately as "likely orphan")
 *   1-10 refs     →  +5 per ref            (low-hanging fruit, up to +50)
 *   11-50 refs    →  +50 plus +3 per extra (high impact, up to +170)
 *   51+ refs      → +170 plateau           (avoids dominating everything)
 */
function referenceCountScore(count: number): number {
  if (count <= 0) return 0;
  if (count <= 10) return count * 5;
  if (count <= 50) return 50 + (count - 10) * 3;
  return 170;
}

export function buildConnectivityCandidates(
  graph: KnowledgeGraph,
  options: ConnectivityOptions = {},
): ConnectivityCandidate[] {
  const degrees = new Map<string, { meaningful: number; cheap: number }>();
  for (const node of graph.nodes) degrees.set(node.id, { meaningful: 0, cheap: 0 });

  for (const edge of graph.edges) {
    const source = degrees.get(edge.source);
    const target = degrees.get(edge.target);
    if (!source || !target) continue;
    const bucket = MEANINGFUL_EDGE_TYPES.has(edge.type) ? "meaningful" : "cheap";
    source[bucket] += 1;
    target[bucket] += 1;
  }

  const candidates: ConnectivityCandidate[] = [];
  for (const node of graph.nodes) {
    const degree = degrees.get(node.id) ?? { meaningful: 0, cheap: 0 };
    const reasons: string[] = [];
    let score = 0;

    if (degree.meaningful === 0) {
      score += 50;
      reasons.push("no meaningful edges");
    }
    if (degree.cheap > 0 && degree.meaningful === 0) {
      score += 10;
      reasons.push("only cheap grouping edges");
    }

    const text = normalized(`${node.name} ${node.summary} ${(node.tags ?? []).join(" ")} ${node.filePath ?? ""}`);
    if (HIGH_SIGNAL_TERMS.some((term) => text.includes(term))) {
      score += 25;
      reasons.push("high-signal name or summary");
    }
    if (node.type === "resource" || node.type === "config" || node.type === "service" || node.type === "pipeline") {
      score += 15;
      reasons.push(`high-signal node type ${node.type}`);
    }
    if (hasLowSignalExtension(node.filePath)) {
      score -= 30;
      reasons.push("low-signal asset extension");
    }

    // Reference-count weighting — the heaviest signal when supplied.
    const refEntry = options.referenceCounts?.get(node.id);
    let referenceCount: number | undefined;
    let referenceSamples: string[] | undefined;
    if (refEntry) {
      referenceCount = refEntry.count;
      referenceSamples = refEntry.samples;
      if (refEntry.count === 0) {
        // Likely orphan / dead code. Push down so missed-references rank first.
        score -= 20;
        reasons.push("no string references in codebase — likely orphan or dead code");
      } else {
        const bonus = referenceCountScore(refEntry.count);
        score += bonus;
        reasons.push(`${refEntry.count} string references in other files (+${bonus})`);
      }
    }

    if (score <= 0) continue;
    candidates.push({
      nodeIds: [node.id],
      score,
      reasons,
      meaningfulDegree: degree.meaningful,
      cheapDegree: degree.cheap,
      primaryNodeName: node.name,
      referenceCount,
      referenceSamples,
    });
  }

  return candidates
    .sort((a, b) => b.score - a.score || a.primaryNodeName.localeCompare(b.primaryNodeName))
    .slice(0, options.limit ?? 25);
}
```

- [ ] **Step 8: Run all tests**

Run:

```powershell
pnpm --dir understand-anything-plugin --filter @understand-anything/core test -- reference-search.test.ts regenerate/__tests__/connectivity.test.ts
```

Expected: both PASS.

- [ ] **Step 9: Commit**

Run:

```powershell
git add understand-anything-plugin/packages/core/src/reference-search.ts understand-anything-plugin/packages/core/src/__tests__/reference-search.test.ts understand-anything-plugin/packages/core/src/regenerate/connectivity.ts understand-anything-plugin/packages/core/src/regenerate/__tests__/connectivity.test.ts
git commit -m "feat(ua): rank connectivity by basename reference count"
```

### Reusing the reference-count primitive (follow-up notes — NOT in scope of this plan)

`countBasenameReferences` is exported as a generic helper so future work can adopt it cheaply. None of these are tasks in this plan; capture them as separate work if useful:

1. **File-analyzer batch enrichment.** Before dispatching a batch, run `countBasenameReferences` for each batch file against the project and surface high-count basenames in the dispatch prompt as candidate cross-file string references that the LLM should investigate. Pairs naturally with the advice spec's Task 4 (advice-aware batching).
2. **Graph-reviewer orphan validation.** During Phase 6, before flagging a node as isolated, run `countBasenameReferences` on its filePath. Count > 0 downgrades to "isolated but referenced — find the missing edge"; count == 0 upgrades to "isolated AND grep-orphan — likely dead code".
3. **`/understand-connectivity --target` triage.** Always call `countBasenameReferences` for the targeted node before investigation; the count gives the LLM a fast prior on whether to look for missing references or accept it as orphan.

---

### Task 7: Export Regenerate APIs

**Files:**
- Modify: `understand-anything-plugin/packages/core/src/index.ts`
- Test: `understand-anything-plugin/packages/core/src/regenerate/__tests__/exports.test.ts`

- [ ] **Step 1: Write failing export tests**

Create `understand-anything-plugin/packages/core/src/regenerate/__tests__/exports.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import * as core from "../../index.js";

describe("regenerate exports", () => {
  it("exports regenerate helpers from the core package index", () => {
    expect(core.createAttemptArchive).toBeTypeOf("function");
    expect(core.buildSubstrateManifest).toBeTypeOf("function");
    expect(core.mergeGraphWithCarryForward).toBeTypeOf("function");
    expect(core.compareGraphs).toBeTypeOf("function");
    expect(core.mergeDomainGraph).toBeTypeOf("function");
    expect(core.buildConnectivityCandidates).toBeTypeOf("function");
  });
});
```

- [ ] **Step 2: Run the failing export test**

Run:

```powershell
pnpm --dir understand-anything-plugin --filter @understand-anything/core test -- regenerate/__tests__/exports.test.ts
```

Expected: FAIL because the new helpers are not exported.

- [ ] **Step 3: Add exports**

Append this block to `understand-anything-plugin/packages/core/src/index.ts`:

```ts
export type {
  AttemptKind,
  AttemptManifest,
  AttemptStatus,
  ConnectivityCandidate,
  DeferredWorkRecord,
  GraphDiffReport,
  GraphPatch,
  InjectionRecord,
  InvalidationRecord,
  PhaseName,
  SubstrateFile,
  SubstrateManifest,
} from "./regenerate/types.js";
export {
  archiveRuntimeDirectories,
  createAttemptArchive,
  createAttemptId,
  finalizeAttemptManifest,
  writeAttemptJson,
} from "./regenerate/attempt-archive.js";
export {
  buildSubstrateManifest,
  isSubstrateCacheReusable,
  type BuildSubstrateOptions,
  type CacheReuseResult,
} from "./regenerate/substrate-manifest.js";
export {
  applyGraphPatch,
  edgeKey,
  mergeGraphWithCarryForward,
  type MergeGraphOptions,
} from "./regenerate/graph-merge.js";
export {
  compareGraphs,
  type CompareGraphOptions,
} from "./regenerate/graph-diff.js";
export {
  mergeDomainGraph,
  type MergeDomainOptions,
} from "./regenerate/domain-merge.js";
export {
  buildConnectivityCandidates,
  type ConnectivityOptions,
} from "./regenerate/connectivity.js";
export {
  countBasenameReferences,
  type CountBasenameReferencesOptions,
  type ReferenceCount,
} from "./reference-search.js";
```

- [ ] **Step 4: Run export test and build**

Run:

```powershell
pnpm --dir understand-anything-plugin --filter @understand-anything/core test -- regenerate/__tests__/exports.test.ts
pnpm --dir understand-anything-plugin --filter @understand-anything/core build
```

Expected: both commands PASS.

- [ ] **Step 5: Commit**

Run:

```powershell
git add understand-anything-plugin/packages/core/src/index.ts understand-anything-plugin/packages/core/src/regenerate/__tests__/exports.test.ts
git commit -m "feat(ua): export regenerate APIs"
```

---

### Task 8: Add Skill Helper CLI Scripts

**Files:**
- Create: `understand-anything-plugin/skills/understand/archive-run.mjs`
- Create: `understand-anything-plugin/skills/understand/apply-regenerate-merge.mjs`
- Create: `understand-anything-plugin/skills/understand-domain/merge-domain-graph.mjs`
- Create: `understand-anything-plugin/skills/understand-connectivity/build-connectivity-candidates.mjs`
- Create: `understand-anything-plugin/skills/understand-connectivity/`

- [ ] **Step 1: Create the archive CLI**

Create `understand-anything-plugin/skills/understand/archive-run.mjs`:

```js
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
```

- [ ] **Step 2: Create the regenerate merge CLI**

Create `understand-anything-plugin/skills/understand/apply-regenerate-merge.mjs`:

```js
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
```

- [ ] **Step 3: Create the domain merge CLI**

Create `understand-anything-plugin/skills/understand-domain/merge-domain-graph.mjs`:

```js
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
```

- [ ] **Step 4: Create the connectivity candidate CLI**

Create directory `understand-anything-plugin/skills/understand-connectivity/`, then create `understand-anything-plugin/skills/understand-connectivity/build-connectivity-candidates.mjs`:

The CLI walks the project ONCE to compute basename reference counts for every node with a `filePath`, then passes those counts into `buildConnectivityCandidates` so the ranking reflects "how likely is this missing edge to be a real reference vs. dead code".

```js
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
```

**Note:** The `understand-connectivity` SKILL.md (Task 12) must invoke this CLI with the new `<project-root>` argument first:

```bash
node <SKILL_DIR>/build-connectivity-candidates.mjs \
  "$PROJECT_ROOT" \
  "$PROJECT_ROOT/.understand-anything/knowledge-graph.json" \
  "$PROJECT_ROOT/.understand-anything/intermediate/connectivity-candidates.json" \
  "<budget>"
```

Task 12 already needs an update to reflect this signature change.

- [ ] **Step 5: Run a CLI syntax check**

Run:

```powershell
node --check understand-anything-plugin/skills/understand/archive-run.mjs
node --check understand-anything-plugin/skills/understand/apply-regenerate-merge.mjs
node --check understand-anything-plugin/skills/understand-domain/merge-domain-graph.mjs
node --check understand-anything-plugin/skills/understand-connectivity/build-connectivity-candidates.mjs
```

Expected: each command exits 0 with no output.

- [ ] **Step 6: Commit**

Run:

```powershell
git add understand-anything-plugin/skills/understand/archive-run.mjs understand-anything-plugin/skills/understand/apply-regenerate-merge.mjs understand-anything-plugin/skills/understand-domain/merge-domain-graph.mjs understand-anything-plugin/skills/understand-connectivity/build-connectivity-candidates.mjs
git commit -m "feat(ua): add regenerate skill helper scripts"
```

---

### Task 9: Update `/understand` Orchestrator Contract

**Files:**
- Modify: `understand-anything-plugin/skills/understand/SKILL.md`

- [ ] **Step 1: Add new options**

In `understand-anything-plugin/skills/understand/SKILL.md`, change the `argument-hint` line to:

```markdown
argument-hint: ["[path] [--full|--regenerate|--preserve-run|--interactive|--connectivity-pass|--budget <N>|--auto-update|--no-auto-update|--review|--language <lang>]"]
```

In the Options list, add these bullets after `--full`:

```markdown
  - `--regenerate` - Start from the current deterministic substrate plus the prior accepted semantic graph overlay. Carries forward prior graph content unless invalidated.
  - `--preserve-run` - Archive `intermediate/`, `tmp/`, scanner output, batch output, merge reports, validation output, and final artifacts under `.understand-anything/runs/<attempt-id>/`.
  - `--interactive` - At orchestrator phase transitions, ask the user whether to inject advice into the next phase. Subagents never ask the user directly.
  - `--connectivity-pass` - After merge, run a budgeted disconnected-node candidate pass and feed selected patches into the regenerate merge.
  - `--budget <N>` - Limit connectivity recovery candidate count. Defaults to `25` when `--connectivity-pass` is present.
```

- [ ] **Step 2: Add attempt initialization to Phase 0**

After Phase 0 creates `intermediate` and `tmp`, insert:

```markdown
3.1. **Attempt archive initialization:**
    - Set `$ATTEMPT_KIND` to `regenerate` when `--regenerate` is present, otherwise `full`.
    - Set `$PRESERVE_RUN` to true when `--preserve-run`, `--regenerate`, or `--connectivity-pass` is present.
    - If `$PRESERVE_RUN` is true, write `$PROJECT_ROOT/.understand-anything/tmp/attempt-init.json`:
      ```json
      {
        "kind": "<full-or-regenerate>",
        "flags": ["<parsed arguments>"],
        "projectRoot": ".",
        "baseAttemptId": "<previous accepted attempt id if known>"
      }
      ```
    - Run:
      ```bash
      node <SKILL_DIR>/archive-run.mjs init "$PROJECT_ROOT" "$PROJECT_ROOT/.understand-anything/tmp/attempt-init.json" \
        > "$PROJECT_ROOT/.understand-anything/tmp/attempt-archive.json"
      ```
    - Read `attempt-archive.json` and store `$ATTEMPT_ID`, `$ATTEMPT_DIR`, and `$ATTEMPT_MANIFEST_PATH`.
```

- [ ] **Step 3: Add the generic interactive checkpoint rule**

After the Phase 0 context collection section, insert:

```markdown
## Interactive Checkpoints

Only run this section when `--interactive` is present. The orchestrator owns all user interaction. Subagents do not ask the user questions.

Before entering a phase that accepts extra guidance, summarize the next step in conversational language and ask whether the user has advice for the agents.

Prompt format:

```text
Next I will <plain-language description of next step>. I have <available evidence list> loaded. Any advice for the agents before I start?
```

If the user gives advice:

1. Write an injection record to `$PROJECT_ROOT/.understand-anything/intermediate/injections/<injection-id>.json`.
2. Copy the same file to `$ATTEMPT_DIR/injections/<injection-id>.json` when `$PRESERVE_RUN` is true.
3. Add the record to `$OPEN_INJECTIONS` for prompts in the next phase.

Injection record shape:

```json
{
  "id": "inj-<timestamp>",
  "createdAt": "<ISO timestamp>",
  "source": "interactive-checkpoint",
  "appliesTo": ["<next phase>"],
  "text": "<user advice>",
  "status": "open"
}
```

If the user skips, continue immediately. In non-interactive mode, do not pause.
```

- [ ] **Step 4: Add regenerate foundation loading**

In Phase 0 Decision Logic, add this row before `--full`:

```markdown
   | `--regenerate` flag + existing graph | Regenerate (full scan/extract current substrate, then merge with prior accepted semantic graph) |
```

After the decision table, add:

```markdown
   **Regenerate foundation:** When `--regenerate` is active:
   - Copy existing `.understand-anything/knowledge-graph.json`, `meta.json`, and `fingerprints.json` into `$ATTEMPT_DIR/final/previous-*` when `$PRESERVE_RUN` is true.
   - Treat the current scan and extractor output as deterministic substrate.
   - Treat the prior accepted graph as semantic overlay. Prior batch graph summaries, tags, inferred relationships, domain graph entries, user corrections, and deferred work carry forward unless invalidated.
   - Prior deterministic extractor outputs are cache, audit, and diff evidence. They do not override current source-derived scan/extraction facts.
```

- [ ] **Step 5: Update Phase 2 analyzer prompt inputs and sidecars**

In the Phase 2 dispatch prompt, after the advice block, add:

```markdown
> Prior regenerate context for this batch:
> ```json
> {
>   "priorBatchGraphPath": "<path if available, otherwise null>",
>   "priorExtractorOutputPath": "<path if available, otherwise null>",
>   "matchingInjections": [<open injection records for analyze>],
>   "matchingDeferredWork": [<open deferred work records for this phase or scope>]
> }
> ```
>
> Use prior semantic graph material as carry-forward context. Use current deterministic extraction as source-derived structure. If a relationship is supported by current evidence, include it in this batch output. If budget runs out, write deferred work rather than dropping the lead silently.
>
> Sidecar outputs:
> - `$PROJECT_ROOT/.understand-anything/intermediate/batch-<batchIndex>.patch.json`
> - `$PROJECT_ROOT/.understand-anything/intermediate/batch-<batchIndex>.deferred-work.json`
> - `$PROJECT_ROOT/.understand-anything/intermediate/batch-<batchIndex>.notes.json`
```

- [ ] **Step 6: Add regenerate merge after normal merge script**

After the `merge-batch-graphs.py` invocation in Phase 2, insert:

```markdown
When `--regenerate` is active, run the regenerate merge wrapper after `merge-batch-graphs.py`:

1. Write `$PROJECT_ROOT/.understand-anything/intermediate/regenerate-merge-input.json`:
   ```json
   {
     "previousGraphPath": "$PROJECT_ROOT/.understand-anything/knowledge-graph.json",
     "currentGraphPath": "$PROJECT_ROOT/.understand-anything/intermediate/assembled-graph.json",
     "patchPaths": ["<all batch-*.patch.json and correction patch paths that exist>"],
     "removedSourcePaths": ["<files present in prior accepted graph but absent from current scan>"],
     "outputGraphPath": "$PROJECT_ROOT/.understand-anything/intermediate/assembled-graph.json",
     "outputDiffPath": "$PROJECT_ROOT/.understand-anything/intermediate/regenerate-diff.json"
   }
   ```
2. Run:
   ```bash
   node <SKILL_DIR>/apply-regenerate-merge.mjs \
     "$PROJECT_ROOT/.understand-anything/intermediate/regenerate-merge-input.json"
   ```
3. Add `regenerate-diff.json` to `$PHASE_WARNINGS` if it lists removed nodes or removed edges.
```

- [ ] **Step 7: Preserve artifacts before cleanup**

Replace Phase 7 cleanup step with:

```markdown
4. Preserve and clean up intermediate files:
   - If `$PRESERVE_RUN` is true, write `$PROJECT_ROOT/.understand-anything/tmp/attempt-snapshot.json`:
     ```json
     { "attemptDir": "$ATTEMPT_DIR" }
     ```
   - Run:
     ```bash
     node <SKILL_DIR>/archive-run.mjs snapshot "$PROJECT_ROOT" "$PROJECT_ROOT/.understand-anything/tmp/attempt-snapshot.json"
     ```
   - Copy final `knowledge-graph.json`, `meta.json`, `fingerprints.json`, `domain-graph.json` if present, and `regenerate-diff.json` if present into `$ATTEMPT_DIR/final/`.
   - Write `$PROJECT_ROOT/.understand-anything/tmp/attempt-finalize.json`:
     ```json
     {
       "manifestPath": "$ATTEMPT_MANIFEST_PATH",
       "update": {
         "status": "completed",
         "promoted": true
       }
     }
     ```
   - Run:
     ```bash
     node <SKILL_DIR>/archive-run.mjs finalize "$PROJECT_ROOT" "$PROJECT_ROOT/.understand-anything/tmp/attempt-finalize.json"
     ```
   - Unless `--preserve-run` is present, delete volatile runtime directories:
     ```bash
     rm -rf $PROJECT_ROOT/.understand-anything/intermediate
     rm -rf $PROJECT_ROOT/.understand-anything/tmp
     ```
```

- [ ] **Step 8: Verify Markdown terms**

Run:

```powershell
rg -n -- "--regenerate|--preserve-run|--interactive|apply-regenerate-merge|archive-run|Interactive Checkpoints|regenerate-diff" understand-anything-plugin/skills/understand/SKILL.md
```

Expected: output includes every searched term.

- [ ] **Step 9: Commit**

Run:

```powershell
git add understand-anything-plugin/skills/understand/SKILL.md
git commit -m "feat(ua): document regenerate orchestration"
```

---

### Task 10: Update Agent Contracts For Regeneration

**Files:**
- Modify: `understand-anything-plugin/agents/file-analyzer.md`
- Modify: `understand-anything-plugin/agents/assemble-reviewer.md`
- Modify: `understand-anything-plugin/agents/domain-analyzer.md`

- [ ] **Step 1: Update file analyzer prior-context rules**

In `understand-anything-plugin/agents/file-analyzer.md`, after the Understand advice section, add:

```markdown
**Regenerate context:** If the dispatch prompt includes prior batch graph, prior extractor output, injection records, or deferred work records, treat those as carry-forward context for this batch. Current `extract-structure.mjs` output is the source-derived structural substrate. Prior semantic nodes, summaries, tags, and inferred relationships may be reused when current evidence supports them.

If you can confidently include a missing relationship within this batch's responsibility, include it in the batch graph or batch patch. Do not report it upward instead of doing the work.

When budget or batch scope prevents completion, write deferred work to:

```text
<project-root>/.understand-anything/intermediate/batch-<batchIndex>.deferred-work.json
```

Use this shape:

```json
[
  {
    "id": "dw-<batchIndex>-<short-name>",
    "phase": "analyze",
    "scope": "batch-<batchIndex>",
    "kind": "deferred-work",
    "summary": "<specific remaining relationship family>",
    "evidencePaths": ["<project-relative path>"],
    "nextAgentInstruction": "<concrete instruction for a later agent>",
    "reasonDeferred": "<batch scope or budget reason>",
    "status": "open"
  }
]
```

When the prompt asks for a patch, write:

```text
<project-root>/.understand-anything/intermediate/batch-<batchIndex>.patch.json
```

Use this shape:

```json
{
  "version": "1.0.0",
  "targetGraph": "knowledge",
  "source": "regenerate",
  "nodes": [],
  "edges": [],
  "invalidations": []
}
```
```

- [ ] **Step 2: Update assemble reviewer deletion rule**

In `understand-anything-plugin/agents/assemble-reviewer.md`, after the Context section, add:

```markdown
## Regenerate Merge Rule

When regenerate context is supplied, absence from the current assembled graph is not deletion evidence by itself. Deletion requires an explicit invalidation, a removed source file, a schema-invalid entry, a canonical replacement, or an accepted regenerate report.

Your role is to resolve mechanical merge problems, recover source-backed relationships, and write review notes. Do not remove prior accepted semantic graph content merely because the current batch agents did not recreate it.
```

- [ ] **Step 3: Update domain analyzer prior-context rule**

In `understand-anything-plugin/agents/domain-analyzer.md`, after the Input section, add:

```markdown
**Existing domain graph context:** If the dispatch prompt includes an existing `domain-graph.json`, treat it as accepted prior domain knowledge. Produce the best current `domain-analysis.json` from the supplied structural context. Do not delete existing domains, flows, or steps by omission. The orchestrator merges your current analysis with the prior domain graph after you write `domain-analysis.json`.
```

- [ ] **Step 4: Verify agent prompt terms**

Run:

```powershell
rg -n "Regenerate context|deferred-work|Regenerate Merge Rule|Existing domain graph context|absence from the current assembled graph" understand-anything-plugin/agents/file-analyzer.md understand-anything-plugin/agents/assemble-reviewer.md understand-anything-plugin/agents/domain-analyzer.md
```

Expected: output includes all five terms.

- [ ] **Step 5: Commit**

Run:

```powershell
git add understand-anything-plugin/agents/file-analyzer.md understand-anything-plugin/agents/assemble-reviewer.md understand-anything-plugin/agents/domain-analyzer.md
git commit -m "feat(ua): teach agents regenerate context"
```

---

### Task 11: Update `/understand-domain` To Merge, Not Overwrite

**Files:**
- Modify: `understand-anything-plugin/skills/understand-domain/SKILL.md`

- [ ] **Step 1: Add domain merge inputs to Phase 4**

In Phase 4, after the instruction to read the domain-analyzer prompt, add:

```markdown
If `$PROJECT_ROOT/.understand-anything/domain-graph.json` exists, include it in the dispatch prompt as accepted prior domain graph context. Tell the agent that omission from the new analysis is not deletion.
```

- [ ] **Step 2: Replace Phase 5 save behavior**

Replace Phase 5 steps 3-5 with:

```markdown
3. If validation fails, log warnings but keep the valid `domain-analysis.json` content for merge input.
4. Write `$PROJECT_ROOT/.understand-anything/intermediate/domain-merge-input.json`:
   ```json
   {
     "previousDomainGraphPath": "$PROJECT_ROOT/.understand-anything/domain-graph.json",
     "currentDomainAnalysisPath": "$PROJECT_ROOT/.understand-anything/intermediate/domain-analysis.json",
     "patchPaths": ["<domain correction patch paths that exist>"],
     "outputDomainGraphPath": "$PROJECT_ROOT/.understand-anything/domain-graph.json"
   }
   ```
5. Run:
   ```bash
   node <SKILL_DIR>/merge-domain-graph.mjs \
     "$PROJECT_ROOT/.understand-anything/intermediate/domain-merge-input.json"
   ```
6. Save the merge report output in the final summary.
7. Clean up `$PROJECT_ROOT/.understand-anything/intermediate/domain-analysis.json` and `$PROJECT_ROOT/.understand-anything/intermediate/domain-context.json` only after `domain-graph.json` exists.
```

- [ ] **Step 3: Add interactive checkpoint mention**

In the Instructions section, add:

```markdown
When `--interactive` is present, use the generic orchestrator checkpoint before Phase 4:

```text
Next I will ask the domain analyzer to turn the structural graph into domains, flows, and process steps. I have the current structural graph, any existing domain graph, and saved feedback loaded. Any advice for the agent before I start?
```
```

- [ ] **Step 4: Verify domain skill terms**

Run:

```powershell
rg -n "merge-domain-graph|domain-merge-input|accepted prior domain graph|--interactive|omission from the new analysis" understand-anything-plugin/skills/understand-domain/SKILL.md
```

Expected: output includes all five terms.

- [ ] **Step 5: Commit**

Run:

```powershell
git add understand-anything-plugin/skills/understand-domain/SKILL.md
git commit -m "feat(ua): merge domain graph updates"
```

---

### Task 12: Add `/understand-connectivity` Flow

**Files:**
- Create: `understand-anything-plugin/skills/understand-connectivity/SKILL.md`

- [ ] **Step 1: Create the connectivity skill**

Create `understand-anything-plugin/skills/understand-connectivity/SKILL.md`:

```markdown
---
name: understand-connectivity
description: Investigate isolated or weakly connected Understand Anything graph areas and produce graph patches for missed relationships
argument-hint: ["[--target <node-id-or-path>] [--budget <N>] [--interactive]"]
---

# /understand-connectivity

Investigates disconnected graph areas in `.understand-anything/knowledge-graph.json` and writes graph patches that can be merged by `/understand --regenerate`.

## Instructions

### Phase 0: Resolve Project And Inputs

1. Set `PROJECT_ROOT` to the current working directory unless a path argument is supplied.
2. Verify `$PROJECT_ROOT/.understand-anything/knowledge-graph.json` exists. If not, stop and tell the user to run `/understand` first.
3. Parse:
   - `--target <node-id-or-path>` for targeted investigation
   - `--budget <N>` for candidate count, default `25`
   - `--interactive` for orchestrator checkpoints
4. Ensure `$PROJECT_ROOT/.understand-anything/intermediate` exists.

### Phase 1: Build Candidates

If `--target` is supplied, create a single candidate for that node or file path. Otherwise run:

```bash
node <SKILL_DIR>/build-connectivity-candidates.mjs \
  "$PROJECT_ROOT" \
  "$PROJECT_ROOT/.understand-anything/knowledge-graph.json" \
  "$PROJECT_ROOT/.understand-anything/intermediate/connectivity-candidates.json" \
  "<budget>"
```

The CLI walks `$PROJECT_ROOT` once for basename references and feeds the counts into ranking, so the top candidates are nodes whose basenames appear most often in other files (high-impact missed edges). Zero-reference candidates are tagged as "likely orphan / dead code" in their `reasons[]` and pushed down — investigate them last, or skip them in favor of the next pass.

Read `connectivity-candidates.json`.

### Phase 2: Interactive Checkpoint

Only when `--interactive` is present, ask:

```text
Next I will inspect the highest-signal disconnected graph areas and look for concrete source-backed relationships. I have the candidate list and the current graph loaded. Any advice for the agent before I start?
```

Persist any answer as an injection record in `$PROJECT_ROOT/.understand-anything/intermediate/injections/`.

### Phase 3: Investigation

For each selected candidate:

1. Load node details and adjacent graph context from `knowledge-graph.json`.
2. Load available prior attempt artifacts from `.understand-anything/runs/` when present.
3. Inspect source files only as needed to verify concrete relationships.
4. Write graph patch output to:
   ```text
   $PROJECT_ROOT/.understand-anything/intermediate/connectivity-<index>.patch.json
   ```
5. Write deferred work output to:
   ```text
   $PROJECT_ROOT/.understand-anything/intermediate/connectivity-<index>.deferred-work.json
   ```

Patch shape:

```json
{
  "version": "1.0.0",
  "targetGraph": "knowledge",
  "source": "connectivity-pass",
  "nodes": [],
  "edges": [
    {
      "source": "config:Application/resources/foo.xml",
      "target": "file:Application/src/ResourceLoader.cs",
      "type": "configures",
      "direction": "forward",
      "weight": 0.8
    }
  ],
  "invalidations": []
}
```

### Phase 4: Report

Write `$PROJECT_ROOT/.understand-anything/intermediate/connectivity-report.json`:

```json
{
  "version": "1.0.0",
  "patchesWritten": ["<patch paths>"],
  "deferredWorkWritten": ["<deferred work paths>"],
  "summary": "<short summary>"
}
```

Tell the user to run `/understand --regenerate` to merge the patches, or run `/understand --regenerate --connectivity-pass` to include this flow in one regenerate pass.
```

- [ ] **Step 2: Verify skill discovery text**

Run:

```powershell
rg -n "understand-connectivity|connectivity-candidates|connectivity-report|connectivity-pass" understand-anything-plugin/skills/understand-connectivity/SKILL.md
```

Expected: output includes all four terms.

- [ ] **Step 3: Commit**

Run:

```powershell
git add understand-anything-plugin/skills/understand-connectivity/SKILL.md
git commit -m "feat(ua): add connectivity recovery skill"
```

---

### Task 13: Full Verification

**Files:**
- Verify all modified plugin source, scripts, and skills.

- [ ] **Step 1: Run regenerate-focused tests**

Run:

```powershell
pnpm --dir understand-anything-plugin --filter @understand-anything/core test -- regenerate
```

Expected: PASS.

- [ ] **Step 2: Run core test suite**

Run:

```powershell
pnpm --dir understand-anything-plugin --filter @understand-anything/core test
```

Expected: PASS.

- [ ] **Step 3: Build core**

Run:

```powershell
pnpm --dir understand-anything-plugin --filter @understand-anything/core build
```

Expected: PASS.

- [ ] **Step 4: Run skill helper syntax checks**

Run:

```powershell
node --check understand-anything-plugin/skills/understand/archive-run.mjs
node --check understand-anything-plugin/skills/understand/apply-regenerate-merge.mjs
node --check understand-anything-plugin/skills/understand-domain/merge-domain-graph.mjs
node --check understand-anything-plugin/skills/understand-connectivity/build-connectivity-candidates.mjs
```

Expected: each command exits 0 with no output.

- [ ] **Step 5: Run existing Python merge tests**

Run:

```powershell
python understand-anything-plugin/skills/understand/test_merge_batch_graphs.py -v
```

Expected: PASS.

- [ ] **Step 6: Verify prompt wiring terms**

Run:

```powershell
rg -n -- "--regenerate|--preserve-run|--interactive|apply-regenerate-merge|archive-run|merge-domain-graph|understand-connectivity|deferred-work" understand-anything-plugin/skills understand-anything-plugin/agents
```

Expected: output includes matches in `/understand`, `/understand-domain`, `/understand-connectivity`, `file-analyzer`, and `assemble-reviewer`.

- [ ] **Step 7: Commit verification-only prompt adjustments if any were needed**

If Step 6 required prompt wording fixes, run:

```powershell
git add understand-anything-plugin/skills understand-anything-plugin/agents
git commit -m "docs(ua): tighten regenerate prompt wiring"
```

Expected: commit is created only when Step 6 led to source edits.

---

## Spec Coverage Self-Review

- Attempt archive: Tasks 1, 2, 8, and 9 create durable run manifests, phase directories, snapshots, and finalize behavior.
- Deterministic substrate versus semantic overlay: Tasks 3, 4, and 9 make current source-derived substrate authoritative while carrying prior semantic graph content forward.
- User advice and corrections: Task 9 adds orchestrator-owned `--interactive` injection records; Task 10 tells subagents how to consume them.
- Deferred work: Tasks 1, 9, 10, and 12 define records and require sidecar output from analyzers and connectivity passes.
- Structural regenerate: Tasks 4, 8, and 9 add graph patch merge, diff report, and `/understand --regenerate` orchestration.
- Domain graph continuity: Tasks 5, 8, 10, and 11 merge existing domain graph entries instead of overwriting.
- Connectivity recovery: Tasks 6, 8, and 12 add ranking, candidate CLI, and a dedicated flow.
- Graph diff and regression report: Task 4 creates `compareGraphs`; Task 9 writes `regenerate-diff.json` before promotion.
- Interactive checkpoints: Tasks 9 and 11 add orchestrator checkpoints for structural and domain workflows.
- Tree-sitter/LLM hybrid correction: Tasks 3, 4, and 9 preserve deterministic extractor facts as cache/audit/diff material and prevent stale deterministic artifacts from overriding current source extraction.

## Self-Review Checks

- Marker scan: completed after writing; no unresolved task markers remain.
- Type consistency: `GraphPatch`, `InjectionRecord`, `DeferredWorkRecord`, `SubstrateManifest`, `GraphDiffReport`, and `ConnectivityCandidate` are defined once in Task 1 and reused by later tasks.
- Execution order: Every code task starts with a failing test, adds implementation, verifies, and commits before the next feature layer.
