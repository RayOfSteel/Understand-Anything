import { describe, it, expect } from "vitest";
import { applyTriggerRules } from "../apply-trigger-rules.js";
import type { TriggerRule } from "../trigger-rule-schema.js";

const rule = (over: Partial<TriggerRule>): TriggerRule => ({
  id: "r", kind: "trigger", match: { type: "glob", pattern: "**/*" },
  confidence: 0.9, enabled: true, disables: [], ...over,
} as TriggerRule);

const node = (id: string, over: Record<string, unknown> = {}) => ({
  id, type: "file", name: id.split("/").pop() ?? id,
  filePath: id.replace(/^file:/, ""), tags: [] as string[], ...over,
});

describe("applyTriggerRules", () => {
  it("glob rule tags matching nodes with entry-point and records rule id", () => {
    const nodes = [node("file:scripts/run.scr"), node("file:src/lib.ts")];
    const res = applyTriggerRules(nodes, [
      rule({ id: "t:scr", match: { type: "glob", pattern: "scripts/**/*.scr" } }),
    ]);
    expect(res.taggedNodeIds).toEqual(["file:scripts/run.scr"]);
    expect(nodes[0].tags).toContain("entry-point");
    expect((nodes[0] as { triggeredBy?: string[] }).triggeredBy).toEqual(["t:scr"]);
    expect(nodes[1].tags).not.toContain("entry-point");
    expect(res.perRule["t:scr"]).toBe(1);
  });

  it("path-regex and symbol matchers work; symbol respects nodeType", () => {
    const nodes = [
      node("file:Service.svc"),
      node("function:app.cs:Main", { type: "function", name: "Main", filePath: "app.cs" }),
      node("file:Main", { name: "Main" }), // wrong nodeType for the symbol rule
    ];
    applyTriggerRules(nodes, [
      rule({ id: "t:svc", match: { type: "path-regex", pattern: "\\.svc$" } }),
      rule({ id: "t:main", match: { type: "symbol", pattern: "^Main$", nodeType: "function" } }),
    ]);
    expect(nodes[0].tags).toContain("entry-point");
    expect(nodes[1].tags).toContain("entry-point");
    expect(nodes[2].tags).not.toContain("entry-point");
  });

  it("is idempotent: re-applying adds no duplicate tags or rule ids", () => {
    const nodes = [node("file:scripts/run.scr")];
    const rules = [rule({ id: "t:scr", match: { type: "glob", pattern: "scripts/**" } })];
    applyTriggerRules(nodes, rules);
    applyTriggerRules(nodes, rules);
    expect(nodes[0].tags.filter((t) => t === "entry-point")).toHaveLength(1);
    expect((nodes[0] as { triggeredBy?: string[] }).triggeredBy).toEqual(["t:scr"]);
  });

  it("normalizes backslash paths before matching", () => {
    const nodes = [node("file:scripts\\run.scr", { filePath: "scripts\\run.scr" })];
    applyTriggerRules(nodes, [rule({ id: "t", match: { type: "glob", pattern: "scripts/**" } })]);
    expect(nodes[0].tags).toContain("entry-point");
  });
});
