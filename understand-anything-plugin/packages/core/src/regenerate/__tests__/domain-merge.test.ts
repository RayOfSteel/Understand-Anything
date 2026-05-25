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
