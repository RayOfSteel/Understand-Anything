import { EDGE_TRAVERSAL, SATELLITE_ATTACH } from "./edge-semantics.js";

export type ReachabilityStatus = "reachable" | "attached" | "isolated" | "unresolved";

export interface ReachabilityNode {
  id: string;
  type: string;
  name: string;
  filePath?: string;
  tags?: string[];
}
export interface ReachabilityEdge {
  source: string;
  target: string;
  type: string;
  direction?: string;
}
export interface ReachabilityGraph {
  nodes: ReachabilityNode[];
  edges: ReachabilityEdge[];
}

export interface IslandComponent {
  id: string;
  nodeIds: string[];
  files: string[];
  size: number;
  dominantCategory: string;
}

export interface ReachabilityResult {
  statusByNode: Map<string, ReachabilityStatus>;
  components: IslandComponent[];
  onlyViaTests: string[];
}

/** FNV-1a 32-bit over the sorted file list — stable, dependency-free, browser-safe. */
export function componentId(files: string[]): string {
  const input = [...files].sort().join("\n");
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `island-${h.toString(16).padStart(8, "0")}`;
}

interface OrientedEdge { s: string; t: string; type: string; bidi: boolean }

function orient(e: ReachabilityEdge): OrientedEdge {
  const backward = e.direction === "backward";
  return {
    s: backward ? e.target : e.source,
    t: backward ? e.source : e.target,
    type: e.type,
    bidi: e.direction === "bidirectional",
  };
}

function bfs(seeds: Iterable<string>, adj: Map<string, string[]>, known: Set<string>): Set<string> {
  const seen = new Set<string>();
  const queue: string[] = [];
  for (const s of seeds) if (known.has(s) && !seen.has(s)) { seen.add(s); queue.push(s); }
  // index pointer instead of shift(): stays O(V+E) on 70k+-node corpora
  for (let qi = 0; qi < queue.length; qi++) {
    const cur = queue[qi];
    for (const next of adj.get(cur) ?? []) {
      if (!seen.has(next)) { seen.add(next); queue.push(next); }
    }
  }
  return seen;
}

export function computeReachability(
  graph: ReachabilityGraph,
  triggerIds: Set<string>,
): ReachabilityResult {
  const known = new Set(graph.nodes.map((n) => n.id));
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));

  // 1. Forward adjacency (forward + deploys forward; containment both ways).
  const adj = new Map<string, string[]>();
  const add = (a: string, b: string) => {
    if (!known.has(a) || !known.has(b)) return;
    const list = adj.get(a);
    if (list) list.push(b); else adj.set(a, [b]);
  };
  const satellites: OrientedEdge[] = [];
  for (const raw of graph.edges) {
    const e = orient(raw);
    const cls = EDGE_TRAVERSAL[e.type] ?? "none";
    if (cls === "forward" || cls === "deploys") {
      add(e.s, e.t);
      if (e.bidi) add(e.t, e.s);
    } else if (cls === "containment") {
      add(e.s, e.t);
      add(e.t, e.s);
    }
    if (cls === "satellite" || cls === "deploys") satellites.push(e);
  }

  const reachable = bfs(triggerIds, adj, known);

  // 2. Satellite attachment fixpoint (spec §5.1 step 2).
  const attached = new Set<string>();
  const anchored = (id: string) => reachable.has(id) || attached.has(id);
  let changed = true;
  while (changed) {
    changed = false;
    for (const e of satellites) {
      const attachEnd = SATELLITE_ATTACH[e.type];
      const candidate = attachEnd === "source" ? e.s : e.t;
      const anchor = attachEnd === "source" ? e.t : e.s;
      if (!anchored(candidate) && anchored(anchor) && known.has(candidate)) {
        attached.add(candidate);
        changed = true;
      }
    }
  }

  // 3. Union-find over ALL edges (any type, any direction) among leftover nodes.
  const leftover = graph.nodes.filter((n) => !reachable.has(n.id) && !attached.has(n.id));
  const leftoverIds = new Set(leftover.map((n) => n.id));
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r) as string;
    let c = x;
    while (parent.get(c) !== c) { const nxt = parent.get(c) as string; parent.set(c, r); c = nxt; }
    return r;
  };
  for (const id of leftoverIds) parent.set(id, id);
  for (const raw of graph.edges) {
    if (leftoverIds.has(raw.source) && leftoverIds.has(raw.target)) {
      parent.set(find(raw.source), find(raw.target));
    }
  }
  const groups = new Map<string, string[]>();
  for (const id of leftoverIds) {
    const root = find(id);
    const list = groups.get(root);
    if (list) list.push(id); else groups.set(root, [id]);
  }

  const components: IslandComponent[] = [...groups.values()].map((nodeIds) => {
    nodeIds.sort();
    const files = [...new Set(
      nodeIds.map((id) => byId.get(id)?.filePath).filter((p): p is string => !!p),
    )].sort();
    const exts = files.map((f) => f.split(".").pop() ?? "none");
    const counts = new Map<string, number>();
    for (const x of exts) counts.set(x, (counts.get(x) ?? 0) + 1);
    const dominantCategory =
      [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? "none";
    return {
      id: componentId(files.length > 0 ? files : nodeIds),
      nodeIds,
      files,
      size: nodeIds.length,
      dominantCategory,
    };
  }).sort((a, b) => b.size - a.size || a.id.localeCompare(b.id));

  // 4. Informational: leftover nodes a test-only BFS would reach (spec §5.2).
  const testSeeds = [...attached].filter((id) => (byId.get(id)?.tags ?? []).includes("test"));
  const viaTests = bfs(testSeeds, adj, known);
  const onlyViaTests = [...leftoverIds].filter((id) => viaTests.has(id)).sort();

  const statusByNode = new Map<string, ReachabilityStatus>();
  for (const node of graph.nodes) {
    statusByNode.set(
      node.id,
      reachable.has(node.id) ? "reachable" : attached.has(node.id) ? "attached" : "unresolved",
    );
  }
  return { statusByNode, components, onlyViaTests };
}
