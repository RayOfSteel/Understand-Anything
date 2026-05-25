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
