import type { KnowledgeGraph } from "../types.js";
import type { GraphDiffReport } from "./types.js";
import { edgeKey } from "./graph-merge.js";

export interface CompareGraphOptions {
  generatedAt?: string;
  invalidatedTargets?: string[];
}

function sortedDifference(left: Set<string>, right: Set<string>): string[] {
  return [...left].filter((item) => !right.has(item)).sort();
}

function sortedIntersection(left: Set<string>, right: Set<string>): string[] {
  return [...left].filter((item) => right.has(item)).sort();
}

export function compareGraphs(
  previous: KnowledgeGraph,
  next: KnowledgeGraph,
  options: CompareGraphOptions = {},
): GraphDiffReport {
  const previousNodeIds = new Set(previous.nodes.map((node) => node.id));
  const nextNodeIds = new Set(next.nodes.map((node) => node.id));
  const previousEdgeKeys = new Set(previous.edges.map(edgeKey));
  const nextEdgeKeys = new Set(next.edges.map(edgeKey));

  const removedNodeIds = sortedDifference(previousNodeIds, nextNodeIds);
  const removedEdgeKeys = sortedDifference(previousEdgeKeys, nextEdgeKeys);
  const warnings: string[] = [];

  if (removedNodeIds.length > 0) {
    warnings.push(`${removedNodeIds.length} node(s) removed or invalidated`);
  }
  if (removedEdgeKeys.length > 0) {
    warnings.push(`${removedEdgeKeys.length} edge(s) removed or invalidated`);
  }

  return {
    version: "1.0.0",
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    previousNodeCount: previous.nodes.length,
    nextNodeCount: next.nodes.length,
    previousEdgeCount: previous.edges.length,
    nextEdgeCount: next.edges.length,
    addedNodeIds: sortedDifference(nextNodeIds, previousNodeIds),
    removedNodeIds,
    carriedForwardNodeIds: sortedIntersection(previousNodeIds, nextNodeIds),
    addedEdgeKeys: sortedDifference(nextEdgeKeys, previousEdgeKeys),
    removedEdgeKeys,
    carriedForwardEdgeKeys: sortedIntersection(previousEdgeKeys, nextEdgeKeys),
    invalidatedTargets: [...(options.invalidatedTargets ?? [])].sort(),
    warnings,
  };
}
