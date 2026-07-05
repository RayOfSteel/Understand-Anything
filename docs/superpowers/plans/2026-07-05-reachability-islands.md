# Trigger-Erreichbarkeit & Island Research Missions — Implementierungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Jede Node-Kette im Knowledge Graph muss von einem Trigger/Entry Point aus erreichbar sein — oder wird getrackt, dem User gelistet und in budgetierten LLM-Research-Missions untersucht (Verdikt `isolated` mit Confidence ist legitim).

**Architecture:** Deterministischer Kern in `packages/core/src/reachability/` (Trigger-Regel-Schema + Loader, Regel-Anwendung, BFS mit typklassifizierter Kantensemantik, Komponenten-Clustering), Wrapper-Script `compute-reachability.mjs` nach dem Muster von `apply-link-rules.mjs`, zwei neue Agents (`trigger-census`, `island-researcher`), Orchestrierung als Phase 6.5 in `skills/understand/SKILL.md` plus Standalone-Skill `/understand-islands`. Missions schreiben ihre Kanten als **Patch-Dateien** (bestehender `apply-graph-patches.mjs`-Pfad, neues `_meta.origin`-Feld) und gelernte Trigger-Regeln in die Repo-Registry — beides überlebt Runs.

**Tech Stack:** TypeScript strict (core), Zod, Vitest, ESM `.mjs`-Scripts (Node ≥ 22), `ignore`-Package für Glob-Matching (bereits core-Dependency).

**Spec:** `docs/superpowers/specs/2026-07-05-reachability-islands-design.md`

## Global Constraints

- Node ≥ 22, pnpm ≥ 10, TypeScript strict, ESM (`"type": "module"`), Vitest.
- Scripts: stderr-only-Logging mit Präfix `Warning: <scriptname>: ...`; Graph-Datei wird nur bei Erfolg in-place neu geschrieben; zweifacher Lauf produziert byte-identischen Output (Idempotenz) — Muster von `apply-link-rules.mjs`/`apply-graph-patches.mjs` exakt übernehmen.
- Kanten-Prioritäts-Invariante: `manual > structural > rule > llm`. Mission-Kanten laufen als Patches mit `origin: "llm"` (kein neuer Origin-Enum-Wert).
- Keine neuen npm-Dependencies. Glob-Matching über das vorhandene `ignore`-Package (gitignore-Semantik).
- core-Subpath-Exporte müssen browser-safe bleiben — `node:fs` nur in Loader-Dateien, die das Dashboard nie importiert (Muster `linker/load-rules.ts`). Kein `node:crypto` (FNV-1a-Hash stattdessen).
- Pfad-Konvention: alle Pfade im Graph relativ zum Projekt-Root mit Forward-Slashes.
- Versions-Bump in den fünf Manifest-Dateien passiert erst beim Push (CLAUDE.md-Regel), NICHT in diesem Plan.
- Alle Test-/Build-Kommandos vom Repo-Root `Understand-Anything/` (dem Verzeichnis mit `pnpm-workspace.yaml`) ausführen.
- **Scope-Entscheidung (Abweichung von Spec §3.2):** Match-Typ `query` (Tree-Sitter-Queries) wird in v1 NICHT implementiert — er wird erst mit der Pack-Befüllung (Spec §9) gebraucht. v1: `glob`, `path-regex`, `symbol`. Das Zod-Schema lehnt `query` ab; Loader warnt und überspringt.

---

### Task 1: Trigger-Regel-Schema + Loader (core)

**Files:**
- Create: `understand-anything-plugin/packages/core/src/reachability/trigger-rule-schema.ts`
- Create: `understand-anything-plugin/packages/core/src/reachability/load-trigger-rules.ts`
- Create: `understand-anything-plugin/packages/core/src/reachability/index.ts`
- Modify: `understand-anything-plugin/packages/core/package.json` (exports-Block)
- Test: `understand-anything-plugin/packages/core/src/reachability/__tests__/trigger-rules.test.ts`

**Interfaces:**
- Consumes: `zod` (vorhanden), Muster aus `linker/rule-schema.ts` und `linker/load-rules.ts`.
- Produces: `TriggerRuleSchema`, `type TriggerRule`, `loadTriggerRuleDirs(dirs: string[]): { rules: TriggerRule[]; warnings: string[] }` — konsumiert von Task 3 (Anwendung) und Task 4 (Script).

- [ ] **Step 1: Failing Test schreiben**

```ts
// packages/core/src/reachability/__tests__/trigger-rules.test.ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TriggerRuleSchema } from "../trigger-rule-schema.js";
import { loadTriggerRuleDirs } from "../load-trigger-rules.js";

const VALID = {
  id: "trigger:test:scr",
  kind: "trigger",
  match: { type: "glob", pattern: "scripts/**/*.scr" },
  description: "TDM runtime executes every .scr under /scripts",
  confidence: 0.9,
  source: "user",
};

function dirWith(files: Record<string, unknown>): string {
  const d = mkdtempSync(join(tmpdir(), "ua-trig-"));
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(d, name), JSON.stringify(content, null, 2), "utf-8");
  }
  return d;
}

describe("TriggerRuleSchema", () => {
  it("accepts a valid glob rule and defaults enabled/disables", () => {
    const parsed = TriggerRuleSchema.parse(VALID);
    expect(parsed.enabled).toBe(true);
    expect(parsed.disables).toEqual([]);
  });

  it("accepts path-regex and symbol match types", () => {
    expect(
      TriggerRuleSchema.safeParse({
        ...VALID, id: "r2", match: { type: "path-regex", pattern: "\\.svc$" },
      }).success,
    ).toBe(true);
    expect(
      TriggerRuleSchema.safeParse({
        ...VALID, id: "r3",
        match: { type: "symbol", pattern: "^Main$", nodeType: "function" },
      }).success,
    ).toBe(true);
  });

  it("rejects the not-yet-supported query match type", () => {
    expect(
      TriggerRuleSchema.safeParse({
        ...VALID, id: "r4", match: { type: "query", pattern: "(class_declaration)" },
      }).success,
    ).toBe(false);
  });

  it("rejects unknown top-level keys (strict)", () => {
    expect(TriggerRuleSchema.safeParse({ ...VALID, extra: 1 }).success).toBe(false);
  });
});

describe("loadTriggerRuleDirs", () => {
  it("merges dirs in order, later id wins, disabled and disabled-by-disables dropped", () => {
    const pack = dirWith({
      "pack.json": [
        VALID,
        { ...VALID, id: "trigger:pack:noise", match: { type: "glob", pattern: "**/*.tmp" } },
      ],
    });
    const local = dirWith({
      "local.json": [
        { ...VALID, id: "trigger:test:scr", confidence: 1.0 }, // override
        { ...VALID, id: "trigger:local:kill", match: { type: "glob", pattern: "x" }, disables: ["trigger:pack:noise"] },
      ],
    });
    const { rules, warnings } = loadTriggerRuleDirs([pack, local]);
    const ids = rules.map((r) => r.id);
    expect(ids).toContain("trigger:test:scr");
    expect(ids).toContain("trigger:local:kill");
    expect(ids).not.toContain("trigger:pack:noise"); // disabled via disables
    expect(rules.find((r) => r.id === "trigger:test:scr")?.confidence).toBe(1.0);
    expect(warnings.some((w) => w.includes("overridden"))).toBe(true);
  });

  it("skips defective files/rules with warnings, never throws", () => {
    const d = mkdtempSync(join(tmpdir(), "ua-trig-bad-"));
    writeFileSync(join(d, "broken.json"), "{ not json", "utf-8");
    writeFileSync(join(d, "invalid.json"), JSON.stringify({ id: "x" }), "utf-8");
    const { rules, warnings } = loadTriggerRuleDirs([d]);
    expect(rules).toEqual([]);
    expect(warnings.length).toBe(2);
  });

  it("ignores missing directories silently", () => {
    const { rules, warnings } = loadTriggerRuleDirs([join(tmpdir(), "does-not-exist-ua")]);
    expect(rules).toEqual([]);
    expect(warnings).toEqual([]);
  });
});
```

- [ ] **Step 2: Test laufen lassen — muss fehlschlagen**

Run: `pnpm --filter @understand-anything/core exec vitest run src/reachability/__tests__/trigger-rules.test.ts`
Expected: FAIL — `Cannot find module '../trigger-rule-schema.js'`

- [ ] **Step 3: Schema implementieren**

```ts
// packages/core/src/reachability/trigger-rule-schema.ts
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
```

- [ ] **Step 4: Loader implementieren**

```ts
// packages/core/src/reachability/load-trigger-rules.ts
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
```

```ts
// packages/core/src/reachability/index.ts
export * from "./trigger-rule-schema.js";
export * from "./load-trigger-rules.js";
```

- [ ] **Step 5: Subpath-Export ergänzen**

In `packages/core/package.json` im `exports`-Block nach dem `"./linker"`-Eintrag ergänzen:

```json
"./reachability": {
  "types": "./dist/reachability/index.d.ts",
  "default": "./dist/reachability/index.js"
}
```

- [ ] **Step 6: Tests laufen lassen — müssen bestehen**

Run: `pnpm --filter @understand-anything/core exec vitest run src/reachability/__tests__/trigger-rules.test.ts`
Expected: PASS (7 Tests)

- [ ] **Step 7: Build prüfen und committen**

```bash
pnpm --filter @understand-anything/core build
git add understand-anything-plugin/packages/core
git commit -m "feat(reachability): trigger-rule schema and loader with disables support"
```

---

### Task 2: Reachability-Engine (core) + Schema-Felder

**Files:**
- Create: `understand-anything-plugin/packages/core/src/reachability/edge-semantics.ts`
- Create: `understand-anything-plugin/packages/core/src/reachability/engine.ts`
- Modify: `understand-anything-plugin/packages/core/src/reachability/index.ts` (Re-Exports)
- Modify: `understand-anything-plugin/packages/core/src/schema.ts:412-430` (`GraphNodeSchema`: zwei optionale Felder)
- Test: `understand-anything-plugin/packages/core/src/reachability/__tests__/engine.test.ts`

**Interfaces:**
- Consumes: Graph-Objekte mit `nodes: {id, type, name, filePath?, tags}[]` und `edges: {source, target, type, direction}[]` (Schema aus `schema.ts`).
- Produces (von Task 3/4 konsumiert):
  - `EDGE_TRAVERSAL: Record<string, "forward"|"containment"|"deploys"|"satellite"|"none">`
  - `SATELLITE_ATTACH: Record<string, "source"|"target">`
  - `computeReachability(graph: ReachabilityGraph, triggerIds: Set<string>): ReachabilityResult`
  - `componentId(files: string[]): string` (FNV-1a, stabil)
  - Typen: `ReachabilityStatus = "reachable"|"attached"|"isolated"|"unresolved"`, `IslandComponent { id, nodeIds, files, size, dominantCategory }`, `ReachabilityResult { statusByNode: Map<string, ReachabilityStatus>, components: IslandComponent[], onlyViaTests: string[] }`
  - Node-Schema-Felder: `reachability?: ReachabilityStatus`, `triggeredBy?: string[]`

- [ ] **Step 1: Failing Test schreiben**

```ts
// packages/core/src/reachability/__tests__/engine.test.ts
import { describe, it, expect } from "vitest";
import { computeReachability, componentId } from "../engine.js";

type N = { id: string; type: string; name: string; filePath?: string; tags: string[] };
type E = { source: string; target: string; type: string; direction: string };
const n = (id: string, over: Partial<N> = {}): N => ({
  id, type: "file", name: id, filePath: id.replace(/^file:/, ""), tags: [], ...over,
});
const e = (source: string, target: string, type: string, direction = "forward"): E =>
  ({ source, target, type, direction });
const run = (nodes: N[], edges: E[], triggers: string[]) =>
  computeReachability({ nodes, edges }, new Set(triggers));

describe("computeReachability", () => {
  it("flags a mutually-connected pair with no path from a trigger as one 2-node island", () => {
    const r = run(
      [n("file:main.ts"), n("file:a.ts"), n("file:b.ts")],
      [e("file:a.ts", "file:b.ts", "imports"), e("file:b.ts", "file:a.ts", "imports")],
      ["file:main.ts"],
    );
    expect(r.statusByNode.get("file:main.ts")).toBe("reachable");
    expect(r.statusByNode.get("file:a.ts")).toBe("unresolved");
    expect(r.components).toHaveLength(1);
    expect(r.components[0].nodeIds.sort()).toEqual(["file:a.ts", "file:b.ts"]);
    expect(r.components[0].size).toBe(2);
  });

  it("attaches satellites pointing at reachable nodes without seeding forward reach", () => {
    const r = run(
      [n("file:main.ts"), n("config:tsconfig.json", { type: "config" }), n("file:dead.ts")],
      [
        e("config:tsconfig.json", "file:main.ts", "configures"),
        e("config:tsconfig.json", "file:dead.ts", "configures"),
      ],
      ["file:main.ts"],
    );
    expect(r.statusByNode.get("config:tsconfig.json")).toBe("attached");
    // attachment must NOT make the config's other target reachable
    expect(r.statusByNode.get("file:dead.ts")).toBe("unresolved");
  });

  it("attachment is a fixpoint: doc documenting an attached config attaches too", () => {
    const r = run(
      [n("file:main.ts"), n("config:c.json", { type: "config" }), n("document:d.md", { type: "document" })],
      [
        e("config:c.json", "file:main.ts", "configures"),
        e("document:d.md", "config:c.json", "documents"),
      ],
      ["file:main.ts"],
    );
    expect(r.statusByNode.get("document:d.md")).toBe("attached");
  });

  it("contains is bidirectional: a called function makes its file reachable", () => {
    const r = run(
      [n("file:main.ts"), n("file:util.ts"), n("function:util.ts:helper", { type: "function" })],
      [
        e("file:main.ts", "function:util.ts:helper", "calls"),
        e("file:util.ts", "function:util.ts:helper", "contains"),
      ],
      ["file:main.ts"],
    );
    expect(r.statusByNode.get("file:util.ts")).toBe("reachable");
  });

  it("deploys traverses forward AND attaches backward", () => {
    const r = run(
      [n("pipeline:ci.yml", { type: "pipeline" }), n("file:app.ts"), n("file:main.ts"), n("config:Dockerfile", { type: "config" })],
      [
        e("pipeline:ci.yml", "file:app.ts", "deploys"),   // forward: reachable from CI trigger
        e("config:Dockerfile", "file:main.ts", "deploys"), // backward attach at reachable code
      ],
      ["pipeline:ci.yml", "file:main.ts"],
    );
    expect(r.statusByNode.get("file:app.ts")).toBe("reachable");
    expect(r.statusByNode.get("config:Dockerfile")).toBe("attached");
  });

  it("tested_by attaches the test, never rescues prod code reachable only via tests", () => {
    const r = run(
      [
        n("file:main.ts"), n("file:reached.ts"),
        n("file:island.ts"), n("file:x.test.ts", { tags: ["test"] }),
      ],
      [
        e("file:main.ts", "file:reached.ts", "imports"),
        e("file:reached.ts", "file:x.test.ts", "tested_by"), // test attaches
        e("file:x.test.ts", "file:island.ts", "imports"),    // island only referenced by the test
      ],
      ["file:main.ts"],
    );
    expect(r.statusByNode.get("file:x.test.ts")).toBe("attached");
    expect(r.statusByNode.get("file:island.ts")).toBe("unresolved");
    expect(r.onlyViaTests).toContain("file:island.ts");
  });

  it("multi-root: two triggers, disjoint reachable sets, zero islands", () => {
    const r = run(
      [n("file:app1.ts"), n("file:lib1.ts"), n("file:app2.ts"), n("file:lib2.ts")],
      [e("file:app1.ts", "file:lib1.ts", "imports"), e("file:app2.ts", "file:lib2.ts", "imports")],
      ["file:app1.ts", "file:app2.ts"],
    );
    expect(r.components).toHaveLength(0);
  });

  it("respects edge.direction backward (swap) and ignores weak types", () => {
    const r = run(
      [n("file:main.ts"), n("file:c.ts"), n("file:w.ts")],
      [
        e("file:c.ts", "file:main.ts", "imports", "backward"), // effectively main -> c
        e("file:main.ts", "file:w.ts", "related"),             // weak: no rescue
      ],
      ["file:main.ts"],
    );
    expect(r.statusByNode.get("file:c.ts")).toBe("reachable");
    expect(r.statusByNode.get("file:w.ts")).toBe("unresolved");
  });

  it("clusters islands via union-find over ALL edge types regardless of direction", () => {
    const r = run(
      [n("file:main.ts"), n("file:i1.ts"), n("file:i2.ts"), n("file:i3.ts")],
      [
        e("file:i1.ts", "file:i2.ts", "related"), // weak edge still groups the component
        e("file:i3.ts", "file:i1.ts", "imports"),
      ],
      ["file:main.ts"],
    );
    expect(r.components).toHaveLength(1);
    expect(r.components[0].size).toBe(3);
    expect(r.components[0].dominantCategory).toBe("ts");
  });
});

describe("componentId", () => {
  it("is stable and order-independent", () => {
    expect(componentId(["b.ts", "a.ts"])).toBe(componentId(["a.ts", "b.ts"]));
    expect(componentId(["a.ts"])).not.toBe(componentId(["b.ts"]));
    expect(componentId(["a.ts", "b.ts"])).toMatch(/^island-[0-9a-f]{8}$/);
  });
});
```

- [ ] **Step 2: Test laufen lassen — muss fehlschlagen**

Run: `pnpm --filter @understand-anything/core exec vitest run src/reachability/__tests__/engine.test.ts`
Expected: FAIL — `Cannot find module '../engine.js'`

- [ ] **Step 3: Kantensemantik implementieren**

```ts
// packages/core/src/reachability/edge-semantics.ts
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
```

- [ ] **Step 4: Engine implementieren**

```ts
// packages/core/src/reachability/engine.ts
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
```

In `packages/core/src/reachability/index.ts` ergänzen:

```ts
export * from "./edge-semantics.js";
export * from "./engine.js";
```

- [ ] **Step 5: Node-Schema erweitern**

In `packages/core/src/schema.ts` im `GraphNodeSchema` (nach `knowledgeMeta`, vor `}).passthrough()`) ergänzen:

```ts
  reachability: z.enum(["reachable", "attached", "isolated", "unresolved"]).optional(),
  triggeredBy: z.array(z.string()).optional(),
```

- [ ] **Step 6: Tests laufen lassen — müssen bestehen**

Run: `pnpm --filter @understand-anything/core exec vitest run src/reachability/`
Expected: PASS (alle Tests aus Task 1 + 2)

Run: `pnpm --filter @understand-anything/core test`
Expected: PASS — keine Regression in bestehenden core-Tests (schema.ts ist `.passthrough()`, die neuen optionalen Felder brechen nichts).

- [ ] **Step 7: Commit**

```bash
pnpm --filter @understand-anything/core build
git add understand-anything-plugin/packages/core
git commit -m "feat(reachability): BFS engine with typed edge semantics, satellite attachment, island clustering"
```

---

### Task 3: Regel-Anwendung + Starter-Pack

**Files:**
- Create: `understand-anything-plugin/packages/core/src/reachability/apply-trigger-rules.ts`
- Create: `understand-anything-plugin/rules/triggers/entry-points.json`
- Modify: `understand-anything-plugin/packages/core/src/reachability/index.ts`
- Test: `understand-anything-plugin/packages/core/src/reachability/__tests__/apply-trigger-rules.test.ts`

**Interfaces:**
- Consumes: `TriggerRule` (Task 1), `ReachabilityGraph`-Nodes (Task 2), `ignore`-Package.
- Produces: `applyTriggerRules(nodes: TaggableNode[], rules: TriggerRule[]): { taggedNodeIds: string[]; perRule: Record<string, number> }` — mutiert Nodes in-place (Tag `entry-point`, Feld `triggeredBy`). Konsumiert von Task 4.
- Starter-Pack `rules/triggers/entry-points.json`: die bisherigen Dateinamen-Heuristiken aus `agents/file-analyzer.md:214-221` als Daten.

- [ ] **Step 1: Failing Test schreiben**

```ts
// packages/core/src/reachability/__tests__/apply-trigger-rules.test.ts
import { describe, it, expect } from "vitest";
import { applyTriggerRules } from "../apply-trigger-rules.js";
import type { TriggerRule } from "../trigger-rule-schema.js";

const rule = (over: Partial<TriggerRule>): TriggerRule => ({
  id: "r", kind: "trigger", match: { type: "glob", pattern: "**/*" },
  confidence: 0.9, enabled: true, disables: [], ...over,
} as TriggerRule);

const node = (id: string, over: Record<string, unknown> = {}) => ({
  id, type: "file", name: id.split("/").pop() ?? id,
  filePath: id.replace(/^file:/, ""), tags: [] as string[], ...over,
});

describe("applyTriggerRules", () => {
  it("glob rule tags matching nodes with entry-point and records rule id", () => {
    const nodes = [node("file:scripts/run.scr"), node("file:src/lib.ts")];
    const res = applyTriggerRules(nodes, [
      rule({ id: "t:scr", match: { type: "glob", pattern: "scripts/**/*.scr" } }),
    ]);
    expect(res.taggedNodeIds).toEqual(["file:scripts/run.scr"]);
    expect(nodes[0].tags).toContain("entry-point");
    expect((nodes[0] as { triggeredBy?: string[] }).triggeredBy).toEqual(["t:scr"]);
    expect(nodes[1].tags).not.toContain("entry-point");
    expect(res.perRule["t:scr"]).toBe(1);
  });

  it("path-regex and symbol matchers work; symbol respects nodeType", () => {
    const nodes = [
      node("file:Service.svc"),
      node("function:app.cs:Main", { type: "function", name: "Main", filePath: "app.cs" }),
      node("file:Main", { name: "Main" }), // wrong nodeType for the symbol rule
    ];
    applyTriggerRules(nodes, [
      rule({ id: "t:svc", match: { type: "path-regex", pattern: "\\.svc$" } }),
      rule({ id: "t:main", match: { type: "symbol", pattern: "^Main$", nodeType: "function" } }),
    ]);
    expect(nodes[0].tags).toContain("entry-point");
    expect(nodes[1].tags).toContain("entry-point");
    expect(nodes[2].tags).not.toContain("entry-point");
  });

  it("is idempotent: re-applying adds no duplicate tags or rule ids", () => {
    const nodes = [node("file:scripts/run.scr")];
    const rules = [rule({ id: "t:scr", match: { type: "glob", pattern: "scripts/**" } })];
    applyTriggerRules(nodes, rules);
    applyTriggerRules(nodes, rules);
    expect(nodes[0].tags.filter((t) => t === "entry-point")).toHaveLength(1);
    expect((nodes[0] as { triggeredBy?: string[] }).triggeredBy).toEqual(["t:scr"]);
  });

  it("normalizes backslash paths before matching", () => {
    const nodes = [node("file:scripts\\run.scr", { filePath: "scripts\\run.scr" })];
    applyTriggerRules(nodes, [rule({ id: "t", match: { type: "glob", pattern: "scripts/**" } })]);
    expect(nodes[0].tags).toContain("entry-point");
  });
});
```

- [ ] **Step 2: Test laufen lassen — muss fehlschlagen**

Run: `pnpm --filter @understand-anything/core exec vitest run src/reachability/__tests__/apply-trigger-rules.test.ts`
Expected: FAIL — `Cannot find module '../apply-trigger-rules.js'`

- [ ] **Step 3: Implementieren**

```ts
// packages/core/src/reachability/apply-trigger-rules.ts
import ignore from "ignore";
import type { TriggerRule } from "./trigger-rule-schema.js";

export interface TaggableNode {
  id: string;
  type: string;
  name: string;
  filePath?: string;
  tags: string[];
  triggeredBy?: string[];
}

export interface TriggerApplication {
  taggedNodeIds: string[];
  perRule: Record<string, number>;
}

const norm = (p: string) => p.replace(/\\/g, "/").replace(/^\.?\//, "");

/**
 * Deterministic rule application pass (spec §3.3): matching nodes get the
 * "entry-point" tag plus rule-id provenance in `triggeredBy`. Mutates nodes
 * in place; idempotent.
 */
export function applyTriggerRules(
  nodes: TaggableNode[],
  rules: TriggerRule[],
): TriggerApplication {
  const perRule: Record<string, number> = {};
  const tagged = new Set<string>();

  const matchers = rules.map((rule) => {
    if (rule.match.type === "glob") {
      const ig = ignore().add(rule.match.pattern);
      return { rule, matches: (n: TaggableNode) => !!n.filePath && ig.ignores(norm(n.filePath)) };
    }
    if (rule.match.type === "path-regex") {
      const re = new RegExp(rule.match.pattern);
      return { rule, matches: (n: TaggableNode) => !!n.filePath && re.test(norm(n.filePath)) };
    }
    const re = new RegExp(rule.match.pattern);
    const wantType = rule.match.nodeType;
    return {
      rule,
      matches: (n: TaggableNode) => (!wantType || n.type === wantType) && re.test(n.name),
    };
  });

  for (const node of nodes) {
    for (const { rule, matches } of matchers) {
      if (!matches(node)) continue;
      if (!node.tags.includes("entry-point")) node.tags.push("entry-point");
      node.triggeredBy = node.triggeredBy ?? [];
      if (!node.triggeredBy.includes(rule.id)) {
        node.triggeredBy.push(rule.id);
        perRule[rule.id] = (perRule[rule.id] ?? 0) + 1;
      }
      tagged.add(node.id);
    }
  }
  return { taggedNodeIds: [...tagged].sort(), perRule };
}
```

In `packages/core/src/reachability/index.ts` ergänzen: `export * from "./apply-trigger-rules.js";`

Hinweis: `ignore` wird als Default-Import genutzt — exakt wie in `packages/core/src/ignore-filter.ts` (dort nachsehen und den Import-Stil übernehmen, falls er abweicht).

- [ ] **Step 4: Starter-Pack schreiben**

```json
// understand-anything-plugin/rules/triggers/entry-points.json
[
  {
    "id": "trigger:common:main-files",
    "kind": "trigger",
    "match": { "type": "path-regex", "pattern": "(^|/)(main\\.go|main\\.rs|manage\\.py|Program\\.cs|Application\\.java|config\\.ru)$" },
    "description": "Conventional application entry files (ported from file-analyzer.md heuristics). path-regex, NOT glob: the ignore package follows gitignore semantics and does not expand {a,b} braces.",
    "confidence": 0.9,
    "source": "pack:entry-points"
  },
  {
    "id": "trigger:common:index-root",
    "kind": "trigger",
    "match": { "type": "path-regex", "pattern": "^(src/)?(index|app|server|cli)\\.(ts|tsx|js|jsx|mjs|cjs)$" },
    "description": "Root-level JS/TS entry files (index/app/server/cli at repo or src root)",
    "confidence": 0.8,
    "source": "pack:entry-points"
  },
  {
    "id": "trigger:common:ci-workflows",
    "kind": "trigger",
    "match": { "type": "glob", "pattern": ".github/workflows/**/*.{yml,yaml}" },
    "description": "CI workflows are externally triggered (push/schedule/dispatch)",
    "confidence": 0.9,
    "source": "pack:entry-points"
  }
]
```

Bewusst NICHT als Regel: `__init__.py` (Barrel, kein Trigger im Erreichbarkeits-Sinn — der file-analyzer-Tag bleibt davon unberührt).

- [ ] **Step 5: Tests laufen lassen — müssen bestehen**

Run: `pnpm --filter @understand-anything/core exec vitest run src/reachability/`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
pnpm --filter @understand-anything/core build
git add understand-anything-plugin/packages/core understand-anything-plugin/rules/triggers
git commit -m "feat(reachability): deterministic trigger-rule application pass + starter pack"
```

---

### Task 4: Wrapper-Script `compute-reachability.mjs`

**Files:**
- Create: `understand-anything-plugin/skills/understand/compute-reachability.mjs`
- Test: `tests/skill/understand/test_compute_reachability.test.mjs`

**Interfaces:**
- Consumes: `@understand-anything/core/reachability` (Tasks 1–3), Graph-JSON, optionale Dateien `triggers.json`, Verdict-Dateien, Regel-Verzeichnisse.
- Produces:
  - CLI: `node compute-reachability.mjs <graph.json> [--rules <dir>]... [--triggers <file>] [--verdicts <dir>] [--max-mission-clusters 5] [--max-mission-files 15]`
  - Graph in-place aktualisiert: `node.reachability`, `node.tags` (+`entry-point`), `node.triggeredBy`.
  - `<projectRoot>/.understand-anything/islands.json` (Format unten) — persistent, von Task 8/9 gelesen.
  - stdout-Zusammenfassung: `compute-reachability: triggers=N reachable=N attached=N islands=N unresolved=N isolated=N missionsPlanned=N`
- Default-Regel-Verzeichnisse (ohne `--rules`): `<pluginRoot>/rules/triggers` und `<projectRoot>/.understand-anything/rules/triggers`.
- `triggers.json`-Format (Census-Output, Task 6): `{ "add": ["<nodeId>"], "remove": ["<nodeId>"], "notes": "<string>" }`
- Verdict-Datei-Format (Mission-Output, Task 7), eine Datei pro Mission im `--verdicts`-Verzeichnis: `{ "missionId": "m-3", "verdicts": [{ "componentId": "island-abc123", "verdict": "isolated" | "connected" | "trigger", "confidence": "high" | "medium" | "low", "reason": "<string>" }] }`
- `islands.json`-Format:

```json
{
  "version": 1,
  "updatedAt": "<ISO 8601>",
  "triggerCount": 0,
  "onlyViaTests": ["<nodeId>"],
  "missionCounter": 0,
  "components": [
    {
      "id": "island-<fnv1a8>",
      "nodeIds": ["..."], "files": ["..."], "size": 0, "dominantCategory": "ts",
      "status": "unresolved",
      "confidence": "high",
      "verdictReason": "<nur bei isolated>",
      "missionId": "<gesetzt sobald eine Mission den Cluster untersucht hat>",
      "updatedAt": "<ISO 8601>"
    }
  ],
  "resolvedComponents": [
    { "id": "island-...", "status": "connected", "missionId": "m-1", "updatedAt": "<ISO 8601>" }
  ],
  "missionPlan": [
    { "missionId": "m-4", "componentIds": ["island-..."], "files": ["..."], "fileCount": 0 }
  ]
}
```

**Verhaltensregeln (alle im Test abgedeckt):**
1. `graph.kind === "knowledge"` → Script schreibt nichts, loggt `compute-reachability: skipped (knowledge graph)` und endet mit Exit 0.
2. Trigger-Seed = Nodes mit Tag `entry-point` (nach Regel-Pass) ∪ `triggers.add` ∖ `triggers.remove`. `remove`-Einträge verlieren zusätzlich Tag + `triggeredBy` (Census-Veto schlägt Regeln).
3. Merge mit vorherigem `islands.json`: Komponente mit gleichem `id` und altem Status `isolated` behält Status/Confidence/Reason/missionId (Verdikt-Retention, Spec §5.3); `missionId` wird generell übernommen. Komponenten, die nicht mehr auftauchen, wandern mit Status `connected` nach `resolvedComponents` (sofern sie zuvor `unresolved`/`isolated` waren).
4. Verdict-Folding: `isolated`-Verdikt setzt Komponenten-Status + `reachability: "isolated"` auf allen Member-Nodes; `connected`/`trigger`-Verdikte setzen nur `missionId` (die Anbindung selbst kommt über Patches/Regeln beim Recompute; ist die Komponente dann immer noch da, bleibt sie `unresolved` mit gesetzter `missionId`).
5. `missionPlan`: nur Komponenten mit Status `unresolved` und ohne `missionId`; sortiert nach `size` absteigend; gruppiert nach erstem Pfadsegment (`files[0].split("/")[0]`), Caps `--max-mission-clusters` (Default 5) und `--max-mission-files` (Default 15) pro Mission; `missionId` fortlaufend `m-<missionCounter+1>` …, `missionCounter` wird NICHT beim Planen erhöht, sondern erst wenn ein Verdict mit dieser missionId eingeht (sonst verbrennen ungelaufene Pläne IDs — stattdessen: Plan-IDs werden bei jedem Lauf deterministisch neu ab `missionCounter+1` vergeben).
6. Node-Status-Schreibregel: `isolated` nur via Verdict; sonst `reachable`/`attached` aus der Engine und `unresolved` für Insel-Nodes.

- [ ] **Step 1: Failing Test schreiben**

```js
// tests/skill/understand/test_compute_reachability.test.mjs
import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(
  __dirname,
  '../../../understand-anything-plugin/skills/understand/compute-reachability.mjs',
);

const fileNode = (rel, tags = []) => ({
  id: `file:${rel}`, type: 'file', name: rel.split('/').pop(),
  filePath: rel, summary: 's', tags, complexity: 'simple',
});
const edge = (s, t, type) => ({
  source: `file:${s}`, target: `file:${t}`, type, direction: 'forward', weight: 0.7,
});

function makeProject({ nodes, edges, kind, localTriggerRules, triggersFile, verdicts, existingIslands } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'ua-reach-'));
  const ua = join(root, '.understand-anything');
  mkdirSync(ua, { recursive: true });
  const graph = {
    version: '1.0.0', ...(kind ? { kind } : {}),
    project: { name: 'p', languages: [], frameworks: [], description: '',
      analyzedAt: '2026-01-01T00:00:00Z', gitCommitHash: 'abc' },
    nodes, edges, layers: [], tour: [],
  };
  const graphPath = join(ua, 'knowledge-graph.json');
  writeFileSync(graphPath, JSON.stringify(graph, null, 2) + '\n', 'utf-8');
  if (localTriggerRules) {
    const rd = join(ua, 'rules', 'triggers');
    mkdirSync(rd, { recursive: true });
    writeFileSync(join(rd, 'local.json'), JSON.stringify(localTriggerRules, null, 2), 'utf-8');
  }
  if (triggersFile) writeFileSync(join(ua, 'triggers.json'), JSON.stringify(triggersFile), 'utf-8');
  if (verdicts) {
    const vd = join(ua, 'intermediate', 'mission-results');
    mkdirSync(vd, { recursive: true });
    for (const [name, v] of Object.entries(verdicts)) {
      writeFileSync(join(vd, name), JSON.stringify(v), 'utf-8');
    }
  }
  if (existingIslands) writeFileSync(join(ua, 'islands.json'), JSON.stringify(existingIslands), 'utf-8');
  return { root, ua, graphPath };
}

function run(graphPath, extra = []) {
  const res = spawnSync('node', [SCRIPT, graphPath, ...extra], { encoding: 'utf-8' });
  return { ...res, graph: JSON.parse(readFileSync(graphPath, 'utf-8')) };
}
const islands = (ua) => JSON.parse(readFileSync(join(ua, 'islands.json'), 'utf-8'));

// Baseline fixture: main.ts is a trigger via local glob rule; a<->b is an island.
const BASE = () => ({
  nodes: [fileNode('src/main.ts'), fileNode('src/a.ts'), fileNode('src/b.ts'), fileNode('src/used.ts')],
  edges: [edge('src/main.ts', 'src/used.ts', 'imports'),
          edge('src/a.ts', 'src/b.ts', 'imports'), edge('src/b.ts', 'src/a.ts', 'imports')],
  localTriggerRules: [{
    id: 'trigger:local:main', kind: 'trigger',
    match: { type: 'glob', pattern: 'src/main.ts' }, confidence: 1.0, source: 'user',
  }],
});

describe('compute-reachability.mjs', () => {
  it('tags triggers, stamps reachability, writes islands.json with the a<->b island', () => {
    const { ua, graphPath } = makeProject(BASE());
    const { status, stdout, graph } = run(graphPath);
    expect(status).toBe(0);
    expect(stdout).toMatch(/compute-reachability: triggers=1 reachable=2 attached=0 islands=1/);
    const main = graph.nodes.find((n) => n.id === 'file:src/main.ts');
    expect(main.tags).toContain('entry-point');
    expect(main.triggeredBy).toEqual(['trigger:local:main']);
    expect(main.reachability).toBe('reachable');
    expect(graph.nodes.find((n) => n.id === 'file:src/a.ts').reachability).toBe('unresolved');
    const isl = islands(ua);
    expect(isl.components).toHaveLength(1);
    expect(isl.components[0].size).toBe(2);
    expect(isl.components[0].status).toBe('unresolved');
    expect(isl.missionPlan).toHaveLength(1);
    expect(isl.missionPlan[0].missionId).toBe('m-1');
  });

  it('is idempotent: second run produces byte-identical graph', () => {
    const { graphPath } = makeProject(BASE());
    run(graphPath);
    const first = readFileSync(graphPath, 'utf-8');
    run(graphPath);
    expect(readFileSync(graphPath, 'utf-8')).toBe(first);
  });

  it('skips knowledge graphs without writing', () => {
    const { ua, graphPath } = makeProject({ ...BASE(), kind: 'knowledge' });
    const before = readFileSync(graphPath, 'utf-8');
    const { status, stdout } = run(graphPath);
    expect(status).toBe(0);
    expect(stdout).toMatch(/skipped \(knowledge graph\)/);
    expect(readFileSync(graphPath, 'utf-8')).toBe(before);
    expect(existsSync(join(ua, 'islands.json'))).toBe(false);
  });

  it('triggers.json add/remove overrides rules (census veto wins)', () => {
    const base = BASE();
    const { graphPath } = makeProject({
      ...base,
      triggersFile: { add: ['file:src/a.ts'], remove: ['file:src/main.ts'], notes: '' },
    });
    const { graph, stdout } = run(graphPath);
    expect(stdout).toMatch(/triggers=1 /);
    expect(graph.nodes.find((n) => n.id === 'file:src/a.ts').reachability).toBe('reachable');
    const main = graph.nodes.find((n) => n.id === 'file:src/main.ts');
    expect(main.reachability).toBe('unresolved');
    expect(main.tags).not.toContain('entry-point');
  });

  it('folds isolated verdicts and retains them across runs while unchanged', () => {
    const base = BASE();
    const p1 = makeProject(base);
    const r1 = run(p1.graphPath);
    const compId = islands(p1.ua).components[0].id;
    expect(r1.status).toBe(0);
    // second run with a verdict for that component
    const p2 = makeProject({
      ...base,
      verdicts: {
        'm-1.json': {
          missionId: 'm-1',
          verdicts: [{ componentId: compId, verdict: 'isolated', confidence: 'high', reason: 'dead code' }],
        },
      },
    });
    run(p2.graphPath, ['--verdicts', join(p2.ua, 'intermediate', 'mission-results')]);
    let isl = islands(p2.ua);
    expect(isl.components[0].status).toBe('isolated');
    expect(isl.components[0].confidence).toBe('high');
    expect(isl.components[0].missionId).toBe('m-1');
    expect(isl.missionCounter).toBe(1);
    const g = JSON.parse(readFileSync(p2.graphPath, 'utf-8'));
    expect(g.nodes.find((n) => n.id === 'file:src/a.ts').reachability).toBe('isolated');
    // third run WITHOUT verdicts dir: verdict retained via islands.json merge
    run(p2.graphPath);
    isl = islands(p2.ua);
    expect(isl.components[0].status).toBe('isolated');
    expect(isl.components[0].verdictReason).toBe('dead code');
    expect(isl.missionPlan).toHaveLength(0); // isolated components are never re-planned
  });

  it('a learned local rule rescues the island on recompute and archives it as connected', () => {
    const base = BASE();
    const p = makeProject(base);
    run(p.graphPath);
    expect(islands(p.ua).components).toHaveLength(1);
    // mission learns: everything under src/a* is a trigger (silly but deterministic)
    const rd = join(p.ua, 'rules', 'triggers');
    mkdirSync(rd, { recursive: true });
    writeFileSync(join(rd, 'mission-m-1.json'), JSON.stringify([{
      id: 'trigger:mission:a', kind: 'trigger',
      match: { type: 'glob', pattern: 'src/a.ts' }, confidence: 0.8, source: 'mission:m-1',
    }]), 'utf-8');
    run(p.graphPath);
    const isl = islands(p.ua);
    expect(isl.components).toHaveLength(0);
    expect(isl.resolvedComponents).toHaveLength(1);
    expect(isl.resolvedComponents[0].status).toBe('connected');
  });

  it('mission plan groups by top path segment and respects caps', () => {
    const nodes = [fileNode('src/main.ts')];
    const edges = [];
    for (let i = 0; i < 8; i++) nodes.push(fileNode(`legacy/iso${i}.ts`));
    for (let i = 0; i < 3; i++) nodes.push(fileNode(`tools/t${i}.ts`));
    const { ua, graphPath } = makeProject({ ...BASE(), nodes, edges });
    run(graphPath);
    const plan = islands(ua).missionPlan;
    // 8 legacy singletons → 2 missions (cap 5 clusters), 3 tools singletons → 1 mission
    const legacyMissions = plan.filter((m) => m.files.every((f) => f.startsWith('legacy/')));
    const toolsMissions = plan.filter((m) => m.files.every((f) => f.startsWith('tools/')));
    expect(legacyMissions).toHaveLength(2);
    expect(toolsMissions).toHaveLength(1);
    for (const m of plan) {
      expect(m.componentIds.length).toBeLessThanOrEqual(5);
      expect(m.fileCount).toBeLessThanOrEqual(15);
    }
  });
});
```

- [ ] **Step 2: Test laufen lassen — muss fehlschlagen**

Run: `pnpm exec vitest run tests/skill/understand/test_compute_reachability.test.mjs`
Expected: FAIL — Script existiert nicht (`spawnSync` liefert Fehlerstatus).

- [ ] **Step 3: Script implementieren**

```js
#!/usr/bin/env node
// understand-anything-plugin/skills/understand/compute-reachability.mjs
/**
 * compute-reachability.mjs  (spec 2026-07-05 §5)
 *
 * Deterministic trigger-reachability pass: applies trigger rules (plugin
 * packs + repo registry), seeds a BFS from entry-point nodes, attaches
 * satellites, clusters everything unreachable into island components, and
 * maintains the persistent tracking file .understand-anything/islands.json
 * (verdict retention + mission plan).
 *
 * Usage:
 *   node compute-reachability.mjs <graph.json> [--rules <dir>]...
 *     [--triggers <triggers.json>] [--verdicts <dir>]
 *     [--max-mission-clusters 5] [--max-mission-files 15]
 *
 * Without --rules, two default directories are loaded: <pluginRoot>/rules/triggers
 * and <projectRoot>/.understand-anything/rules/triggers. The graph file is
 * rewritten in place, only on success. Logging: stderr only; degradations are
 * prefixed "Warning: compute-reachability: ...". Running the script twice
 * produces byte-identical output (idempotence).
 */

import { dirname, join, resolve, sep } from 'node:path';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pluginRoot = resolve(__dirname, '../..');

const warn = (m) => console.error(`Warning: compute-reachability: ${m}`);

async function loadReachability() {
  const require = createRequire(resolve(pluginRoot, 'package.json'));
  try {
    return await import(
      pathToFileURL(require.resolve('@understand-anything/core/reachability')).href
    );
  } catch {
    return await import(
      pathToFileURL(resolve(pluginRoot, 'packages/core/dist/reachability/index.js')).href
    );
  }
}

function parseArgs(argv) {
  const args = {
    graphPath: null, ruleDirs: [], triggersPath: null, verdictsDir: null,
    maxClusters: 5, maxFiles: 15,
  };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--rules') args.ruleDirs.push(argv[++i]);
    else if (argv[i] === '--triggers') args.triggersPath = argv[++i];
    else if (argv[i] === '--verdicts') args.verdictsDir = argv[++i];
    else if (argv[i] === '--max-mission-clusters') args.maxClusters = parseInt(argv[++i], 10);
    else if (argv[i] === '--max-mission-files') args.maxFiles = parseInt(argv[++i], 10);
    else rest.push(argv[i]);
  }
  args.graphPath = rest[0] ?? null;
  return args;
}

function deriveProjectRoot(graphPath) {
  const parts = resolve(graphPath).split(sep);
  const idx = parts.indexOf('.understand-anything');
  if (idx > 0) return parts.slice(0, idx).join(sep);
  return null;
}

function readJson(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return fallback;
  }
}

function readVerdicts(dir) {
  const verdicts = new Map(); // componentId -> {verdict, confidence, reason, missionId}
  let maxMission = 0;
  if (!dir || !existsSync(dir)) return { verdicts, maxMission };
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
    const data = readJson(join(dir, f), null);
    if (!data || !Array.isArray(data.verdicts)) {
      warn(`verdict file ${f}: invalid — skipped`);
      continue;
    }
    const num = parseInt(String(data.missionId ?? '').replace(/^m-/, ''), 10);
    if (Number.isFinite(num)) maxMission = Math.max(maxMission, num);
    for (const v of data.verdicts) {
      if (!v.componentId || !v.verdict) continue;
      verdicts.set(v.componentId, { ...v, missionId: data.missionId });
    }
  }
  return { verdicts, maxMission };
}

function planMissions(components, startId, maxClusters, maxFiles) {
  const eligible = components.filter((c) => c.status === 'unresolved' && !c.missionId);
  const byPrefix = new Map();
  for (const c of eligible) {
    const prefix = (c.files[0] ?? c.nodeIds[0] ?? '').split('/')[0];
    if (!byPrefix.has(prefix)) byPrefix.set(prefix, []);
    byPrefix.get(prefix).push(c);
  }
  const plan = [];
  let next = startId;
  for (const prefix of [...byPrefix.keys()].sort()) {
    const group = byPrefix.get(prefix).sort((a, b) => b.size - a.size || a.id.localeCompare(b.id));
    let current = null;
    for (const comp of group) {
      const fits = current
        && current.componentIds.length < maxClusters
        && current.fileCount + comp.files.length <= maxFiles;
      if (!fits) {
        current = { missionId: `m-${next++}`, componentIds: [], files: [], fileCount: 0 };
        plan.push(current);
      }
      current.componentIds.push(comp.id);
      current.files.push(...comp.files);
      current.fileCount += comp.files.length;
    }
  }
  return plan;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.graphPath) {
    warn('usage: compute-reachability.mjs <graph.json> [--rules <dir>]... [--triggers <file>] [--verdicts <dir>]');
    process.exit(1);
  }

  const graph = readJson(args.graphPath, null);
  if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
    warn(`cannot read graph file ${args.graphPath}`);
    process.exit(1);
  }
  if (graph.kind === 'knowledge') {
    console.log('compute-reachability: skipped (knowledge graph)');
    return;
  }

  let projectRoot = deriveProjectRoot(args.graphPath);
  if (projectRoot === null) {
    projectRoot = dirname(resolve(args.graphPath));
    warn(`graph path has no .understand-anything segment — using ${projectRoot} as project root`);
  }
  const uaDir = join(projectRoot, '.understand-anything');

  let ruleDirs = args.ruleDirs;
  if (ruleDirs.length === 0) {
    ruleDirs = [join(pluginRoot, 'rules', 'triggers'), join(uaDir, 'rules', 'triggers')];
  }

  let core;
  try {
    core = await loadReachability();
  } catch (e) {
    warn(`cannot load @understand-anything/core (${e.message}) — reachability step skipped`);
    console.log('compute-reachability: skipped (core unavailable)');
    return;
  }

  // 1. Rules + census trigger set.
  const { rules, warnings } = core.loadTriggerRuleDirs(ruleDirs);
  for (const w of warnings) warn(w);
  core.applyTriggerRules(graph.nodes, rules);

  const triggersPath = args.triggersPath ?? join(uaDir, 'triggers.json');
  const triggersFile = existsSync(triggersPath)
    ? readJson(triggersPath, { add: [], remove: [] })
    : { add: [], remove: [] };
  const removeSet = new Set(triggersFile.remove ?? []);
  for (const node of graph.nodes) {
    if (removeSet.has(node.id)) {
      node.tags = (node.tags ?? []).filter((t) => t !== 'entry-point');
      delete node.triggeredBy;
    }
  }
  const triggerIds = new Set(
    graph.nodes.filter((n) => (n.tags ?? []).includes('entry-point')).map((n) => n.id),
  );
  for (const id of triggersFile.add ?? []) if (!removeSet.has(id)) triggerIds.add(id);

  // 2. Engine.
  const result = core.computeReachability(graph, triggerIds);

  // 3. Merge with previous islands.json + verdicts.
  const islandsPath = join(uaDir, 'islands.json');
  const previous = readJson(islandsPath, { components: [], resolvedComponents: [], missionCounter: 0 });
  const prevById = new Map((previous.components ?? []).map((c) => [c.id, c]));
  const { verdicts, maxMission } = readVerdicts(args.verdictsDir);
  const now = new Date().toISOString();

  const components = result.components.map((c) => {
    const prev = prevById.get(c.id);
    const verdict = verdicts.get(c.id);
    let status = 'unresolved';
    let extra = {};
    if (verdict && verdict.verdict === 'isolated') {
      status = 'isolated';
      extra = { confidence: verdict.confidence, verdictReason: verdict.reason, missionId: verdict.missionId };
    } else if (verdict) {
      extra = { missionId: verdict.missionId }; // connected/trigger claimed but still an island
    } else if (prev && prev.status === 'isolated') {
      status = 'isolated';
      extra = { confidence: prev.confidence, verdictReason: prev.verdictReason, missionId: prev.missionId };
    } else if (prev && prev.missionId) {
      extra = { missionId: prev.missionId };
    }
    return { ...c, status, ...extra, updatedAt: prev && prev.status === status ? prev.updatedAt : now };
  });

  const currentIds = new Set(components.map((c) => c.id));
  const resolvedComponents = [...(previous.resolvedComponents ?? [])];
  for (const prev of previous.components ?? []) {
    if (!currentIds.has(prev.id)) {
      resolvedComponents.push({ id: prev.id, status: 'connected', missionId: prev.missionId, updatedAt: now });
    }
  }

  const missionCounter = Math.max(previous.missionCounter ?? 0, maxMission);
  const missionPlan = planMissions(components, missionCounter + 1, args.maxClusters, args.maxFiles);

  // 4. Stamp node status.
  const isolatedNodes = new Set(
    components.filter((c) => c.status === 'isolated').flatMap((c) => c.nodeIds),
  );
  for (const node of graph.nodes) {
    node.reachability = isolatedNodes.has(node.id)
      ? 'isolated'
      : result.statusByNode.get(node.id) ?? 'unresolved';
  }

  // 5. Write graph + islands.json (graph first; islands.json is derived state).
  writeFileSync(args.graphPath, JSON.stringify(graph, null, 2) + '\n', 'utf-8');
  const islandsOut = {
    version: 1,
    updatedAt: now,
    triggerCount: triggerIds.size,
    onlyViaTests: result.onlyViaTests,
    missionCounter,
    components,
    resolvedComponents,
    missionPlan,
  };
  writeFileSync(islandsPath, JSON.stringify(islandsOut, null, 2) + '\n', 'utf-8');

  const counts = { reachable: 0, attached: 0, unresolved: 0, isolated: 0 };
  for (const node of graph.nodes) counts[node.reachability] = (counts[node.reachability] ?? 0) + 1;
  console.log(
    `compute-reachability: triggers=${triggerIds.size} reachable=${counts.reachable} ` +
      `attached=${counts.attached} islands=${components.length} unresolved=${counts.unresolved} ` +
      `isolated=${counts.isolated} missionsPlanned=${missionPlan.length}`,
  );
}

main().catch((e) => {
  warn(`unexpected failure: ${e?.stack ?? e}`);
  process.exit(1);
});
```

**Idempotenz-Hinweis für den Implementierer:** Der zweite Lauf muss byte-identisch sein. `updatedAt` steht NUR in `islands.json` (nie im Graph), und die Merge-Logik übernimmt `updatedAt` unverändert, wenn sich der Status einer Komponente nicht geändert hat — der Idempotenz-Test prüft deshalb nur den Graph. Das ist beabsichtigt und reicht (Muster: `apply-link-rules.mjs`).

- [ ] **Step 4: Tests laufen lassen — müssen bestehen**

Zuerst core bauen (das Script lädt `dist/`):
Run: `pnpm --filter @understand-anything/core build && pnpm exec vitest run tests/skill/understand/test_compute_reachability.test.mjs`
Expected: PASS (7 Tests)

- [ ] **Step 5: Commit**

```bash
git add understand-anything-plugin/skills/understand/compute-reachability.mjs tests/skill/understand/test_compute_reachability.test.mjs
git commit -m "feat(reachability): compute-reachability.mjs — BFS pass, islands.json tracking, mission planning"
```

---

### Task 5: `_meta.origin`-Override in `apply-graph-patches.mjs`

**Files:**
- Modify: `understand-anything-plugin/skills/understand/apply-graph-patches.mjs` (Patch-Anwendungsteil, ~Zeile 220 `edges_to_add`-Schleife und Header-Kommentar)
- Test: `tests/skill/understand/test_apply_graph_patches.test.mjs` (bestehende Datei erweitern)

**Interfaces:**
- Consumes: bestehendes Patch-Format `*.patch.json` (`_meta`, `edges_to_remove`, `edges_to_add`).
- Produces: Patches dürfen `"origin": "llm"` in `_meta` setzen; hinzugefügte Kanten tragen dann `origin: "llm"` statt `"manual"` (`ruleId` bleibt der Patch-Dateiname). Erlaubte Werte: `"manual"` (Default) und `"llm"`; alles andere → Warning + Fallback `"manual"`. Missions (Task 7) nutzen das, damit die Prioritäts-Invariante `manual > structural > rule > llm` ehrlich bleibt: Mission-Kanten sind LLM-Behauptungen, keine Menschen-Entscheidungen.

- [ ] **Step 1: Failing Test in bestehende Testdatei ergänzen**

Zuerst die bestehende Datei `tests/skill/understand/test_apply_graph_patches.test.mjs` lesen und deren Fixture-Helfer wiederverwenden. Neuen Test-Case im Stil der vorhandenen ergänzen:

```js
it('applies _meta.origin "llm" to added edges, defaults to manual otherwise', () => {
  // Fixture: graph with nodes file:a.ts and file:b.ts, patch dir containing:
  const patch = {
    _meta: { title: 'mission edges', origin: 'llm' },
    edges_to_remove: [],
    edges_to_add: [
      { source: 'file:a.ts', target: 'file:b.ts', type: 'imports', direction: 'forward', weight: 0.7 },
    ],
  };
  // ... write patch as mission-m-1.patch.json using the file's existing helpers,
  // run the script, then:
  const added = graph.edges.find((e) => e.source === 'file:a.ts' && e.target === 'file:b.ts');
  expect(added.origin).toBe('llm');
  expect(added.ruleId).toBe('mission-m-1.patch.json');
});

it('falls back to manual with a warning on an invalid _meta.origin', () => {
  // same fixture but _meta.origin: 'structural' — expect origin 'manual'
  // and stderr containing "invalid _meta.origin"
});
```

(Der Implementierer passt die zwei Cases an die tatsächlichen Helfer der Datei an — Fixture-Aufbau NICHT duplizieren.)

- [ ] **Step 2: Test laufen lassen — muss fehlschlagen**

Run: `pnpm exec vitest run tests/skill/understand/test_apply_graph_patches.test.mjs`
Expected: FAIL — `added.origin` ist `"manual"`.

- [ ] **Step 3: Script anpassen**

In `apply-graph-patches.mjs` die `edges_to_add`-Schleife (ab ~Zeile 220) erweitern. Vor der Schleife pro Patch-Datei:

```js
const ALLOWED_PATCH_ORIGINS = new Set(['manual', 'llm']);
let patchOrigin = 'manual';
const requested = data._meta?.origin;
if (requested !== undefined) {
  if (ALLOWED_PATCH_ORIGINS.has(requested)) patchOrigin = requested;
  else warn(`${fileName}: invalid _meta.origin "${requested}" — falling back to "manual"`);
}
```

und in der Kanten-Erzeugung das bisher hart codierte `origin: 'manual'` durch `origin: patchOrigin` ersetzen (die `ruleId`-Zuweisung auf den Patch-Dateinamen bleibt unverändert). Header-Kommentar des Scripts um einen Satz ergänzen: `_meta.origin: "llm"` markiert LLM-erzeugte Patches (Island-Missions).

- [ ] **Step 4: Tests laufen lassen — müssen bestehen (inkl. Bestand)**

Run: `pnpm exec vitest run tests/skill/understand/test_apply_graph_patches.test.mjs`
Expected: PASS — alle alten und beide neuen Cases.

- [ ] **Step 5: Commit**

```bash
git add understand-anything-plugin/skills/understand/apply-graph-patches.mjs tests/skill/understand/test_apply_graph_patches.test.mjs
git commit -m "feat(patches): _meta.origin override so mission patches carry origin llm"
```

---

### Task 6: Agent `trigger-census`

**Files:**
- Create: `understand-anything-plugin/agents/trigger-census.md`

**Interfaces:**
- Consumes: `scan-result.json` (Frameworks/Sprachen), `layers.json`, Graph mit provisorischen `reachability`-Feldern (erster `compute-reachability`-Lauf), provisorisches `islands.json`.
- Produces: `$PROJECT_ROOT/.understand-anything/triggers.json` (Format aus Task 4) und optional `$PROJECT_ROOT/.understand-anything/rules/triggers/census-learned.json` (Array von `TriggerRule`). Kein Graph-Write — der nächste Script-Lauf wendet beides an.

- [ ] **Step 1: Agent-Definition schreiben**

```markdown
---
name: trigger-census
description: |
  Validates and extends the knowledge graph's trigger/entry-point set after
  framework and architecture analysis. Confirms rule-pass candidates, hunts
  framework-specific triggers the patterns cannot see, and generalizes
  findings into repo-specific trigger rules.
---

# Trigger Census

You are the trigger census for a freshly analyzed codebase. A deterministic
rule pass has already tagged candidate entry points (`entry-point` tag,
`triggeredBy` rule ids) and computed provisional reachability. Your job:
make the trigger set TRUE, not just plausible — every real way this system
starts executing (app entry, HTTP route, CLI command, service, scheduled
job, queue consumer, build/installer target) should be represented.

## Inputs (provided in the dispatch prompt)

- `$PROJECT_ROOT` — absolute path of the analyzed repo
- `$GRAPH_PATH` — knowledge graph JSON (read-only for you)
- `$SCAN_RESULT` — scan-result.json (languages, frameworks, file inventory)
- `$LAYERS` — layers.json from the architecture phase
- `$ISLANDS` — provisional islands.json (the current unreachable clusters)

## Step 1 — Review candidates

Read the graph and list every node tagged `entry-point`. For each, judge:
is this genuinely a trigger (something external starts it), or a false
positive (a barrel file, an example, dead scaffolding)? False positives go
into `remove`.

## Step 2 — Hunt what patterns cannot see

Use the framework list from `$SCAN_RESULT` to search the source for
framework-specific trigger wiring the glob rules missed. Depending on the
stack, check for e.g.:

- ASP.NET: attribute routes, `MapGet/MapPost`, `Program.cs` minimal APIs, IIS/web.config wiring
- Windows: service `OnStart`, scheduled-task XML, COM registrations, installer custom actions
- WPF/WinForms: `App.xaml`/`Main` startup chains
- Node/JS: `package.json` `bin`/`scripts` targets, serverless handlers
- Python: console_scripts entry points, `__main__` blocks, celery tasks
- CI/build: pipeline definitions, MSBuild targets invoked from outside
- Message queues / event buses: consumer registrations

Judge by evidence in the source, not by filename alone. Read files before
claiming them as triggers.

## Step 3 — Generalize (mandatory question)

For EVERY trigger you confirm or find, ask: **is this a one-off, or is
there a mechanism behind it that yields a rule for the whole repo?**
(House conventions, custom plugin systems, script directories a runtime
executes, DI registrations by convention.) If a mechanism exists, emit a
trigger rule instead of N individual adds — one rule can rescue hundreds of
sibling islands deterministically.

Rule format (JSON, one array in one file; match types: `glob`,
`path-regex`, `symbol`):

    [{
      "id": "trigger:census:<short-slug>",
      "kind": "trigger",
      "match": { "type": "glob", "pattern": "scripts/**/*.scr" },
      "description": "<what the mechanism is>",
      "evidence": "<file:line where you saw the mechanism>",
      "confidence": 0.9,
      "source": "census"
    }]

## Step 4 — Sanity check against the islands

Open `$ISLANDS`. If a huge share of the graph is unreachable (e.g. > 40% of
nodes), your trigger set is almost certainly incomplete — go back to Step 2
before finishing. Large single components whose files share an obvious
purpose ("all HTTP controllers", "all report templates") usually mean one
missed mechanism → that is a rule, not N adds.

## Outputs (write files, keep your reply short)

1. `$PROJECT_ROOT/.understand-anything/triggers.json`:

       { "add": ["<nodeId>", ...], "remove": ["<nodeId>", ...], "notes": "<1-3 sentences>" }

   `add`/`remove` contain node IDs exactly as they appear in the graph.
   Individual triggers WITHOUT a generalizable mechanism go here.

2. `$PROJECT_ROOT/.understand-anything/rules/triggers/census-learned.json`
   — ONLY if you derived at least one rule (array format above).

Reply with a summary: candidates confirmed/removed, triggers added, rules
learned (with one-line rationale each). Do NOT modify the graph file.
```

- [ ] **Step 2: Round-Trip-Test des Output-Formats ergänzen**

In `tests/skill/understand/test_compute_reachability.test.mjs` einen Test ergänzen, der das dokumentierte Census-Output-Beispiel 1:1 als Fixture nutzt (Schutz gegen Format-Drift zwischen Agent-Doku und Script):

```js
it('accepts the exact output format documented in agents/trigger-census.md', () => {
  const base = BASE();
  const { ua, graphPath } = makeProject({
    ...base,
    triggersFile: { add: ['file:src/a.ts'], remove: [], notes: 'census smoke' },
    localTriggerRules: [
      ...base.localTriggerRules,
      {
        id: 'trigger:census:scr', kind: 'trigger',
        match: { type: 'glob', pattern: 'src/b.ts' },
        description: 'x', evidence: 'y', confidence: 0.9, source: 'census',
      },
    ],
  });
  const { status, stdout } = run(graphPath);
  expect(status).toBe(0);
  expect(stdout).toMatch(/islands=0/); // a via add, b via learned rule
});
```

Run: `pnpm exec vitest run tests/skill/understand/test_compute_reachability.test.mjs`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add understand-anything-plugin/agents/trigger-census.md tests/skill/understand/test_compute_reachability.test.mjs
git commit -m "feat(reachability): trigger-census agent definition + output-format round-trip test"
```

---

### Task 7: Agent `island-researcher`

**Files:**
- Create: `understand-anything-plugin/agents/island-researcher.md`

**Interfaces:**
- Consumes: eine Mission aus `islands.json.missionPlan` (missionId, componentIds, files), Graph, `$PROJECT_ROOT`-Quellcode.
- Produces (drei mögliche Artefakte, IMMER das Verdict-File):
  1. `$PROJECT_ROOT/.understand-anything/patches/mission-<missionId>.patch.json` — Kanten mit Evidence, `_meta.origin: "llm"` (Task-5-Format).
  2. `$PROJECT_ROOT/.understand-anything/rules/triggers/mission-<missionId>.json` — gelernte Trigger-Regeln.
  3. `$PROJECT_ROOT/.understand-anything/intermediate/mission-results/<missionId>.json` — Verdicts (Task-4-Format), Pflicht.

- [ ] **Step 1: Agent-Definition schreiben**

```markdown
---
name: island-researcher
description: |
  Investigates unreachable island components of the knowledge graph: hunts
  the missing inbound references in the rest of the corpus, recognizes
  overlooked trigger mechanisms, or delivers an evidence-backed "isolated"
  verdict with a confidence level.
---

# Island Researcher

You investigate one research mission: a set of island components — nodes
that are mutually connected but unreachable from every known trigger/entry
point of this codebase. For each component you must reach exactly ONE of
three outcomes. Never invent edges: every claim needs evidence you actually
saw in the source.

## Inputs (provided in the dispatch prompt)

- `$PROJECT_ROOT`, `$GRAPH_PATH`
- `$MISSION_ID` — e.g. `m-3`
- `$COMPONENTS` — JSON array: `[{ "id": "island-...", "files": [...], "nodeIds": [...] }]`
- `$TRIGGERS_SUMMARY` — the current trigger set (node ids + rule ids)

## Investigation per component

1. **Understand the island.** Read (a sample of) its files. What is this
   code? Library? Tool? Feature? Generated? Old?
2. **Hunt inbound references.** Search the REST of the corpus (exclude the
   island's own files) for:
   - file names and paths of the island (string literals, build scripts, csproj/vcxproj includes)
   - exported symbols / class names / public functions (dynamic imports, reflection, DI registrations)
   - config wiring (ini/xml/json/yaml values naming the island's files or types)
   - runtime conventions (plugin dirs, script dirs, naming-convention loading)
3. **Or: is the island itself a trigger?** A standalone tool with its own
   `main`, a scheduled script, a service — then it needs a trigger tag, not
   an inbound edge.
4. **Generalize (mandatory question).** If you found a MECHANISM (e.g. "the
   runtime executes every .scr under scripts/"), emit a trigger RULE — it
   rescues every sibling island deterministically. One-off findings stay
   one-off edges/triggers.

## Outcomes and where they go

**(a) Found inbound edges** → append to
`$PROJECT_ROOT/.understand-anything/patches/mission-$MISSION_ID.patch.json`:

    {
      "_meta": {
        "title": "island mission $MISSION_ID",
        "rationale": "<how these connections were found>",
        "origin": "llm"
      },
      "edges_to_remove": [],
      "edges_to_add": [{
        "source": "file:<referencing file>",
        "target": "file:<island file>",
        "type": "depends_on",
        "direction": "forward",
        "weight": 0.7,
        "note": "<evidence: file:line and the exact reference you saw>"
      }]
    }

Pick the edge type honestly: `imports` only for real import statements,
`calls` for seen invocations, `configures` for config wiring, `depends_on`
for dynamic/reflective references, `triggers` for schedulers/CI.

**(b) Found a trigger or mechanism** → write
`$PROJECT_ROOT/.understand-anything/rules/triggers/mission-$MISSION_ID.json`
(array of trigger rules, `"source": "mission:$MISSION_ID"`; match types
`glob`, `path-regex`, `symbol`). For a one-off trigger without a mechanism,
use verdict `trigger` below — the orchestrator folds it into triggers.json.

**(c) Genuinely isolated** → verdict with confidence:
- `high` — clear evidence (e.g. replaced by X, nothing references it, git-dead)
- `medium` — no references found, but dynamic loading cannot be ruled out
- `low` — investigation inconclusive (say why in `reason`)

## Mandatory output: the verdict file

ALWAYS write `$PROJECT_ROOT/.understand-anything/intermediate/mission-results/$MISSION_ID.json`:

    {
      "missionId": "$MISSION_ID",
      "verdicts": [{
        "componentId": "island-...",
        "verdict": "connected" | "trigger" | "isolated",
        "confidence": "high" | "medium" | "low",
        "reason": "<1-2 sentences with the decisive evidence>",
        "triggerNodeIds": ["<only for verdict trigger: node ids to add>"]
      }]
    }

One verdict per component — no component may be missing. `connected` means
you wrote patch edges for it; `trigger` means add `triggerNodeIds` to the
trigger set; `isolated` is a legitimate final result, not a failure.
Reply with a compact summary table (component → verdict → evidence).
Do NOT modify the graph file.
```

- [ ] **Step 2: Verdict-`trigger`-Folding im Script nachrüsten (Failing Test zuerst)**

Der Agent liefert bei Verdict `trigger` die `triggerNodeIds` im Verdict-File — das Script muss sie beim Folding wie `triggers.add` behandeln. Test in `test_compute_reachability.test.mjs` ergänzen:

```js
it('folds trigger verdicts: triggerNodeIds become entry points on recompute', () => {
  const base = BASE();
  const p = makeProject(base);
  run(p.graphPath);
  const compId = islands(p.ua).components[0].id;
  const vd = join(p.ua, 'intermediate', 'mission-results');
  mkdirSync(vd, { recursive: true });
  writeFileSync(join(vd, 'm-1.json'), JSON.stringify({
    missionId: 'm-1',
    verdicts: [{
      componentId: compId, verdict: 'trigger', confidence: 'high',
      reason: 'standalone tool', triggerNodeIds: ['file:src/a.ts'],
    }],
  }), 'utf-8');
  run(p.graphPath, ['--verdicts', vd]);
  const isl = islands(p.ua);
  expect(isl.components).toHaveLength(0);
  expect(isl.resolvedComponents.some((c) => c.id === compId)).toBe(true);
});
```

Run: `pnpm exec vitest run tests/skill/understand/test_compute_reachability.test.mjs`
Expected: FAIL (Insel bleibt bestehen).

- [ ] **Step 3: Script-Erweiterung**

Drei präzise Änderungen in `compute-reachability.mjs`:

**(1)** In `readVerdicts` Trigger-IDs mitsammeln — Return-Zeile und Sammellogik ersetzen:

```js
function readVerdicts(dir) {
  const verdicts = new Map(); // componentId -> {verdict, confidence, reason, missionId}
  const triggerAdds = [];
  let maxMission = 0;
  if (!dir || !existsSync(dir)) return { verdicts, triggerAdds, maxMission };
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
    const data = readJson(join(dir, f), null);
    if (!data || !Array.isArray(data.verdicts)) {
      warn(`verdict file ${f}: invalid — skipped`);
      continue;
    }
    const num = parseInt(String(data.missionId ?? '').replace(/^m-/, ''), 10);
    if (Number.isFinite(num)) maxMission = Math.max(maxMission, num);
    for (const v of data.verdicts) {
      if (!v.componentId || !v.verdict) continue;
      verdicts.set(v.componentId, { ...v, missionId: data.missionId });
      if (v.verdict === 'trigger') triggerAdds.push(...(v.triggerNodeIds ?? []));
    }
  }
  return { verdicts, triggerAdds, maxMission };
}
```

**(2)** In `main()` den `readVerdicts`-Aufruf VOR die Trigger-Seed-Berechnung ziehen (direkt nach dem `triggersFile`/`removeSet`-Block, vor `const triggerIds = ...`) und die Destrukturierung anpassen — der spätere Aufruf in Schritt 3 entfällt:

```js
  const { verdicts, triggerAdds, maxMission } = readVerdicts(args.verdictsDir);
  const triggerIds = new Set(
    graph.nodes.filter((n) => (n.tags ?? []).includes('entry-point')).map((n) => n.id),
  );
  for (const id of triggersFile.add ?? []) if (!removeSet.has(id)) triggerIds.add(id);
  for (const id of triggerAdds) if (!removeSet.has(id)) triggerIds.add(id);
```

**(3)** `triggerAdds` nach `triggers.json` zurückschreiben (direkt nach Block 2), damit der Trigger künftige Läufe ohne `--verdicts` überlebt:

```js
  if (triggerAdds.length > 0) {
    const merged = [...new Set([...(triggersFile.add ?? []), ...triggerAdds])].sort();
    writeFileSync(triggersPath, JSON.stringify({ ...triggersFile, add: merged }, null, 2) + '\n', 'utf-8');
  }
```

Die Tests aus Task 4 decken die Umstellung als Regression ab (Isolated-Folding und Retention bleiben unverändert, da `verdicts`/`maxMission` weiter im Merge-Block konsumiert werden).

- [ ] **Step 4: Tests laufen lassen — müssen bestehen**

Run: `pnpm exec vitest run tests/skill/understand/test_compute_reachability.test.mjs`
Expected: PASS (alle Cases aus Task 4, 6 und 7)

- [ ] **Step 5: Commit**

```bash
git add understand-anything-plugin/agents/island-researcher.md understand-anything-plugin/skills/understand/compute-reachability.mjs tests/skill/understand/test_compute_reachability.test.mjs
git commit -m "feat(reachability): island-researcher agent + trigger-verdict folding"
```

---

### Task 8: Phase 6.5 in `/understand` (SKILL.md)

**Files:**
- Modify: `understand-anything-plugin/skills/understand/SKILL.md` — Options-Block (~Zeile 13-20), neue Phase zwischen `## Phase 6 — REVIEW` (endet ~Zeile 743) und `## Phase 7 — SAVE` (~Zeile 747), Report-Zusammenfassung in Phase 7 Schritt 5 (~Zeile 802-810), Cleanup-Hinweis Phase 7 Schritt 4.

**Interfaces:**
- Consumes: `compute-reachability.mjs` (Task 4/7), Agents `trigger-census` (Task 6) und `island-researcher` (Task 7), `apply-graph-patches.mjs` (Task 5).
- Produces: Orchestrierungstext; `--skip-islands`-Option; Missions-Loop mit 10er-Budget + AskUserQuestion-Checkpoint.

- [ ] **Step 1: Options-Block ergänzen**

Nach dem `--test`-Bullet einfügen:

```markdown
  - `--skip-islands` — Skip Phase 6.5 LLM steps (trigger census + island research missions). The deterministic reachability pass still runs and tracks islands in `.understand-anything/islands.json`; only the census/mission subagents are skipped.
```

- [ ] **Step 2: Phase-6.5-Abschnitt einfügen**

Direkt vor `## Phase 7 — SAVE`:

```markdown
## Phase 6.5 — REACHABILITY & ISLANDS

Report to the user: `[Phase 6.5/7] Checking trigger reachability...`

Every chain of nodes must be reachable from a trigger/entry point — or get
explicitly tracked and investigated. This phase is deterministic first
(free), interactive-budgeted LLM second. Skip the LLM steps (3-5) if
`--skip-islands` is in `$ARGUMENTS`; step 1 always runs.

1. **Deterministic pass (always).** Run:

   ```bash
   node <SKILL_DIR>/compute-reachability.mjs \
     "$PROJECT_ROOT/.understand-anything/intermediate/assembled-graph.json"
   ```

   Append every stderr `Warning:` line to `$PHASE_WARNINGS`. If the script
   exits non-zero, append `"reachability step failed — graph saved without
   reachability data"` and continue to Phase 7 (the script only rewrites on
   success). If stdout reports `skipped (knowledge graph)`, continue to
   Phase 7. Read `$PROJECT_ROOT/.understand-anything/islands.json` and note
   `triggerCount` and the island list. If `--skip-islands`: report
   `Phase 6.5 complete (deterministic only). <N> islands tracked in islands.json.`
   and continue to Phase 7.

2. **Report the tracked state (step 1 of the team effort: track; step 2:
   the list).** Print a compact island list to the user: component id,
   size, dominantCategory, first 3 files. Sorted by size, max 20 rows,
   `... and N more` if longer.

3. **Trigger census (1 subagent).** Skip when
   `$PROJECT_ROOT/.understand-anything/triggers.json` already exists (an
   earlier run's census remains valid; the deterministic pass already
   consumed it). Otherwise dispatch a subagent using the `trigger-census`
   agent definition (at `agents/trigger-census.md`) with this prompt:

   > Census the triggers of the project at `$PROJECT_ROOT`.
   > `$GRAPH_PATH` = `$PROJECT_ROOT/.understand-anything/intermediate/assembled-graph.json`
   > `$SCAN_RESULT` = `$PROJECT_ROOT/.understand-anything/intermediate/scan-result.json`
   > `$LAYERS` = `$PROJECT_ROOT/.understand-anything/intermediate/layers.json`
   > `$ISLANDS` = `$PROJECT_ROOT/.understand-anything/islands.json`
   > Write `triggers.json` (and optionally `rules/triggers/census-learned.json`) as specified in your instructions.

   Then re-run the step-1 command (picks up triggers.json + learned rules)
   and refresh your island list from islands.json.

4. **Research missions (interactive budget).** Initialize
   `MISSIONS_RUN = 0`. Loop:

   a. Read `islands.json`. If `missionPlan` is empty, break.
   b. Determine this round's batch: the first `min(10, missionPlan.length)`
      missions. **The first 10 missions overall run without asking.** If
      `MISSIONS_RUN >= 10`, FIRST ask via AskUserQuestion:
      > `<N> unresolved islands remain (<M> missions planned). So far <MISSIONS_RUN> missions ran.`
      > 1. Look at the list together now (print the full island list, then ask again)
      > 2. Run 10 more missions
      > 3. Stop — remaining islands stay tracked as unresolved in islands.json
      On option 1: print list, re-ask. On option 3: break.
   c. For each mission in the batch (max 5 concurrent, same limit as
      Phase 2), dispatch a subagent using the `island-researcher` agent
      definition (at `agents/island-researcher.md`) with this prompt:

      > Investigate mission `<missionId>` for the project at `$PROJECT_ROOT`.
      > `$GRAPH_PATH` = `$PROJECT_ROOT/.understand-anything/intermediate/assembled-graph.json`
      > `$MISSION_ID` = `<missionId>`
      > `$COMPONENTS` = `<JSON array of the mission's components (id, files, nodeIds) from islands.json>`
      > `$TRIGGERS_SUMMARY` = `<node ids currently tagged entry-point, plus active rule ids>`
      > Write your patch/rules/verdict files as specified in your instructions.

      Increment `MISSIONS_RUN` per dispatched mission.
   d. After the batch: apply new mission patches, then recompute:

      ```bash
      node <SKILL_DIR>/apply-graph-patches.mjs \
        "$PROJECT_ROOT/.understand-anything/intermediate/assembled-graph.json" \
        --scan-result "$PROJECT_ROOT/.understand-anything/intermediate/scan-result.json" \
        --patches "$PROJECT_ROOT/.understand-anything/patches"
      node <SKILL_DIR>/compute-reachability.mjs \
        "$PROJECT_ROOT/.understand-anything/intermediate/assembled-graph.json" \
        --verdicts "$PROJECT_ROOT/.understand-anything/intermediate/mission-results"
      ```

      Append stderr `Warning:` lines to `$PHASE_WARNINGS`. Report:
      `Mission round complete. Islands: <before> -> <after> (resolved <X>, isolated <Y>, unresolved <Z>).`

5. **Phase completion.** Report:
   `Phase 6.5 complete. Triggers: <triggerCount>. Reachable: <reachable>, attached: <attached>, isolated: <isolated> (with confidence), unresolved: <unresolved> (tracked in islands.json).`
   If `islands.json.onlyViaTests` is non-empty, add one line:
   `<N> nodes are referenced only by tests (candidates for dead production code) — listed in islands.json.onlyViaTests.`
```

- [ ] **Step 3: Phase-7-Report erweitern**

In Phase 7 Schritt 5 (Aufzählung der Summary-Punkte) nach dem Layers-Bullet ergänzen:

```markdown
   - Reachability: trigger count, reachable/attached node counts, islands by status (isolated with confidence, unresolved) — from `islands.json`
```

Und in Phase 7 Schritt 4 (Cleanup) den `find`-Befehl NICHT ändern — aber im umgebenden Text klarstellen, dass `islands.json`, `triggers.json`, `rules/` und `patches/` außerhalb von `intermediate/` liegen und den Cleanup überleben (nur `intermediate/mission-results/` wird mit-getrasht, dessen Verdicts sind zu diesem Zeitpunkt in `islands.json` gefoldet).

- [ ] **Step 4: Konsistenz-Check (manuell, kein Test)**

- `grep -n "6.5" understand-anything-plugin/skills/understand/SKILL.md` — Phase erscheint in Options (`--skip-islands`), Phase-Block, keine Widersprüche zur Progress-Konvention `[Phase N/7]`.
- Die drei Script-Aufrufe in Phase 6.5 referenzieren exakt die CLI aus Task 4/7 (`--verdicts`-Flag, Pfade).
- Phase 6 bleibt unverändert (Degree-Check-Warnungen verweisen weiter auf orphans; kein Umbau nötig).

- [ ] **Step 5: Commit**

```bash
git add understand-anything-plugin/skills/understand/SKILL.md
git commit -m "feat(understand): Phase 6.5 — reachability check, trigger census, island research missions"
```

---

### Task 9: Standalone-Skill `/understand-islands`

**Files:**
- Create: `understand-anything-plugin/skills/understand-islands/SKILL.md`

**Interfaces:**
- Consumes: bestehendes `knowledge-graph.json`, dieselben Scripts/Agents wie Phase 6.5.
- Produces: Skill-Definition; operiert direkt auf `knowledge-graph.json` (nicht auf `intermediate/assembled-graph.json`), setzt `islands.json` fort.

- [ ] **Step 1: Skill schreiben**

```markdown
---
name: understand-islands
description: Check an existing knowledge graph for node chains unreachable from any trigger/entry point, and investigate them with budgeted island research missions
argument-hint: [project-path] [--skip-missions]
---

# /understand-islands

Run the trigger-reachability check (spec 2026-07-05) on an EXISTING
knowledge graph — without re-running the full `/understand` pipeline.
Tracks unreachable island components in `.understand-anything/islands.json`,
lists them, and investigates them with interactively budgeted
`island-researcher` missions. Resumes where a previous run stopped
(existing verdicts and mission ids are retained).

## Instructions

1. **Resolve the project.** `$PROJECT_ROOT` = path from `$ARGUMENTS`, else
   the current working directory. `$GRAPH` =
   `$PROJECT_ROOT/.understand-anything/knowledge-graph.json`. If `$GRAPH`
   does not exist, tell the user: `No knowledge graph found. Run /understand first.`
   and stop. If the graph has `"kind": "knowledge"`, tell the user
   reachability only applies to codebase graphs and stop.

2. **Locate the scripts.** `<SKILL_DIR>` =
   `${CLAUDE_PLUGIN_ROOT}/skills/understand/` (the sibling skill's
   directory — compute-reachability.mjs, apply-graph-patches.mjs live
   there).

3. **Deterministic pass.** Run:

   ```bash
   node <SKILL_DIR>/compute-reachability.mjs "$GRAPH"
   ```

   Surface stderr `Warning:` lines to the user. Read
   `$PROJECT_ROOT/.understand-anything/islands.json`; print the island
   list (component id, size, dominantCategory, first 3 files; sorted by
   size, max 20 rows). If there are no islands: report
   `All node chains are reachable from a trigger. Nothing to do.` and stop.

4. **Census (only if `triggers.json` is missing).** If
   `$PROJECT_ROOT/.understand-anything/triggers.json` does not exist,
   dispatch the `trigger-census` agent (at `agents/trigger-census.md`) with:

   > Census the triggers of the project at `$PROJECT_ROOT`.
   > `$GRAPH_PATH` = `$GRAPH`
   > `$SCAN_RESULT` = `$PROJECT_ROOT/.understand-anything/intermediate/scan-result.json` (may be missing — then derive frameworks from the graph's `project.frameworks`)
   > `$LAYERS` = derive from the graph's `layers` array
   > `$ISLANDS` = `$PROJECT_ROOT/.understand-anything/islands.json`
   > Write `triggers.json` (and optionally `rules/triggers/census-learned.json`) as specified in your instructions.

   Then re-run the step-3 command and refresh the island list.

5. **Missions.** If `--skip-missions` is in `$ARGUMENTS`, report the
   tracked state and stop. Otherwise run the identical mission loop as
   `/understand` Phase 6.5 step 4 (first 10 missions free, then
   AskUserQuestion checkpoint: view list / 10 more / stop), with `$GRAPH`
   in place of the assembled-graph path in both script invocations.

6. **Report.** Summarize: triggers, reachable/attached counts, islands by
   status (`isolated` with confidence, `unresolved`), missions run, and
   that state persists in `islands.json` / `triggers.json` /
   `rules/triggers/` / `patches/` for the next run.
```

- [ ] **Step 2: Konsistenz-Check (manuell)**

- Frontmatter-Format identisch zu `skills/understand-dashboard/SKILL.md` (name/description/argument-hint).
- Alle referenzierten Pfade/Flags existieren (`compute-reachability.mjs`, `--verdicts`, `agents/*.md`).

- [ ] **Step 3: Commit**

```bash
git add understand-anything-plugin/skills/understand-islands
git commit -m "feat(understand-islands): standalone reachability + island-mission skill"
```

---

### Task 10: Doku-Abschluss

**Files:**
- Modify: `Understand-Anything/CLAUDE.md` (Abschnitt „Agent Pipeline" + neuer Kurzabschnitt)
- Modify: `docs/superpowers/specs/2026-07-05-reachability-islands-design.md` (Status-Zeile)

**Interfaces:** keine — reine Doku.

- [ ] **Step 1: CLAUDE.md ergänzen**

Im Abschnitt „Agent Pipeline" die Agent-Liste um `trigger-census` und `island-researcher` erweitern. Danach neuen Abschnitt einfügen (nach „Readiness Test"):

```markdown
## Reachability & Islands (`/understand` Phase 6.5, `/understand-islands`)
Every node chain must be reachable from a trigger/entry point (spec
`docs/superpowers/specs/2026-07-05-reachability-islands-design.md`).
Deterministic pass: `skills/understand/compute-reachability.mjs` (trigger
rules from `rules/triggers/` + `.understand-anything/rules/triggers/`, BFS
with typed edge semantics, island clustering into
`.understand-anything/islands.json`). LLM steps: `trigger-census` agent
(once per repo, writes `triggers.json`), `island-researcher` missions
(first 10 free, then interactive checkpoint; verdicts `connected` /
`trigger` / `isolated` with confidence). Mission edges arrive as
`.understand-anything/patches/mission-*.patch.json` with `_meta.origin:
"llm"`. All state survives runs — `/understand-islands` resumes on an
existing graph.
```

- [ ] **Step 2: Spec-Status aktualisieren**

In der Spec die Status-Zeile ändern zu:

```markdown
**Status:** Implementiert (2026-07-05) — bis auf Match-Typ `query` (kommt mit der Pack-Befüllung, §9)
```

- [ ] **Step 3: Voller Testlauf + Commit**

Run: `pnpm --filter @understand-anything/core build && pnpm test`
Expected: PASS — komplette Suite grün.

```bash
git add Understand-Anything/CLAUDE.md docs/superpowers/specs/2026-07-05-reachability-islands-design.md
git commit -m "docs: reachability & islands — CLAUDE.md section, spec status"
```

---

## Selbst-Review-Notizen (Spec-Abdeckung)

| Spec-Abschnitt | Task |
|---|---|
| §2.1 Isolation legitim + Confidence | 4 (Verdict-Folding), 7 (Agent-Verdikte) |
| §2.2 Erreichbarkeit von Trigger, gerichtete Kanten | 2 (Engine) |
| §2.3 Tracken → Liste → 10er-Budget-Checkpoint | 4 (islands.json), 8 (Loop) |
| §2.4 A+B-Integration | 8 (Phase 6.5), 9 (/understand-islands) |
| §2.5 Census nach Framework-Analyse | 6, 8 (Schritt 3) |
| §2.6 Regeln in zwei Schichten, Promotion-Format | 1 (Schema/Loader), 3 (Starter-Pack) |
| §3.3 Regel-Pass nach jeder Missionsrunde | 4+8 (Recompute ruft Regel-Pass immer mit) |
| §4 Census-Selbstkorrektur via Insel-Signal | 6 (Step 4 des Agents) |
| §5.1/5.2 BFS, Satelliten-Fixpunkt, Kantensemantik | 2 |
| §5.3 islands.json-Persistenz, Verdikt-Retention, Node-Status | 2 (Schema), 4 (Merge) |
| §6.1 Bündelung nach Pfadnähe, Caps | 4 (planMissions) |
| §6.2 Drei Ergebnisarten, Evidence, Patch-Kompatibilität | 5, 7 |
| §6.3 Erste 10 automatisch, Checkpoint-Loop | 8 (Schritt 4b) |
| §7 `--skip-islands`, Degree-Check bleibt | 8 |
| §8 Testfälle | 1-7 (je Task) |
| §9 Out of scope (query-Matching dokumentiert als v1-Abweichung) | Global Constraints, 10 |
