import type { LinkRule } from "./rule-schema.js";
import { CONDITION_RE } from "./rule-schema.js";
import type { Fact } from "./facts.js";

export interface CandidateEdge {
  source: string; // fertige Knoten-ID "file:<relpath>"
  target: string;
  type: string;
  direction: string;
  confidence: number;
  ruleId: string;
  evidence?: string;
}

interface Condition {
  aFact: string;
  aField: string;
  bFact: string;
  bField: string;
}

const EVIDENCE_REF = /\{([A-Za-z_]\w*)\.([A-Za-z_]\w*)\}/g;

function interpolate(template: string, binding: Map<string, Fact>): string {
  return template.replace(EVIDENCE_REF, (whole, fact: string, field: string) => {
    const value = binding.get(fact)?.[field];
    return value !== undefined ? value : whole;
  });
}

/**
 * Backtracking equality join over the rule's fact tables. Conditions are
 * checked as soon as both sides are bound, so mismatching branches are
 * pruned early. Fact tables are small (per-project fact counts), so the
 * simple strategy is deliberate — no query planner.
 */
export function evaluateRule(rule: LinkRule, tables: Map<string, Fact[]>): CandidateEdge[] {
  const names = Object.keys(rule.facts);
  const conds: Condition[] = rule.link.where.map((w) => {
    const m = CONDITION_RE.exec(w)!; // schema-validiert
    return { aFact: m[1], aField: m[2], bFact: m[3], bField: m[4] };
  });
  const sourceFact = rule.link.source.split(".")[0];
  const targetFact = rule.link.target.split(".")[0];

  const out = new Map<string, CandidateEdge>();
  const binding = new Map<string, Fact>();

  const boundConditionsHold = (): boolean =>
    conds.every((c) => {
      const a = binding.get(c.aFact);
      const b = binding.get(c.bFact);
      if (!a || !b) return true; // noch nicht beide gebunden
      const av = a[c.aField];
      const bv = b[c.bField];
      return av !== undefined && av === bv;
    });

  const extend = (i: number): void => {
    if (i === names.length) {
      const src = binding.get(sourceFact)!.file;
      const tgt = binding.get(targetFact)!.file;
      // Drop self-pairs: at file→file granularity a file cannot meaningfully
      // implement/depend-on itself, so a self-edge is deterministic noise, not a candidate.
      if (src === tgt) return;
      const key = `${src}|${tgt}`;
      if (!out.has(key)) {
        out.set(key, {
          source: `file:${src}`,
          target: `file:${tgt}`,
          type: rule.edge.type,
          direction: rule.edge.direction,
          confidence: rule.confidence,
          ruleId: rule.id,
          ...(rule.link.evidence !== undefined
            ? { evidence: interpolate(rule.link.evidence, binding) }
            : {}),
        });
      }
      return;
    }
    for (const fact of tables.get(names[i]) ?? []) {
      binding.set(names[i], fact);
      if (boundConditionsHold()) extend(i + 1);
    }
    binding.delete(names[i]);
  };

  extend(0);
  return [...out.values()].sort(
    (a, b) => a.source.localeCompare(b.source) || a.target.localeCompare(b.target),
  );
}
