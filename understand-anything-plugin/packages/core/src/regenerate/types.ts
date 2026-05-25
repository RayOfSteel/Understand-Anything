import type { GraphEdge, GraphNode } from "../types.js";

export type AttemptKind = "full" | "regenerate" | "connectivity" | "domain";
export type AttemptStatus = "running" | "completed" | "failed";
export type PhaseName =
  | "preflight"
  | "scan"
  | "analyze"
  | "merge"
  | "assemble-review"
  | "architecture"
  | "tour"
  | "validate"
  | "domain"
  | "connectivity"
  | "promote";

export interface AttemptManifest {
  attemptId: string;
  kind: AttemptKind;
  projectRoot: string;
  baseAttemptId?: string;
  createdAt: string;
  completedAt?: string;
  flags: string[];
  status: AttemptStatus;
  promoted: boolean;
  failureReason?: string;
}

export interface InjectionRecord {
  id: string;
  createdAt: string;
  source: "interactive-checkpoint" | "user-correction" | "regenerate-argument";
  appliesTo: PhaseName[];
  text: string;
  status: "open" | "applied" | "superseded";
}

export interface DeferredWorkRecord {
  id: string;
  phase: PhaseName;
  scope: string;
  kind: "deferred-work";
  summary: string;
  evidencePaths: string[];
  nextAgentInstruction: string;
  reasonDeferred: string;
  status: "open" | "resolved" | "superseded" | "still-open" | "split";
}

export interface InvalidationRecord {
  id: string;
  target: string;
  reason:
    | "user-correction"
    | "source-file-removed"
    | "schema-invalid"
    | "superseded-by-canonical"
    | "accepted-regenerate-report";
  replacement?: string;
}

export interface GraphPatch {
  version: "1.0.0";
  targetGraph: "knowledge" | "domain";
  source: "user-correction" | "connectivity-pass" | "domain-merge" | "regenerate";
  nodes: GraphNode[];
  edges: GraphEdge[];
  invalidations: InvalidationRecord[];
}

export interface SubstrateFile {
  path: string;
  contentHash: string;
  sizeBytes: number;
}

export interface SubstrateManifest {
  version: "1.0.0";
  generatedAt: string;
  coreVersion: string;
  extractorVersion: string;
  parserVersions: Record<string, string>;
  files: Record<string, SubstrateFile>;
}

export interface GraphDiffReport {
  version: "1.0.0";
  generatedAt: string;
  previousNodeCount: number;
  nextNodeCount: number;
  previousEdgeCount: number;
  nextEdgeCount: number;
  addedNodeIds: string[];
  removedNodeIds: string[];
  carriedForwardNodeIds: string[];
  addedEdgeKeys: string[];
  removedEdgeKeys: string[];
  carriedForwardEdgeKeys: string[];
  invalidatedTargets: string[];
  warnings: string[];
}

export interface ConnectivityCandidate {
  nodeIds: string[];
  score: number;
  reasons: string[];
  meaningfulDegree: number;
  cheapDegree: number;
  primaryNodeName: string;
  /** Times the node's basename stem appears as a string in OTHER files. Higher = more likely a missed reference. */
  referenceCount?: number;
  /** Sample paths where references were found (capped, for human triage). */
  referenceSamples?: string[];
}
