import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { extname, join } from "node:path";
import type { Language, Node, Parser as ParserT } from "web-tree-sitter";
import { builtinLanguageConfigs } from "../languages/configs/index.js";
import type { Fact } from "./facts.js";
import { loadRuleDirs } from "./load-rules.js";
import { isBuiltinSource, type LinkRule } from "./rule-schema.js";
import { collectQueryFacts, compileQuery } from "./query-facts.js";
import { builtinProviderMap, builtinProviders, type BuiltinProvider } from "./builtins/index.js";
import { evaluateRule, type CandidateEdge } from "./engine.js";
import { applyCandidates } from "./apply.js";

export { LinkRuleSchema, type LinkRule } from "./rule-schema.js";
export { loadRuleDirs } from "./load-rules.js";
export { builtinProviders } from "./builtins/index.js";
export type { Fact } from "./facts.js";

export interface LinkReport {
  rules: number;
  files: number;
  added: number;
  upgraded: number;
  skippedRules: number;
  skippedEdges: number;
  warnings: string[];
}

export interface ApplyLinkRulesOptions {
  ruleDirs: string[];
  projectRoot: string;
}

interface GraphLike {
  nodes: Array<{ id: string }>;
  edges: Array<Record<string, unknown>>;
}

const require = createRequire(import.meta.url);

interface CompiledQueryFact {
  factName: string;
  language: string;
  query: ReturnType<typeof compileQuery>;
  transform: Record<string, string>;
}

/**
 * Deterministic rule-based linking pass (spec §8.2). Mutates `graph`
 * in place and returns the report; the caller decides about persisting.
 * Degradations never throw — they surface as report warnings.
 */
export async function applyLinkRules(
  graph: GraphLike,
  opts: ApplyLinkRulesOptions,
): Promise<LinkReport> {
  const warnings: string[] = [];
  const warn = (m: string) => warnings.push(m);
  const empty = (skippedRules: number): LinkReport => ({
    rules: 0, files: 0, added: 0, upgraded: 0, skippedRules, skippedEdges: 0, warnings,
  });

  const loaded = loadRuleDirs(opts.ruleDirs);
  warnings.push(...loaded.warnings);
  if (loaded.rules.length === 0) return empty(0);
  let skippedRules = 0;

  // 1. Provider-Auflösung (inkl. dependsOn-Hülle) und Sprachbedarf
  const providerMap = builtinProviderMap();
  const neededProviders = new Map<string, BuiltinProvider>();
  const addProvider = (p: BuiltinProvider): void => {
    if (neededProviders.has(p.name)) return;
    neededProviders.set(p.name, p);
    for (const dep of p.dependsOn ?? []) {
      const d = providerMap.get(dep);
      if (d) addProvider(d);
    }
  };
  let rules: LinkRule[] = [];
  for (const rule of loaded.rules) {
    const providers: BuiltinProvider[] = [];
    let ok = true;
    for (const src of Object.values(rule.facts)) {
      if (!isBuiltinSource(src)) continue;
      const p = providerMap.get(src.builtin);
      if (!p) {
        warn(`rule ${rule.id}: unknown builtin '${src.builtin}' — rule skipped`);
        ok = false;
        break;
      }
      providers.push(p);
    }
    if (!ok) {
      skippedRules++;
      continue;
    }
    providers.forEach(addProvider);
    rules.push(rule);
  }
  if (rules.length === 0) return empty(skippedRules);

  const neededLanguages = new Set<string>();
  for (const rule of rules) {
    for (const src of Object.values(rule.facts)) {
      if (!isBuiltinSource(src)) neededLanguages.add(src.language);
    }
  }
  for (const p of neededProviders.values()) {
    if (p.languageId) neededLanguages.add(p.languageId);
  }

  // 2. Grammatiken laden (Ausfall = Warnung, betroffene Regeln/Provider fallen weg)
  const wts = await import("web-tree-sitter");
  await wts.Parser.init();
  const languages = new Map<string, Language>();
  for (const langId of [...neededLanguages].sort()) {
    const config = builtinLanguageConfigs.find((c) => c.id === langId);
    if (!config?.treeSitter) {
      warn(`language '${langId}': no tree-sitter grammar configured — dependent rules skipped`);
      continue;
    }
    try {
      const wasmPath = require.resolve(
        `${config.treeSitter.wasmPackage}/${config.treeSitter.wasmFile}`,
      );
      languages.set(langId, await wts.Language.load(wasmPath));
    } catch (e) {
      warn(`language '${langId}': grammar not loadable (${(e as Error).message}) — dependent rules skipped`);
    }
  }
  const droppedProviders = new Set(
    [...neededProviders.values()]
      .filter((p) => p.languageId !== null && !languages.has(p.languageId))
      .map((p) => p.name),
  );

  // 3. Queries kompilieren; Regeln mit fehlender Grammatik/kaputter Query/totem Provider skippen
  const compiledByRule = new Map<string, CompiledQueryFact[]>();
  rules = rules.filter((rule) => {
    const compiled: CompiledQueryFact[] = [];
    for (const [factName, src] of Object.entries(rule.facts)) {
      if (isBuiltinSource(src)) {
        if (droppedProviders.has(src.builtin) ||
            (providerMap.get(src.builtin)?.dependsOn ?? []).some((d) => droppedProviders.has(d))) {
          warn(`rule ${rule.id}: builtin '${src.builtin}' unavailable — rule skipped`);
          skippedRules++;
          return false;
        }
        continue;
      }
      const lang = languages.get(src.language);
      if (!lang) {
        skippedRules++;
        return false; // Sprachwarnung kam bereits aus Schritt 2
      }
      try {
        compiled.push({
          factName,
          language: src.language,
          query: compileQuery(lang, src.query),
          transform: src.transform ?? {},
        });
      } catch (e) {
        warn(`rule ${rule.id}: invalid query for fact '${factName}' (${(e as Error).message}) — rule skipped`);
        skippedRules++;
        return false;
      }
    }
    compiledByRule.set(rule.id, compiled);
    return true;
  });
  if (rules.length === 0) return empty(skippedRules);

  // 4. Datei-Inventar aus dem Graphen; nur relevante Extensions
  const extToLang = new Map<string, string>();
  for (const [langId] of languages) {
    const config = builtinLanguageConfigs.find((c) => c.id === langId)!;
    for (const ext of config.extensions) extToLang.set(ext.toLowerCase(), langId);
  }
  const activeProviders = [...neededProviders.values()].filter((p) => !droppedProviders.has(p.name));
  const relevantExts = new Set<string>([
    ...activeProviders.flatMap((p) => p.extensions),
    ...[...extToLang.keys()],
  ]);
  const files = graph.nodes
    .map((n) => n.id)
    .filter((id): id is string => typeof id === "string" && id.startsWith("file:"))
    .map((id) => id.slice("file:".length))
    .filter((rel) => relevantExts.has(extname(rel).toLowerCase()))
    .sort();

  // 5. Pro Datei: lesen, (einmal) parsen, Query- und Provider-Fakten sammeln
  const parsers = new Map<string, ParserT>();
  for (const [langId, lang] of languages) {
    const parser = new wts.Parser();
    parser.setLanguage(lang);
    parsers.set(langId, parser);
  }
  const builtinTables = new Map<string, Fact[]>(
    activeProviders.map((p) => [p.name, [] as Fact[]]),
  );
  const queryTables = new Map<string, Map<string, Fact[]>>(
    rules.map((r) => [r.id, new Map(compiledByRule.get(r.id)!.map((c) => [c.factName, []]))]),
  );
  let filesProcessed = 0;
  for (const rel of files) {
    const ext = extname(rel).toLowerCase();
    const langId = extToLang.get(ext);
    const providersForFile = activeProviders.filter((p) => p.extensions.includes(ext));
    let source: string;
    try {
      source = readFileSync(join(opts.projectRoot, rel), "utf-8");
    } catch {
      warn(`file ${rel}: not readable on disk — skipped`);
      continue;
    }
    filesProcessed++;
    let root: Node | null = null;
    if (langId) {
      const tree = parsers.get(langId)!.parse(source);
      root = tree?.rootNode ?? null;
      if (!root) warn(`file ${rel}: parse produced no tree — query facts skipped`);
    }
    if (root && langId) {
      for (const rule of rules) {
        for (const c of compiledByRule.get(rule.id)!) {
          if (c.language !== langId) continue;
          queryTables.get(rule.id)!.get(c.factName)!.push(
            ...collectQueryFacts(c.query, root, rel, c.transform),
          );
        }
      }
    }
    for (const p of providersForFile) {
      builtinTables.get(p.name)!.push(
        ...p.collect(rel, source, p.languageId ? root : null, warn),
      );
    }
  }

  // 6. Provider-Finalize (Registry-Reihenfolge = deterministisch)
  for (const p of builtinProviders) {
    if (!builtinTables.has(p.name) || !p.finalize) continue;
    builtinTables.set(p.name, p.finalize(builtinTables.get(p.name)!, builtinTables, warn));
  }

  // 7. Joins auswerten und anwenden
  const candidates: CandidateEdge[] = [];
  for (const rule of rules) {
    const tables = new Map<string, Fact[]>();
    for (const [factName, src] of Object.entries(rule.facts)) {
      tables.set(
        factName,
        isBuiltinSource(src)
          ? builtinTables.get(src.builtin) ?? []
          : queryTables.get(rule.id)!.get(factName) ?? [],
      );
    }
    candidates.push(...evaluateRule(rule, tables));
  }
  const stats = applyCandidates(graph, candidates, warn);

  return {
    rules: rules.length,
    files: filesProcessed,
    added: stats.added,
    upgraded: stats.upgraded,
    skippedRules,
    skippedEdges: stats.skippedEdges,
    warnings,
  };
}
