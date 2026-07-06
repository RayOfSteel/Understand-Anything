import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { TriggerRuleSchema, type TriggerRule } from "./trigger-rule-schema.js";

export interface LoadTriggerRulesResult {
  rules: TriggerRule[];
  warnings: string[];
}

/**
 * Load trigger-rule files (*.json; one rule or an array per file) from the
 * given directories in order. Later definitions of the same id override
 * earlier ones (repo registry overrides plugin pack). After merging,
 * `disables` entries of enabled rules remove the named rule ids
 * (false-positive kill switch, spec §3.1). Defective files/rules are
 * skipped with a warning — loading never throws.
 */
export function loadTriggerRuleDirs(dirs: string[]): LoadTriggerRulesResult {
  const byId = new Map<string, TriggerRule>();
  const warnings: string[] = [];

  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    const files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
    for (const file of files) {
      let raw: unknown;
      try {
        raw = JSON.parse(readFileSync(join(dir, file), "utf-8"));
      } catch (e) {
        warnings.push(`trigger-rule file ${file}: invalid JSON (${(e as Error).message}) — skipped`);
        continue;
      }
      const entries = Array.isArray(raw) ? raw : [raw];
      for (const entry of entries) {
        const parsed = TriggerRuleSchema.safeParse(entry);
        if (!parsed.success) {
          const id =
            typeof (entry as { id?: unknown })?.id === "string"
              ? (entry as { id: string }).id
              : "<no id>";
          warnings.push(
            `trigger rule ${id} in ${file}: schema violation (${parsed.error.issues[0]?.message ?? "invalid"}) — skipped`,
          );
          continue;
        }
        if (parsed.data.match.type === "path-regex" || parsed.data.match.type === "symbol") {
          try {
            new RegExp(parsed.data.match.pattern);
          } catch (e) {
            warnings.push(
              `trigger rule ${parsed.data.id} in ${file}: uncompilable regex (${(e as Error).message}) — skipped`,
            );
            continue;
          }
        }
        if (byId.has(parsed.data.id)) {
          warnings.push(`trigger rule ${parsed.data.id}: overridden by later definition in ${file}`);
        }
        byId.set(parsed.data.id, parsed.data);
      }
    }
  }

  const enabled = [...byId.values()].filter((r) => r.enabled);
  const disabled = new Set(enabled.flatMap((r) => r.disables));
  const rules = enabled
    .filter((r) => !disabled.has(r.id))
    .sort((a, b) => a.id.localeCompare(b.id));
  return { rules, warnings };
}
