/**
 * Traversal classification per edge type (spec 2026-07-05 §5.2).
 * - forward:     BFS follows source → target
 * - containment: BFS follows both directions (membership is identity, not usage)
 * - deploys:     BFS follows source → target AND source attaches when target is reachable
 * - satellite:   attachment fixpoint only — never seeds forward reach
 * - none:        not traversed at all (a "related" link rescues nothing)
 * Knowledge/domain-only types are "none"/"containment" for safety; codebase
 * graphs never emit them, knowledge graphs skip reachability entirely.
 */
export type TraversalClass = "forward" | "containment" | "deploys" | "satellite" | "none";

export const EDGE_TRAVERSAL: Record<string, TraversalClass> = {
  imports: "forward", exports: "forward", inherits: "forward", implements: "forward",
  calls: "forward", subscribes: "forward", publishes: "forward", middleware: "forward",
  reads_from: "forward", writes_to: "forward", transforms: "forward", validates: "forward",
  depends_on: "forward", serves: "forward", provisions: "forward", triggers: "forward",
  routes: "forward", defines_schema: "forward",
  contains: "containment", contains_flow: "containment", flow_step: "containment",
  deploys: "deploys",
  configures: "satellite", documents: "satellite", migrates: "satellite", tested_by: "satellite",
  related: "none", similar_to: "none", cross_domain: "none",
  cites: "none", contradicts: "none", builds_on: "none", exemplifies: "none",
  categorized_under: "none", authored_by: "none",
};

/** Which endpoint attaches when the other endpoint is reachable/attached. */
export const SATELLITE_ATTACH: Record<string, "source" | "target"> = {
  configures: "source", // config attaches to the code it configures
  documents: "source",  // doc attaches to what it describes
  migrates: "source",   // migration attaches to the table it modifies
  deploys: "source",    // Dockerfile attaches to the code it ships
  tested_by: "target",  // canonical direction is production → test: the TEST attaches
};
