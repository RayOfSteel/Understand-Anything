import { z } from "zod";

const NODE_TYPES = [
  "file", "function", "class", "module", "concept",
  "config", "document", "service", "table", "endpoint",
  "pipeline", "schema", "resource",
] as const;

const GlobMatchSchema = z
  .object({ type: z.literal("glob"), pattern: z.string().min(1) })
  .strict();
const PathRegexMatchSchema = z
  .object({ type: z.literal("path-regex"), pattern: z.string().min(1) })
  .strict();
const SymbolMatchSchema = z
  .object({
    type: z.literal("symbol"),
    pattern: z.string().min(1),
    nodeType: z.enum(NODE_TYPES).optional(),
  })
  .strict();

export const TriggerMatchSchema = z.discriminatedUnion("type", [
  GlobMatchSchema,
  PathRegexMatchSchema,
  SymbolMatchSchema,
]);
export type TriggerMatch = z.infer<typeof TriggerMatchSchema>;

/**
 * Spec 2026-07-05 §3.2. Match type "query" (tree-sitter) is deliberately
 * absent in v1 — it arrives with framework-pack filling (spec §9).
 */
export const TriggerRuleSchema = z
  .object({
    id: z.string().min(1),
    kind: z.literal("trigger"),
    match: TriggerMatchSchema,
    description: z.string().optional(),
    evidence: z.string().optional(),
    confidence: z.number().min(0).max(1),
    enabled: z.boolean().default(true),
    source: z.string().optional(), // "pack:<name>" | "census" | "mission:<id>" | "user"
    disables: z.array(z.string()).default([]),
  })
  .strict();
export type TriggerRule = z.infer<typeof TriggerRuleSchema>;
