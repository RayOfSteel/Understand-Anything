import ignore from "ignore";
import type { TriggerRule } from "./trigger-rule-schema.js";

export interface TaggableNode {
  id: string;
  type: string;
  name: string;
  filePath?: string;
  tags: string[];
  triggeredBy?: string[];
}

export interface TriggerApplication {
  taggedNodeIds: string[];
  perRule: Record<string, number>;
}

const norm = (p: string) => p.replace(/\\/g, "/").replace(/^\.?\//, "");

/**
 * Deterministic rule application pass (spec §3.3): matching nodes get the
 * "entry-point" tag plus rule-id provenance in `triggeredBy`. Mutates nodes
 * in place; idempotent.
 */
export function applyTriggerRules(
  nodes: TaggableNode[],
  rules: TriggerRule[],
): TriggerApplication {
  const perRule: Record<string, number> = {};
  const tagged = new Set<string>();

  const matchers = rules.map((rule) => {
    if (rule.match.type === "glob") {
      const ig = ignore().add(rule.match.pattern);
      return { rule, matches: (n: TaggableNode) => !!n.filePath && ig.ignores(norm(n.filePath)) };
    }
    if (rule.match.type === "path-regex") {
      const re = new RegExp(rule.match.pattern);
      return { rule, matches: (n: TaggableNode) => !!n.filePath && re.test(norm(n.filePath)) };
    }
    const re = new RegExp(rule.match.pattern);
    const wantType = rule.match.nodeType;
    return {
      rule,
      matches: (n: TaggableNode) => (!wantType || n.type === wantType) && re.test(n.name),
    };
  });

  for (const node of nodes) {
    for (const { rule, matches } of matchers) {
      if (!matches(node)) continue;
      if (!node.tags.includes("entry-point")) node.tags.push("entry-point");
      node.triggeredBy = node.triggeredBy ?? [];
      if (!node.triggeredBy.includes(rule.id)) {
        node.triggeredBy.push(rule.id);
        perRule[rule.id] = (perRule[rule.id] ?? 0) + 1;
      }
      tagged.add(node.id);
    }
  }
  return { taggedNodeIds: [...tagged].sort(), perRule };
}
