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
