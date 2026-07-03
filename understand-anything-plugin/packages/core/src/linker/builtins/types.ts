import type { Node } from "web-tree-sitter";
import type { Fact } from "../facts.js";

export type WarnFn = (msg: string) => void;

/**
 * A builtin fact provider — the escape hatch of the rule format (spec §8.1):
 * facts that a single tree-sitter query cannot express (derived or resolved
 * values). Rules reference providers by name via { "builtin": "<name>" }.
 */
export interface BuiltinProvider {
  name: string;
  /** Lowercase file extensions (with dot) this provider consumes. */
  extensions: string[];
  /** Language config id whose grammar collect() needs, or null for raw source. */
  languageId: string | null;
  /** Providers whose fact tables finalize() reads; the engine runs them too. */
  dependsOn?: string[];
  collect(file: string, source: string, root: Node | null, warn: WarnFn): Fact[];
  /** Optional cross-file post-pass; returns the replacement table for this provider. */
  finalize?(own: Fact[], all: Map<string, Fact[]>, warn: WarnFn): Fact[];
}
