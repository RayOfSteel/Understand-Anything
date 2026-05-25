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
