import type { GraphEdge, GraphNode, KnowledgeGraph } from "../types.js";
import type { GraphPatch, InvalidationRecord } from "./types.js";

export function edgeKey(edge: GraphEdge): string {
  return `edge:${edge.source}->${edge.target}:${edge.type}:${edge.direction}`;
}

function invalidationTargets(patches: GraphPatch[]): Set<string> {
  return new Set(patches.flatMap((patch) => patch.invalidations.map((item) => item.target)));
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/");
}

function shouldCarryNode(node: GraphNode, removedSourcePaths: Set<string>, invalidated: Set<string>): boolean {
  if (invalidated.has(node.id)) return false;
  if (node.filePath && removedSourcePaths.has(normalizePath(node.filePath))) return false;
  return true;
}

function shouldCarryEdge(edge: GraphEdge, nodeIds: Set<string>, invalidated: Set<string>): boolean {
  if (invalidated.has(edgeKey(edge))) return false;
  return nodeIds.has(edge.source) && nodeIds.has(edge.target);
}

function applyInvalidations(graph: KnowledgeGraph, invalidations: InvalidationRecord[]): KnowledgeGraph {
  const invalidated = new Set(invalidations.map((item) => item.target));
  return {
    ...graph,
    nodes: graph.nodes.filter((node) => !invalidated.has(node.id)),
    edges: graph.edges.filter((edge) => !invalidated.has(edgeKey(edge))),
  };
}

export function applyGraphPatch(base: KnowledgeGraph, patch: GraphPatch): KnowledgeGraph {
  const pruned = applyInvalidations(base, patch.invalidations);
  const nodesById = new Map<string, GraphNode>();
  for (const node of pruned.nodes) nodesById.set(node.id, node);
  for (const node of patch.nodes) nodesById.set(node.id, node);

  const edgesByKey = new Map<string, GraphEdge>();
  for (const edge of pruned.edges) edgesByKey.set(edgeKey(edge), edge);
  for (const edge of patch.edges) edgesByKey.set(edgeKey(edge), edge);

  const nodeIds = new Set(nodesById.keys());
  return {
    ...base,
    nodes: [...nodesById.values()],
    edges: [...edgesByKey.values()].filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target)),
  };
}

export interface MergeGraphOptions {
  previous: KnowledgeGraph;
  current: KnowledgeGraph;
  patches: GraphPatch[];
  removedSourcePaths: string[];
}

export function mergeGraphWithCarryForward(options: MergeGraphOptions): KnowledgeGraph {
  const invalidated = invalidationTargets(options.patches);
  const removedSourcePaths = new Set(options.removedSourcePaths.map(normalizePath));
  const nodesById = new Map<string, GraphNode>();

  for (const node of options.current.nodes) nodesById.set(node.id, node);
  for (const node of options.previous.nodes) {
    if (nodesById.has(node.id)) continue;
    if (!shouldCarryNode(node, removedSourcePaths, invalidated)) continue;
    nodesById.set(node.id, {
      ...node,
      meta: {
        ...(node.meta ?? {}),
        regenerate: {
          carriedForward: true,
        },
      },
    });
  }

  const nodeIds = new Set(nodesById.keys());
  const edgesByKey = new Map<string, GraphEdge>();
  for (const edge of options.current.edges) {
    if (shouldCarryEdge(edge, nodeIds, invalidated)) edgesByKey.set(edgeKey(edge), edge);
  }
  for (const edge of options.previous.edges) {
    const key = edgeKey(edge);
    if (edgesByKey.has(key)) continue;
    if (!shouldCarryEdge(edge, nodeIds, invalidated)) continue;
    edgesByKey.set(key, {
      ...edge,
      meta: {
        ...(edge.meta ?? {}),
        regenerate: {
          carriedForward: true,
        },
      },
    });
  }

  let merged: KnowledgeGraph = {
    ...options.current,
    nodes: [...nodesById.values()],
    edges: [...edgesByKey.values()],
  };

  for (const patch of options.patches) {
    merged = applyGraphPatch(merged, patch);
  }

  return merged;
}
