import { describe, it, expect } from "vitest";
import { computeReachability, componentId } from "../engine.js";

type N = { id: string; type: string; name: string; filePath?: string; tags: string[] };
type E = { source: string; target: string; type: string; direction: string };
const n = (id: string, over: Partial<N> = {}): N => ({
  id, type: "file", name: id, filePath: id.replace(/^file:/, ""), tags: [], ...over,
});
const e = (source: string, target: string, type: string, direction = "forward"): E =>
  ({ source, target, type, direction });
const run = (nodes: N[], edges: E[], triggers: string[]) =>
  computeReachability({ nodes, edges }, new Set(triggers));

describe("computeReachability", () => {
  it("flags a mutually-connected pair with no path from a trigger as one 2-node island", () => {
    const r = run(
      [n("file:main.ts"), n("file:a.ts"), n("file:b.ts")],
      [e("file:a.ts", "file:b.ts", "imports"), e("file:b.ts", "file:a.ts", "imports")],
      ["file:main.ts"],
    );
    expect(r.statusByNode.get("file:main.ts")).toBe("reachable");
    expect(r.statusByNode.get("file:a.ts")).toBe("unresolved");
    expect(r.components).toHaveLength(1);
    expect(r.components[0].nodeIds.sort()).toEqual(["file:a.ts", "file:b.ts"]);
    expect(r.components[0].size).toBe(2);
  });

  it("attaches satellites pointing at reachable nodes without seeding forward reach", () => {
    const r = run(
      [n("file:main.ts"), n("config:tsconfig.json", { type: "config" }), n("file:dead.ts")],
      [
        e("config:tsconfig.json", "file:main.ts", "configures"),
        e("config:tsconfig.json", "file:dead.ts", "configures"),
      ],
      ["file:main.ts"],
    );
    expect(r.statusByNode.get("config:tsconfig.json")).toBe("attached");
    // attachment must NOT make the config's other target reachable
    expect(r.statusByNode.get("file:dead.ts")).toBe("unresolved");
  });

  it("attachment is a fixpoint: doc documenting an attached config attaches too", () => {
    const r = run(
      [n("file:main.ts"), n("config:c.json", { type: "config" }), n("document:d.md", { type: "document" })],
      [
        e("config:c.json", "file:main.ts", "configures"),
        e("document:d.md", "config:c.json", "documents"),
      ],
      ["file:main.ts"],
    );
    expect(r.statusByNode.get("document:d.md")).toBe("attached");
  });

  it("contains is bidirectional: a called function makes its file reachable", () => {
    const r = run(
      [n("file:main.ts"), n("file:util.ts"), n("function:util.ts:helper", { type: "function" })],
      [
        e("file:main.ts", "function:util.ts:helper", "calls"),
        e("file:util.ts", "function:util.ts:helper", "contains"),
      ],
      ["file:main.ts"],
    );
    expect(r.statusByNode.get("file:util.ts")).toBe("reachable");
  });

  it("deploys traverses forward AND attaches backward", () => {
    const r = run(
      [n("pipeline:ci.yml", { type: "pipeline" }), n("file:app.ts"), n("file:main.ts"), n("config:Dockerfile", { type: "config" })],
      [
        e("pipeline:ci.yml", "file:app.ts", "deploys"),   // forward: reachable from CI trigger
        e("config:Dockerfile", "file:main.ts", "deploys"), // backward attach at reachable code
      ],
      ["pipeline:ci.yml", "file:main.ts"],
    );
    expect(r.statusByNode.get("file:app.ts")).toBe("reachable");
    expect(r.statusByNode.get("config:Dockerfile")).toBe("attached");
  });

  it("tested_by attaches the test, never rescues prod code reachable only via tests", () => {
    const r = run(
      [
        n("file:main.ts"), n("file:reached.ts"),
        n("file:island.ts"), n("file:x.test.ts", { tags: ["test"] }),
      ],
      [
        e("file:main.ts", "file:reached.ts", "imports"),
        e("file:reached.ts", "file:x.test.ts", "tested_by"), // test attaches
        e("file:x.test.ts", "file:island.ts", "imports"),    // island only referenced by the test
      ],
      ["file:main.ts"],
    );
    expect(r.statusByNode.get("file:x.test.ts")).toBe("attached");
    expect(r.statusByNode.get("file:island.ts")).toBe("unresolved");
    expect(r.onlyViaTests).toContain("file:island.ts");
  });

  it("multi-root: two triggers, disjoint reachable sets, zero islands", () => {
    const r = run(
      [n("file:app1.ts"), n("file:lib1.ts"), n("file:app2.ts"), n("file:lib2.ts")],
      [e("file:app1.ts", "file:lib1.ts", "imports"), e("file:app2.ts", "file:lib2.ts", "imports")],
      ["file:app1.ts", "file:app2.ts"],
    );
    expect(r.components).toHaveLength(0);
  });

  it("respects edge.direction backward (swap) and ignores weak types", () => {
    const r = run(
      [n("file:main.ts"), n("file:c.ts"), n("file:w.ts")],
      [
        e("file:c.ts", "file:main.ts", "imports", "backward"), // effectively main -> c
        e("file:main.ts", "file:w.ts", "related"),             // weak: no rescue
      ],
      ["file:main.ts"],
    );
    expect(r.statusByNode.get("file:c.ts")).toBe("reachable");
    expect(r.statusByNode.get("file:w.ts")).toBe("unresolved");
  });

  it("clusters islands via union-find over ALL edge types regardless of direction", () => {
    const r = run(
      [n("file:main.ts"), n("file:i1.ts"), n("file:i2.ts"), n("file:i3.ts")],
      [
        e("file:i1.ts", "file:i2.ts", "related"), // weak edge still groups the component
        e("file:i3.ts", "file:i1.ts", "imports"),
      ],
      ["file:main.ts"],
    );
    expect(r.components).toHaveLength(1);
    expect(r.components[0].size).toBe(3);
    expect(r.components[0].dominantCategory).toBe("ts");
  });
});

describe("componentId", () => {
  it("is stable and order-independent", () => {
    expect(componentId(["b.ts", "a.ts"])).toBe(componentId(["a.ts", "b.ts"]));
    expect(componentId(["a.ts"])).not.toBe(componentId(["b.ts"]));
    expect(componentId(["a.ts", "b.ts"])).toMatch(/^island-[0-9a-f]{8}$/);
  });
});
