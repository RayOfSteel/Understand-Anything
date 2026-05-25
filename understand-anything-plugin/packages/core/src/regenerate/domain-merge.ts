import type { EdgeType, GraphEdge, GraphNode, KnowledgeGraph } from "../types.js";
import type { GraphPatch } from "./types.js";
import { applyGraphPatch, edgeKey } from "./graph-merge.js";

const DOMAIN_NODE_TYPES = new Set(["domain", "flow", "step"]);
const DOMAIN_EDGE_TYPES = new Set<EdgeType>(["contains_flow", "flow_step", "cross_domain"]);

export interface MergeDomainOptions {
  previous: KnowledgeGraph | null;
  current: KnowledgeGraph;
  patches: GraphPatch[];
}

function isDomainNode(node: GraphNode): boolean {
  return DOMAIN_NODE_TYPES.has(node.type);
}

function isDomainEdge(edge: GraphEdge): boolean {
  return DOMAIN_EDGE_TYPES.has(edge.type);
}

export function mergeDomainGraph(options: MergeDomainOptions): KnowledgeGraph {
  const nodesById = new Map<string, GraphNode>();
  const edgesByKey = new Map<string, GraphEdge>();

  if (options.previous) {
    for (const node of options.previous.nodes.filter(isDomainNode)) {
      nodesById.set(node.id, {
        ...node,
        meta: {
          ...(node.meta ?? {}),
          domainMerge: { carriedForward: true },
        },
      });
    }
    for (const edge of options.previous.edges.filter(isDomainEdge)) {
      edgesByKey.set(edgeKey(edge), {
        ...edge,
        meta: {
          ...(edge.meta ?? {}),
          domainMerge: { carriedForward: true },
        },
      });
    }
  }

  for (const node of options.current.nodes.filter(isDomainNode)) nodesById.set(node.id, node);
  for (const edge of options.current.edges.filter(isDomainEdge)) edgesByKey.set(edgeKey(edge), edge);

  let merged: KnowledgeGraph = {
    ...options.current,
    nodes: [...nodesById.values()],
    edges: [...edgesByKey.values()],
    layers: [],
    tour: [],
  };

  for (const patch of options.patches) {
    merged = applyGraphPatch(merged, patch);
  }

  const nodeIds = new Set(merged.nodes.map((node) => node.id));
  return {
    ...merged,
    edges: merged.edges.filter((edge) => isDomainEdge(edge) && nodeIds.has(edge.source) && nodeIds.has(edge.target)),
    layers: [],
    tour: [],
  };
}
