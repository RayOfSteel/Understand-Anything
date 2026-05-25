import type { EdgeType, KnowledgeGraph } from "../types.js";
import type { ConnectivityCandidate } from "./types.js";
import type { ReferenceCount } from "../reference-search.js";

const MEANINGFUL_EDGE_TYPES = new Set<EdgeType>([
  "imports", "calls", "configures", "reads_from", "writes_to",
  "routes", "defines_schema", "deploys", "triggers", "documents",
  "contains_flow", "flow_step", "cross_domain", "depends_on", "serves",
  "provisions", "migrates", "tested_by",
]);

const HIGH_SIGNAL_TERMS = [
  "resource", "configuration", "config", "script", "template",
  "message", "service", "mapping", "loader", "registry",
  "route", "schema", "pipeline",
];

const LOW_SIGNAL_EXTENSIONS = [".png", ".jpg", ".jpeg", ".gif", ".ico", ".woff", ".woff2", ".pdf", ".zip"];

export interface ConnectivityOptions {
  limit?: number;
  /**
   * Optional: nodeId → ReferenceCount produced by `countBasenameReferences`.
   * When provided, drives ranking — high-reference nodes shoot to the top
   * (high-impact missing edges); zero-reference nodes get a separate "likely
   * orphan/dead code" tag rather than competing with missed-reference candidates.
   */
  referenceCounts?: Map<string, ReferenceCount>;
}

function normalized(value: string): string {
  return value.toLowerCase();
}

function hasLowSignalExtension(filePath?: string): boolean {
  if (!filePath) return false;
  const lower = filePath.toLowerCase();
  return LOW_SIGNAL_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/**
 * Bounded reward per missing reference.
 *   0 refs        →   0  (handled separately as "likely orphan")
 *   1-10 refs     →  +5 per ref            (low-hanging fruit, up to +50)
 *   11-50 refs    →  +50 plus +3 per extra (high impact, up to +170)
 *   51+ refs      → +170 plateau           (avoids dominating everything)
 */
function referenceCountScore(count: number): number {
  if (count <= 0) return 0;
  if (count <= 10) return count * 5;
  if (count <= 50) return 50 + (count - 10) * 3;
  return 170;
}

export function buildConnectivityCandidates(
  graph: KnowledgeGraph,
  options: ConnectivityOptions = {},
): ConnectivityCandidate[] {
  const degrees = new Map<string, { meaningful: number; cheap: number }>();
  for (const node of graph.nodes) degrees.set(node.id, { meaningful: 0, cheap: 0 });

  for (const edge of graph.edges) {
    const source = degrees.get(edge.source);
    const target = degrees.get(edge.target);
    if (!source || !target) continue;
    const bucket = MEANINGFUL_EDGE_TYPES.has(edge.type) ? "meaningful" : "cheap";
    source[bucket] += 1;
    target[bucket] += 1;
  }

  const candidates: ConnectivityCandidate[] = [];
  for (const node of graph.nodes) {
    const degree = degrees.get(node.id) ?? { meaningful: 0, cheap: 0 };
    const reasons: string[] = [];
    let score = 0;

    if (degree.meaningful === 0) {
      score += 50;
      reasons.push("no meaningful edges");
    }
    if (degree.cheap > 0 && degree.meaningful === 0) {
      score += 10;
      reasons.push("only cheap grouping edges");
    }

    const text = normalized(`${node.name} ${node.summary} ${(node.tags ?? []).join(" ")} ${node.filePath ?? ""}`);
    if (HIGH_SIGNAL_TERMS.some((term) => text.includes(term))) {
      score += 25;
      reasons.push("high-signal name or summary");
    }
    if (node.type === "resource" || node.type === "config" || node.type === "service" || node.type === "pipeline") {
      score += 15;
      reasons.push(`high-signal node type ${node.type}`);
    }
    if (hasLowSignalExtension(node.filePath)) {
      score -= 30;
      reasons.push("low-signal asset extension");
    }

    // Reference-count weighting — the heaviest signal when supplied.
    const refEntry = options.referenceCounts?.get(node.id);
    let referenceCount: number | undefined;
    let referenceSamples: string[] | undefined;
    if (refEntry) {
      referenceCount = refEntry.count;
      referenceSamples = refEntry.samples;
      if (refEntry.count === 0) {
        // Likely orphan / dead code. Push down so missed-references rank first.
        score -= 20;
        reasons.push("no string references in codebase — likely orphan or dead code");
      } else {
        const bonus = referenceCountScore(refEntry.count);
        score += bonus;
        reasons.push(`${refEntry.count} string references in other files (+${bonus})`);
      }
    }

    if (score <= 0) continue;
    candidates.push({
      nodeIds: [node.id],
      score,
      reasons,
      meaningfulDegree: degree.meaningful,
      cheapDegree: degree.cheap,
      primaryNodeName: node.name,
      referenceCount,
      referenceSamples,
    });
  }

  return candidates
    .sort((a, b) => b.score - a.score || a.primaryNodeName.localeCompare(b.primaryNodeName))
    .slice(0, options.limit ?? 25);
}
