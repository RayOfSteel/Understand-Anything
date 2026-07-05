import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TriggerRuleSchema } from "../trigger-rule-schema.js";
import { loadTriggerRuleDirs } from "../load-trigger-rules.js";

const VALID = {
  id: "trigger:test:scr",
  kind: "trigger",
  match: { type: "glob", pattern: "scripts/**/*.scr" },
  description: "TDM runtime executes every .scr under /scripts",
  confidence: 0.9,
  source: "user",
};

function dirWith(files: Record<string, unknown>): string {
  const d = mkdtempSync(join(tmpdir(), "ua-trig-"));
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(d, name), JSON.stringify(content, null, 2), "utf-8");
  }
  return d;
}

describe("TriggerRuleSchema", () => {
  it("accepts a valid glob rule and defaults enabled/disables", () => {
    const parsed = TriggerRuleSchema.parse(VALID);
    expect(parsed.enabled).toBe(true);
    expect(parsed.disables).toEqual([]);
  });

  it("accepts path-regex and symbol match types", () => {
    expect(
      TriggerRuleSchema.safeParse({
        ...VALID, id: "r2", match: { type: "path-regex", pattern: "\\.svc$" },
      }).success,
    ).toBe(true);
    expect(
      TriggerRuleSchema.safeParse({
        ...VALID, id: "r3",
        match: { type: "symbol", pattern: "^Main$", nodeType: "function" },
      }).success,
    ).toBe(true);
  });

  it("rejects the not-yet-supported query match type", () => {
    expect(
      TriggerRuleSchema.safeParse({
        ...VALID, id: "r4", match: { type: "query", pattern: "(class_declaration)" },
      }).success,
    ).toBe(false);
  });

  it("rejects unknown top-level keys (strict)", () => {
    expect(TriggerRuleSchema.safeParse({ ...VALID, extra: 1 }).success).toBe(false);
  });
});

describe("loadTriggerRuleDirs", () => {
  it("merges dirs in order, later id wins, disabled and disabled-by-disables dropped", () => {
    const pack = dirWith({
      "pack.json": [
        VALID,
        { ...VALID, id: "trigger:pack:noise", match: { type: "glob", pattern: "**/*.tmp" } },
      ],
    });
    const local = dirWith({
      "local.json": [
        { ...VALID, id: "trigger:test:scr", confidence: 1.0 }, // override
        { ...VALID, id: "trigger:local:kill", match: { type: "glob", pattern: "x" }, disables: ["trigger:pack:noise"] },
      ],
    });
    const { rules, warnings } = loadTriggerRuleDirs([pack, local]);
    const ids = rules.map((r) => r.id);
    expect(ids).toContain("trigger:test:scr");
    expect(ids).toContain("trigger:local:kill");
    expect(ids).not.toContain("trigger:pack:noise"); // disabled via disables
    expect(rules.find((r) => r.id === "trigger:test:scr")?.confidence).toBe(1.0);
    expect(warnings.some((w) => w.includes("overridden"))).toBe(true);
  });

  it("skips defective files/rules with warnings, never throws", () => {
    const d = mkdtempSync(join(tmpdir(), "ua-trig-bad-"));
    writeFileSync(join(d, "broken.json"), "{ not json", "utf-8");
    writeFileSync(join(d, "invalid.json"), JSON.stringify({ id: "x" }), "utf-8");
    const { rules, warnings } = loadTriggerRuleDirs([d]);
    expect(rules).toEqual([]);
    expect(warnings.length).toBe(2);
  });

  it("ignores missing directories silently", () => {
    const { rules, warnings } = loadTriggerRuleDirs([join(tmpdir(), "does-not-exist-ua")]);
    expect(rules).toEqual([]);
    expect(warnings).toEqual([]);
  });
});
