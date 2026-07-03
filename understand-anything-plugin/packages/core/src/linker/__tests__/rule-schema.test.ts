import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LinkRuleSchema } from "../rule-schema.js";
import { loadRuleDirs } from "../load-rules.js";

const VALID_RULE = {
  id: "wpf.code-behind",
  confidence: 1.0,
  edge: { type: "implements", direction: "forward" },
  facts: {
    xClass: {
      language: "xaml",
      query: ['(Attribute (Name) @n (#eq? @n "x:Class") (AttValue) @value)'],
      transform: { value: "stripQuotes" },
    },
    cls: { builtin: "csharp.classFqn" },
  },
  link: {
    where: ["cls.value == xClass.value"],
    source: "cls.file",
    target: "xClass.file",
    evidence: "x:Class={xClass.value}",
  },
};

describe("LinkRuleSchema", () => {
  it("accepts a valid rule and defaults enabled/direction", () => {
    const r = LinkRuleSchema.parse({ ...VALID_RULE, edge: { type: "implements" } });
    expect(r.enabled).toBe(true);
    expect(r.edge.direction).toBe("forward");
  });

  it("rejects an unknown edge type", () => {
    const bad = { ...VALID_RULE, edge: { type: "renders" } };
    expect(LinkRuleSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects a where condition that is not a plain equality", () => {
    const bad = {
      ...VALID_RULE,
      link: { ...VALID_RULE.link, where: ["cls.value != xClass.value"] },
    };
    expect(LinkRuleSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects references to undeclared facts (where, source/target, evidence)", () => {
    const badWhere = {
      ...VALID_RULE,
      link: { ...VALID_RULE.link, where: ["ghost.value == xClass.value"] },
    };
    expect(LinkRuleSchema.safeParse(badWhere).success).toBe(false);
    const badEvidence = {
      ...VALID_RULE,
      link: { ...VALID_RULE.link, evidence: "{ghost.value}" },
    };
    expect(LinkRuleSchema.safeParse(badEvidence).success).toBe(false);
  });

  it("rejects a source that is not a <fact>.file reference", () => {
    const bad = { ...VALID_RULE, link: { ...VALID_RULE.link, source: "cls.value" } };
    expect(LinkRuleSchema.safeParse(bad).success).toBe(false);
  });
});

describe("loadRuleDirs", () => {
  function dirWith(files: Record<string, unknown>) {
    const d = mkdtempSync(join(tmpdir(), "ua-rules-"));
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(
        join(d, name),
        typeof content === "string" ? content : JSON.stringify(content),
        "utf-8",
      );
    }
    return d;
  }

  it("loads arrays and single objects, sorts by id, filters disabled", () => {
    const d = dirWith({
      "pack.json": [VALID_RULE, { ...VALID_RULE, id: "aaa.first" }],
      "single.json": { ...VALID_RULE, id: "zzz.off", enabled: false },
    });
    const { rules, warnings } = loadRuleDirs([d]);
    expect(rules.map((r) => r.id)).toEqual(["aaa.first", "wpf.code-behind"]);
    expect(warnings).toEqual([]);
  });

  it("skips invalid JSON and schema violations with warnings, never throws", () => {
    const d = dirWith({
      "broken.json": "{ not json",
      "badrule.json": { id: "x", confidence: 2 },
      "good.json": VALID_RULE,
    });
    const { rules, warnings } = loadRuleDirs([d]);
    expect(rules.map((r) => r.id)).toEqual(["wpf.code-behind"]);
    expect(warnings.length).toBe(2);
  });

  it("later directory wins on id collision, with a warning", () => {
    const d1 = dirWith({ "a.json": VALID_RULE });
    const d2 = dirWith({
      "b.json": { ...VALID_RULE, confidence: 0.5 },
    });
    const { rules, warnings } = loadRuleDirs([d1, d2]);
    expect(rules).toHaveLength(1);
    expect(rules[0].confidence).toBe(0.5);
    expect(warnings.some((w) => w.includes("overridden"))).toBe(true);
  });

  it("missing directory is a no-op", () => {
    const { rules, warnings } = loadRuleDirs([join(tmpdir(), "does-not-exist-xyz")]);
    expect(rules).toEqual([]);
    expect(warnings).toEqual([]);
  });
});
