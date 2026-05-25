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
