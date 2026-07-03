import { z } from "zod";
import { EdgeTypeSchema } from "../schema.js";

/** Single allowed capture post-processing (spec §8.1). */
export const STRIP_QUOTES = "stripQuotes" as const;

const IDENT = /^[A-Za-z_]\w*$/;
/** `factA.fieldA == factB.fieldB` — the entire join language. */
export const CONDITION_RE =
  /^\s*([A-Za-z_]\w*)\.([A-Za-z_]\w*)\s*==\s*([A-Za-z_]\w*)\.([A-Za-z_]\w*)\s*$/;
const FILE_REF = /^([A-Za-z_]\w*)\.file$/;
const EVIDENCE_REF = /\{([A-Za-z_]\w*)\.([A-Za-z_]\w*)\}/g;

const QueryFactSourceSchema = z
  .object({
    language: z.string().min(1),
    query: z.array(z.string()).min(1),
    transform: z.record(z.string().regex(IDENT), z.literal(STRIP_QUOTES)).optional(),
  })
  .strict();

const BuiltinFactSourceSchema = z.object({ builtin: z.string().min(1) }).strict();

export const FactSourceSchema = z.union([QueryFactSourceSchema, BuiltinFactSourceSchema]);
export type FactSource = z.infer<typeof FactSourceSchema>;

export function isBuiltinSource(s: FactSource): s is z.infer<typeof BuiltinFactSourceSchema> {
  return "builtin" in s;
}

export const LinkRuleSchema = z
  .object({
    id: z.string().min(1),
    description: z.string().optional(),
    enabled: z.boolean().default(true),
    confidence: z.number().min(0).max(1),
    edge: z
      .object({
        type: EdgeTypeSchema,
        direction: z.enum(["forward", "backward", "bidirectional"]).default("forward"),
      })
      .strict(),
    facts: z.record(z.string().regex(IDENT), FactSourceSchema),
    link: z
      .object({
        where: z
          .array(z.string().regex(CONDITION_RE, "condition must be 'factA.field == factB.field'"))
          .min(1),
        source: z.string().regex(FILE_REF, "source must be '<fact>.file'"),
        target: z.string().regex(FILE_REF, "target must be '<fact>.file'"),
        evidence: z.string().optional(),
      })
      .strict(),
  })
  .strict()
  .superRefine((rule, ctx) => {
    const declared = new Set(Object.keys(rule.facts));
    const refs: string[] = [];
    for (const cond of rule.link.where) {
      const m = CONDITION_RE.exec(cond);
      if (m) refs.push(m[1], m[3]);
    }
    for (const ref of [rule.link.source, rule.link.target]) {
      const m = FILE_REF.exec(ref);
      if (m) refs.push(m[1]);
    }
    if (rule.link.evidence) {
      for (const m of rule.link.evidence.matchAll(EVIDENCE_REF)) refs.push(m[1]);
    }
    for (const name of refs) {
      if (!declared.has(name)) {
        ctx.addIssue({ code: "custom", message: `unknown fact reference '${name}'` });
      }
    }
  });

export type LinkRule = z.infer<typeof LinkRuleSchema>;
