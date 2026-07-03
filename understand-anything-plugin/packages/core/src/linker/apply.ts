import type { CandidateEdge } from "./engine.js";

export interface ApplyStats {
  added: number;
  upgraded: number;
  skippedEdges: number;
}

interface GraphLike {
  nodes: Array<{ id: string }>;
  edges: Array<Record<string, unknown>>;
}

const edgeKey = (s: unknown, t: unknown, ty: unknown) => `${s}|${t}|${ty}`;

/**
 * Insert candidate edges honouring the priority invariant
 * manual > structural > rule > llm (spec §8.2 step 6):
 * - existing edge with origin llm or missing (== null) → upgrade to rule
 * - existing edge with origin structural/manual/rule → untouched
 * - otherwise append (origin rule, weight 1.0)
 * Matching is on (source, target, type) across all direction values.
 */
export function applyCandidates(
  graph: GraphLike,
  candidates: CandidateEdge[],
  warn: (msg: string) => void,
): ApplyStats {
  const nodeIds = new Set(graph.nodes.map((n) => n.id));
  const index = new Map<string, Array<Record<string, unknown>>>();
  for (const e of graph.edges) {
    const key = edgeKey(e.source, e.target, e.type);
    const list = index.get(key) ?? [];
    list.push(e);
    index.set(key, list);
  }

  const sorted = [...candidates].sort(
    (a, b) =>
      a.ruleId.localeCompare(b.ruleId) ||
      a.source.localeCompare(b.source) ||
      a.target.localeCompare(b.target) ||
      a.type.localeCompare(b.type),
  );

  const stats: ApplyStats = { added: 0, upgraded: 0, skippedEdges: 0 };
  for (const c of sorted) {
    if (!nodeIds.has(c.source) || !nodeIds.has(c.target)) {
      stats.skippedEdges++;
      warn(`rule ${c.ruleId}: edge ${c.source} -> ${c.target} references an unknown node — skipped`);
      continue;
    }
    const key = edgeKey(c.source, c.target, c.type);
    const existing = index.get(key);
    if (existing && existing.length > 0) {
      const upgradable = existing.find((e) => e.origin == null || e.origin === "llm");
      if (upgradable) {
        upgradable.origin = "rule";
        upgradable.ruleId = c.ruleId;
        upgradable.confidence = c.confidence;
        if (c.evidence !== undefined) upgradable.evidence = c.evidence;
        stats.upgraded++;
      }
      // structural/manual/rule: untouched — first rule wins deterministically.
      continue;
    }
    const edge: Record<string, unknown> = {
      source: c.source,
      target: c.target,
      type: c.type,
      direction: c.direction,
      weight: 1.0,
      origin: "rule",
      ruleId: c.ruleId,
      confidence: c.confidence,
      ...(c.evidence !== undefined ? { evidence: c.evidence } : {}),
    };
    graph.edges.push(edge);
    index.set(key, [edge]);
    stats.added++;
  }
  return stats;
}
