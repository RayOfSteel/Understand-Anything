# Phase ② — Provenance-Felder und Einzelfall-Patches: Implementierungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Jede Kante im Knowledge Graph trägt ihre Herkunft (`origin`/`ruleId`/`confidence`/`evidence`), und handkuratierte `.understand-anything/patches/*.patch.json` werden maschinell und idempotent angewendet.

**Architecture:** Additive optionale Felder auf `GraphEdge` (Core-Typen + Zod-Schema + Durchreichen in `validateGraph`); die beiden deterministischen Kanten-Produzenten in `merge-batch-graphs.py` stempeln ihre Kanten selbst; ein neues Nachlauf-Script `apply-graph-patches.mjs` reklassifiziert importMap-belegte `imports`-Kanten, setzt den `llm`-Default und wendet Patches an. Eingebettet in `/understand` Phase 6 (vor der Validierung) und in den Auto-Update-Hook (nach dem Schreiben, vor meta.json). Dashboard zeigt ein Origin-Badge in der NodeInfo-Kantenliste.

**Tech Stack:** TypeScript strict + Zod (Core), Node ESM Script (Skill), Python 3 (Merge-Script), Vitest (TS/Script-Tests), unittest (Python-Tests), React + Tailwind v4 (Dashboard).

**Spec:** `docs/superpowers/specs/2026-07-02-deterministic-linking-design.md` §7 (Stand nach Commit `43204dd` + Klarstellungen vom 2026-07-03).

## Global Constraints

- `origin`-Enum exakt: `"structural" | "llm" | "rule" | "manual"` — keine weiteren Werte.
- `confidence` ∈ [0, 1]; deterministische Herkünfte (`structural`, `manual`) tragen `confidence: 1.0`; `llm`-Kanten bekommen in Phase ② **kein** `confidence`.
- Prioritäts-Invariante nach dem Apply-Lauf: `manual > structural > rule > llm`. Reklassifikation (Schritt 1) stempelt Kanten ohne `origin` und upgradet `origin: "llm"`; `structural`/`rule`/`manual` bleiben in Schritt 1 unangetastet. Patch-Apply (Schritt 3) darf **jede** Kante auf `manual` heben.
- Patch-Matching auf `(source, target, type)` nach Alias-Normalisierung, über alle `direction`-Werte hinweg.
- Patch-Dateien alphabetisch; pro Datei erst `edges_to_remove`, dann `edges_to_add`.
- Knoten-ID-↔-Pfad-Konvention: `file:<importMap-Pfad>` — identisch zu `recover_imports_from_scan` (`merge-batch-graphs.py:956`).
- `apply-graph-patches.mjs`: nur stderr-Logging; Degradierungen als `Warning: apply-graph-patches: ...`; Per-Item-Resilienz (nie abbrechen wegen eines Patches/Eintrags); Graph-Datei wird nur bei Erfolg neu geschrieben; **Idempotenz**: zweimaliges Anwenden → byte-identischer Output.
- `GraphEdgeSchema` bekommt die vier Felder **explizit** — kein `.passthrough()`.
- Die 15 realen KernelResearch-Patch-Dateien müssen unverändert als gültige Patches akzeptiert werden (Format-Ebene; Knoten-Existenz ist repo-abhängig).
- `DIRECTION_ALIASES` wird um `outgoing → forward` und `incoming → backward` erweitert.
- Bestehende Graphen ohne Provenance-Felder validieren unverändert; kein Output-Shape-Bruch an anderer Stelle.
- Konventionen: TypeScript strict, ESM, Vitest; Python-Tests via `python -m unittest tests.skill.understand.test_merge_batch_graphs -v`; Code-Kommentare auf Englisch.
- Vor Vitest-Läufen, die das neue Script mit Core-Aliassen testen (ab Task 4), Core bauen: `pnpm --filter @understand-anything/core build`.
- Commits direkt auf `myMaster` (Fork-Modus, wie Phase ①), kein Push.

**Repo-Root aller Pfade:** `C:\1_Develop_\Repos\Mine\Understand-Anything\Understand-Anything` (in Git Bash: `/c/1_Develop_/Repos/Mine/Understand-Anything/Understand-Anything`).

---

### Task 1: Core-Datenmodell — Provenance-Felder in Typen und Schema

**Files:**
- Modify: `understand-anything-plugin/packages/core/src/types.ts:53-61`
- Modify: `understand-anything-plugin/packages/core/src/schema.ts` (DIRECTION_ALIASES ~Zeile 139, sanitizeGraph ~Zeile 176, autoFixGraph Edges-Abschnitt ~Zeile 335, GraphEdgeSchema ~Zeile 388)
- Test: `understand-anything-plugin/packages/core/src/__tests__/schema.test.ts` (neuer describe-Block am Dateiende)

**Interfaces:**
- Consumes: bestehende `GraphEdge`, `GraphEdgeSchema`, `validateGraph`, `DIRECTION_ALIASES`.
- Produces: `export type EdgeOrigin = "structural" | "llm" | "rule" | "manual"` in `types.ts`; `GraphEdge` mit optionalen Feldern `origin?: EdgeOrigin`, `ruleId?: string`, `confidence?: number`, `evidence?: string`; `GraphEdgeSchema` validiert/erhält diese Felder; `DIRECTION_ALIASES` enthält `outgoing`/`incoming`. Spätere Tasks (2, 3, 4, 6) verlassen sich auf exakt diese Feldnamen.

- [ ] **Step 1: Failing Tests schreiben**

In `understand-anything-plugin/packages/core/src/__tests__/schema.test.ts` am Dateiende anhängen (Import-Zeile oben prüfen: `validateGraph` muss importiert sein — ist es in dieser Datei bereits; sonst ergänzen):

```ts
describe("edge provenance (phase 2)", () => {
  // Minimal valid graph with one fully-stamped edge. Returned as `any` so
  // individual tests can poke invalid values into fields without casts.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const provenanceGraph = (): any => ({
    version: "1.0.0",
    project: {
      name: "p",
      languages: [],
      frameworks: [],
      description: "",
      analyzedAt: "2026-01-01T00:00:00Z",
      gitCommitHash: "abc",
    },
    nodes: [
      { id: "file:a.cs", type: "file", name: "a.cs", summary: "s", tags: [], complexity: "simple" },
      { id: "file:b.cs", type: "file", name: "b.cs", summary: "s", tags: [], complexity: "simple" },
    ],
    edges: [
      {
        source: "file:a.cs",
        target: "file:b.cs",
        type: "imports",
        direction: "forward",
        weight: 0.7,
        origin: "structural",
        ruleId: "r1",
        confidence: 1.0,
        evidence: "using X",
      },
    ],
    layers: [],
    tour: [],
  });

  it("preserves origin/ruleId/confidence/evidence through validateGraph", () => {
    const result = validateGraph(provenanceGraph());
    expect(result.success).toBe(true);
    const edge = result.data!.edges[0];
    expect(edge.origin).toBe("structural");
    expect(edge.ruleId).toBe("r1");
    expect(edge.confidence).toBe(1.0);
    expect(edge.evidence).toBe("using X");
  });

  it("removes an invalid origin value with an auto-corrected issue", () => {
    const graph = provenanceGraph();
    graph.edges[0].origin = "guessed";
    const result = validateGraph(graph);
    expect(result.success).toBe(true);
    expect(result.data!.edges[0].origin).toBeUndefined();
    expect(
      result.issues.some(
        (i) => i.level === "auto-corrected" && i.path === "edges[0].origin",
      ),
    ).toBe(true);
  });

  it("clamps out-of-range confidence into [0, 1]", () => {
    const graph = provenanceGraph();
    graph.edges[0].confidence = 1.5;
    const result = validateGraph(graph);
    expect(result.success).toBe(true);
    expect(result.data!.edges[0].confidence).toBe(1);
    expect(result.issues.some((i) => i.path === "edges[0].confidence")).toBe(true);
  });

  it("drops a non-numeric confidence with an issue", () => {
    const graph = provenanceGraph();
    graph.edges[0].confidence = "high";
    const result = validateGraph(graph);
    expect(result.success).toBe(true);
    expect(result.data!.edges[0].confidence).toBeUndefined();
    expect(result.issues.some((i) => i.path === "edges[0].confidence")).toBe(true);
  });

  it("maps the ad-hoc direction alias outgoing to forward", () => {
    const graph = provenanceGraph();
    graph.edges[0].direction = "outgoing";
    const result = validateGraph(graph);
    expect(result.success).toBe(true);
    expect(result.data!.edges[0].direction).toBe("forward");
  });

  it("maps the ad-hoc direction alias incoming to backward", () => {
    const graph = provenanceGraph();
    graph.edges[0].direction = "incoming";
    const result = validateGraph(graph);
    expect(result.success).toBe(true);
    expect(result.data!.edges[0].direction).toBe("backward");
  });

  it("keeps provenance-free graphs valid without new issues", () => {
    const graph = provenanceGraph();
    delete graph.edges[0].origin;
    delete graph.edges[0].ruleId;
    delete graph.edges[0].confidence;
    delete graph.edges[0].evidence;
    const result = validateGraph(graph);
    expect(result.success).toBe(true);
    expect(result.data!.edges[0].origin).toBeUndefined();
    expect(result.issues).toHaveLength(0);
  });

  it("deletes null provenance fields during sanitize", () => {
    const graph = provenanceGraph();
    graph.edges[0].origin = null;
    graph.edges[0].ruleId = null;
    graph.edges[0].confidence = null;
    graph.edges[0].evidence = null;
    const result = validateGraph(graph);
    expect(result.success).toBe(true);
    expect(result.data!.edges[0].origin).toBeUndefined();
    expect(result.data!.edges[0].ruleId).toBeUndefined();
  });
});
```

- [ ] **Step 2: Tests laufen lassen — sie müssen fehlschlagen**

Run: `pnpm --filter @understand-anything/core test -- --run schema`
Expected: FAIL — `preserves origin/...` schlägt fehl, weil Zod die undeklarierten Felder strippt (`edge.origin` ist `undefined`); die Alias-Tests schlagen fehl, weil `outgoing`/`incoming` nicht gemappt werden.

- [ ] **Step 3: `types.ts` erweitern**

In `understand-anything-plugin/packages/core/src/types.ts` den `GraphEdge`-Block (Zeilen 53-61) ersetzen durch:

```ts
// Edge provenance (phase 2): who asserted this edge.
//   structural — deterministically derived (import map, path convention)
//   llm        — inferred by the LLM analysis phase
//   rule       — produced by a generalized linker rule (phase 3)
//   manual     — asserted by a hand-written patch file
export type EdgeOrigin = "structural" | "llm" | "rule" | "manual";

// GraphEdge with rich relationship modeling
export interface GraphEdge {
  source: string;
  target: string;
  type: EdgeType;
  direction: "forward" | "backward" | "bidirectional";
  description?: string;
  weight: number; // 0-1
  origin?: EdgeOrigin;
  ruleId?: string; // manual: patch file name; rule: rule id
  confidence?: number; // 0-1, certainty that the edge exists (not its weight)
  evidence?: string; // human-readable proof, e.g. the patch note
}
```

- [ ] **Step 4: `schema.ts` erweitern**

Vier Änderungen in `understand-anything-plugin/packages/core/src/schema.ts`:

(a) In `DIRECTION_ALIASES` (~Zeile 139) vor der schließenden Klammer ergänzen:

```ts
  // Ad-hoc patch files historically used outgoing/incoming
  outgoing: "forward",
  incoming: "backward",
```

(b) In `sanitizeGraph`, Edges-Abschnitt, direkt nach `if (e.description === null) delete e.description;` (~Zeile 176) ergänzen:

```ts
      if (e.origin === null) delete e.origin;
      if (e.ruleId === null) delete e.ruleId;
      if (e.confidence === null) delete e.confidence;
      if (e.evidence === null) delete e.evidence;
```

(c) In `autoFixGraph`, Edges-Map, direkt nach dem `// Clamp weight to [0, 1]`-Block (~Zeile 344, vor `return e;`) ergänzen:

```ts
      // Provenance (phase 2): validate origin enum, clamp confidence
      if (e.origin !== undefined) {
        const normalized = typeof e.origin === "string" ? e.origin.toLowerCase() : "";
        if (["structural", "llm", "rule", "manual"].includes(normalized)) {
          e.origin = normalized;
        } else {
          issues.push({
            level: "auto-corrected",
            category: "invalid-value",
            message: `edges[${i}]: origin "${String(e.origin)}" is not a valid origin — removed`,
            path: `edges[${i}].origin`,
          });
          delete e.origin;
        }
      }
      if (e.confidence !== undefined) {
        if (typeof e.confidence !== "number" || Number.isNaN(e.confidence)) {
          issues.push({
            level: "auto-corrected",
            category: "type-coercion",
            message: `edges[${i}]: confidence "${String(e.confidence)}" is not a number — removed`,
            path: `edges[${i}].confidence`,
          });
          delete e.confidence;
        } else if (e.confidence < 0 || e.confidence > 1) {
          const original = e.confidence;
          e.confidence = Math.max(0, Math.min(1, e.confidence));
          issues.push({
            level: "auto-corrected",
            category: "out-of-range",
            message: `edges[${i}]: confidence ${original} clamped to ${e.confidence}`,
            path: `edges[${i}].confidence`,
          });
        }
      }
```

(d) `GraphEdgeSchema` (~Zeile 388) ersetzen durch:

```ts
export const EdgeOriginSchema = z.enum(["structural", "llm", "rule", "manual"]);

export const GraphEdgeSchema = z.object({
  source: z.string(),
  target: z.string(),
  type: EdgeTypeSchema,
  direction: z.enum(["forward", "backward", "bidirectional"]),
  description: z.string().optional(),
  weight: z.number().min(0).max(1),
  origin: EdgeOriginSchema.optional(),
  ruleId: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
  evidence: z.string().optional(),
});
```

- [ ] **Step 5: Tests laufen lassen — sie müssen bestehen**

Run: `pnpm --filter @understand-anything/core test -- --run schema`
Expected: PASS, alle neuen und alle bestehenden schema-Tests grün.

- [ ] **Step 6: Volle Core-Suite + Lint**

Run: `pnpm --filter @understand-anything/core test -- --run && pnpm lint`
Expected: PASS (758+ Tests grün, kein neuer Lint-Fehler).

- [ ] **Step 7: Commit**

```bash
git add understand-anything-plugin/packages/core/src/types.ts \
        understand-anything-plugin/packages/core/src/schema.ts \
        understand-anything-plugin/packages/core/src/__tests__/schema.test.ts
git commit -m "feat(core): add edge provenance fields origin/ruleId/confidence/evidence"
```

---

### Task 2: Erzeuger-Stempel in merge-batch-graphs.py

**Files:**
- Modify: `understand-anything-plugin/skills/understand/merge-batch-graphs.py:697-704` (tested_by Pass 2) und `:972-979` (recover_imports_from_scan)
- Test: `tests/skill/understand/test_merge_batch_graphs.py` (Imports oben ergänzen, zwei neue Testklassen am Dateiende)

**Interfaces:**
- Consumes: bestehende Funktionen `link_tests(nodes_by_id, edges)` und `recover_imports_from_scan(assembled, scan_result_path)`; Test-Helper `_file_node(path)` der Testdatei.
- Produces: Pass-2-`tested_by`-Kanten tragen `"origin": "structural"`, `"evidence": "path convention"`; wiederhergestellte `imports`-Kanten tragen `"origin": "structural"`, `"confidence": 1.0` (zusätzlich zum bestehenden `"recoveredFromImportMap": True`). Task 3/7 verlassen sich darauf, dass diese Kanten bereits gestempelt ankommen.

- [ ] **Step 1: Failing Tests schreiben**

In `tests/skill/understand/test_merge_batch_graphs.py`: oben bei den Imports `import json` und `import tempfile` ergänzen (falls nicht vorhanden). Am Dateiende (vor einem etwaigen `if __name__ == "__main__":`-Block) anhängen:

```python
# ── Provenance stamps (phase 2) ───────────────────────────────────────────

class Pass2ProvenanceTests(unittest.TestCase):
    """Pass-2 supplements are deterministic producers and stamp themselves."""

    def test_pass2_supplement_carries_structural_origin(self) -> None:
        nodes_by_id = {
            "file:src/foo.ts": _file_node("src/foo.ts"),
            "file:src/foo.test.ts": _file_node("src/foo.test.ts"),
        }
        edges: list[dict[str, Any]] = []

        added, _dropped, _tagged, _swapped = mbg.link_tests(nodes_by_id, edges)

        self.assertEqual(added, 1)
        edge = edges[0]
        self.assertEqual(edge["origin"], "structural")
        self.assertEqual(edge["evidence"], "path convention")

    def test_pass1_kept_llm_edges_stay_unstamped(self) -> None:
        # LLM-asserted pairings keep their (absent) origin — the apply
        # script defaults them to "llm" later.
        nodes_by_id = {
            "file:src/foo.ts": _file_node("src/foo.ts"),
            "file:src/foo.test.ts": _file_node("src/foo.test.ts"),
        }
        edges: list[dict[str, Any]] = [
            {
                "source": "file:src/foo.ts",
                "target": "file:src/foo.test.ts",
                "type": "tested_by",
                "direction": "forward",
                "weight": 0.9,
            }
        ]

        mbg.link_tests(nodes_by_id, edges)

        self.assertEqual(len(edges), 1)
        self.assertNotIn("origin", edges[0])


class RecoverImportsProvenanceTests(unittest.TestCase):
    """Recovered importMap edges are structural by construction."""

    def test_recovered_edges_carry_structural_origin(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            scan_path = Path(tmp) / "scan-result.json"
            scan_path.write_text(
                json.dumps({"importMap": {"a.cs": ["b.cs"]}}), encoding="utf-8"
            )
            assembled: dict[str, Any] = {
                "nodes": [
                    {"id": "file:a.cs", "type": "file"},
                    {"id": "file:b.cs", "type": "file"},
                ],
                "edges": [],
            }

            recovered, _lines = mbg.recover_imports_from_scan(assembled, scan_path)

            self.assertEqual(recovered, 1)
            edge = assembled["edges"][0]
            self.assertEqual(edge["origin"], "structural")
            self.assertEqual(edge["confidence"], 1.0)
            self.assertTrue(edge["recoveredFromImportMap"])
```

- [ ] **Step 2: Tests laufen lassen — die zwei neuen Stempel-Tests müssen fehlschlagen**

Run: `python -m unittest tests.skill.understand.test_merge_batch_graphs -v`
Expected: FAIL — `test_pass2_supplement_carries_structural_origin` (KeyError `origin`) und `test_recovered_edges_carry_structural_origin` (KeyError `origin`); `test_pass1_kept_llm_edges_stay_unstamped` besteht bereits.

- [ ] **Step 3: Stempel implementieren**

(a) In `merge-batch-graphs.py`, Pass-2-Append (~Zeile 697), das Dict erweitern:

```python
            edges.append({
                "source": prod_node["id"],
                "target": test_node["id"],
                "type": "tested_by",
                "direction": "forward",
                "weight": 0.5,
                "description": "Path-based pairing (deterministic)",
                "origin": "structural",
                "evidence": "path convention",
            })
```

(b) In `recover_imports_from_scan` (~Zeile 972) das Append-Dict erweitern:

```python
            assembled["edges"].append({
                "source": src_id,
                "target": tgt_id,
                "type": "imports",
                "direction": "forward",
                "weight": 0.7,
                "recoveredFromImportMap": True,
                "origin": "structural",
                "confidence": 1.0,
            })
```

- [ ] **Step 4: Tests laufen lassen — alle müssen bestehen**

Run: `python -m unittest tests.skill.understand.test_merge_batch_graphs -v`
Expected: PASS, alle Tests grün (auch alle bestehenden Linker-Tests — der Stempel ändert keine Zählwerte oder Richtungen).

- [ ] **Step 5: Commit**

```bash
git add understand-anything-plugin/skills/understand/merge-batch-graphs.py \
        tests/skill/understand/test_merge_batch_graphs.py
git commit -m "feat(skill): stamp deterministic producer edges with structural origin"
```

---

### Task 3: apply-graph-patches.mjs — Reklassifikation und llm-Default

**Files:**
- Create: `understand-anything-plugin/skills/understand/apply-graph-patches.mjs`
- Test: `tests/skill/understand/test_apply_graph_patches.test.mjs` (neu)

**Interfaces:**
- Consumes: Graph-JSON (Shape wie `knowledge-graph.json`: `{ nodes: [{id,...}], edges: [{source,target,type,direction,weight,...}], ... }`); scan-result-JSON mit Feld `importMap: { <pfad>: [<pfad>, ...] }` (sowohl `scan-result.json` als auch der Output von `extract-import-map.mjs` haben dieses Feld).
- Produces: CLI `node apply-graph-patches.mjs <graph.json> [--scan-result <pfad>] [--patches <verzeichnis>]`; schreibt die Graph-Datei in-place (`JSON.stringify(graph, null, 2) + "\n"`); Summary-Zeile auf stderr `apply-graph-patches: reclassified=N defaulted=N`. Task 4 erweitert dieselbe Datei um Patch-Apply; Task 5 bettet die CLI in die Abläufe ein.

- [ ] **Step 1: Failing Tests schreiben**

Neue Datei `tests/skill/understand/test_apply_graph_patches.test.mjs`:

```js
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(
  __dirname,
  '../../../understand-anything-plugin/skills/understand/apply-graph-patches.mjs',
);

/** Minimal valid graph: two file nodes and the given edges. */
function makeGraph(edges, extraNodes = []) {
  return {
    version: '1.0.0',
    project: {
      name: 'p', languages: [], frameworks: [], description: '',
      analyzedAt: '2026-01-01T00:00:00Z', gitCommitHash: 'abc',
    },
    nodes: [
      { id: 'file:a.cs', type: 'file', name: 'a.cs', summary: 's', tags: [], complexity: 'simple' },
      { id: 'file:b.cs', type: 'file', name: 'b.cs', summary: 's', tags: [], complexity: 'simple' },
      ...extraNodes,
    ],
    edges,
    layers: [],
    tour: [],
  };
}

function edge(overrides = {}) {
  return {
    source: 'file:a.cs',
    target: 'file:b.cs',
    type: 'imports',
    direction: 'forward',
    weight: 0.7,
    ...overrides,
  };
}

/**
 * Write graph (+ optional scan result / patch files) into a temp dir and run
 * the script. Returns { status, stderr, graph } where graph is the re-read
 * graph file content.
 */
function runScript({ graph, importMap = null, patches = null, extraArgs = [] }) {
  const root = mkdtempSync(join(tmpdir(), 'ua-agp-test-'));
  const graphPath = join(root, 'knowledge-graph.json');
  writeFileSync(graphPath, JSON.stringify(graph, null, 2) + '\n', 'utf-8');
  const args = [SCRIPT, graphPath, ...extraArgs];
  if (importMap !== null) {
    const scanPath = join(root, 'scan-result.json');
    writeFileSync(scanPath, JSON.stringify({ importMap }), 'utf-8');
    args.push('--scan-result', scanPath);
  }
  if (patches !== null) {
    const patchDir = join(root, 'patches');
    mkdirSync(patchDir, { recursive: true });
    for (const [name, content] of Object.entries(patches)) {
      writeFileSync(
        join(patchDir, name),
        typeof content === 'string' ? content : JSON.stringify(content, null, 2),
        'utf-8',
      );
    }
    args.push('--patches', patchDir);
  }
  const result = spawnSync('node', args, { encoding: 'utf-8' });
  let updated = null;
  try {
    updated = JSON.parse(readFileSync(graphPath, 'utf-8'));
  } catch {
    /* unreadable on hard failure */
  }
  return { status: result.status, stderr: result.stderr, graph: updated, graphPath, root };
}

const roots = [];
afterEach(() => {
  while (roots.length) rmSync(roots.pop(), { recursive: true, force: true });
});

describe('apply-graph-patches.mjs — reclassification and llm default', () => {
  it('stamps an importMap-backed imports edge as structural with confidence 1.0', () => {
    const r = runScript({
      graph: makeGraph([edge()]),
      importMap: { 'a.cs': ['b.cs'] },
    });
    roots.push(r.root);
    expect(r.status).toBe(0);
    const e = r.graph.edges[0];
    expect(e.origin).toBe('structural');
    expect(e.confidence).toBe(1.0);
  });

  it('upgrades an llm-stamped imports edge that the importMap backs', () => {
    const r = runScript({
      graph: makeGraph([edge({ origin: 'llm' })]),
      importMap: { 'a.cs': ['b.cs'] },
    });
    roots.push(r.root);
    expect(r.graph.edges[0].origin).toBe('structural');
    expect(r.graph.edges[0].confidence).toBe(1.0);
  });

  it('leaves producer-stamped edges untouched during reclassification', () => {
    const r = runScript({
      graph: makeGraph([edge({ origin: 'manual', ruleId: 'x.patch.json', confidence: 1.0 })]),
      importMap: { 'a.cs': ['b.cs'] },
    });
    roots.push(r.root);
    expect(r.graph.edges[0].origin).toBe('manual');
    expect(r.graph.edges[0].ruleId).toBe('x.patch.json');
  });

  it('defaults unmatched and non-imports edges to origin llm without confidence', () => {
    const r = runScript({
      graph: makeGraph([
        edge({ target: 'file:b.cs', type: 'calls' }),
        edge({ source: 'file:b.cs', target: 'file:a.cs' }),
      ]),
      importMap: { 'a.cs': ['b.cs'] },
    });
    roots.push(r.root);
    for (const e of r.graph.edges) {
      expect(e.origin).toBe('llm');
      expect(e.confidence).toBeUndefined();
    }
  });

  it('runs standalone without --scan-result: only defaults are applied', () => {
    const r = runScript({ graph: makeGraph([edge()]) });
    roots.push(r.root);
    expect(r.status).toBe(0);
    expect(r.graph.edges[0].origin).toBe('llm');
  });

  it('warns and continues when the scan result is unreadable', () => {
    const r = runScript({
      graph: makeGraph([edge()]),
      importMap: null,
      extraArgs: ['--scan-result', 'does-not-exist.json'],
    });
    roots.push(r.root);
    expect(r.status).toBe(0);
    expect(r.stderr).toContain('Warning: apply-graph-patches:');
    expect(r.graph.edges[0].origin).toBe('llm');
  });

  it('exits non-zero when the graph file is missing', () => {
    const result = spawnSync('node', [SCRIPT, 'no-such-graph.json'], { encoding: 'utf-8' });
    expect(result.status).toBe(1);
  });
});
```

- [ ] **Step 2: Tests laufen lassen — sie müssen fehlschlagen**

Run: `pnpm vitest run tests/skill/understand/test_apply_graph_patches.test.mjs`
Expected: FAIL — das Script existiert noch nicht (`node` exit != 0 überall).

- [ ] **Step 3: Script implementieren**

Neue Datei `understand-anything-plugin/skills/understand/apply-graph-patches.mjs`:

```js
#!/usr/bin/env node
/**
 * apply-graph-patches.mjs
 *
 * Provenance post-pass for the knowledge graph (spec 2026-07-02 §7.3):
 *   1. imports edges backed by the scan importMap → origin "structural",
 *      confidence 1.0 (edges stamped structural/rule/manual are left alone;
 *      llm-stamped edges are upgraded — structural is the stronger claim).
 *   2. every edge without an origin → origin "llm".
 *   3. single-case patches from .understand-anything/patches/*.patch.json
 *      are applied (per file: removes first, then adds; added/upgraded
 *      edges carry origin "manual", ruleId = patch file name).
 *
 * Usage:
 *   node apply-graph-patches.mjs <graph.json> [--scan-result <path>] [--patches <dir>]
 *
 * The graph file is rewritten in place, only on success. Logging: stderr
 * only; degradations are prefixed "Warning: apply-graph-patches: ...".
 * Running the script twice produces byte-identical output (idempotence).
 */

import { dirname, resolve, join, basename } from 'node:path';
import { existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';

function warn(msg) {
  console.error(`Warning: apply-graph-patches: ${msg}`);
}

function info(msg) {
  console.error(msg);
}

function parseArgs(argv) {
  const args = { graphPath: null, scanResultPath: null, patchesDir: null };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--scan-result') args.scanResultPath = argv[++i];
    else if (a === '--patches') args.patchesDir = argv[++i];
    else rest.push(a);
  }
  args.graphPath = rest[0] ?? null;
  return args;
}

// ── Step 1: reclassify importMap-backed imports edges ─────────────────────

function reclassifyStructural(graph, importMap) {
  const backed = new Set();
  for (const [src, targets] of Object.entries(importMap)) {
    if (!Array.isArray(targets)) continue;
    for (const tgt of targets) {
      if (typeof tgt === 'string' && tgt) backed.add(`file:${src}|file:${tgt}`);
    }
  }
  let count = 0;
  for (const e of graph.edges) {
    if (e.type !== 'imports') continue;
    // Producer stamps (structural/rule/manual) win; llm upgrades to structural.
    if (e.origin !== undefined && e.origin !== 'llm') continue;
    if (!backed.has(`${e.source}|${e.target}`)) continue;
    e.origin = 'structural';
    e.confidence = 1.0;
    count++;
  }
  return count;
}

// ── Step 2: default origin ─────────────────────────────────────────────────

function defaultLlmOrigin(graph) {
  let count = 0;
  for (const e of graph.edges) {
    if (e.origin === undefined) {
      e.origin = 'llm';
      count++;
    }
  }
  return count;
}

async function main() {
  const { graphPath, scanResultPath, patchesDir } = parseArgs(process.argv.slice(2));
  if (!graphPath) {
    console.error(
      'Usage: node apply-graph-patches.mjs <graph.json> [--scan-result <path>] [--patches <dir>]',
    );
    process.exit(1);
  }

  let graph;
  try {
    graph = JSON.parse(readFileSync(graphPath, 'utf-8'));
  } catch (err) {
    console.error(`apply-graph-patches: cannot read graph ${graphPath}: ${err.message}`);
    process.exit(1);
  }
  if (!graph || !Array.isArray(graph.edges)) {
    console.error('apply-graph-patches: graph.edges is missing or not an array');
    process.exit(1);
  }

  let reclassified = 0;
  if (scanResultPath) {
    try {
      const scan = JSON.parse(readFileSync(scanResultPath, 'utf-8'));
      if (scan && typeof scan.importMap === 'object' && scan.importMap !== null) {
        reclassified = reclassifyStructural(graph, scan.importMap);
      } else {
        warn(`no importMap in ${basename(scanResultPath)} — reclassification skipped`);
      }
    } catch (err) {
      warn(
        `cannot read scan result ${basename(scanResultPath)}: ${err.message} — reclassification skipped`,
      );
    }
  }

  const defaulted = defaultLlmOrigin(graph);

  writeFileSync(graphPath, JSON.stringify(graph, null, 2) + '\n', 'utf-8');
  info(`apply-graph-patches: reclassified=${reclassified} defaulted=${defaulted}`);
}

await main();
```

(`dirname`, `resolve`, `join`, `existsSync`, `readdirSync` werden erst in Task 4 benutzt — der Import steht schon vollständig da, damit Task 4 nur Funktionen ergänzt. Falls ESLint über ungenutzte Importe klagt, in diesem Task nur `readFileSync`, `writeFileSync`, `basename` importieren und Task 4 erweitert die Import-Zeile.)

- [ ] **Step 4: Tests laufen lassen — sie müssen bestehen**

Run: `pnpm vitest run tests/skill/understand/test_apply_graph_patches.test.mjs`
Expected: PASS (alle Tests aus Step 1).

- [ ] **Step 5: Commit**

```bash
git add understand-anything-plugin/skills/understand/apply-graph-patches.mjs \
        tests/skill/understand/test_apply_graph_patches.test.mjs
git commit -m "feat(skill): add provenance post-pass script (reclassify + llm default)"
```

---

### Task 4: apply-graph-patches.mjs — Patch-Apply, Idempotenz, KernelResearch-Fixtures

**Files:**
- Modify: `understand-anything-plugin/skills/understand/apply-graph-patches.mjs` (Funktionen ergänzen, `main()` erweitern)
- Test: `tests/skill/understand/test_apply_graph_patches.test.mjs` (neuer describe-Block)
- Create: `tests/skill/understand/fixtures/kernelresearch-patches/` (15 kopierte reale Patch-Dateien)

**Interfaces:**
- Consumes: Script und Test-Harness aus Task 3; `EDGE_TYPE_ALIASES`/`DIRECTION_ALIASES` aus `@understand-anything/core/schema` (Fallback: `packages/core/dist/schema.js`) — **Task 1 muss gebaut sein**.
- Produces: Patch-Verarbeitung gemäß Spec §7.2/§7.3; Summary-Zeile wird zu `apply-graph-patches: reclassified=N defaulted=N patchFiles=N added=N upgraded=N removed=N skipped=N`.

- [ ] **Step 1: Core bauen (Voraussetzung für Alias-Import)**

Run: `pnpm --filter @understand-anything/core build`
Expected: Build ok; `understand-anything-plugin/packages/core/dist/schema.js` existiert und enthält `outgoing`.

- [ ] **Step 2: KernelResearch-Fixtures kopieren**

```bash
mkdir -p tests/skill/understand/fixtures/kernelresearch-patches
cp /c/1_Develop_/Repos/Mine/KernelResearch/.understand-anything/patches/*.patch.json \
   tests/skill/understand/fixtures/kernelresearch-patches/
ls tests/skill/understand/fixtures/kernelresearch-patches/ | wc -l
```
Expected: `15`

- [ ] **Step 3: Failing Tests schreiben**

In `tests/skill/understand/test_apply_graph_patches.test.mjs` am Dateiende anhängen:

```js
describe('apply-graph-patches.mjs — patch application', () => {
  const patchMeta = { title: 't', rationale: 'r', created: '2026-07-03' };

  it('adds a new edge with manual provenance and normalized direction', () => {
    const r = runScript({
      graph: makeGraph([]),
      patches: {
        'a-add.patch.json': {
          _meta: patchMeta,
          edges_to_add: [
            {
              source: 'file:a.cs', target: 'file:b.cs', type: 'imports',
              direction: 'outgoing', weight: 1.0, note: 'hand-verified include',
            },
          ],
        },
      },
    });
    roots.push(r.root);
    expect(r.status).toBe(0);
    expect(r.graph.edges).toHaveLength(1);
    const e = r.graph.edges[0];
    expect(e.origin).toBe('manual');
    expect(e.ruleId).toBe('a-add.patch.json');
    expect(e.confidence).toBe(1.0);
    expect(e.evidence).toBe('hand-verified include');
    expect(e.direction).toBe('forward');
  });

  it('upgrades an existing edge instead of duplicating, keeping description and weight', () => {
    const r = runScript({
      graph: makeGraph([edge({ origin: 'llm', description: 'llm said so', weight: 0.4 })]),
      patches: {
        'a-add.patch.json': {
          _meta: patchMeta,
          edges_to_add: [
            { source: 'file:a.cs', target: 'file:b.cs', type: 'imports', note: 'confirmed' },
          ],
        },
      },
    });
    roots.push(r.root);
    expect(r.graph.edges).toHaveLength(1);
    const e = r.graph.edges[0];
    expect(e.origin).toBe('manual');
    expect(e.ruleId).toBe('a-add.patch.json');
    expect(e.description).toBe('llm said so');
    expect(e.weight).toBe(0.4);
    expect(e.evidence).toBe('confirmed');
  });

  it('manual upgrade also overrides a structural stamp (priority invariant)', () => {
    const r = runScript({
      graph: makeGraph([edge()]),
      importMap: { 'a.cs': ['b.cs'] },
      patches: {
        'a-add.patch.json': {
          _meta: patchMeta,
          edges_to_add: [
            { source: 'file:a.cs', target: 'file:b.cs', type: 'imports', note: 'human says yes' },
          ],
        },
      },
    });
    roots.push(r.root);
    expect(r.graph.edges[0].origin).toBe('manual');
  });

  it('removes matching edges across all directions and type aliases', () => {
    const r = runScript({
      graph: makeGraph([
        edge({ direction: 'forward' }),
        edge({ direction: 'bidirectional' }),
        edge({ type: 'calls' }),
      ]),
      patches: {
        'b-remove.patch.json': {
          _meta: patchMeta,
          edges_to_remove: [
            { source: 'file:a.cs', target: 'file:b.cs', type: 'import', reason: 'misrouted' },
          ],
        },
      },
    });
    roots.push(r.root);
    // "import" alias → imports; both direction variants removed, calls kept.
    expect(r.graph.edges).toHaveLength(1);
    expect(r.graph.edges[0].type).toBe('calls');
  });

  it('skips entries with unknown nodes but applies the rest (per-item resilience)', () => {
    const r = runScript({
      graph: makeGraph([]),
      patches: {
        'c-mixed.patch.json': {
          _meta: patchMeta,
          edges_to_add: [
            { source: 'file:ghost.cs', target: 'file:b.cs', type: 'imports' },
            { source: 'file:a.cs', target: 'file:b.cs', type: 'imports' },
          ],
        },
      },
    });
    roots.push(r.root);
    expect(r.status).toBe(0);
    expect(r.stderr).toContain('Warning: apply-graph-patches:');
    expect(r.graph.edges).toHaveLength(1);
    expect(r.graph.edges[0].source).toBe('file:a.cs');
  });

  it('skips a broken patch file with a warning and still applies later files', () => {
    const r = runScript({
      graph: makeGraph([]),
      patches: {
        'a-broken.patch.json': '{ not json',
        'b-good.patch.json': {
          _meta: patchMeta,
          edges_to_add: [{ source: 'file:a.cs', target: 'file:b.cs', type: 'imports' }],
        },
      },
    });
    roots.push(r.root);
    expect(r.status).toBe(0);
    expect(r.stderr).toContain('Warning: apply-graph-patches: skipping patch a-broken.patch.json');
    expect(r.graph.edges).toHaveLength(1);
  });

  it('skips a patch file without _meta.title', () => {
    const r = runScript({
      graph: makeGraph([]),
      patches: {
        'a-no-meta.patch.json': {
          edges_to_add: [{ source: 'file:a.cs', target: 'file:b.cs', type: 'imports' }],
        },
      },
    });
    roots.push(r.root);
    expect(r.stderr).toContain('missing _meta.title');
    expect(r.graph.edges).toHaveLength(0);
  });

  it('processes files alphabetically with removes before adds per file', () => {
    const r = runScript({
      graph: makeGraph([]),
      patches: {
        // Within one file: remove is a no-op, then add creates the edge.
        'a-first.patch.json': {
          _meta: patchMeta,
          edges_to_remove: [{ source: 'file:a.cs', target: 'file:b.cs', type: 'imports', reason: 'reset' }],
          edges_to_add: [{ source: 'file:a.cs', target: 'file:b.cs', type: 'imports' }],
        },
        // Later file removes what the earlier one added → net: gone.
        'z-last.patch.json': {
          _meta: patchMeta,
          edges_to_remove: [{ source: 'file:a.cs', target: 'file:b.cs', type: 'imports', reason: 'retracted' }],
        },
      },
    });
    roots.push(r.root);
    expect(r.graph.edges).toHaveLength(0);
  });

  it('is idempotent: applying twice yields byte-identical output', () => {
    const r = runScript({
      graph: makeGraph([edge(), edge({ type: 'calls' })]),
      importMap: { 'a.cs': ['b.cs'] },
      patches: {
        'a-add.patch.json': {
          _meta: patchMeta,
          edges_to_add: [
            { source: 'file:a.cs', target: 'file:b.cs', type: 'depends_on', note: 'n' },
          ],
          edges_to_remove: [
            { source: 'file:b.cs', target: 'file:a.cs', type: 'imports', reason: 'x' },
          ],
        },
      },
    });
    roots.push(r.root);
    const firstRun = readFileSync(r.graphPath, 'utf-8');
    const scanPath = join(r.root, 'scan-result.json');
    const patchDir = join(r.root, 'patches');
    const second = spawnSync(
      'node',
      [SCRIPT, r.graphPath, '--scan-result', scanPath, '--patches', patchDir],
      { encoding: 'utf-8' },
    );
    expect(second.status).toBe(0);
    const secondRun = readFileSync(r.graphPath, 'utf-8');
    expect(secondRun).toBe(firstRun);
  });

  it('accepts all 15 real KernelResearch patch files at format level', () => {
    const fixtureDir = resolve(__dirname, 'fixtures/kernelresearch-patches');
    const r = runScript({ graph: makeGraph([]) , patches: {} });
    roots.push(r.root);
    const result = spawnSync(
      'node',
      [SCRIPT, r.graphPath, '--patches', fixtureDir],
      { encoding: 'utf-8' },
    );
    expect(result.status).toBe(0);
    // Node-level skips are expected (this synthetic graph lacks the nodes),
    // but no file may be rejected at format level.
    expect(result.stderr).not.toContain('skipping patch');
    expect(result.stderr).toContain('patchFiles=15');
  });
});
```

- [ ] **Step 4: Tests laufen lassen — der neue Block muss fehlschlagen**

Run: `pnpm vitest run tests/skill/understand/test_apply_graph_patches.test.mjs`
Expected: FAIL — Patch-Tests schlagen fehl (Patches werden ignoriert, Summary enthält kein `patchFiles=`); die Task-3-Tests bestehen weiter.

- [ ] **Step 5: Patch-Apply implementieren**

In `apply-graph-patches.mjs` ergänzen — (a) unter den bestehenden Imports die Core-Alias-Ladung:

```js
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pluginRoot = resolve(__dirname, '../..');

async function loadCoreAliases() {
  const require = createRequire(resolve(pluginRoot, 'package.json'));
  let mod;
  try {
    mod = await import(pathToFileURL(require.resolve('@understand-anything/core/schema')).href);
  } catch {
    mod = await import(pathToFileURL(resolve(pluginRoot, 'packages/core/dist/schema.js')).href);
  }
  return { EDGE_TYPE_ALIASES: mod.EDGE_TYPE_ALIASES, DIRECTION_ALIASES: mod.DIRECTION_ALIASES };
}
```

(b) die Patch-Funktionen (zwischen `defaultLlmOrigin` und `main`):

```js
// ── Step 3: single-case patches ────────────────────────────────────────────

const VALID_DIRECTIONS = new Set(['forward', 'backward', 'bidirectional']);

function normalizeEdgeType(type, EDGE_TYPE_ALIASES) {
  const t = String(type ?? '').toLowerCase();
  return EDGE_TYPE_ALIASES[t] ?? t;
}

function normalizeDirection(direction, DIRECTION_ALIASES) {
  const d = String(direction ?? 'forward').toLowerCase();
  const mapped = DIRECTION_ALIASES[d] ?? d;
  return VALID_DIRECTIONS.has(mapped) ? mapped : 'forward';
}

function loadPatchFiles(patchesDir) {
  if (!existsSync(patchesDir)) return [];
  const names = readdirSync(patchesDir)
    .filter((n) => n.endsWith('.patch.json'))
    .sort();
  const patches = [];
  for (const name of names) {
    let data;
    try {
      data = JSON.parse(readFileSync(join(patchesDir, name), 'utf-8'));
    } catch (err) {
      warn(`skipping patch ${name}: ${err.message}`);
      continue;
    }
    const hasAdds = Array.isArray(data.edges_to_add);
    const hasRemoves = Array.isArray(data.edges_to_remove);
    if (!hasAdds && !hasRemoves) {
      warn(`skipping patch ${name}: neither edges_to_add nor edges_to_remove is an array`);
      continue;
    }
    if (typeof data._meta !== 'object' || data._meta === null || !data._meta.title) {
      warn(`skipping patch ${name}: missing _meta.title`);
      continue;
    }
    patches.push({ name, data });
  }
  return patches;
}

function applyPatches(graph, patchesDir, aliases) {
  const stats = { files: 0, added: 0, upgraded: 0, removed: 0, skipped: 0 };
  const patches = loadPatchFiles(patchesDir);
  const { EDGE_TYPE_ALIASES, DIRECTION_ALIASES } = aliases;
  const nodeIds = new Set((graph.nodes ?? []).map((n) => n.id));

  for (const { name, data } of patches) {
    stats.files++;

    for (const entry of data.edges_to_remove ?? []) {
      if (!entry || !entry.source || !entry.target || !entry.type) {
        warn(`${name}: edges_to_remove entry missing source/target/type — skipped`);
        stats.skipped++;
        continue;
      }
      const type = normalizeEdgeType(entry.type, EDGE_TYPE_ALIASES);
      const before = graph.edges.length;
      graph.edges = graph.edges.filter(
        (e) =>
          !(
            e.source === entry.source &&
            e.target === entry.target &&
            normalizeEdgeType(e.type, EDGE_TYPE_ALIASES) === type
          ),
      );
      const removed = before - graph.edges.length;
      stats.removed += removed;
      if (removed === 0) {
        info(`apply-graph-patches: ${name}: remove ${entry.source} -> ${entry.target} (${type}) matched no edge`);
      }
    }

    for (const entry of data.edges_to_add ?? []) {
      if (!entry || !entry.source || !entry.target || !entry.type) {
        warn(`${name}: edges_to_add entry missing source/target/type — skipped`);
        stats.skipped++;
        continue;
      }
      if (!nodeIds.has(entry.source) || !nodeIds.has(entry.target)) {
        warn(`${name}: add ${entry.source} -> ${entry.target}: unknown node — skipped`);
        stats.skipped++;
        continue;
      }
      const type = normalizeEdgeType(entry.type, EDGE_TYPE_ALIASES);
      const existing = graph.edges.find(
        (e) =>
          e.source === entry.source &&
          e.target === entry.target &&
          normalizeEdgeType(e.type, EDGE_TYPE_ALIASES) === type,
      );
      if (existing) {
        existing.origin = 'manual';
        existing.ruleId = name;
        existing.confidence = 1.0;
        if (typeof entry.note === 'string' && entry.note) existing.evidence = entry.note;
        stats.upgraded++;
        continue;
      }
      const newEdge = {
        source: entry.source,
        target: entry.target,
        type,
        direction: normalizeDirection(entry.direction, DIRECTION_ALIASES),
        weight: typeof entry.weight === 'number' ? Math.max(0, Math.min(1, entry.weight)) : 1.0,
        origin: 'manual',
        ruleId: name,
        confidence: 1.0,
      };
      if (typeof entry.note === 'string' && entry.note) newEdge.evidence = entry.note;
      graph.edges.push(newEdge);
      stats.added++;
    }
  }
  return stats;
}
```

(c) in `main()` nach `const defaulted = defaultLlmOrigin(graph);` einfügen bzw. die zwei Schlusszeilen ersetzen:

```js
  const resolvedPatchesDir =
    patchesDir ?? join(dirname(resolve(graphPath)), 'patches');
  const aliases = await loadCoreAliases();
  const stats = applyPatches(graph, resolvedPatchesDir, aliases);

  writeFileSync(graphPath, JSON.stringify(graph, null, 2) + '\n', 'utf-8');
  info(
    `apply-graph-patches: reclassified=${reclassified} defaulted=${defaulted} ` +
      `patchFiles=${stats.files} added=${stats.added} upgraded=${stats.upgraded} ` +
      `removed=${stats.removed} skipped=${stats.skipped}`,
  );
```

Hinweis: `defaultLlmOrigin` läuft **vor** `applyPatches` — von Patches neu erzeugte Kanten tragen bereits `origin: "manual"` und werden dadurch nicht doppelt behandelt; beim zweiten Lauf sind sie vorhanden und werden per Upgrade idempotent überschrieben.

- [ ] **Step 6: Tests laufen lassen — alle müssen bestehen**

Run: `pnpm vitest run tests/skill/understand/test_apply_graph_patches.test.mjs`
Expected: PASS (Task-3- und Task-4-Blöcke).

- [ ] **Step 7: Gesamtsuite + Lint**

Run: `pnpm test && pnpm lint`
Expected: Keine neuen Fehlschläge gegenüber dem Stand vor Phase ② (bekannte vorbestehende Windows-Umgebungsfehler: `extract-structure.test.mjs`, `merge-recover-imports.test.mjs`, `worktree-redirect.test.mjs` — im Ledger von Phase ① dokumentiert).

- [ ] **Step 8: Commit**

```bash
git add understand-anything-plugin/skills/understand/apply-graph-patches.mjs \
        tests/skill/understand/test_apply_graph_patches.test.mjs \
        tests/skill/understand/fixtures/kernelresearch-patches
git commit -m "feat(skill): apply single-case graph patches with manual provenance"
```

---

### Task 5: Ablauf-Einbettung — SKILL.md Phase 6 und Auto-Update-Hook

**Files:**
- Modify: `understand-anything-plugin/skills/understand/SKILL.md:178` und `:589-591`
- Modify: `understand-anything-plugin/hooks/auto-update-prompt.md:229-233` (Abschnitt „3d. Save")

**Interfaces:**
- Consumes: CLI aus Task 3/4 (`node apply-graph-patches.mjs <graph> --scan-result <pfad> --patches <verzeichnis>`).
- Produces: Prompt-Anweisungen, die das Script an beiden Hook-Punkten aufrufen. Reine Doku-/Prompt-Änderung — Verifikation ist Text-Review, kein Testlauf.

- [ ] **Step 1: SKILL.md — neuen Phase-6-Schritt einfügen**

In `understand-anything-plugin/skills/understand/SKILL.md` direkt nach der Zeile
`2. Write the assembled graph to `$PROJECT_ROOT/.understand-anything/intermediate/assembled-graph.json`.`
(~Zeile 589) einfügen:

```markdown
3. **Provenance & patches (deterministic).** Run the provenance post-pass on the assembled graph. It stamps `origin` on every edge, reclassifies importMap-backed `imports` edges as `structural`, and applies user patches from `.understand-anything/patches/`:

   ```bash
   node <SKILL_DIR>/apply-graph-patches.mjs \
     "$PROJECT_ROOT/.understand-anything/intermediate/assembled-graph.json" \
     --scan-result "$PROJECT_ROOT/.understand-anything/intermediate/scan-result.json" \
     --patches "$PROJECT_ROOT/.understand-anything/patches"
   ```

   Append every stderr line starting with `Warning:` to `$PHASE_WARNINGS`. If the script exits non-zero, append `"provenance step failed — graph saved without provenance"` to `$PHASE_WARNINGS` and continue: the script rewrites the graph file only on success, so the assembled graph is still intact.
```

Anschließend die bisherige Zeile `3. **Check `$ARGUMENTS` for `--review` flag.** ...` (~Zeile 591) zu `4. **Check ...` umnummerieren.

- [ ] **Step 2: SKILL.md — Review-only-Sprungziel anpassen**

Zeile ~178: `..., then jump directly to Phase 6 step 3.` → `..., then jump directly to Phase 6 step 4.` (Der Review-only-Pfad überspringt den Provenance-Schritt bewusst: Er arbeitet auf einem bereits gestempelten `knowledge-graph.json` eines früheren Volllaufs.)

- [ ] **Step 3: Auto-Update-Hook — Apply nach dem Schreiben einfügen**

In `understand-anything-plugin/hooks/auto-update-prompt.md`, Abschnitt `### 3d. Save`: nach dem Punkt `1. Write the final knowledge graph to `$PROJECT_ROOT/.understand-anything/knowledge-graph.json`.` einen neuen Punkt einfügen und alle folgenden Punkte des Abschnitts um eins hochnummerieren:

```markdown
2. Run the provenance & patch post-pass in place on the just-written graph (plugin root as resolved in step 1 of this hook):

   ```bash
   node "$PLUGIN_ROOT/skills/understand/apply-graph-patches.mjs" \
     "$PROJECT_ROOT/.understand-anything/knowledge-graph.json" \
     --scan-result "$PROJECT_ROOT/.understand-anything/intermediate/scan-result.json" \
     --patches "$PROJECT_ROOT/.understand-anything/patches"
   ```

   `scan-result.json` may be absent in this flow — the script then skips reclassification but still stamps defaults and applies patches. Surface every stderr `Warning:` line in the final report; on non-zero exit report it as a warning and continue (the graph file is only rewritten on success).
```

- [ ] **Step 4: Verifikation der Doku-Änderungen**

Run: `grep -n "apply-graph-patches" understand-anything-plugin/skills/understand/SKILL.md understand-anything-plugin/hooks/auto-update-prompt.md && grep -n "Phase 6 step 4" understand-anything-plugin/skills/understand/SKILL.md`
Expected: Je ein Treffer in SKILL.md (Phase 6) und im Hook (3d), plus der angepasste Sprungverweis; keine verwaiste `step 3`-Referenz auf den alten Check (`grep -n "step 3" .../SKILL.md` prüfen).

- [ ] **Step 5: Commit**

```bash
git add understand-anything-plugin/skills/understand/SKILL.md \
        understand-anything-plugin/hooks/auto-update-prompt.md
git commit -m "docs(skill): wire provenance post-pass into understand phase 6 and auto-update hook"
```

---

### Task 6: Dashboard — Origin-Badge in der NodeInfo-Kantenliste

**Files:**
- Modify: `understand-anything-plugin/packages/dashboard/src/components/NodeInfo.tsx:504-536` (Connections-Block; Konstante oberhalb der Komponente ergänzen)

**Interfaces:**
- Consumes: `GraphEdge.origin/ruleId/confidence/evidence` aus Task 1 (via `@understand-anything/core/types`, kommt über den bestehenden `KnowledgeGraph`-Import herein).
- Produces: Badge-Anzeige; keine neue API.

- [ ] **Step 1: Badge-Styles als Modul-Konstante ergänzen**

In `NodeInfo.tsx` auf Modulebene (z. B. direkt nach `getDirectionalLabel`, ~Zeile 44) einfügen:

```tsx
// Phase 2 provenance badge colors, one per EdgeOrigin value.
const ORIGIN_BADGE_STYLES: Record<string, string> = {
  structural: "text-emerald-300 border-emerald-300/30 bg-emerald-300/10",
  llm: "text-text-muted border-border-subtle bg-transparent",
  rule: "text-sky-300 border-sky-300/30 bg-sky-300/10",
  manual: "text-gold border-gold/40 bg-gold/10",
};

function originTooltip(edge: {
  origin?: string;
  ruleId?: string;
  confidence?: number;
  evidence?: string;
}): string {
  return [
    `origin: ${edge.origin}`,
    edge.ruleId ? `rule: ${edge.ruleId}` : null,
    edge.confidence !== undefined ? `confidence: ${edge.confidence}` : null,
    edge.evidence ? `evidence: ${edge.evidence}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}
```

- [ ] **Step 2: Badge in die Connections-Zeile einbauen**

Im Connections-Block (~Zeile 526-530), nach dem Namens-`<span>` und vor dem schließenden `</div>` der Zeile einfügen:

```tsx
                  {edge.origin && (
                    <span
                      className={`ml-auto shrink-0 text-[9px] font-semibold uppercase tracking-wider rounded px-1.5 py-0.5 border ${
                        ORIGIN_BADGE_STYLES[edge.origin] ?? ORIGIN_BADGE_STYLES.llm
                      }`}
                      title={originTooltip(edge)}
                    >
                      {edge.origin}
                    </span>
                  )}
```

Kanten ohne `origin` (alte Graphen) rendern unverändert ohne Badge.

- [ ] **Step 3: Build und Lint**

Run: `pnpm --filter @understand-anything/core build && pnpm --filter @understand-anything/dashboard build && pnpm lint`
Expected: Beide Builds grün (TypeScript kennt `edge.origin` aus Task 1), kein Lint-Fehler.

- [ ] **Step 4: Sichtprüfung (optional, wenn ein Graph mit Provenance vorliegt)**

Run: `pnpm dev:dashboard` gegen ein Projekt mit gestempeltem Graphen; Knoten anklicken → Connections zeigen Badges; Tooltip zeigt ruleId/confidence/evidence.
Expected: Badge rechtsbündig in der Kantenzeile, vier Farbvarianten.

- [ ] **Step 5: Commit**

```bash
git add understand-anything-plugin/packages/dashboard/src/components/NodeInfo.tsx
git commit -m "feat(dashboard): show edge origin badge with provenance tooltip in NodeInfo"
```

---

### Task 7: Integrationsmessung MachineSIC + KernelResearch, Spec-Update

**Files:**
- Modify: `docs/superpowers/specs/2026-07-02-deterministic-linking-design.md` (§7.6, Messergebnis-Absatz anhängen)
- Arbeitsdateien nur im Scratchpad/Temp — nichts davon committen.

**Interfaces:**
- Consumes: alle vorherigen Tasks; Prüfsteine `C:\1_Develop_\Repos\Mine\Understand-Anything\MachineSIC` und `C:\1_Develop_\Repos\Mine\KernelResearch` (Graph + 15 Patches).
- Produces: dokumentiertes Messergebnis in §7.6.

- [ ] **Step 1: Builds sicherstellen**

Run: `pnpm --filter @understand-anything/core build`
Expected: ok.

- [ ] **Step 2: MachineSIC — importMap erzeugen (wie Phase-①-Messung)**

Arbeitsverzeichnis anlegen (z. B. `$TMP/ua-phase2-meas/`), dann Input aus den Fingerprints bauen und den Resolver laufen lassen:

```bash
MEAS=$(mktemp -d)
python - "$MEAS" <<'PY'
import json, sys, os
meas = sys.argv[1]
root = r'C:\1_Develop_\Repos\Mine\Understand-Anything\MachineSIC'
fp = json.load(open(os.path.join(root, '.understand-anything', 'fingerprints.json'), encoding='utf-8'))
files = fp['files'] if 'files' in fp else fp
inp = {
    'projectRoot': root,
    'files': [{'path': p, 'language': 'csharp', 'fileCategory': 'code'}
              for p in files if p.endswith('.cs')],
}
json.dump(inp, open(os.path.join(meas, 'eim-input.json'), 'w', encoding='utf-8'))
PY
node understand-anything-plugin/skills/understand/extract-import-map.mjs \
  "$MEAS/eim-input.json" "$MEAS/eim-output.json"
```
Expected: stderr endet mit Stats `filesScanned=... totalEdges≈418` (Toleranz wie Phase ①).

- [ ] **Step 3: MachineSIC — Pipeline-Segment simulieren (Recover → Apply)**

Graph kopieren, Recovery per Treiber ausführen (stempelt `structural`), dann Apply-Script (Reklassifikation + Default; `eim-output.json` hat das Feld `importMap` und taugt direkt als `--scan-result`):

```bash
cp /c/1_Develop_/Repos/Mine/Understand-Anything/MachineSIC/.understand-anything/knowledge-graph.json "$MEAS/graph.json"
python - "$MEAS" <<'PY'
import importlib.util, json, sys
from pathlib import Path
meas = Path(sys.argv[1])
spec = importlib.util.spec_from_file_location(
    'mbg', 'understand-anything-plugin/skills/understand/merge-batch-graphs.py')
mbg = importlib.util.module_from_spec(spec); spec.loader.exec_module(mbg)
graph = json.loads((meas / 'graph.json').read_text(encoding='utf-8'))
recovered, lines = mbg.recover_imports_from_scan(graph, meas / 'eim-output.json')
print('\n'.join(lines), file=sys.stderr)
(meas / 'graph.json').write_text(json.dumps(graph, indent=2) + '\n', encoding='utf-8')
print(f'recovered={recovered}', file=sys.stderr)
PY
node understand-anything-plugin/skills/understand/apply-graph-patches.mjs \
  "$MEAS/graph.json" --scan-result "$MEAS/eim-output.json"
```
Expected: `recovered≈418`; Apply-Summary mit `defaulted=<Restkanten>` und `reclassified=0` (alle imports-Kanten kamen bereits gestempelt aus dem Recover — das bestätigt den Erzeuger-Stempel).

- [ ] **Step 4: MachineSIC — Verteilung auswerten**

```bash
python - "$MEAS" <<'PY'
import json, sys
from pathlib import Path
from collections import Counter
graph = json.loads((Path(sys.argv[1]) / 'graph.json').read_text(encoding='utf-8'))
c = Counter(e.get('origin', '<none>') for e in graph['edges'])
total = len(graph['edges'])
print(f'total={total}', dict(c))
assert c['<none>'] == 0, 'edges without origin found'
PY
```
Expected: `<none>` = 0 (Messgröße „100 % der Kanten tragen origin"), `structural ≈ 418 + tested_by-Anteil`, Rest `llm`.

- [ ] **Step 5: KernelResearch — Patches anwenden**

```bash
cp /c/1_Develop_/Repos/Mine/KernelResearch/.understand-anything/knowledge-graph.json "$MEAS/kr-graph.json"
node understand-anything-plugin/skills/understand/apply-graph-patches.mjs \
  "$MEAS/kr-graph.json" \
  --patches /c/1_Develop_/Repos/Mine/KernelResearch/.understand-anything/patches
```
Expected: exit 0, `patchFiles=15`, `added+upgraded+removed > 0`; `Warning:`-Zeilen nur für Einträge, deren Knoten im Graphen tatsächlich fehlen (jede einzelne prüfen und im Messprotokoll erklären). Falls `kr-graph.json` nicht existiert, diesen Prüfstein als „nicht verfügbar" dokumentieren und die Fixture-Ebene aus Task 4 als Beleg zitieren.

- [ ] **Step 6: Idempotenz am Realdaten-Graphen**

Beide Apply-Aufrufe (Step 3 und Step 5) jeweils ein zweites Mal identisch ausführen und die Dateien vergleichen:

```bash
cp "$MEAS/graph.json" "$MEAS/graph-run1.json"
node understand-anything-plugin/skills/understand/apply-graph-patches.mjs \
  "$MEAS/graph.json" --scan-result "$MEAS/eim-output.json"
cmp "$MEAS/graph-run1.json" "$MEAS/graph.json" && echo IDEMPOTENT
```
Expected: `IDEMPOTENT`.

- [ ] **Step 7: Messergebnis in Spec §7.6 dokumentieren**

An §7.6 einen Absatz `**Messergebnis (<Ausführungsdatum>):** ...` anhängen mit: Kantenzahl gesamt, origin-Verteilung (structural/llm/manual), recovered-Zahl, KernelResearch-Ergebnis (patchFiles/added/upgraded/removed/übersprungene Einträge mit Grund), Idempotenz-Bestätigung.

- [ ] **Step 8: Commit**

```bash
git add docs/superpowers/specs/2026-07-02-deterministic-linking-design.md
git commit -m "docs: record phase 2 provenance measurement on MachineSIC and KernelResearch"
```

---

## Nicht-Ziele (aus Spec §7.7 — im Zweifel NICHT bauen)

Muster-Regeln/Linker-Engine, Suppressions-Liste im Graphen, Origin-Filter im FilterPanel, confidence für llm-Kanten, Änderungen an LLM-Agenten-Prompts, Dedup-Vereinheitlichung über Merge-Pfade, provenance-bewusste Dedup-Präferenz in Domain-/Knowledge-Merges.
