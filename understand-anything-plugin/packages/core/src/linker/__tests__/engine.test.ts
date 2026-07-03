import { describe, it, expect } from "vitest";
import { LinkRuleSchema } from "../rule-schema.js";
import { evaluateRule } from "../engine.js";
import { applyCandidates } from "../apply.js";
import type { Fact } from "../facts.js";

const RULE = LinkRuleSchema.parse({
  id: "wpf.event-handler",
  confidence: 0.9,
  edge: { type: "calls" },
  facts: {
    xClass: { builtin: "b1" },
    attr: { builtin: "b2" },
    method: { builtin: "b3" },
  },
  link: {
    where: [
      "attr.file == xClass.file",
      "method.classFqn == xClass.value",
      "method.name == attr.value",
    ],
    source: "attr.file",
    target: "method.file",
    evidence: '{attr.name}="{attr.value}" in {xClass.value}',
  },
});

function tables(x: Record<string, Fact[]>) {
  return new Map(Object.entries(x));
}

describe("evaluateRule", () => {
  it("evaluates a three-fact join and interpolates evidence", () => {
    const result = evaluateRule(RULE, tables({
      xClass: [{ file: "V.xaml", value: "Demo.Main" }],
      attr: [
        { file: "V.xaml", name: "Loaded", value: "OnLoaded" },
        { file: "V.xaml", name: "Title", value: "Hello" },
        { file: "Other.xaml", name: "Loaded", value: "OnLoaded" },
      ],
      method: [{ file: "V.xaml.cs", classFqn: "Demo.Main", name: "OnLoaded" }],
    }));
    expect(result).toEqual([
      {
        source: "file:V.xaml",
        target: "file:V.xaml.cs",
        type: "calls",
        direction: "forward",
        confidence: 0.9,
        ruleId: "wpf.event-handler",
        evidence: 'Loaded="OnLoaded" in Demo.Main',
      },
    ]);
  });

  it("never matches on missing fields", () => {
    const result = evaluateRule(RULE, tables({
      xClass: [{ file: "V.xaml" }], // kein value-Feld
      attr: [{ file: "V.xaml", name: "Loaded", value: "OnLoaded" }],
      method: [{ file: "V.xaml.cs", name: "OnLoaded" }], // kein classFqn
    }));
    expect(result).toEqual([]);
  });

  it("deduplicates multiple matches onto the same source/target pair", () => {
    const result = evaluateRule(RULE, tables({
      xClass: [{ file: "V.xaml", value: "Demo.Main" }],
      attr: [
        { file: "V.xaml", name: "Loaded", value: "OnLoaded" },
        { file: "V.xaml", name: "Click", value: "OnLoaded" },
      ],
      method: [{ file: "V.xaml.cs", classFqn: "Demo.Main", name: "OnLoaded" }],
    }));
    expect(result).toHaveLength(1);
  });

  it("drops self-loop pairs but keeps legitimate cross-file edges from the same run", () => {
    const result = evaluateRule(RULE, tables({
      xClass: [
        { file: "Self.cs", value: "Demo.Self" }, // interface + impl live in one file
        { file: "Cross.xaml", value: "Demo.Cross" },
      ],
      attr: [
        { file: "Self.cs", name: "Loaded", value: "OnSelf" },
        { file: "Cross.xaml", name: "Loaded", value: "OnCross" },
      ],
      method: [
        { file: "Self.cs", classFqn: "Demo.Self", name: "OnSelf" }, // source == target: self-loop
        { file: "Cross.xaml.cs", classFqn: "Demo.Cross", name: "OnCross" },
      ],
    }));
    // file→file self-edge (Self.cs -> Self.cs) is meaningless noise and must be dropped;
    // the cross-file edge (Cross.xaml -> Cross.xaml.cs) must still be emitted.
    expect(result).toEqual([
      {
        source: "file:Cross.xaml",
        target: "file:Cross.xaml.cs",
        type: "calls",
        direction: "forward",
        confidence: 0.9,
        ruleId: "wpf.event-handler",
        evidence: 'Loaded="OnCross" in Demo.Cross',
      },
    ]);
  });
});

describe("applyCandidates", () => {
  function graphWith(edges: Array<Record<string, unknown>>) {
    return {
      nodes: [{ id: "file:a.xaml" }, { id: "file:a.xaml.cs" }],
      edges,
    };
  }
  const CAND = {
    source: "file:a.xaml",
    target: "file:a.xaml.cs",
    type: "calls",
    direction: "forward",
    confidence: 0.9,
    ruleId: "wpf.event-handler",
    evidence: "e",
  };
  const warnings: string[] = [];
  const warn = (m: string) => warnings.push(m);

  it("appends a new edge with origin rule and weight 1.0", () => {
    const g = graphWith([]);
    const stats = applyCandidates(g, [CAND], warn);
    expect(stats).toEqual({ added: 1, upgraded: 0, skippedEdges: 0 });
    expect(g.edges[0]).toEqual({
      source: "file:a.xaml",
      target: "file:a.xaml.cs",
      type: "calls",
      direction: "forward",
      weight: 1.0,
      origin: "rule",
      ruleId: "wpf.event-handler",
      confidence: 0.9,
      evidence: "e",
    });
  });

  it("upgrades llm and origin-less edges, keeps description, matches across directions", () => {
    for (const origin of ["llm", undefined, null]) {
      const g = graphWith([
        {
          source: "file:a.xaml",
          target: "file:a.xaml.cs",
          type: "calls",
          direction: "backward",
          weight: 0.5,
          description: "keep me",
          ...(origin !== undefined ? { origin } : {}),
        },
      ]);
      const stats = applyCandidates(g, [CAND], warn);
      expect(stats).toEqual({ added: 0, upgraded: 1, skippedEdges: 0 });
      expect(g.edges[0].origin).toBe("rule");
      expect(g.edges[0].ruleId).toBe("wpf.event-handler");
      expect(g.edges[0].confidence).toBe(0.9);
      expect(g.edges[0].description).toBe("keep me");
      expect(g.edges[0].direction).toBe("backward"); // Upgrade dreht nichts
      expect(g.edges[0].weight).toBe(0.5);
    }
  });

  it("leaves structural, manual and rule edges untouched (first rule wins)", () => {
    for (const origin of ["structural", "manual", "rule"]) {
      const g = graphWith([
        { source: "file:a.xaml", target: "file:a.xaml.cs", type: "calls", direction: "forward", weight: 1.0, origin, ruleId: "other" },
      ]);
      const stats = applyCandidates(g, [CAND], warn);
      expect(stats).toEqual({ added: 0, upgraded: 0, skippedEdges: 0 });
      expect(g.edges[0].origin).toBe(origin);
      expect(g.edges).toHaveLength(1);
    }
  });

  it("skips candidates referencing unknown nodes with a warning", () => {
    const g = graphWith([]);
    const before = warnings.length;
    const stats = applyCandidates(g, [{ ...CAND, target: "file:ghost.cs" }], warn);
    expect(stats).toEqual({ added: 0, upgraded: 0, skippedEdges: 1 });
    expect(warnings.length).toBe(before + 1);
    expect(g.edges).toEqual([]);
  });

  it("deduplicates identical candidates from different rules — first rule id wins", () => {
    const g = graphWith([]);
    const stats = applyCandidates(
      g,
      [{ ...CAND, ruleId: "zzz.later" }, { ...CAND, ruleId: "aaa.earlier" }],
      warn,
    );
    expect(stats).toEqual({ added: 1, upgraded: 0, skippedEdges: 0 });
    expect(g.edges[0].ruleId).toBe("aaa.earlier");
  });
});
