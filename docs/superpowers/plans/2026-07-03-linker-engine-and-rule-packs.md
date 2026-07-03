# Linker-Engine + Regel-Packs (Phase ③) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eine deterministische, regelbasierte Linker-Phase (deklarative JSON-Regeln mit Tree-Sitter-Queries + builtin-Fakten-Provider), die Framework-Kanten mit `origin: "rule"` in den Knowledge Graph einfügt — mit WPF-, Razor- und DryIoc-Pack.

**Architecture:** Engine als TypeScript in `packages/core/src/linker/` (Zod-Regel-Schema, Query-Runner, builtin-Provider, Gleichheits-Join, Prioritäts-Apply), exportiert als neuer core-Subpath `./linker`. Ein dünner CLI-Wrapper `skills/understand/apply-link-rules.mjs` (Muster: `apply-graph-patches.mjs`) läuft in der Pipeline **vor** `apply-graph-patches.mjs`. XAML bekommt eine eigene Language-Config mit vendored XML-Grammatik (wasm).

**Tech Stack:** TypeScript strict, Zod v4, web-tree-sitter 0.26 (`Query`-API), Vitest, ESM, pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-07-02-deterministic-linking-design.md` §8 (Stand Commit `21c1d01`). §7.3 definiert die Nachbar-Schritte.

## Global Constraints

- **Prioritäts-Invariante `manual > structural > rule > llm`:** Der Linker fasst Kanten mit `origin` `structural`/`manual`/`rule` **nie** an; Kanten mit `origin` `llm` oder ohne `origin` (`== null`-Semantik: deckt `undefined` und `null`) werden beim Match auf `rule` hochgestuft.
- **Pipeline-Position:** Merge → `apply-link-rules.mjs` (neu) → `apply-graph-patches.mjs` → Validierung.
- **Kanten-Granularität:** Datei→Datei; Knoten-IDs `file:<relpath>`; Member-Details nur in `evidence`.
- **Neue Kanten tragen:** `origin: "rule"`, `ruleId: <Regel-ID>`, `confidence` aus der Regel, `evidence` aus dem Template, `weight: 1.0`. Beim Upgrade bleibt `description` erhalten.
- **Confidence-Werte (exakt):** `wpf.code-behind` 1.0, `wpf.event-handler` 0.9, `wpf.xmlns-viewmodel` 0.8, `razor.inject` 0.9, `razor.component-tag` 0.9, `dryioc.implements` 1.0, `dryioc.registration` 1.0.
- **Kantentypen der Packs (exakt):** `implements` (code-behind cs→xaml; dryioc impl→service), `calls` (event-handler xaml→cs), `depends_on` (xmlns-viewmodel xaml→cs; razor.inject razor→cs; razor.component-tag razor→razor), `configures` (dryioc registrar→impl). `edge.type` wird gegen `EdgeTypeSchema` validiert.
- **Regeln sind reine Daten:** JSON; Queries als String-Array (join `\n`); einzige Capture-Nachbehandlung ist `transform: { "<capture>": "stripQuotes" }`; Join-Sprache ist eine Konjunktion von `faktA.feld == faktB.feld` — keine Funktionen, keine Regex, keine Konkatenation (dafür builtin-Provider).
- **Regel-Verzeichnisse:** Plugin-Packs `understand-anything-plugin/rules/*.json`, projektlokal `<projektwurzel>/.understand-anything/rules/*.json`; Projektwurzel = alles vor dem Pfadsegment `.understand-anything` im Graph-Pfad. Bei Regel-ID-Kollision gewinnt die zuletzt geladene Definition mit Warnung; `"enabled": false` deaktiviert.
- **Determinismus/Idempotenz:** keine `Date.now()`/`Math.random()`; Verzeichnisse, Dateien, Regeln und Kanten-Einfügung in sortierter Reihenfolge; zweimaliges Anwenden byte-identisch; Graph wird nur bei Erfolg zurückgeschrieben (write-only-on-success).
- **Observability:** nur stderr; Degradierungen mit Präfix `Warning: apply-link-rules: `; Summary-Zeile `apply-link-rules: rules=N files=N added=N upgraded=N skippedRules=N skippedEdges=N`; nie Abbruch wegen einer defekten Regel/Datei/Grammatik.
- **`xml.ts` bleibt unangetastet** (keine Verhaltensänderung für `.xml`); XAML ist eine **eigene** Config `xaml` mit vendored Paket `@understand-anything/tree-sitter-xml-wasm`.
- **Keine Wiederverwendung von `extract-import-map.mjs`-Code in core** (un-exportiertes CLI, Codex-Befund): FQN-Stitching und using-Auflösung werden in `packages/core/src/linker/builtins/` **re-implementiert** (Phase-①-Muster).
- **Browser-Sicherheit:** Das Dashboard importiert `./linker` nicht; der neue Subpath darf von keinem Dashboard-Code referenziert werden.
- **Konventionen:** TypeScript strict, Vitest, ESM, `pnpm lint` sauber; kein Push, kein Versions-Bump (Fork-Modus).

## Dateistruktur (neu/geändert)

| Datei | Verantwortung |
|---|---|
| `understand-anything-plugin/packages/core/src/types.ts` | `EDGE_ORIGINS as const` als Single Source (Task 1) |
| `understand-anything-plugin/packages/core/src/schema.ts` | `EdgeOriginSchema`/`autoFixGraph` aus `EDGE_ORIGINS` (Task 1) |
| `understand-anything-plugin/packages/tree-sitter-xml-wasm/` | Vendored XML-Grammatik (Task 2) |
| `understand-anything-plugin/packages/core/src/languages/configs/xaml.ts` (+ `index.ts`) | XAML-Language-Config (Task 2) |
| `understand-anything-plugin/packages/core/src/linker/rule-schema.ts` | Zod-Schema des Regelformats (Task 3) |
| `understand-anything-plugin/packages/core/src/linker/load-rules.ts` | Regel-Laden, Kollision, enabled (Task 3) |
| `understand-anything-plugin/packages/core/src/linker/facts.ts` | `Fact`-Typ (Task 4) |
| `understand-anything-plugin/packages/core/src/linker/query-facts.ts` | Query-Kompilierung/-Ausführung, stripQuotes (Task 4) |
| `understand-anything-plugin/packages/core/src/linker/builtins/types.ts` | `BuiltinProvider`-Schnittstelle (Task 5) |
| `understand-anything-plugin/packages/core/src/linker/builtins/csharp.ts` | classFqn/methodDecl/registration (Task 5) |
| `understand-anything-plugin/packages/core/src/linker/builtins/xaml.ts` | xaml.typeUsage (Task 6) |
| `understand-anything-plugin/packages/core/src/linker/builtins/razor.ts` | razor.* (Task 6) |
| `understand-anything-plugin/packages/core/src/linker/builtins/index.ts` | Provider-Registry (Task 6) |
| `understand-anything-plugin/packages/core/src/linker/engine.ts` | Join-Auswertung → Kandidaten-Kanten (Task 7) |
| `understand-anything-plugin/packages/core/src/linker/apply.ts` | Einfügen/Upgrade mit Prioritätslogik (Task 7) |
| `understand-anything-plugin/packages/core/src/linker/index.ts` | Orchestrierung `applyLinkRules` (Task 7) |
| `understand-anything-plugin/rules/{wpf,razor,dryioc}.json` | Die 7 Regeln (Task 8) |
| `understand-anything-plugin/skills/understand/apply-link-rules.mjs` | CLI-Wrapper (Task 8) |
| `tests/skill/understand/test_apply_link_rules.test.mjs` | End-to-End (Task 8) |
| `understand-anything-plugin/skills/understand/SKILL.md`, `understand-anything-plugin/hooks/auto-update-prompt.md` | Einbettung + Hook-Cleanup-Fix (Task 9) |
| Spec §8.6 | Messergebnis (Task 10) |

---

### Task 1: origin-Enum-Single-Source (Follow-up 2)

**Files:**
- Modify: `understand-anything-plugin/packages/core/src/types.ts:58`
- Modify: `understand-anything-plugin/packages/core/src/schema.ts:356` und `:431`
- Test: `understand-anything-plugin/packages/core/src/__tests__/schema.test.ts` (bestehende Datei, Test anhängen)

**Interfaces:**
- Consumes: bestehendes `EdgeOriginSchema` (schema.ts:431), bestehende Union `EdgeOrigin` (types.ts:58), origin-Literal-Array in `autoFixGraph` (schema.ts:356).
- Produces: `export const EDGE_ORIGINS = ["structural", "llm", "rule", "manual"] as const;` und `export type EdgeOrigin = (typeof EDGE_ORIGINS)[number];` in types.ts — spätere Tasks importieren **weiterhin nur** `EdgeOrigin`/`EdgeOriginSchema`; `EDGE_ORIGINS` ist die interne Single Source.

- [ ] **Step 1: Failing Test schreiben** — im bestehenden `describe`-Block „edge provenance (phase 2)" von `schema.test.ts` ergänzen:

```ts
it("derives EdgeOriginSchema from the single EDGE_ORIGINS source", async () => {
  const { EDGE_ORIGINS } = await import("../types.js");
  expect(EdgeOriginSchema.options).toEqual([...EDGE_ORIGINS]);
});
```

- [ ] **Step 2: Test läuft rot**

Run: `pnpm --filter @understand-anything/core test -- schema`
Expected: FAIL — `EDGE_ORIGINS` ist kein Export von `../types.js` (`undefined`).

- [ ] **Step 3: Implementierung**

`types.ts:58` ersetzen:

```ts
export const EDGE_ORIGINS = ["structural", "llm", "rule", "manual"] as const;
export type EdgeOrigin = (typeof EDGE_ORIGINS)[number];
```

`schema.ts`: Import ergänzen (falls schema.ts noch nichts aus `./types.js` importiert, neue Import-Zeile anlegen):

```ts
import { EDGE_ORIGINS } from "./types.js";
```

`schema.ts:431` ersetzen:

```ts
export const EdgeOriginSchema = z.enum(EDGE_ORIGINS);
```

`schema.ts:356` (in `autoFixGraph`, das Literal-Array) ersetzen:

```ts
        if ((EdgeOriginSchema.options as readonly string[]).includes(normalized)) {
```

Hinweis: `EdgeOriginSchema` steht im Modul weiter unten (Zeile ~431) als die Funktion, die Zeile 356 enthält — das ist zulässig, weil die Funktion erst nach Modul-Initialisierung aufgerufen wird. Zod v4 `z.enum` akzeptiert das `as const`-Tupel direkt.

- [ ] **Step 4: Tests grün**

Run: `pnpm --filter @understand-anything/core test`
Expected: PASS — alle bestehenden Provenance-Tests (Mixed-Case-Normalisierung, ungültiger origin → auto-corrected) unverändert grün; der neue Test grün.

- [ ] **Step 5: Lint + Commit**

```bash
pnpm lint
git add understand-anything-plugin/packages/core/src/types.ts understand-anything-plugin/packages/core/src/schema.ts understand-anything-plugin/packages/core/src/__tests__/schema.test.ts
git commit -m "refactor(core): single source EDGE_ORIGINS for the edge origin enum"
```

---

### Task 2: XAML-Grammatik vendoren + `xaml`-Language-Config

**Files:**
- Create: `understand-anything-plugin/packages/tree-sitter-xml-wasm/package.json`
- Create: `understand-anything-plugin/packages/tree-sitter-xml-wasm/BUILD.md`
- Create: `understand-anything-plugin/packages/tree-sitter-xml-wasm/tree-sitter-xml.wasm` (Download, binär)
- Modify: `understand-anything-plugin/packages/core/package.json` (dependencies)
- Create: `understand-anything-plugin/packages/core/src/languages/configs/xaml.ts`
- Modify: `understand-anything-plugin/packages/core/src/languages/configs/index.ts`
- Test: `understand-anything-plugin/packages/core/src/languages/__tests__/xaml-grammar.test.ts`

**Interfaces:**
- Consumes: Loader-Vertrag `require.resolve("${wasmPackage}/${wasmFile}")` (`tree-sitter-plugin.ts:143`); Präzedenzfall `packages/tree-sitter-dart-wasm/package.json`.
- Produces: Language-Config `xamlConfig` (id `"xaml"`, Extension `".xaml"`, `treeSitter: { wasmPackage: "@understand-anything/tree-sitter-xml-wasm", wasmFile: "tree-sitter-xml.wasm" }`) in `builtinLanguageConfigs`. Spätere Tasks laden die Grammatik über genau diese Config.

- [ ] **Step 1: Failing Test schreiben** — `xaml-grammar.test.ts`:

```ts
import { describe, it, expect, beforeAll } from "vitest";
import { createRequire } from "node:module";
import { Parser, Language, Query } from "web-tree-sitter";
import { builtinLanguageConfigs } from "../configs/index.js";

const require = createRequire(import.meta.url);
let xamlLang: Language;

beforeAll(async () => {
  await Parser.init();
  const wasmPath = require.resolve(
    "@understand-anything/tree-sitter-xml-wasm/tree-sitter-xml.wasm",
  );
  xamlLang = await Language.load(wasmPath);
});

describe("vendored XAML (XML) grammar", () => {
  it("registers a xaml language config with the vendored wasm package", () => {
    const cfg = builtinLanguageConfigs.find((c) => c.id === "xaml");
    expect(cfg?.extensions).toContain(".xaml");
    expect(cfg?.treeSitter?.wasmPackage).toBe("@understand-anything/tree-sitter-xml-wasm");
    expect(cfg?.treeSitter?.wasmFile).toBe("tree-sitter-xml.wasm");
  });

  it("parses WPF markup and answers Attribute/Name/AttValue queries", () => {
    const parser = new Parser();
    parser.setLanguage(xamlLang);
    const tree = parser.parse(
      '<Window x:Class="Demo.MainWindow" Loaded="OnLoaded"><Grid/></Window>',
    );
    const q = new Query(xamlLang, "(Attribute (Name) @n (AttValue) @v)");
    const pairs = q
      .matches(tree!.rootNode)
      .map((m) => Object.fromEntries(m.captures.map((c) => [c.name, c.node.text])));
    expect(pairs).toContainEqual({ n: "x:Class", v: '"Demo.MainWindow"' });
    expect(pairs).toContainEqual({ n: "Loaded", v: '"OnLoaded"' });
  });
});
```

- [ ] **Step 2: Test läuft rot**

Run: `pnpm --filter @understand-anything/core test -- xaml-grammar`
Expected: FAIL — `Cannot find package '@understand-anything/tree-sitter-xml-wasm'` (und die Config existiert nicht).

- [ ] **Step 3: wasm herunterladen und Paket anlegen**

```bash
mkdir -p understand-anything-plugin/packages/tree-sitter-xml-wasm
curl -L -o understand-anything-plugin/packages/tree-sitter-xml-wasm/tree-sitter-xml.wasm \
  https://github.com/tree-sitter-grammars/tree-sitter-xml/releases/download/v0.7.0/tree-sitter-xml.wasm
```

`package.json` (exakt nach Dart-Vorbild):

```json
{
  "name": "@understand-anything/tree-sitter-xml-wasm",
  "version": "0.1.0",
  "type": "module",
  "description": "Vendored tree-sitter-xml WASM grammar (release asset of tree-sitter-grammars/tree-sitter-xml v0.7.0) for use with web-tree-sitter@^0.26.",
  "main": "tree-sitter-xml.wasm",
  "files": ["tree-sitter-xml.wasm", "BUILD.md"],
  "license": "MIT"
}
```

`BUILD.md`:

```markdown
# tree-sitter-xml.wasm

Prebuilt WASM taken unmodified from the official release
https://github.com/tree-sitter-grammars/tree-sitter-xml/releases/tag/v0.7.0
(asset `tree-sitter-xml.wasm`, MIT license). Node type names follow the XML
spec (`STag`, `Attribute`, `Name`, `AttValue`).

Re-fetch:

    curl -L -o tree-sitter-xml.wasm \
      https://github.com/tree-sitter-grammars/tree-sitter-xml/releases/download/v0.7.0/tree-sitter-xml.wasm
```

- [ ] **Step 4: core-Dependency + Config**

In `understand-anything-plugin/packages/core/package.json` unter `dependencies` (alphabetisch neben dem Dart-Eintrag):

```json
    "@understand-anything/tree-sitter-xml-wasm": "workspace:*",
```

Dann `pnpm install` (verlinkt das Workspace-Paket).

`configs/xaml.ts`:

```ts
import type { LanguageConfig } from "../types.js";

export const xamlConfig = {
  id: "xaml",
  displayName: "XAML",
  extensions: [".xaml"],
  treeSitter: {
    wasmPackage: "@understand-anything/tree-sitter-xml-wasm",
    wasmFile: "tree-sitter-xml.wasm",
  },
  concepts: [
    "WPF",
    "data binding",
    "code-behind",
    "resources",
    "styles",
    "templates",
    "routed events",
  ],
  filePatterns: {
    entryPoints: ["App.xaml"],
    barrels: [],
    tests: [],
    config: [],
  },
} satisfies LanguageConfig;
```

`configs/index.ts`: Import `import { xamlConfig } from "./xaml.js";` ergänzen und `xamlConfig` in `builtinLanguageConfigs` direkt nach `xmlConfig` einfügen.

- [ ] **Step 5: Tests grün**

Run: `pnpm --filter @understand-anything/core test -- xaml-grammar`
Expected: PASS (2 Tests). Danach volle Core-Suite: `pnpm --filter @understand-anything/core test` — keine Regression (die neue Config ist additiv; `.xaml` war bisher keiner Sprache zugeordnet).

- [ ] **Step 6: Lint + Commit**

```bash
pnpm lint
git add understand-anything-plugin/packages/tree-sitter-xml-wasm understand-anything-plugin/packages/core/package.json pnpm-lock.yaml understand-anything-plugin/packages/core/src/languages/configs/xaml.ts understand-anything-plugin/packages/core/src/languages/configs/index.ts understand-anything-plugin/packages/core/src/languages/__tests__/xaml-grammar.test.ts
git commit -m "feat(core): vendored XAML (XML) grammar and xaml language config"
```

---

### Task 3: Regel-Schema und Regel-Loader

**Files:**
- Create: `understand-anything-plugin/packages/core/src/linker/rule-schema.ts`
- Create: `understand-anything-plugin/packages/core/src/linker/load-rules.ts`
- Test: `understand-anything-plugin/packages/core/src/linker/__tests__/rule-schema.test.ts`

**Interfaces:**
- Consumes: `EdgeTypeSchema` aus `../schema.js` (Task 1 hat sie unverändert gelassen).
- Produces:
  - `LinkRuleSchema` (Zod), `type LinkRule = z.infer<typeof LinkRuleSchema>`, `const CONDITION_RE: RegExp` (mit 4 Capture-Gruppen: faktA, feldA, faktB, feldB) aus `rule-schema.ts`.
  - `loadRuleDirs(dirs: string[]): { rules: LinkRule[]; warnings: string[] }` aus `load-rules.ts` — Regeln alphabetisch nach `id` sortiert, `enabled:false` herausgefiltert, ID-Kollision: letzte gewinnt + Warnung. Eine Regeldatei enthält **ein Regel-Objekt oder ein Array von Regeln**.

- [ ] **Step 1: Failing Tests schreiben** — `rule-schema.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LinkRuleSchema } from "../rule-schema.js";
import { loadRuleDirs } from "../load-rules.js";

const VALID_RULE = {
  id: "wpf.code-behind",
  confidence: 1.0,
  edge: { type: "implements", direction: "forward" },
  facts: {
    xClass: {
      language: "xaml",
      query: ['(Attribute (Name) @n (#eq? @n "x:Class") (AttValue) @value)'],
      transform: { value: "stripQuotes" },
    },
    cls: { builtin: "csharp.classFqn" },
  },
  link: {
    where: ["cls.value == xClass.value"],
    source: "cls.file",
    target: "xClass.file",
    evidence: "x:Class={xClass.value}",
  },
};

describe("LinkRuleSchema", () => {
  it("accepts a valid rule and defaults enabled/direction", () => {
    const r = LinkRuleSchema.parse({ ...VALID_RULE, edge: { type: "implements" } });
    expect(r.enabled).toBe(true);
    expect(r.edge.direction).toBe("forward");
  });

  it("rejects an unknown edge type", () => {
    const bad = { ...VALID_RULE, edge: { type: "renders" } };
    expect(LinkRuleSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects a where condition that is not a plain equality", () => {
    const bad = {
      ...VALID_RULE,
      link: { ...VALID_RULE.link, where: ["cls.value != xClass.value"] },
    };
    expect(LinkRuleSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects references to undeclared facts (where, source/target, evidence)", () => {
    const badWhere = {
      ...VALID_RULE,
      link: { ...VALID_RULE.link, where: ["ghost.value == xClass.value"] },
    };
    expect(LinkRuleSchema.safeParse(badWhere).success).toBe(false);
    const badEvidence = {
      ...VALID_RULE,
      link: { ...VALID_RULE.link, evidence: "{ghost.value}" },
    };
    expect(LinkRuleSchema.safeParse(badEvidence).success).toBe(false);
  });

  it("rejects a source that is not a <fact>.file reference", () => {
    const bad = { ...VALID_RULE, link: { ...VALID_RULE.link, source: "cls.value" } };
    expect(LinkRuleSchema.safeParse(bad).success).toBe(false);
  });
});

describe("loadRuleDirs", () => {
  function dirWith(files: Record<string, unknown>) {
    const d = mkdtempSync(join(tmpdir(), "ua-rules-"));
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(
        join(d, name),
        typeof content === "string" ? content : JSON.stringify(content),
        "utf-8",
      );
    }
    return d;
  }

  it("loads arrays and single objects, sorts by id, filters disabled", () => {
    const d = dirWith({
      "pack.json": [VALID_RULE, { ...VALID_RULE, id: "aaa.first" }],
      "single.json": { ...VALID_RULE, id: "zzz.off", enabled: false },
    });
    const { rules, warnings } = loadRuleDirs([d]);
    expect(rules.map((r) => r.id)).toEqual(["aaa.first", "wpf.code-behind"]);
    expect(warnings).toEqual([]);
  });

  it("skips invalid JSON and schema violations with warnings, never throws", () => {
    const d = dirWith({
      "broken.json": "{ not json",
      "badrule.json": { id: "x", confidence: 2 },
      "good.json": VALID_RULE,
    });
    const { rules, warnings } = loadRuleDirs([d]);
    expect(rules.map((r) => r.id)).toEqual(["wpf.code-behind"]);
    expect(warnings.length).toBe(2);
  });

  it("later directory wins on id collision, with a warning", () => {
    const d1 = dirWith({ "a.json": VALID_RULE });
    const d2 = dirWith({
      "b.json": { ...VALID_RULE, confidence: 0.5 },
    });
    const { rules, warnings } = loadRuleDirs([d1, d2]);
    expect(rules).toHaveLength(1);
    expect(rules[0].confidence).toBe(0.5);
    expect(warnings.some((w) => w.includes("overridden"))).toBe(true);
  });

  it("missing directory is a no-op", () => {
    const { rules, warnings } = loadRuleDirs([join(tmpdir(), "does-not-exist-xyz")]);
    expect(rules).toEqual([]);
    expect(warnings).toEqual([]);
  });
});
```

- [ ] **Step 2: Tests laufen rot**

Run: `pnpm --filter @understand-anything/core test -- rule-schema`
Expected: FAIL — Module `../rule-schema.js` / `../load-rules.js` existieren nicht.

- [ ] **Step 3: Implementierung** — `rule-schema.ts`:

```ts
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
```

`load-rules.ts`:

```ts
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
```

- [ ] **Step 4: Tests grün**

Run: `pnpm --filter @understand-anything/core test -- rule-schema`
Expected: PASS (10 Tests).

- [ ] **Step 5: Lint + Commit**

```bash
pnpm lint
git add understand-anything-plugin/packages/core/src/linker
git commit -m "feat(core): link rule schema and rule directory loader"
```

---

### Task 4: Fakten-Modell, Query-Runner und stripQuotes

**Files:**
- Create: `understand-anything-plugin/packages/core/src/linker/facts.ts`
- Create: `understand-anything-plugin/packages/core/src/linker/query-facts.ts`
- Test: `understand-anything-plugin/packages/core/src/linker/__tests__/query-facts.test.ts`

**Interfaces:**
- Consumes: `Query`, `Language`, `Node` aus `web-tree-sitter`; vendored XAML-Grammatik aus Task 2.
- Produces:
  - `facts.ts`: `export interface Fact { file: string; [field: string]: string; }`
  - `query-facts.ts`: `stripQuotes(value: string): string`; `compileQuery(language: Language, lines: string[]): Query` (wirft bei Syntaxfehler — Aufrufer fängt und skippt die Regel); `collectQueryFacts(query: Query, root: Node, file: string, transform?: Record<string, string>): Fact[]` — pro Query-Match ein Fakt, Capture-Namen als Felder, `stripQuotes` gemäß transform.

- [ ] **Step 1: Failing Tests schreiben** — `query-facts.test.ts`:

```ts
import { describe, it, expect, beforeAll } from "vitest";
import { createRequire } from "node:module";
import { Parser, Language } from "web-tree-sitter";
import { stripQuotes, compileQuery, collectQueryFacts } from "../query-facts.js";

const require = createRequire(import.meta.url);
let xaml: Language;
let parser: Parser;

beforeAll(async () => {
  await Parser.init();
  xaml = await Language.load(
    require.resolve("@understand-anything/tree-sitter-xml-wasm/tree-sitter-xml.wasm"),
  );
  parser = new Parser();
  parser.setLanguage(xaml);
});

describe("stripQuotes", () => {
  it("strips matching double and single quotes, leaves the rest alone", () => {
    expect(stripQuotes('"a.b"')).toBe("a.b");
    expect(stripQuotes("'x'")).toBe("x");
    expect(stripQuotes('"unbalanced')).toBe('"unbalanced');
    expect(stripQuotes("plain")).toBe("plain");
    expect(stripQuotes('""')).toBe("");
  });
});

describe("collectQueryFacts", () => {
  it("yields one fact per match with capture fields and transforms", () => {
    const tree = parser.parse('<W x:Class="Demo.Main" Loaded="OnLoaded"/>')!;
    const q = compileQuery(xaml, ["(Attribute (Name) @name", "  (AttValue) @value)"]);
    const facts = collectQueryFacts(q, tree.rootNode, "V.xaml", { value: "stripQuotes" });
    expect(facts).toContainEqual({ file: "V.xaml", name: "x:Class", value: "Demo.Main" });
    expect(facts).toContainEqual({ file: "V.xaml", name: "Loaded", value: "OnLoaded" });
  });

  it("honours #eq? predicates", () => {
    const tree = parser.parse('<W x:Class="Demo.Main" Loaded="OnLoaded"/>')!;
    const q = compileQuery(xaml, [
      "(Attribute (Name) @n",
      '  (#eq? @n "x:Class")',
      "  (AttValue) @value)",
    ]);
    const facts = collectQueryFacts(q, tree.rootNode, "V.xaml", { value: "stripQuotes" });
    expect(facts).toEqual([{ file: "V.xaml", n: "x:Class", value: "Demo.Main" }]);
  });

  it("compileQuery throws on a syntactically invalid query", () => {
    expect(() => compileQuery(xaml, ["(Attribute (Name @broken"])).toThrow();
  });
});
```

- [ ] **Step 2: Tests laufen rot**

Run: `pnpm --filter @understand-anything/core test -- query-facts`
Expected: FAIL — Module existieren nicht.

- [ ] **Step 3: Implementierung** — `facts.ts`:

```ts
/**
 * A single fact instance produced by a tree-sitter query or a builtin
 * provider. `file` is the project-relative path of the originating file;
 * all other fields are string values (capture names or provider fields).
 * Fields starting with "_" are provider-internal and are dropped by
 * finalize passes.
 */
export interface Fact {
  file: string;
  [field: string]: string;
}
```

`query-facts.ts`:

```ts
import { Query, type Language, type Node } from "web-tree-sitter";
import type { Fact } from "./facts.js";

/** Remove one pair of matching surrounding quotes (`"` or `'`), if present. */
export function stripQuotes(value: string): string {
  if (
    value.length >= 2 &&
    (value[0] === '"' || value[0] === "'") &&
    value[value.length - 1] === value[0]
  ) {
    return value.slice(1, -1);
  }
  return value;
}

/** Compile a rule query (lines are joined with newlines). Throws on syntax errors. */
export function compileQuery(language: Language, lines: string[]): Query {
  return new Query(language, lines.join("\n"));
}

/** Run a compiled query over one file's tree and collect one fact per match. */
export function collectQueryFacts(
  query: Query,
  root: Node,
  file: string,
  transform: Record<string, string> = {},
): Fact[] {
  const facts: Fact[] = [];
  for (const match of query.matches(root)) {
    const fact: Fact = { file };
    for (const capture of match.captures) {
      const raw = capture.node.text;
      fact[capture.name] = transform[capture.name] === "stripQuotes" ? stripQuotes(raw) : raw;
    }
    facts.push(fact);
  }
  return facts;
}
```

- [ ] **Step 4: Tests grün**

Run: `pnpm --filter @understand-anything/core test -- query-facts`
Expected: PASS (4 Tests).

- [ ] **Step 5: Lint + Commit**

```bash
pnpm lint
git add understand-anything-plugin/packages/core/src/linker
git commit -m "feat(core): linker fact model and tree-sitter query runner"
```

---

### Task 5: builtin-Provider C# (`csharp.classFqn`, `csharp.methodDecl`, `csharp.registration`)

**Files:**
- Create: `understand-anything-plugin/packages/core/src/linker/builtins/types.ts`
- Create: `understand-anything-plugin/packages/core/src/linker/builtins/csharp.ts`
- Test: `understand-anything-plugin/packages/core/src/linker/__tests__/csharp-builtins.test.ts`

**Interfaces:**
- Consumes: `Fact` (Task 4); C#-Grammatik `tree-sitter-c-sharp/tree-sitter-c_sharp.wasm` (bereits core-Dependency); Grammatik-Knoten: `using_directive`, `namespace_declaration`, `file_scoped_namespace_declaration`, `class_declaration`, `interface_declaration`, `record_declaration`, `struct_declaration`, `enum_declaration`, `method_declaration`, `invocation_expression`, `member_access_expression`, `generic_name`, `type_argument_list` (Namespace-Stitching-Fälle wie `csharp-extractor.ts:224–305` — Re-Implementierung, kein Import, siehe Global Constraints).
- Produces:
  - `builtins/types.ts`: `export type WarnFn = (msg: string) => void;` und

    ```ts
    export interface BuiltinProvider {
      name: string;
      extensions: string[];          // lowercase, mit Punkt
      languageId: string | null;     // Grammatik für collect(), null = raw source
      dependsOn?: string[];          // Provider, deren Tabellen finalize() braucht
      collect(file: string, source: string, root: Node | null, warn: WarnFn): Fact[];
      finalize?(own: Fact[], all: Map<string, Fact[]>, warn: WarnFn): Fact[];
    }
    ```
  - `builtins/csharp.ts`: `csharpClassFqnProvider` (Fakten `{file, value: FQN, name: Kurzname}`), `csharpMethodDeclProvider` (`{file, classFqn, name}`), `csharpRegistrationProvider` (`dependsOn: ["csharp.classFqn"]`; nach finalize `{file, serviceFqn, implFqn}`).

- [ ] **Step 1: Failing Tests schreiben** — `csharp-builtins.test.ts`:

```ts
import { describe, it, expect, beforeAll } from "vitest";
import { createRequire } from "node:module";
import { Parser, Language } from "web-tree-sitter";
import {
  csharpClassFqnProvider,
  csharpMethodDeclProvider,
  csharpRegistrationProvider,
} from "../builtins/csharp.js";
import type { Fact } from "../facts.js";

const require = createRequire(import.meta.url);
let parser: Parser;
const warnings: string[] = [];
const warn = (m: string) => warnings.push(m);

beforeAll(async () => {
  await Parser.init();
  const lang = await Language.load(
    require.resolve("tree-sitter-c-sharp/tree-sitter-c_sharp.wasm"),
  );
  parser = new Parser();
  parser.setLanguage(lang);
});

function collect(provider: { collect: Function }, file: string, source: string): Fact[] {
  return provider.collect(file, source, parser.parse(source)!.rootNode, warn);
}

describe("csharp.classFqn", () => {
  it("stitches block-scoped, file-scoped and nested namespaces", () => {
    expect(collect(csharpClassFqnProvider, "a.cs",
      "namespace A.B { public class Foo { } public interface IBar { } }",
    )).toEqual([
      { file: "a.cs", value: "A.B.Foo", name: "Foo" },
      { file: "a.cs", value: "A.B.IBar", name: "IBar" },
    ]);
    expect(collect(csharpClassFqnProvider, "b.cs",
      "namespace C;\npublic record Rec;\npublic struct St { }\npublic enum En { X }",
    )).toEqual([
      { file: "b.cs", value: "C.Rec", name: "Rec" },
      { file: "b.cs", value: "C.St", name: "St" },
      { file: "b.cs", value: "C.En", name: "En" },
    ]);
    expect(collect(csharpClassFqnProvider, "c.cs",
      "namespace A { namespace B { class Inner { } } }",
    )).toEqual([{ file: "c.cs", value: "A.B.Inner", name: "Inner" }]);
  });

  it("classes without namespace keep the bare name", () => {
    expect(collect(csharpClassFqnProvider, "d.cs", "class Naked { }")).toEqual([
      { file: "d.cs", value: "Naked", name: "Naked" },
    ]);
  });
});

describe("csharp.methodDecl", () => {
  it("pairs method names with the enclosing class FQN", () => {
    const facts = collect(csharpMethodDeclProvider, "w.cs",
      "namespace Demo { public partial class MainWindow { void OnLoaded(object s, System.EventArgs e) { } int Helper() { return 1; } } }",
    );
    expect(facts).toContainEqual({ file: "w.cs", classFqn: "Demo.MainWindow", name: "OnLoaded" });
    expect(facts).toContainEqual({ file: "w.cs", classFqn: "Demo.MainWindow", name: "Helper" });
  });
});

describe("csharp.registration", () => {
  const REG_FILE =
    "using Demo.Services;\nnamespace Demo {\n  public class Bootstrap {\n    void Init(object container) {\n      ((dynamic)container).Register<IGreeter, Greeter>();\n      ((dynamic)container).Register<string>();\n    }\n  }\n}\n";
  const CLASS_TABLE: Fact[] = [
    { file: "Services/IGreeter.cs", value: "Demo.Services.IGreeter", name: "IGreeter" },
    { file: "Services/Greeter.cs", value: "Demo.Services.Greeter", name: "Greeter" },
  ];

  it("collects two-type-arg Register calls and resolves via using context", () => {
    const raw = collect(csharpRegistrationProvider, "Bootstrap.cs", REG_FILE);
    const all = new Map<string, Fact[]>([["csharp.classFqn", CLASS_TABLE]]);
    const facts = csharpRegistrationProvider.finalize!(raw, all, warn);
    expect(facts).toEqual([
      {
        file: "Bootstrap.cs",
        serviceFqn: "Demo.Services.IGreeter",
        implFqn: "Demo.Services.Greeter",
      },
    ]);
  });

  it("drops unresolvable type arguments with a warning", () => {
    const before = warnings.length;
    const raw = collect(csharpRegistrationProvider, "Bootstrap.cs", REG_FILE);
    const facts = csharpRegistrationProvider.finalize!(raw, new Map([["csharp.classFqn", []]]), warn);
    expect(facts).toEqual([]);
    expect(warnings.length).toBeGreaterThan(before);
  });
});
```

- [ ] **Step 2: Tests laufen rot**

Run: `pnpm --filter @understand-anything/core test -- csharp-builtins`
Expected: FAIL — Module existieren nicht.

- [ ] **Step 3: Implementierung** — `builtins/types.ts`:

```ts
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
```

`builtins/csharp.ts`:

```ts
import type { Node } from "web-tree-sitter";
import type { Fact } from "../facts.js";
import type { BuiltinProvider, WarnFn } from "./types.js";

const CLASS_LIKE = new Set([
  "class_declaration",
  "interface_declaration",
  "record_declaration",
  "struct_declaration",
  "enum_declaration",
]);
const REGISTER_METHODS = new Set(["Register", "RegisterMany", "RegisterInstance"]);

interface ClassInfo {
  fqn: string;
  name: string;
  methods: string[];
}
interface RegistrationInfo {
  serviceRaw: string;
  implRaw: string;
}
interface FileInfo {
  usings: string[];
  namespaces: string[];
  classes: ClassInfo[];
  registrations: RegistrationInfo[];
}

const cache = new WeakMap<Node, FileInfo>();

function findChild(node: Node, type: string): Node | null {
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i);
    if (c?.type === type) return c;
  }
  return null;
}

/** Same field/fallback strategy as csharp-extractor.ts namespaceName (re-implemented). */
function namespaceName(node: Node): string | null {
  const n =
    node.childForFieldName("name") ??
    findChild(node, "qualified_name") ??
    findChild(node, "identifier");
  return n ? n.text : null;
}

function collectClass(node: Node, ns: string, info: FileInfo): void {
  const nameNode = node.childForFieldName("name");
  if (!nameNode) return;
  const name = nameNode.text;
  const methods: string[] = [];
  const body = node.childForFieldName("body");
  if (body) {
    for (let i = 0; i < body.childCount; i++) {
      const m = body.child(i);
      if (m?.type !== "method_declaration") continue;
      const mName = m.childForFieldName("name");
      if (mName) methods.push(mName.text);
    }
  }
  info.classes.push({ fqn: ns ? `${ns}.${name}` : name, name, methods });
}

function walkNamespaceBody(nsNode: Node, parentNs: string, info: FileInfo): void {
  const body = nsNode.childForFieldName("body");
  if (!body) return;
  for (let i = 0; i < body.childCount; i++) {
    const child = body.child(i);
    if (!child) continue;
    if (CLASS_LIKE.has(child.type)) {
      collectClass(child, parentNs, info);
    } else if (child.type === "namespace_declaration") {
      const ns = namespaceName(child);
      const full = ns ? (parentNs ? `${parentNs}.${ns}` : ns) : parentNs;
      if (ns) info.namespaces.push(full);
      walkNamespaceBody(child, full, info);
    }
  }
}

function collectRegistrations(node: Node, info: FileInfo): void {
  if (node.type === "invocation_expression") {
    const fn = node.childForFieldName("function");
    let generic: Node | null = null;
    if (fn?.type === "member_access_expression") {
      const name = fn.childForFieldName("name");
      if (name?.type === "generic_name") generic = name;
    } else if (fn?.type === "generic_name") {
      generic = fn;
    }
    if (generic) {
      const ident = findChild(generic, "identifier");
      if (ident && REGISTER_METHODS.has(ident.text)) {
        const argList = findChild(generic, "type_argument_list");
        if (argList) {
          const typeArgs: string[] = [];
          for (let i = 0; i < argList.namedChildCount; i++) {
            const t = argList.namedChild(i);
            if (t) typeArgs.push(t.text);
          }
          if (typeArgs.length === 2) {
            info.registrations.push({ serviceRaw: typeArgs[0], implRaw: typeArgs[1] });
          }
        }
      }
    }
  }
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i);
    if (c) collectRegistrations(c, info);
  }
}

/**
 * One walk per file, shared by all three providers via WeakMap cache.
 * File-scoped namespaces apply to all following top-level declarations
 * (the declarations are siblings of the namespace node in the grammar).
 */
function analyze(root: Node): FileInfo {
  const cached = cache.get(root);
  if (cached) return cached;
  const info: FileInfo = { usings: [], namespaces: [], classes: [], registrations: [] };
  let fileScopedNs = "";
  for (let i = 0; i < root.childCount; i++) {
    const child = root.child(i);
    if (!child) continue;
    switch (child.type) {
      case "using_directive": {
        const target = findChild(child, "qualified_name") ?? findChild(child, "identifier");
        if (target) info.usings.push(target.text);
        break;
      }
      case "file_scoped_namespace_declaration": {
        const ns = namespaceName(child);
        if (ns) {
          fileScopedNs = ns;
          info.namespaces.push(ns);
        }
        break;
      }
      case "namespace_declaration": {
        const ns = namespaceName(child);
        if (ns) info.namespaces.push(ns);
        walkNamespaceBody(child, ns ?? "", info);
        break;
      }
      default:
        if (CLASS_LIKE.has(child.type)) collectClass(child, fileScopedNs, info);
    }
  }
  collectRegistrations(root, info);
  cache.set(root, info);
  return info;
}

export const csharpClassFqnProvider: BuiltinProvider = {
  name: "csharp.classFqn",
  extensions: [".cs"],
  languageId: "csharp",
  collect(file, _source, root) {
    if (!root) return [];
    return analyze(root).classes.map((c) => ({ file, value: c.fqn, name: c.name }));
  },
};

export const csharpMethodDeclProvider: BuiltinProvider = {
  name: "csharp.methodDecl",
  extensions: [".cs"],
  languageId: "csharp",
  collect(file, _source, root) {
    if (!root) return [];
    return analyze(root).classes.flatMap((c) =>
      c.methods.map((m) => ({ file, classFqn: c.fqn, name: m })),
    );
  },
};

/** Strip generic arguments: "IRepo<Foo>" → "IRepo". */
function baseTypeName(raw: string): string {
  const idx = raw.indexOf("<");
  return idx === -1 ? raw : raw.slice(0, idx);
}

function resolveType(
  raw: string,
  usings: string[],
  namespaces: string[],
  fqnIndex: Set<string>,
  file: string,
  warn: WarnFn,
): string | null {
  const base = baseTypeName(raw).trim();
  if (base.includes(".")) {
    if (fqnIndex.has(base)) return base;
    warn(`csharp.registration: ${file}: qualified type '${base}' not found in project — dropped`);
    return null;
  }
  const candidates = [
    ...new Set([...namespaces, ...usings].map((p) => `${p}.${base}`).filter((c) => fqnIndex.has(c))),
  ];
  if (candidates.length === 1) return candidates[0];
  warn(
    `csharp.registration: ${file}: type '${base}' ${candidates.length === 0 ? "not resolvable" : "ambiguous"} via using context — dropped`,
  );
  return null;
}

export const csharpRegistrationProvider: BuiltinProvider = {
  name: "csharp.registration",
  extensions: [".cs"],
  languageId: "csharp",
  dependsOn: ["csharp.classFqn"],
  collect(file, _source, root) {
    if (!root) return [];
    const info = analyze(root);
    return info.registrations.map((r) => ({
      file,
      _serviceRaw: r.serviceRaw,
      _implRaw: r.implRaw,
      _usings: JSON.stringify(info.usings),
      _namespaces: JSON.stringify(info.namespaces),
    }));
  },
  finalize(own, all, warn) {
    const fqnIndex = new Set((all.get("csharp.classFqn") ?? []).map((f) => f.value));
    const out: Fact[] = [];
    for (const f of own) {
      const usings = JSON.parse(f._usings) as string[];
      const namespaces = JSON.parse(f._namespaces) as string[];
      const serviceFqn = resolveType(f._serviceRaw, usings, namespaces, fqnIndex, f.file, warn);
      const implFqn = resolveType(f._implRaw, usings, namespaces, fqnIndex, f.file, warn);
      if (serviceFqn && implFqn) out.push({ file: f.file, serviceFqn, implFqn });
    }
    return out;
  },
};
```

- [ ] **Step 4: Tests grün**

Run: `pnpm --filter @understand-anything/core test -- csharp-builtins`
Expected: PASS (6 Tests). Hinweis für den Fall, dass ein Grammatik-Knotenname abweicht (z. B. `record_declaration`-Struktur): mit einem 5-Zeilen-Debug-Walk den echten Knotentyp prüfen und den Test-/Code-Namen an die Grammatik anpassen — die Grammatik ist die Wahrheit, nicht dieser Plan.

- [ ] **Step 5: Lint + Commit**

```bash
pnpm lint
git add understand-anything-plugin/packages/core/src/linker
git commit -m "feat(core): csharp builtin fact providers (classFqn, methodDecl, registration)"
```

---

### Task 6: builtin-Provider XAML + Razor und Provider-Registry

**Files:**
- Create: `understand-anything-plugin/packages/core/src/linker/builtins/xaml.ts`
- Create: `understand-anything-plugin/packages/core/src/linker/builtins/razor.ts`
- Create: `understand-anything-plugin/packages/core/src/linker/builtins/index.ts`
- Test: `understand-anything-plugin/packages/core/src/linker/__tests__/xaml-razor-builtins.test.ts`

**Interfaces:**
- Consumes: `BuiltinProvider`/`WarnFn` (Task 5), `Fact` (Task 4), `stripQuotes` (Task 4), XAML-Grammatik (Task 2; Knoten `STag`, `EmptyElemTag`, `Attribute`, `Name`, `AttValue`).
- Produces:
  - `xamlTypeUsageProvider` — `name: "xaml.typeUsage"`, Fakten `{file, value: FQN}` aus xmlns-Mapping + präfixierten Element-Tags.
  - `razorUsingDirectiveProvider` (`razor.usingDirective`, `{file, namespace}`), `razorComponentDeclProvider` (`razor.componentDecl`, `{file, name}`; `_`-Dateien ausgenommen; Duplikat-Namen in finalize verworfen + Warnung), `razorComponentTagProvider` (`razor.componentTag`, `{file, name}`), `razorInjectProvider` (`razor.inject`, `dependsOn: ["csharp.classFqn", "razor.usingDirective"]`, nach finalize `{file, typeName, typeFqn}` — Unauflösbares verworfen + Warnung). Alle Razor-Provider: `languageId: null` (raw source).
  - `builtins/index.ts`: `export const builtinProviders: BuiltinProvider[]` (alle 8 Provider inkl. der drei aus Task 5) und `export function builtinProviderMap(): Map<string, BuiltinProvider>`.

- [ ] **Step 1: Failing Tests schreiben** — `xaml-razor-builtins.test.ts`:

```ts
import { describe, it, expect, beforeAll } from "vitest";
import { createRequire } from "node:module";
import { Parser, Language } from "web-tree-sitter";
import { xamlTypeUsageProvider } from "../builtins/xaml.js";
import {
  razorUsingDirectiveProvider,
  razorComponentDeclProvider,
  razorComponentTagProvider,
  razorInjectProvider,
} from "../builtins/razor.js";
import { builtinProviders, builtinProviderMap } from "../builtins/index.js";
import type { Fact } from "../facts.js";

const require = createRequire(import.meta.url);
let parser: Parser;
const warnings: string[] = [];
const warn = (m: string) => warnings.push(m);

beforeAll(async () => {
  await Parser.init();
  const xaml = await Language.load(
    require.resolve("@understand-anything/tree-sitter-xml-wasm/tree-sitter-xml.wasm"),
  );
  parser = new Parser();
  parser.setLanguage(xaml);
});

describe("xaml.typeUsage", () => {
  it("resolves prefixed element tags via clr-namespace xmlns mappings", () => {
    const src =
      '<Window xmlns:vm="clr-namespace:Demo.ViewModels;assembly=Demo" xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml">' +
      "<Grid><vm:MainViewModel/><vm:MainViewModel/></Grid></Window>";
    const facts = xamlTypeUsageProvider.collect("V.xaml", src, parser.parse(src)!.rootNode, warn);
    expect(facts).toEqual([{ file: "V.xaml", value: "Demo.ViewModels.MainViewModel" }]);
  });
});

describe("razor providers (raw source)", () => {
  it("razor.usingDirective collects @using lines", () => {
    expect(
      razorUsingDirectiveProvider.collect("_Imports.razor", "@using Demo.Services\n@using X.Y\n", null, warn),
    ).toEqual([
      { file: "_Imports.razor", namespace: "Demo.Services" },
      { file: "_Imports.razor", namespace: "X.Y" },
    ]);
  });

  it("razor.componentDecl names components after the file, skips _-files and duplicates", () => {
    expect(razorComponentDeclProvider.collect("Pages/Hello.razor", "<h1/>", null, warn)).toEqual([
      { file: "Pages/Hello.razor", name: "Hello" },
    ]);
    expect(razorComponentDeclProvider.collect("_Imports.razor", "", null, warn)).toEqual([]);
    const dup: Fact[] = [
      { file: "A/Hello.razor", name: "Hello" },
      { file: "B/Hello.razor", name: "Hello" },
    ];
    const before = warnings.length;
    expect(razorComponentDeclProvider.finalize!(dup, new Map(), warn)).toEqual([]);
    expect(warnings.length).toBeGreaterThan(before);
  });

  it("razor.componentTag finds unique PascalCase tags", () => {
    expect(
      razorComponentTagProvider.collect("Pages/Index.razor", "<div><Hello /><Hello/><p>x</p></div>", null, warn),
    ).toEqual([{ file: "Pages/Index.razor", name: "Hello" }]);
  });

  it("razor.inject resolves qualified, per-using and directory-scoped _Imports usings", () => {
    const classTable: Fact[] = [
      { file: "Services/IGreeter.cs", value: "Demo.Services.IGreeter", name: "IGreeter" },
    ];
    const usingTable: Fact[] = [{ file: "Pages/_Imports.razor", namespace: "Demo.Services" }];
    const all = new Map<string, Fact[]>([
      ["csharp.classFqn", classTable],
      ["razor.usingDirective", usingTable],
    ]);
    const qualified = razorInjectProvider.collect(
      "Pages/Hello.razor",
      "@inject Demo.Services.IGreeter Greeter\n",
      null,
      warn,
    );
    expect(razorInjectProvider.finalize!(qualified, all, warn)).toEqual([
      { file: "Pages/Hello.razor", typeName: "Demo.Services.IGreeter", typeFqn: "Demo.Services.IGreeter" },
    ]);
    const short = razorInjectProvider.collect("Pages/Hi.razor", "@inject IGreeter G\n", null, warn);
    expect(razorInjectProvider.finalize!(short, all, warn)).toEqual([
      { file: "Pages/Hi.razor", typeName: "IGreeter", typeFqn: "Demo.Services.IGreeter" },
    ]);
    const outOfScope = razorInjectProvider.collect("Other/Hi.razor", "@inject IGreeter G\n", null, warn);
    // Other/ liegt nicht unter Pages/ — aber der eindeutige Kurzname greift als Fallback:
    expect(razorInjectProvider.finalize!(outOfScope, all, warn)).toEqual([
      { file: "Other/Hi.razor", typeName: "IGreeter", typeFqn: "Demo.Services.IGreeter" },
    ]);
  });
});

describe("builtin registry", () => {
  it("exposes all eight providers by name", () => {
    expect(builtinProviders).toHaveLength(8);
    const map = builtinProviderMap();
    for (const n of [
      "csharp.classFqn",
      "csharp.methodDecl",
      "csharp.registration",
      "xaml.typeUsage",
      "razor.usingDirective",
      "razor.componentDecl",
      "razor.componentTag",
      "razor.inject",
    ]) {
      expect(map.has(n)).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Tests laufen rot**

Run: `pnpm --filter @understand-anything/core test -- xaml-razor-builtins`
Expected: FAIL — Module existieren nicht.

- [ ] **Step 3: Implementierung** — `builtins/xaml.ts`:

```ts
import type { Node } from "web-tree-sitter";
import type { Fact } from "../facts.js";
import { stripQuotes } from "../query-facts.js";
import type { BuiltinProvider } from "./types.js";

const TAG_TYPES = new Set(["STag", "EmptyElemTag"]);
const CLR_PREFIX = "clr-namespace:";

function visit(node: Node, fn: (n: Node) => void): void {
  fn(node);
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i);
    if (c) visit(c, fn);
  }
}

/**
 * xmlns prefix mapping + prefixed element tags → resolved FQNs.
 * Prefix splitting and namespace concatenation live deliberately here,
 * not in the equality-join language (spec §8.3).
 */
export const xamlTypeUsageProvider: BuiltinProvider = {
  name: "xaml.typeUsage",
  extensions: [".xaml"],
  languageId: "xaml",
  collect(file, _source, root) {
    if (!root) return [];
    const prefixToNs = new Map<string, string>();
    const tagNames: string[] = [];
    visit(root, (n) => {
      if (n.type === "Attribute") {
        const name = n.childForFieldName("name") ?? n.namedChild(0);
        const value = n.namedChild(n.namedChildCount - 1);
        if (!name || !value || name.type !== "Name" || value.type !== "AttValue") return;
        if (name.text.startsWith("xmlns:")) {
          const prefix = name.text.slice("xmlns:".length);
          const v = stripQuotes(value.text);
          if (v.startsWith(CLR_PREFIX)) {
            prefixToNs.set(prefix, v.slice(CLR_PREFIX.length).split(";")[0]);
          }
        }
      } else if (TAG_TYPES.has(n.type)) {
        const name = n.namedChild(0);
        if (name?.type === "Name" && name.text.includes(":")) tagNames.push(name.text);
      }
    });
    const values = new Set<string>();
    for (const tag of tagNames) {
      const [prefix, local] = tag.split(":", 2);
      const ns = prefixToNs.get(prefix);
      if (ns && local) values.add(`${ns}.${local}`);
    }
    const facts: Fact[] = [];
    for (const value of [...values].sort()) facts.push({ file, value });
    return facts;
  },
};
```

`builtins/razor.ts`:

```ts
import type { Fact } from "../facts.js";
import type { BuiltinProvider, WarnFn } from "./types.js";

const USING_RE = /^\s*@using\s+([\w.]+)/;
const INJECT_RE = /^\s*@inject\s+(\S+)\s+\S+/;
const TAG_RE = /<([A-Z][A-Za-z0-9]*)[\s/>]/g;

function baseName(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? path : path.slice(slash + 1);
}

function dirName(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "" : path.slice(0, slash + 1);
}

export const razorUsingDirectiveProvider: BuiltinProvider = {
  name: "razor.usingDirective",
  extensions: [".razor"],
  languageId: null,
  collect(file, source) {
    const facts: Fact[] = [];
    for (const line of source.split(/\r?\n/)) {
      const m = USING_RE.exec(line);
      if (m) facts.push({ file, namespace: m[1] });
    }
    return facts;
  },
};

export const razorComponentDeclProvider: BuiltinProvider = {
  name: "razor.componentDecl",
  extensions: [".razor"],
  languageId: null,
  collect(file) {
    const base = baseName(file);
    if (base.startsWith("_")) return [];
    return [{ file, name: base.replace(/\.razor$/i, "") }];
  },
  finalize(own, _all, warn) {
    const byName = new Map<string, Fact[]>();
    for (const f of own) {
      const list = byName.get(f.name) ?? [];
      list.push(f);
      byName.set(f.name, list);
    }
    const out: Fact[] = [];
    for (const [name, list] of byName) {
      if (list.length === 1) out.push(list[0]);
      else warn(`razor.componentDecl: component name '${name}' is ambiguous (${list.length} files) — dropped`);
    }
    return out;
  },
};

export const razorComponentTagProvider: BuiltinProvider = {
  name: "razor.componentTag",
  extensions: [".razor"],
  languageId: null,
  collect(file, source) {
    const names = new Set<string>();
    for (const m of source.matchAll(TAG_RE)) names.add(m[1]);
    return [...names].sort().map((name) => ({ file, name }));
  },
};

function usingsForFile(file: string, usingTable: Fact[]): string[] {
  const result: string[] = [];
  for (const u of usingTable) {
    const isImports = baseName(u.file) === "_Imports.razor";
    // Eigene Direktiven immer; _Imports.razor gilt für sein Verzeichnis und alles darunter.
    if (u.file === file || (isImports && file.startsWith(dirName(u.file)))) {
      result.push(u.namespace);
    }
  }
  return result;
}

function resolveInject(
  typeName: string,
  usings: string[],
  fqnIndex: Set<string>,
  shortIndex: Map<string, string[]>,
  file: string,
  warn: WarnFn,
): string | null {
  if (typeName.includes(".")) {
    if (fqnIndex.has(typeName)) return typeName;
    warn(`razor.inject: ${file}: qualified type '${typeName}' not found — dropped`);
    return null;
  }
  const viaUsings = [
    ...new Set(usings.map((u) => `${u}.${typeName}`).filter((c) => fqnIndex.has(c))),
  ];
  if (viaUsings.length === 1) return viaUsings[0];
  const short = shortIndex.get(typeName) ?? [];
  if (short.length === 1) return short[0];
  warn(
    `razor.inject: ${file}: type '${typeName}' ${short.length === 0 ? "not resolvable" : "ambiguous"} — dropped`,
  );
  return null;
}

export const razorInjectProvider: BuiltinProvider = {
  name: "razor.inject",
  extensions: [".razor"],
  languageId: null,
  dependsOn: ["csharp.classFqn", "razor.usingDirective"],
  collect(file, source) {
    const facts: Fact[] = [];
    for (const line of source.split(/\r?\n/)) {
      const m = INJECT_RE.exec(line);
      if (!m) continue;
      const raw = m[1];
      const idx = raw.indexOf("<");
      facts.push({ file, typeName: idx === -1 ? raw : raw.slice(0, idx) });
    }
    return facts;
  },
  finalize(own, all, warn) {
    const classTable = all.get("csharp.classFqn") ?? [];
    const usingTable = all.get("razor.usingDirective") ?? [];
    const fqnIndex = new Set(classTable.map((f) => f.value));
    const shortIndex = new Map<string, string[]>();
    for (const f of classTable) {
      const list = shortIndex.get(f.name) ?? [];
      list.push(f.value);
      shortIndex.set(f.name, list);
    }
    const out: Fact[] = [];
    for (const f of own) {
      const usings = usingsForFile(f.file, usingTable);
      const typeFqn = resolveInject(f.typeName, usings, fqnIndex, shortIndex, f.file, warn);
      if (typeFqn) out.push({ file: f.file, typeName: f.typeName, typeFqn });
    }
    return out;
  },
};
```

`builtins/index.ts`:

```ts
import type { BuiltinProvider } from "./types.js";
import {
  csharpClassFqnProvider,
  csharpMethodDeclProvider,
  csharpRegistrationProvider,
} from "./csharp.js";
import { xamlTypeUsageProvider } from "./xaml.js";
import {
  razorUsingDirectiveProvider,
  razorComponentDeclProvider,
  razorComponentTagProvider,
  razorInjectProvider,
} from "./razor.js";

export type { BuiltinProvider, WarnFn } from "./types.js";

export const builtinProviders: BuiltinProvider[] = [
  csharpClassFqnProvider,
  csharpMethodDeclProvider,
  csharpRegistrationProvider,
  xamlTypeUsageProvider,
  razorUsingDirectiveProvider,
  razorComponentDeclProvider,
  razorComponentTagProvider,
  razorInjectProvider,
];

export function builtinProviderMap(): Map<string, BuiltinProvider> {
  return new Map(builtinProviders.map((p) => [p.name, p]));
}
```

Hinweis zur `Attribute`-Kindstruktur in `xaml.ts`: laut `node-types.json` hat `Attribute` die benannten Kinder `Name` und `AttValue` (in dieser Reihenfolge); falls `childForFieldName("name")` in dieser Grammatik nichts liefert, greift der `namedChild(0)`-Fallback im Code oben.

- [ ] **Step 4: Tests grün**

Run: `pnpm --filter @understand-anything/core test -- xaml-razor-builtins`
Expected: PASS (6 Tests).

- [ ] **Step 5: Lint + Commit**

```bash
pnpm lint
git add understand-anything-plugin/packages/core/src/linker
git commit -m "feat(core): xaml and razor builtin fact providers plus registry"
```

---

### Task 7: Join-Engine, Apply-Prioritätslogik, Orchestrierung und core-Export

**Files:**
- Create: `understand-anything-plugin/packages/core/src/linker/engine.ts`
- Create: `understand-anything-plugin/packages/core/src/linker/apply.ts`
- Create: `understand-anything-plugin/packages/core/src/linker/index.ts`
- Modify: `understand-anything-plugin/packages/core/package.json` (`exports`: neuer Subpath `./linker`)
- Test: `understand-anything-plugin/packages/core/src/linker/__tests__/engine.test.ts`

**Interfaces:**
- Consumes: `LinkRule`/`CONDITION_RE`/`isBuiltinSource` (Task 3), `Fact`/`compileQuery`/`collectQueryFacts` (Task 4), `builtinProviders`/`builtinProviderMap` (Task 6), `builtinLanguageConfigs` (Task 2), `loadRuleDirs` (Task 3).
- Produces:
  - `engine.ts`: `interface CandidateEdge { source: string; target: string; type: string; direction: string; confidence: number; ruleId: string; evidence?: string }` (source/target sind fertige `file:`-Knoten-IDs); `evaluateRule(rule: LinkRule, tables: Map<string, Fact[]>): CandidateEdge[]`.
  - `apply.ts`: `applyCandidates(graph: { nodes: Array<{ id: string }>; edges: Array<Record<string, unknown>> }, candidates: CandidateEdge[], warn: (m: string) => void): { added: number; upgraded: number; skippedEdges: number }`.
  - `index.ts`: `interface LinkReport { rules: number; files: number; added: number; upgraded: number; skippedRules: number; skippedEdges: number; warnings: string[] }`; `applyLinkRules(graph, opts: { ruleDirs: string[]; projectRoot: string }): Promise<LinkReport>`; Re-Exports von `LinkRuleSchema`, `loadRuleDirs`, `builtinProviders`. **Task 8 ruft genau `applyLinkRules` über den Subpath `@understand-anything/core/linker` auf.**

- [ ] **Step 1: Failing Tests schreiben** — `engine.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { LinkRuleSchema } from "../rule-schema.js";
import { evaluateRule } from "../engine.js";
import { applyCandidates } from "../apply.js";
import type { Fact } from "../facts.js";

const RULE = LinkRuleSchema.parse({
  id: "wpf.event-handler",
  confidence: 0.9,
  edge: { type: "calls" },
  facts: {
    xClass: { builtin: "b1" },
    attr: { builtin: "b2" },
    method: { builtin: "b3" },
  },
  link: {
    where: [
      "attr.file == xClass.file",
      "method.classFqn == xClass.value",
      "method.name == attr.value",
    ],
    source: "attr.file",
    target: "method.file",
    evidence: '{attr.name}="{attr.value}" in {xClass.value}',
  },
});

function tables(x: Record<string, Fact[]>) {
  return new Map(Object.entries(x));
}

describe("evaluateRule", () => {
  it("evaluates a three-fact join and interpolates evidence", () => {
    const result = evaluateRule(RULE, tables({
      xClass: [{ file: "V.xaml", value: "Demo.Main" }],
      attr: [
        { file: "V.xaml", name: "Loaded", value: "OnLoaded" },
        { file: "V.xaml", name: "Title", value: "Hello" },
        { file: "Other.xaml", name: "Loaded", value: "OnLoaded" },
      ],
      method: [{ file: "V.xaml.cs", classFqn: "Demo.Main", name: "OnLoaded" }],
    }));
    expect(result).toEqual([
      {
        source: "file:V.xaml",
        target: "file:V.xaml.cs",
        type: "calls",
        direction: "forward",
        confidence: 0.9,
        ruleId: "wpf.event-handler",
        evidence: 'Loaded="OnLoaded" in Demo.Main',
      },
    ]);
  });

  it("never matches on missing fields", () => {
    const result = evaluateRule(RULE, tables({
      xClass: [{ file: "V.xaml" }], // kein value-Feld
      attr: [{ file: "V.xaml", name: "Loaded", value: "OnLoaded" }],
      method: [{ file: "V.xaml.cs", name: "OnLoaded" }], // kein classFqn
    }));
    expect(result).toEqual([]);
  });

  it("deduplicates multiple matches onto the same source/target pair", () => {
    const result = evaluateRule(RULE, tables({
      xClass: [{ file: "V.xaml", value: "Demo.Main" }],
      attr: [
        { file: "V.xaml", name: "Loaded", value: "OnLoaded" },
        { file: "V.xaml", name: "Click", value: "OnLoaded" },
      ],
      method: [{ file: "V.xaml.cs", classFqn: "Demo.Main", name: "OnLoaded" }],
    }));
    expect(result).toHaveLength(1);
  });
});

describe("applyCandidates", () => {
  function graphWith(edges: Array<Record<string, unknown>>) {
    return {
      nodes: [{ id: "file:a.xaml" }, { id: "file:a.xaml.cs" }],
      edges,
    };
  }
  const CAND = {
    source: "file:a.xaml",
    target: "file:a.xaml.cs",
    type: "calls",
    direction: "forward",
    confidence: 0.9,
    ruleId: "wpf.event-handler",
    evidence: "e",
  };
  const warnings: string[] = [];
  const warn = (m: string) => warnings.push(m);

  it("appends a new edge with origin rule and weight 1.0", () => {
    const g = graphWith([]);
    const stats = applyCandidates(g, [CAND], warn);
    expect(stats).toEqual({ added: 1, upgraded: 0, skippedEdges: 0 });
    expect(g.edges[0]).toEqual({
      source: "file:a.xaml",
      target: "file:a.xaml.cs",
      type: "calls",
      direction: "forward",
      weight: 1.0,
      origin: "rule",
      ruleId: "wpf.event-handler",
      confidence: 0.9,
      evidence: "e",
    });
  });

  it("upgrades llm and origin-less edges, keeps description, matches across directions", () => {
    for (const origin of ["llm", undefined, null]) {
      const g = graphWith([
        {
          source: "file:a.xaml",
          target: "file:a.xaml.cs",
          type: "calls",
          direction: "backward",
          weight: 0.5,
          description: "keep me",
          ...(origin !== undefined ? { origin } : {}),
        },
      ]);
      const stats = applyCandidates(g, [CAND], warn);
      expect(stats).toEqual({ added: 0, upgraded: 1, skippedEdges: 0 });
      expect(g.edges[0].origin).toBe("rule");
      expect(g.edges[0].ruleId).toBe("wpf.event-handler");
      expect(g.edges[0].confidence).toBe(0.9);
      expect(g.edges[0].description).toBe("keep me");
      expect(g.edges[0].direction).toBe("backward"); // Upgrade dreht nichts
      expect(g.edges[0].weight).toBe(0.5);
    }
  });

  it("leaves structural, manual and rule edges untouched (first rule wins)", () => {
    for (const origin of ["structural", "manual", "rule"]) {
      const g = graphWith([
        { source: "file:a.xaml", target: "file:a.xaml.cs", type: "calls", direction: "forward", weight: 1.0, origin, ruleId: "other" },
      ]);
      const stats = applyCandidates(g, [CAND], warn);
      expect(stats).toEqual({ added: 0, upgraded: 0, skippedEdges: 0 });
      expect(g.edges[0].origin).toBe(origin);
      expect(g.edges).toHaveLength(1);
    }
  });

  it("skips candidates referencing unknown nodes with a warning", () => {
    const g = graphWith([]);
    const before = warnings.length;
    const stats = applyCandidates(g, [{ ...CAND, target: "file:ghost.cs" }], warn);
    expect(stats).toEqual({ added: 0, upgraded: 0, skippedEdges: 1 });
    expect(warnings.length).toBe(before + 1);
    expect(g.edges).toEqual([]);
  });

  it("deduplicates identical candidates from different rules — first rule id wins", () => {
    const g = graphWith([]);
    const stats = applyCandidates(
      g,
      [{ ...CAND, ruleId: "zzz.later" }, { ...CAND, ruleId: "aaa.earlier" }],
      warn,
    );
    expect(stats).toEqual({ added: 1, upgraded: 0, skippedEdges: 0 });
    expect(g.edges[0].ruleId).toBe("aaa.earlier");
  });
});
```

- [ ] **Step 2: Tests laufen rot**

Run: `pnpm --filter @understand-anything/core test -- engine`
Expected: FAIL — Module existieren nicht.

- [ ] **Step 3: Implementierung** — `engine.ts`:

```ts
import type { LinkRule } from "./rule-schema.js";
import { CONDITION_RE } from "./rule-schema.js";
import type { Fact } from "./facts.js";

export interface CandidateEdge {
  source: string; // fertige Knoten-ID "file:<relpath>"
  target: string;
  type: string;
  direction: string;
  confidence: number;
  ruleId: string;
  evidence?: string;
}

interface Condition {
  aFact: string;
  aField: string;
  bFact: string;
  bField: string;
}

const EVIDENCE_REF = /\{([A-Za-z_]\w*)\.([A-Za-z_]\w*)\}/g;

function interpolate(template: string, binding: Map<string, Fact>): string {
  return template.replace(EVIDENCE_REF, (whole, fact: string, field: string) => {
    const value = binding.get(fact)?.[field];
    return value !== undefined ? value : whole;
  });
}

/**
 * Backtracking equality join over the rule's fact tables. Conditions are
 * checked as soon as both sides are bound, so mismatching branches are
 * pruned early. Fact tables are small (per-project fact counts), so the
 * simple strategy is deliberate — no query planner.
 */
export function evaluateRule(rule: LinkRule, tables: Map<string, Fact[]>): CandidateEdge[] {
  const names = Object.keys(rule.facts);
  const conds: Condition[] = rule.link.where.map((w) => {
    const m = CONDITION_RE.exec(w)!; // schema-validiert
    return { aFact: m[1], aField: m[2], bFact: m[3], bField: m[4] };
  });
  const sourceFact = rule.link.source.split(".")[0];
  const targetFact = rule.link.target.split(".")[0];

  const out = new Map<string, CandidateEdge>();
  const binding = new Map<string, Fact>();

  const boundConditionsHold = (): boolean =>
    conds.every((c) => {
      const a = binding.get(c.aFact);
      const b = binding.get(c.bFact);
      if (!a || !b) return true; // noch nicht beide gebunden
      const av = a[c.aField];
      const bv = b[c.bField];
      return av !== undefined && av === bv;
    });

  const extend = (i: number): void => {
    if (i === names.length) {
      const src = binding.get(sourceFact)!.file;
      const tgt = binding.get(targetFact)!.file;
      const key = `${src}|${tgt}`;
      if (!out.has(key)) {
        out.set(key, {
          source: `file:${src}`,
          target: `file:${tgt}`,
          type: rule.edge.type,
          direction: rule.edge.direction,
          confidence: rule.confidence,
          ruleId: rule.id,
          ...(rule.link.evidence !== undefined
            ? { evidence: interpolate(rule.link.evidence, binding) }
            : {}),
        });
      }
      return;
    }
    for (const fact of tables.get(names[i]) ?? []) {
      binding.set(names[i], fact);
      if (boundConditionsHold()) extend(i + 1);
    }
    binding.delete(names[i]);
  };

  extend(0);
  return [...out.values()].sort(
    (a, b) => a.source.localeCompare(b.source) || a.target.localeCompare(b.target),
  );
}
```

`apply.ts`:

```ts
import type { CandidateEdge } from "./engine.js";

export interface ApplyStats {
  added: number;
  upgraded: number;
  skippedEdges: number;
}

interface GraphLike {
  nodes: Array<{ id: string }>;
  edges: Array<Record<string, unknown>>;
}

const edgeKey = (s: unknown, t: unknown, ty: unknown) => `${s}|${t}|${ty}`;

/**
 * Insert candidate edges honouring the priority invariant
 * manual > structural > rule > llm (spec §8.2 step 6):
 * - existing edge with origin llm or missing (== null) → upgrade to rule
 * - existing edge with origin structural/manual/rule → untouched
 * - otherwise append (origin rule, weight 1.0)
 * Matching is on (source, target, type) across all direction values.
 */
export function applyCandidates(
  graph: GraphLike,
  candidates: CandidateEdge[],
  warn: (msg: string) => void,
): ApplyStats {
  const nodeIds = new Set(graph.nodes.map((n) => n.id));
  const index = new Map<string, Array<Record<string, unknown>>>();
  for (const e of graph.edges) {
    const key = edgeKey(e.source, e.target, e.type);
    const list = index.get(key) ?? [];
    list.push(e);
    index.set(key, list);
  }

  const sorted = [...candidates].sort(
    (a, b) =>
      a.ruleId.localeCompare(b.ruleId) ||
      a.source.localeCompare(b.source) ||
      a.target.localeCompare(b.target) ||
      a.type.localeCompare(b.type),
  );

  const stats: ApplyStats = { added: 0, upgraded: 0, skippedEdges: 0 };
  for (const c of sorted) {
    if (!nodeIds.has(c.source) || !nodeIds.has(c.target)) {
      stats.skippedEdges++;
      warn(`rule ${c.ruleId}: edge ${c.source} -> ${c.target} references an unknown node — skipped`);
      continue;
    }
    const key = edgeKey(c.source, c.target, c.type);
    const existing = index.get(key);
    if (existing && existing.length > 0) {
      const upgradable = existing.find((e) => e.origin == null || e.origin === "llm");
      if (upgradable) {
        upgradable.origin = "rule";
        upgradable.ruleId = c.ruleId;
        upgradable.confidence = c.confidence;
        if (c.evidence !== undefined) upgradable.evidence = c.evidence;
        stats.upgraded++;
      }
      // structural/manual/rule: untouched — first rule wins deterministically.
      continue;
    }
    const edge: Record<string, unknown> = {
      source: c.source,
      target: c.target,
      type: c.type,
      direction: c.direction,
      weight: 1.0,
      origin: "rule",
      ruleId: c.ruleId,
      confidence: c.confidence,
      ...(c.evidence !== undefined ? { evidence: c.evidence } : {}),
    };
    graph.edges.push(edge);
    index.set(key, [edge]);
    stats.added++;
  }
  return stats;
}
```

`index.ts`:

```ts
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
```

`packages/core/package.json`: im `exports`-Block einen Eintrag `"./linker"` ergänzen, der **exakt dem vorhandenen `"./schema"`-Eintrag nachgebildet** ist (gleiche Felder/Reihenfolge, Pfade auf `dist/linker/index.js` bzw. dessen Typ-Datei umgestellt). Der Subpath ist Node-only und wird vom Dashboard nicht importiert.

- [ ] **Step 4: Tests grün + Build**

Run: `pnpm --filter @understand-anything/core test -- engine`
Expected: PASS (8 Tests).
Run: `pnpm --filter @understand-anything/core build`
Expected: Build OK; `packages/core/dist/linker/index.js` existiert.

- [ ] **Step 5: Lint + Commit**

```bash
pnpm lint
git add understand-anything-plugin/packages/core/src/linker understand-anything-plugin/packages/core/package.json
git commit -m "feat(core): link rule engine with priority-aware apply and ./linker export"
```

---

### Task 8: Regel-Packs, CLI-Wrapper `apply-link-rules.mjs` und End-to-End-Tests

**Files:**
- Create: `understand-anything-plugin/rules/wpf.json`
- Create: `understand-anything-plugin/rules/razor.json`
- Create: `understand-anything-plugin/rules/dryioc.json`
- Create: `understand-anything-plugin/skills/understand/apply-link-rules.mjs`
- Test: `tests/skill/understand/test_apply_link_rules.test.mjs`

**Interfaces:**
- Consumes: `applyLinkRules(graph, { ruleDirs, projectRoot })` über `@understand-anything/core/linker` (Task 7; Fallback `packages/core/dist/linker/index.js`); die 8 builtin-Provider-Namen (Tasks 5/6). Die E2E-Tests brauchen gebautes core (`pnpm --filter @understand-anything/core build` — wie beim bestehenden `test_apply_graph_patches`-Harness).
- Produces: CLI `node apply-link-rules.mjs <graph.json> [--rules <verzeichnis>]...` (Defaults: Plugin-`rules/` + `<projektwurzel>/.understand-anything/rules/`; Projektwurzel = Graph-Pfad-Anteil vor dem Segment `.understand-anything`, sonst Graph-Verzeichnis mit Warnung). Die 7 Regeln als versionierte Pack-Dateien. Task 9 verweist auf exakt diesen CLI-Aufruf.

- [ ] **Step 1: Regel-Packs schreiben** — `understand-anything-plugin/rules/wpf.json`:

```json
[
  {
    "id": "wpf.code-behind",
    "description": "XAML x:Class <-> C# partial class (code-behind pairing)",
    "confidence": 1.0,
    "edge": { "type": "implements", "direction": "forward" },
    "facts": {
      "xClass": {
        "language": "xaml",
        "query": [
          "(Attribute (Name) @n",
          "  (#eq? @n \"x:Class\")",
          "  (AttValue) @value)"
        ],
        "transform": { "value": "stripQuotes" }
      },
      "cls": { "builtin": "csharp.classFqn" }
    },
    "link": {
      "where": ["cls.value == xClass.value"],
      "source": "cls.file",
      "target": "xClass.file",
      "evidence": "x:Class={xClass.value}"
    }
  },
  {
    "id": "wpf.event-handler",
    "description": "XAML attribute value naming a method of the x:Class type",
    "confidence": 0.9,
    "edge": { "type": "calls", "direction": "forward" },
    "facts": {
      "xClass": {
        "language": "xaml",
        "query": [
          "(Attribute (Name) @n",
          "  (#eq? @n \"x:Class\")",
          "  (AttValue) @value)"
        ],
        "transform": { "value": "stripQuotes" }
      },
      "attr": {
        "language": "xaml",
        "query": [
          "(Attribute (Name) @name",
          "  (AttValue) @value)"
        ],
        "transform": { "value": "stripQuotes" }
      },
      "method": { "builtin": "csharp.methodDecl" }
    },
    "link": {
      "where": [
        "attr.file == xClass.file",
        "method.classFqn == xClass.value",
        "method.name == attr.value"
      ],
      "source": "attr.file",
      "target": "method.file",
      "evidence": "{attr.name}=\"{attr.value}\" in {xClass.value}"
    }
  },
  {
    "id": "wpf.xmlns-viewmodel",
    "description": "Prefixed type usage via clr-namespace xmlns mapping",
    "confidence": 0.8,
    "edge": { "type": "depends_on", "direction": "forward" },
    "facts": {
      "usage": { "builtin": "xaml.typeUsage" },
      "cls": { "builtin": "csharp.classFqn" }
    },
    "link": {
      "where": ["cls.value == usage.value"],
      "source": "usage.file",
      "target": "cls.file",
      "evidence": "uses {usage.value} in markup"
    }
  }
]
```

`understand-anything-plugin/rules/razor.json`:

```json
[
  {
    "id": "razor.inject",
    "description": "@inject directive to the declaring C# file",
    "confidence": 0.9,
    "edge": { "type": "depends_on", "direction": "forward" },
    "facts": {
      "inj": { "builtin": "razor.inject" },
      "cls": { "builtin": "csharp.classFqn" }
    },
    "link": {
      "where": ["cls.value == inj.typeFqn"],
      "source": "inj.file",
      "target": "cls.file",
      "evidence": "@inject {inj.typeName}"
    }
  },
  {
    "id": "razor.component-tag",
    "description": "PascalCase component tag to the component file",
    "confidence": 0.9,
    "edge": { "type": "depends_on", "direction": "forward" },
    "facts": {
      "tag": { "builtin": "razor.componentTag" },
      "decl": { "builtin": "razor.componentDecl" }
    },
    "link": {
      "where": ["tag.name == decl.name"],
      "source": "tag.file",
      "target": "decl.file",
      "evidence": "<{tag.name}>"
    }
  }
]
```

`understand-anything-plugin/rules/dryioc.json`:

```json
[
  {
    "id": "dryioc.implements",
    "description": "Register<TService, TImpl>() proves the implementation relation",
    "confidence": 1.0,
    "edge": { "type": "implements", "direction": "forward" },
    "facts": {
      "reg": { "builtin": "csharp.registration" },
      "impl": { "builtin": "csharp.classFqn" },
      "svc": { "builtin": "csharp.classFqn" }
    },
    "link": {
      "where": ["impl.value == reg.implFqn", "svc.value == reg.serviceFqn"],
      "source": "impl.file",
      "target": "svc.file",
      "evidence": "Register<{reg.serviceFqn}, {reg.implFqn}>"
    }
  },
  {
    "id": "dryioc.registration",
    "description": "Composition root configures the registered implementation",
    "confidence": 1.0,
    "edge": { "type": "configures", "direction": "forward" },
    "facts": {
      "reg": { "builtin": "csharp.registration" },
      "impl": { "builtin": "csharp.classFqn" }
    },
    "link": {
      "where": ["impl.value == reg.implFqn"],
      "source": "reg.file",
      "target": "impl.file",
      "evidence": "registers {reg.implFqn}"
    }
  }
]
```

- [ ] **Step 2: Failing E2E-Tests schreiben** — `tests/skill/understand/test_apply_link_rules.test.mjs` (Harness-Muster von `test_apply_graph_patches.test.mjs`):

```js
import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(
  __dirname,
  '../../../understand-anything-plugin/skills/understand/apply-link-rules.mjs',
);

const FIXTURE_SOURCES = {
  'Views/MainWindow.xaml':
    '<Window x:Class="Demo.MainWindow" Loaded="OnLoaded"\n' +
    '        xmlns:vm="clr-namespace:Demo.ViewModels;assembly=Demo">\n' +
    '  <Grid><vm:MainViewModel/></Grid>\n' +
    '</Window>\n',
  'Views/MainWindow.xaml.cs':
    'namespace Demo {\n  public partial class MainWindow {\n' +
    '    void OnLoaded(object s, System.EventArgs e) { }\n  }\n}\n',
  'ViewModels/MainViewModel.cs':
    'namespace Demo.ViewModels;\npublic class MainViewModel { }\n',
  'Services/IGreeter.cs': 'namespace Demo.Services;\npublic interface IGreeter { }\n',
  'Services/Greeter.cs':
    'namespace Demo.Services;\npublic class Greeter : IGreeter { }\n',
  'Bootstrap.cs':
    'using Demo.Services;\nnamespace Demo {\n  public class Bootstrap {\n' +
    '    void Init(dynamic container) { container.Register<IGreeter, Greeter>(); }\n  }\n}\n',
  'Pages/_Imports.razor': '@using Demo.Services\n',
  'Pages/Hello.razor': '@inject IGreeter Greeter\n<h1>hi</h1>\n',
  'Pages/Index.razor': '<div><Hello /></div>\n',
};

function fileNode(rel) {
  return {
    id: `file:${rel}`, type: 'file', name: rel.split('/').pop(),
    summary: 's', tags: [], complexity: 'simple',
  };
}

function makeFixtureProject({ edges = [], dropNodes = [], localRules = null } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'ua-alr-test-'));
  for (const [rel, content] of Object.entries(FIXTURE_SOURCES)) {
    mkdirSync(join(root, dirname(rel)), { recursive: true });
    writeFileSync(join(root, rel), content, 'utf-8');
  }
  const uaDir = join(root, '.understand-anything');
  mkdirSync(uaDir, { recursive: true });
  const nodes = Object.keys(FIXTURE_SOURCES)
    .filter((rel) => !dropNodes.includes(rel))
    .map(fileNode);
  const graph = {
    version: '1.0.0',
    project: {
      name: 'p', languages: [], frameworks: [], description: '',
      analyzedAt: '2026-01-01T00:00:00Z', gitCommitHash: 'abc',
    },
    nodes, edges, layers: [], tour: [],
  };
  const graphPath = join(uaDir, 'knowledge-graph.json');
  writeFileSync(graphPath, JSON.stringify(graph, null, 2) + '\n', 'utf-8');
  if (localRules) {
    const rulesDir = join(uaDir, 'rules');
    mkdirSync(rulesDir, { recursive: true });
    for (const [name, content] of Object.entries(localRules)) {
      writeFileSync(
        join(rulesDir, name),
        typeof content === 'string' ? content : JSON.stringify(content, null, 2),
        'utf-8',
      );
    }
  }
  return { root, graphPath };
}

function runScript(graphPath, extraArgs = []) {
  const result = spawnSync('node', [SCRIPT, graphPath, ...extraArgs], { encoding: 'utf-8' });
  let graph = null;
  try { graph = JSON.parse(readFileSync(graphPath, 'utf-8')); } catch { /* hard failure */ }
  return { status: result.status, stderr: result.stderr, stdout: result.stdout, graph };
}

function ruleEdges(graph, ruleId) {
  return graph.edges.filter((e) => e.ruleId === ruleId);
}

describe('apply-link-rules.mjs (end-to-end, default plugin packs)', () => {
  it('fires every one of the seven pack rules exactly once on the fixture project', () => {
    const { graphPath } = makeFixtureProject();
    const { status, stderr, graph } = runScript(graphPath);
    expect(status).toBe(0);
    expect(stderr).toContain('added=7');
    const expectations = [
      ['wpf.code-behind', 'file:Views/MainWindow.xaml.cs', 'file:Views/MainWindow.xaml', 'implements', 1.0],
      ['wpf.event-handler', 'file:Views/MainWindow.xaml', 'file:Views/MainWindow.xaml.cs', 'calls', 0.9],
      ['wpf.xmlns-viewmodel', 'file:Views/MainWindow.xaml', 'file:ViewModels/MainViewModel.cs', 'depends_on', 0.8],
      ['razor.inject', 'file:Pages/Hello.razor', 'file:Services/IGreeter.cs', 'depends_on', 0.9],
      ['razor.component-tag', 'file:Pages/Index.razor', 'file:Pages/Hello.razor', 'depends_on', 0.9],
      ['dryioc.implements', 'file:Services/Greeter.cs', 'file:Services/IGreeter.cs', 'implements', 1.0],
      ['dryioc.registration', 'file:Bootstrap.cs', 'file:Services/Greeter.cs', 'configures', 1.0],
    ];
    for (const [ruleId, source, target, type, confidence] of expectations) {
      const edges = ruleEdges(graph, ruleId);
      expect(edges, ruleId).toHaveLength(1);
      expect(edges[0]).toMatchObject({ source, target, type, confidence, origin: 'rule', weight: 1.0 });
      expect(edges[0].evidence).toBeTruthy();
    }
  });

  it('is byte-identical on the second run (idempotence)', () => {
    const { graphPath } = makeFixtureProject();
    expect(runScript(graphPath).status).toBe(0);
    const first = readFileSync(graphPath, 'utf-8');
    expect(runScript(graphPath).status).toBe(0);
    expect(readFileSync(graphPath, 'utf-8')).toBe(first);
  });

  it('upgrades an existing llm edge instead of duplicating, leaves manual edges alone', () => {
    const { graphPath } = makeFixtureProject({
      edges: [
        { source: 'file:Services/Greeter.cs', target: 'file:Services/IGreeter.cs', type: 'implements', direction: 'forward', weight: 0.6, origin: 'llm', description: 'guessed' },
        { source: 'file:Bootstrap.cs', target: 'file:Services/Greeter.cs', type: 'configures', direction: 'forward', weight: 1.0, origin: 'manual', ruleId: 'patch.json' },
      ],
    });
    const { stderr, graph } = runScript(graphPath);
    expect(stderr).toContain('upgraded=1');
    expect(stderr).toContain('added=5');
    const upgraded = ruleEdges(graph, 'dryioc.implements')[0];
    expect(upgraded).toMatchObject({ origin: 'rule', description: 'guessed', weight: 0.6 });
    const manual = graph.edges.find((e) => e.origin === 'manual');
    expect(manual.ruleId).toBe('patch.json');
  });

  it('skips edges whose nodes are missing from the graph, with a warning', () => {
    const { graphPath } = makeFixtureProject({ dropNodes: ['Services/IGreeter.cs'] });
    const { status, stderr, graph } = runScript(graphPath);
    expect(status).toBe(0);
    expect(stderr).toContain('unknown node');
    expect(ruleEdges(graph, 'razor.inject')).toHaveLength(0);
    expect(ruleEdges(graph, 'dryioc.implements')).toHaveLength(0);
  });

  it('loads project-local rules and lets them override pack rules by id', () => {
    const { graphPath } = makeFixtureProject({
      localRules: {
        'local.json': [
          {
            id: 'wpf.code-behind',
            description: 'override: disabled',
            enabled: false,
            confidence: 1.0,
            edge: { type: 'implements' },
            facts: { cls: { builtin: 'csharp.classFqn' } },
            link: { where: ['cls.value == cls.value'], source: 'cls.file', target: 'cls.file' },
          },
        ],
      },
    });
    const { stderr, graph } = runScript(graphPath);
    expect(stderr).toContain('overridden');
    expect(ruleEdges(graph, 'wpf.code-behind')).toHaveLength(0);
    expect(stderr).toContain('added=6');
  });

  it('skips a defective rule file with a warning and keeps going', () => {
    const { graphPath } = makeFixtureProject({ localRules: { 'broken.json': '{ nope' } });
    const { status, stderr } = runScript(graphPath);
    expect(status).toBe(0);
    expect(stderr).toContain('invalid JSON');
    expect(stderr).toContain('added=7');
  });

  it('skips rules whose language has no grammar, with a warning (spec §8.6 degradation path)', () => {
    const { graphPath } = makeFixtureProject({
      localRules: {
        'nolang.json': {
          id: 'x.nolang',
          confidence: 1.0,
          edge: { type: 'calls' },
          facts: { f: { language: 'nolang', query: ['(x) @a'] } },
          link: { where: ['f.file == f.file'], source: 'f.file', target: 'f.file' },
        },
      },
    });
    const { status, stderr } = runScript(graphPath);
    expect(status).toBe(0);
    expect(stderr).toContain("language 'nolang'");
    expect(stderr).toContain('skippedRules=1');
    expect(stderr).toContain('added=7');
  });

  it('explicit --rules replaces both defaults', () => {
    const { root, graphPath } = makeFixtureProject();
    const emptyDir = join(root, 'empty-rules');
    mkdirSync(emptyDir);
    const { status, stderr, graph } = runScript(graphPath, ['--rules', emptyDir]);
    expect(status).toBe(0);
    expect(stderr).toContain('rules=0');
    expect(graph.edges).toEqual([]);
  });

  it('degrades to a warning no-op when core is not loadable (script copied out of the plugin)', () => {
    const { root, graphPath } = makeFixtureProject();
    const orphan = join(root, 'orphan');
    mkdirSync(orphan, { recursive: true });
    const copied = join(orphan, 'apply-link-rules.mjs');
    cpSync(SCRIPT, copied);
    const before = readFileSync(graphPath, 'utf-8');
    const result = spawnSync('node', [copied, graphPath], { encoding: 'utf-8' });
    expect(result.status).toBe(0);
    expect(result.stderr).toContain('cannot load @understand-anything/core');
    expect(readFileSync(graphPath, 'utf-8')).toBe(before);
  });
});
```

- [ ] **Step 3: Tests laufen rot**

Run: `pnpm --filter @understand-anything/core build && pnpm vitest run tests/skill/understand/test_apply_link_rules.test.mjs`
Expected: FAIL — `apply-link-rules.mjs` existiert nicht.

- [ ] **Step 4: CLI-Wrapper implementieren** — `skills/understand/apply-link-rules.mjs`:

```js
#!/usr/bin/env node
/**
 * apply-link-rules.mjs
 *
 * Deterministic rule-based linking pass (spec 2026-07-02 §8): declarative
 * JSON rules (tree-sitter queries + builtin fact providers) add framework
 * edges with origin "rule" to the knowledge graph. Runs BEFORE
 * apply-graph-patches.mjs so manual patches keep the last word
 * (priority invariant manual > structural > rule > llm).
 *
 * Usage:
 *   node apply-link-rules.mjs <graph.json> [--rules <dir>]...
 *
 * Without --rules, two default directories are loaded: the plugin's rules/
 * directory and <projectRoot>/.understand-anything/rules/. The project root
 * is everything before the ".understand-anything" segment of the graph path.
 *
 * The graph file is rewritten in place, only on success. Logging: stderr
 * only; degradations are prefixed "Warning: apply-link-rules: ...".
 * Running the script twice produces byte-identical output (idempotence).
 */

import { dirname, join, resolve, sep } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pluginRoot = resolve(__dirname, '../..');

function warn(msg) {
  console.error(`Warning: apply-link-rules: ${msg}`);
}

function info(msg) {
  console.error(msg);
}

async function loadLinker() {
  const require = createRequire(resolve(pluginRoot, 'package.json'));
  try {
    return await import(pathToFileURL(require.resolve('@understand-anything/core/linker')).href);
  } catch {
    return await import(
      pathToFileURL(resolve(pluginRoot, 'packages/core/dist/linker/index.js')).href
    );
  }
}

function parseArgs(argv) {
  const args = { graphPath: null, ruleDirs: [] };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--rules') args.ruleDirs.push(argv[++i]);
    else rest.push(argv[i]);
  }
  args.graphPath = rest[0] ?? null;
  return args;
}

/** Everything before the ".understand-anything" path segment, if present. */
function deriveProjectRoot(graphPath) {
  const parts = resolve(graphPath).split(sep);
  const idx = parts.indexOf('.understand-anything');
  if (idx > 0) return parts.slice(0, idx).join(sep);
  return null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.graphPath) {
    warn('usage: apply-link-rules.mjs <graph.json> [--rules <dir>]...');
    process.exit(1);
  }

  let graphRaw;
  try {
    graphRaw = readFileSync(args.graphPath, 'utf-8');
  } catch (e) {
    warn(`cannot read graph file ${args.graphPath} (${e.message})`);
    process.exit(1);
  }
  let graph;
  try {
    graph = JSON.parse(graphRaw);
  } catch (e) {
    warn(`graph file is not valid JSON (${e.message})`);
    process.exit(1);
  }
  if (!Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
    warn('graph file has no nodes/edges arrays');
    process.exit(1);
  }

  let projectRoot = deriveProjectRoot(args.graphPath);
  if (projectRoot === null) {
    projectRoot = dirname(resolve(args.graphPath));
    warn(
      `graph path has no .understand-anything segment — using ${projectRoot} as project root, project-local rules skipped`,
    );
  }

  let ruleDirs = args.ruleDirs;
  if (ruleDirs.length === 0) {
    ruleDirs = [join(pluginRoot, 'rules')];
    if (deriveProjectRoot(args.graphPath) !== null) {
      ruleDirs.push(join(projectRoot, '.understand-anything', 'rules'));
    }
  }

  // Task-8-Vertrag + Phase-②-Re-Review-Lehre: try/catch NUR ums Laden.
  let linker = null;
  try {
    linker = await loadLinker();
  } catch (e) {
    warn(`cannot load @understand-anything/core (${e.message}) — link step skipped`);
  }

  let report = null;
  if (linker) {
    report = await linker.applyLinkRules(graph, { ruleDirs, projectRoot });
    for (const w of report.warnings) warn(w);
    writeFileSync(args.graphPath, JSON.stringify(graph, null, 2) + '\n', 'utf-8');
  }

  const r = report ?? { rules: 0, files: 0, added: 0, upgraded: 0, skippedRules: 0, skippedEdges: 0 };
  info(
    `apply-link-rules: rules=${r.rules} files=${r.files} added=${r.added} ` +
      `upgraded=${r.upgraded} skippedRules=${r.skippedRules} skippedEdges=${r.skippedEdges}`,
  );
}

main().catch((e) => {
  warn(`unexpected failure: ${e?.stack ?? e}`);
  process.exit(1);
});
```

- [ ] **Step 5: Tests grün**

Run: `pnpm --filter @understand-anything/core build && pnpm vitest run tests/skill/understand/test_apply_link_rules.test.mjs`
Expected: PASS (9 Tests). Bei Abweichungen im Fixture-Verhalten (z. B. Event-Handler feuert doppelt wegen `Title="Hello"`) gilt: Die Regel-Semantik aus den Global Constraints ist maßgeblich — Fixture so anpassen, dass jede Regel genau einmal feuert, und die Abweichung im Report dokumentieren.

- [ ] **Step 6: Gesamtsuite + Lint + Commit**

Run: `pnpm test`
Expected: bestehende Suiten unverändert (die 3 bekannten vorbestehenden Windows-Fehler bleiben; keine neuen Fehler).

```bash
pnpm lint
git add understand-anything-plugin/rules understand-anything-plugin/skills/understand/apply-link-rules.mjs tests/skill/understand/test_apply_link_rules.test.mjs
git commit -m "feat(skill): apply-link-rules CLI with wpf, razor and dryioc rule packs"
```

---

### Task 9: Pipeline-Einbettung (SKILL.md + Auto-Update-Hook) und Hook-Cleanup-Fix

**Files:**
- Modify: `understand-anything-plugin/skills/understand/SKILL.md` (Phase 6, aktuell Schritte 1–4 ab Zeile ~580; Sprungziel Zeile ~178)
- Modify: `understand-anything-plugin/hooks/auto-update-prompt.md` (Schritt 3d ab Zeile ~229; Cleanup Zeile ~303–305)

**Interfaces:**
- Consumes: CLI-Aufruf `node <SKILL_DIR>/apply-link-rules.mjs <graph>` (Task 8); bestehender Schritt „Provenance & patches" (SKILL.md:591–600, Hook:233–242).
- Produces: dokumentierte Pipeline-Reihenfolge Linker → Patches → Validierung an beiden Hook-Punkten; Hook-Cleanup bewahrt `scan-result.json`. Reine Prompt-/Doku-Änderung, kein Code — Verifikation per Grep-Checks.

- [ ] **Step 1: SKILL.md — neuen Phase-6-Schritt 3 einfügen** (zwischen dem heutigen Schritt 2 „Write the assembled graph…" und dem heutigen Schritt 3 „Provenance & patches"):

```markdown
3. **Deterministic linking (rule packs).** Run the rule-based linker on the assembled graph. It adds framework edges (origin `rule`) from the plugin's rule packs and from `.understand-anything/rules/`, and runs before the patch step so manual patches keep the last word (priority `manual > structural > rule > llm`):

   ```bash
   node <SKILL_DIR>/apply-link-rules.mjs \
     "$PROJECT_ROOT/.understand-anything/intermediate/assembled-graph.json"
   ```

   Append every stderr line starting with `Warning:` to `$PHASE_WARNINGS`. If the script exits non-zero, append `"link step failed — graph saved without rule edges"` to `$PHASE_WARNINGS` and continue: the script rewrites the graph file only on success.
```

- [ ] **Step 2: SKILL.md — Folgeschritte renummerieren und Sprungziele fixen**

Der heutige Schritt 3 („Provenance & patches", :591) wird **4**, der heutige Schritt 4 („Check `$ARGUMENTS` for `--review` flag", :602) wird **5**. Danach **alle** Verweise prüfen (Phase-②-Lehre: der damalige Plan übersah Folgeschritt-Duplikate):

Run: `grep -n "Phase 6 step\|step 3\|step 4\|step 5" understand-anything-plugin/skills/understand/SKILL.md`

Erwartete Fixes: Zeile ~178 `jump directly to Phase 6 step 4` → `jump directly to Phase 6 step 5` (der Review-only-Pfad überspringt Assemble/Linking/Patches). Jeden weiteren Treffer einzeln beurteilen und konsistent machen; es dürfen keine zwei Schritte mit derselben Nummer existieren.

- [ ] **Step 3: Hook — Linker-Aufruf in 3d einfügen**

In `hooks/auto-update-prompt.md` Schritt 3d: **vor** dem heutigen Punkt 2 (Aufruf `apply-graph-patches.mjs`, :236) einen neuen Punkt einfügen (die self-contained `$PLUGIN_ROOT`-Resolution aus Punkt 1 gilt für beide Aufrufe; Punkt-Nummerierung von 3d entsprechend anpassen):

```markdown
2. Run the deterministic linker on the freshly written graph (before the patch step, so manual patches keep the last word):

   ```bash
   node "$PLUGIN_ROOT/skills/understand/apply-link-rules.mjs" \
     "$PROJECT_ROOT/.understand-anything/knowledge-graph.json"
   ```

   Surface every stderr `Warning:` line in the final report; on non-zero exit report it as a warning and continue (the graph file is only rewritten on success).
```

Der bisherige Punkt 2 (Patches) wird Punkt 3; nachfolgende Punkte in 3d entsprechend verschieben. Mit `grep -n "point\|Punkt\|step" understand-anything-plugin/hooks/auto-update-prompt.md` prüfen, ob Text an anderer Stelle auf „3d Punkt N" verweist, und mitziehen.

- [ ] **Step 4: Hook-Cleanup-Fix (Follow-up 1, Spec §8.5)**

Zeile ~303–305 ersetzen — statt

```bash
rm -rf $PROJECT_ROOT/.understand-anything/intermediate
```

jetzt `scan-result.json` bewahren (sie wird vom Provenance-Schritt des **nächsten** Laufs gebraucht — 3d übergibt sie an `apply-graph-patches.mjs`):

```bash
find $PROJECT_ROOT/.understand-anything/intermediate -mindepth 1 ! -name 'scan-result.json' -delete
```

Vorher per `grep -n "preserving scan-result" understand-anything-plugin/skills/understand/SKILL.md` nachsehen, wie SKILL.md dieselbe Bewahrung formuliert (issue #293), und — falls dort ein anderer Mechanismus steht — dessen Form exakt übernehmen, damit beide Abläufe identisch sind. Den erklärenden Satz über dem Befehl anpassen („preserving scan-result.json for the next incremental run").

- [ ] **Step 5: Verifikations-Greps**

```bash
grep -n "apply-link-rules" understand-anything-plugin/skills/understand/SKILL.md understand-anything-plugin/hooks/auto-update-prompt.md
grep -n "rm -rf \$PROJECT_ROOT/.understand-anything/intermediate" understand-anything-plugin/hooks/auto-update-prompt.md
```

Expected: je Datei genau ein Linker-Aufruf, positioniert vor dem Patch-Aufruf; der zweite Grep liefert **keinen** Treffer mehr.

- [ ] **Step 6: Commit**

```bash
git add understand-anything-plugin/skills/understand/SKILL.md understand-anything-plugin/hooks/auto-update-prompt.md
git commit -m "docs(skill,hook): wire apply-link-rules before patches; preserve scan-result.json in hook cleanup"
```

---

### Task 10: Integrationsmessung am Prüfstein MachineSIC + Spec-Messabsatz

**Files:**
- Read-only Prüfstein: `C:\1_Develop_\Repos\Mine\Understand-Anything\MachineSIC` (Graph: `.understand-anything/knowledge-graph.json` — **niemals in-place verändern**, Messung läuft auf einer Kopie)
- Modify: `docs/superpowers/specs/2026-07-02-deterministic-linking-design.md` (§8.6, Messabsatz anfügen)

**Interfaces:**
- Consumes: alle vorherigen Tasks (gebautes core, CLI, Packs); Messgrößen aus Spec §3/§8.6: Code-behind **9/9**, Event-Handler **> 0**, 0 veränderte `structural`/`manual`-Kanten, Idempotenz byte-identisch.
- Produces: Messabsatz in Spec §8.6 (analog §7.6): Kantenzahl je Regel-ID, Upgrade-Zähler, Stichproben-Ergebnis, Idempotenz-Beleg.

- [ ] **Step 1: Vorbereitung**

```bash
pnpm --filter @understand-anything/core build
MSIC=/c/1_Develop_/Repos/Mine/Understand-Anything/MachineSIC/.understand-anything
cp "$MSIC/knowledge-graph.json" "$MSIC/knowledge-graph.measure.json"
```

(Die Messkopie liegt bewusst **im** `.understand-anything`-Verzeichnis, damit die Projektwurzel-Ableitung des CLI auf die echten MachineSIC-Quelldateien zeigt.)

- [ ] **Step 2: Lauf 1 + Summary festhalten**

```bash
node understand-anything-plugin/skills/understand/apply-link-rules.mjs \
  "$MSIC/knowledge-graph.measure.json" 2>/tmp/alr-run1.log
tail -5 /tmp/alr-run1.log
```

Expected: Exit 0; Summary-Zeile mit `added=N upgraded=M`. Alle `Warning:`-Zeilen sichten und im Report einordnen (erwartbar: unauflösbare DryIoc-/Razor-Typen).

- [ ] **Step 3: Verteilung je Regel auswerten**

```bash
node -e '
const g = JSON.parse(require("fs").readFileSync(process.argv[1], "utf-8"));
const byRule = {};
for (const e of g.edges) if (e.origin === "rule") byRule[e.ruleId] = (byRule[e.ruleId] ?? 0) + 1;
console.log(JSON.stringify(byRule, null, 2));
const xaml = g.nodes.filter(n => typeof n.id === "string" && n.id.startsWith("file:") && n.id.toLowerCase().endsWith(".xaml"));
console.log("xamlViews:", xaml.length);
' "$MSIC/knowledge-graph.measure.json"
```

Expected: `wpf.code-behind` = Anzahl der XAML-Views (**9** laut §9-Messbasis — Messgröße 9/9); `wpf.event-handler` **> 0**. Liegt code-behind unter der View-Zahl: jede fehlende Paarung einzeln am Quelltext untersuchen (x:Class-Wert vs. deklarierte Klasse) und ehrlich im Messabsatz dokumentieren — die Zahl wird gemessen, nicht erzwungen.

- [ ] **Step 4: Invarianten prüfen (keine structural/manual-Änderung, Idempotenz)**

```bash
node -e '
const fs = require("fs");
const a = JSON.parse(fs.readFileSync(process.argv[1], "utf-8"));
const b = JSON.parse(fs.readFileSync(process.argv[2], "utf-8"));
for (const o of ["structural", "manual"]) {
  const pick = (g) => JSON.stringify(g.edges.filter((e) => e.origin === o));
  console.log(o, "unchanged:", pick(a) === pick(b));
}
' "$MSIC/knowledge-graph.json" "$MSIC/knowledge-graph.measure.json"
node understand-anything-plugin/skills/understand/apply-link-rules.mjs \
  "$MSIC/knowledge-graph.measure.json" 2>/tmp/alr-run2.log
cp "$MSIC/knowledge-graph.measure.json" /tmp/alr-after2.json
node understand-anything-plugin/skills/understand/apply-link-rules.mjs \
  "$MSIC/knowledge-graph.measure.json" 2>/dev/null
cmp "$MSIC/knowledge-graph.measure.json" /tmp/alr-after2.json && echo IDEMPOTENT
```

Expected: beide `unchanged: true`; `IDEMPOTENT`.

- [ ] **Step 5: Stichprobe**

Deterministisch jede k-te `rule`-Kante (k so, dass ≥ 8 Kanten über alle Regeln geprüft werden, mindestens 1 pro feuernder Regel) gegen die Quelldateien verifizieren: Existiert das behauptete Muster (x:Class-Attribut, Event-Attribut + Methode, Register-Aufruf, @inject, Komponenten-Tag) wirklich in beiden Dateien? Ergebnis als `N/N korrekt` (oder mit benannten Ausreißern) festhalten.

- [ ] **Step 6: Aufräumen + Spec-Messabsatz + Commit**

```bash
rm "$MSIC/knowledge-graph.measure.json"
```

In Spec §8.6 unter den Messgrößen-Aufzählungen einen Absatz `**Messergebnis (JJJJ-MM-TT):**` anfügen (Format analog §7.6): Summary-Zeile aus Lauf 1, Verteilung je Regel-ID, Code-behind-Quote (X/9), Event-Handler-Zahl, Razor-/DryIoc-Zahlen, Upgrade-Zähler, Stichproben-Quote, Idempotenz-Beleg, auffällige Warnungen mit Ursache.

```bash
git add docs/superpowers/specs/2026-07-02-deterministic-linking-design.md
git commit -m "docs: record phase 3 linker measurement on MachineSIC"
```

---

## Plan-Ende — Ausführungshinweise

- Reihenfolge strikt Task 1 → 10 (Task 2 liefert die Grammatik für 4/6; Task 7 den Export für 8; Task 8 den CLI-Aufruf für 9/10).
- Fable-Subagents gemäß User-Präferenz; Fortschritt im Ledger `.superpowers/sdd/progress.md` unter einem neuen Plan-Abschnitt führen.
- Kein Push, kein Versions-Bump (Fork-Modus `myMaster`).
- Die 3 bekannten vorbestehenden Windows-Testfehler (extract-structure Vitest-Transform, merge-recover-imports Em-Dash/cp1252, worktree-redirect /tmp-Pfade) sind **kein** Regressionssignal dieses Plans.

