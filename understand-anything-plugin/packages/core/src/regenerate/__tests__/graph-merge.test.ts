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
