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
