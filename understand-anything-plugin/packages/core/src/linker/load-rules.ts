import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { LinkRuleSchema, type LinkRule } from "./rule-schema.js";

export interface LoadRulesResult {
  rules: LinkRule[];
  warnings: string[];
}

/**
 * Load rule files (*.json; one rule object or an array of rules per file)
 * from the given directories in order. Later definitions of the same rule id
 * override earlier ones (project-local overrides plugin pack). Defective
 * files or rules are skipped with a warning — loading never throws.
 */
export function loadRuleDirs(dirs: string[]): LoadRulesResult {
  const byId = new Map<string, LinkRule>();
  const warnings: string[] = [];

  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    const files = readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .sort();
    for (const file of files) {
      let raw: unknown;
      try {
        raw = JSON.parse(readFileSync(join(dir, file), "utf-8"));
      } catch (e) {
        warnings.push(`rule file ${file}: invalid JSON (${(e as Error).message}) — skipped`);
        continue;
      }
      const entries = Array.isArray(raw) ? raw : [raw];
      for (const entry of entries) {
        const parsed = LinkRuleSchema.safeParse(entry);
        if (!parsed.success) {
          const id =
            typeof (entry as { id?: unknown })?.id === "string"
              ? (entry as { id: string }).id
              : "<no id>";
          warnings.push(
            `rule ${id} in ${file}: schema violation (${parsed.error.issues[0]?.message ?? "invalid"}) — skipped`,
          );
          continue;
        }
        if (byId.has(parsed.data.id)) {
          warnings.push(`rule ${parsed.data.id}: overridden by later definition in ${file}`);
        }
        byId.set(parsed.data.id, parsed.data);
      }
    }
  }

  const rules = [...byId.values()]
    .filter((r) => r.enabled)
    .sort((a, b) => a.id.localeCompare(b.id));
  return { rules, warnings };
}
