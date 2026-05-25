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
