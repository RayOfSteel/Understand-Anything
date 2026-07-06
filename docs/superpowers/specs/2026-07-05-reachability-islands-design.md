# Design: Trigger-Erreichbarkeit und Island Research Missions

**Datum:** 2026-07-05
**Status:** Implementiert (2026-07-05) — bis auf Match-Typ `query` (kommt mit der Pack-Befüllung, §9)
**Verhältnis zu anderen Specs:** baut auf der Regel-Infrastruktur aus `2026-07-02-deterministic-linking-design.md` §8 auf (deklarative JSON-Regeln, Packs im Plugin + repo-lokale Regeln) und realisiert/erweitert deren offene Phase ④ (Gap-Diagnose).

## 1. Kontext und Motivation

Die einzige Konnektivitätsprüfung im heutigen Pipeline-Output ist ein **Degree-Check**: ein Node gilt als „orphan", wenn er an keiner einzigen Kante hängt. Implementiert zweimal identisch — im Inline-Validator (`skills/understand/SKILL.md`, Phase 6, `withEdges`-Set) und als Check 7 des `graph-reviewer` — und in beiden Fällen nur als nicht-blockierende Warnung.

**Die Lücke:** Zwei Dateien, die sich gegenseitig referenzieren, aber mit dem Rest der Applikation nichts zu tun haben (A↔B-Insel), bestehen den Degree-Check. Allgemeiner: der Check misst lokalen Grad, nicht globale Anbindung. Es gibt heute

- keine Zusammenhangskomponenten-Analyse auf dem Knowledge Graph,
- keine Erreichbarkeitsprüfung von Entry Points aus,
- keinen Mechanismus, der auf Basis des fertigen Graphen **Nachanalysen** auslöst (die Batch-Zusammensetzung steht vor jedem LLM-Output fest; Phase 3/6 patchen nur Schema- und Referenzfehler).

Entry Points existieren als Konzept, aber nur flach und für andere Zwecke: Dateinamen-Heuristiken (`Program.cs`, `main.go`, `index.ts`, …) fürs Tagging in `file-analyzer`/`architecture-analyzer`, ein einzelner `$ENTRY_POINT` für die Tour, und ein reicherer Detektor (HTTP-Routen, CLI-Kommandos) nur in der Domain-Pipeline (`skills/understand-domain/extract-domain-context.py`).

**Anspruch dieses Designs:** Jede zusammenhängende Node-Gruppe („Kette") muss von einem Trigger/Entry Point aus erreichbar sein — oder explizit als isoliert klassifiziert werden, mit Confidence und Begründung. Unerreichbare Cluster werden getrackt, dem User als Liste vorgelegt und in budgetierten **Research Missions** untersucht.

## 2. Entschiedene Grundsatzfragen

1. **Isolation ist ein legitimes Endergebnis.** Eine Mission versucht zuerst, fehlende Verbindungen zu finden; findet sie keine, wird der Cluster als `isolated` markiert — **mit Confidence (high/medium/low) und Begründung**, nie als binäres Urteil. Der Graph ist damit „grün". Kein Zwang, alles anzubinden (keine erfundenen Kanten, garantierte Terminierung).
2. **Kriterium ist Erreichbarkeit VON einem Trigger aus** über gerichtete Kanten — nicht bloß „Komponente enthält irgendeinen Entry Point". Damit werden auch tote Äste *innerhalb* verbundener Komponenten sichtbar. Die Richtungs-Semantik pro Kantentyp ist in §5.2 definiert.
3. **100 % sind nicht das Ziel eines einzelnen Runs.** Der Vorgang ist ein Team-Effort über mehrere Runs: Schritt 1 ist Tracken, Schritt 2 die Liste für den User. Missions laufen interaktiv budgetiert: die ersten 10 automatisch, danach Checkpoint (§6.3).
4. **Integration doppelt (A+B):** als neue Phase 6.5 im `/understand`-Flow **und** als eigenständiges Skill `/understand-islands` auf bestehenden Graphen. Gleiche Bausteine, zwei Einstiegspunkte.
5. **Trigger-Erkennung ist ein eigener logischer Schritt nach der Framework-/Architektur-Analyse** (Census, §4) — nicht nur verstreute Dateinamen-Heuristiken.
6. **Regeln statt Instanzen, in zwei Schichten:** Framework-generische Trigger-Regeln gehören in ausgelieferte Packs; repo-spezifische Mechanismen (Hauskonventionen, Custom-Plugin-Systeme) werden pro Repo gelernt und persistiert. Ein Schema, zwei Quellen; gelernte Regeln können später in Packs promoted werden.

## 3. Trigger-Regeln

### 3.1 Format und Ablage

Trigger-Regeln nutzen die in der Linking-Spec entschiedene Infrastruktur: **deklaratives JSON, Zod-validiert in core, reine Daten**. Sie sind eine neue Regelart neben den Linker-Regeln — Linker-Regeln erzeugen Kanten, Trigger-Regeln markieren Nodes als Trigger.

Ablage analog zur Linking-Spec (Weggabelung 3, „beides, additiv"):

- **Packs (shipped):** `understand-anything-plugin/rules/triggers/*.json` — framework-generisch, ausgewählt nach den im Scan erkannten Frameworks/Sprachen. Die heutigen Dateinamen-Heuristiken aus `file-analyzer.md`/`architecture-analyzer.md` werden als erstes, minimales Starter-Pack in Daten überführt (Prompt-Prosa → Regeln).
- **Repo-Registry (gelernt/User):** `.understand-anything/rules/triggers/*.json` im Ziel-Repo — von Census und Missions geschrieben, vom User editierbar, überlebt Runs. Repo-Regeln können Pack-Regeln überstimmen (`disables`-Feld für False-Positive-Abschaltung).

### 3.2 Schema (Kern)

```json
{
  "id": "trigger:tdm:scr-scripts",
  "kind": "trigger",
  "match": {
    "type": "glob | path-regex | symbol | query",
    "pattern": "scripts/**/*.scr"
  },
  "description": "Jede .scr unter /scripts wird vom TDM-Runtime ausgeführt",
  "evidence": "ScriptHost.cs:214 lädt Verzeichnis per Directory.GetFiles(\"*.scr\")",
  "confidence": 0.9,
  "source": "pack:<name> | census | mission:<id> | user",
  "disables": []
}
```

`match.type = "query"` nutzt Tree-Sitter-Queries als Matching-Primitiv (gleiches Prinzip wie Linker-Regeln, z. B. „Klasse erbt `ServiceBase`", „Methode trägt `[HttpGet]`"). `glob`/`path-regex` matchen auf Dateipfade, `symbol` auf Node-Namen/-Typen im Graph.

### 3.3 Anwendungs-Pass (deterministisch)

Ein Script-Pass (Teil von `compute-reachability.mjs`, §5) merged Packs + Repo-Registry, wertet `disables` aus und wendet alle Regeln auf den Graph an: matchende Nodes erhalten das `entry-point`-Tag und die `triggeredBy`-Regel-ID (Provenance analog zu Kanten-`origin`/`ruleId` aus Linking-Spec Phase ②). **Eine gelernte Regel kann so hunderte Geschwister-Inseln ohne weitere LLM-Spawns anbinden.** Der Pass läuft nach jeder Missionsrunde erneut.

## 4. Phase 6.5a — Trigger-Census (1 LLM-Spawn)

Läuft nach Review (Phase 6), vor Save (Phase 7) — also nachdem Frameworks (Scan) und Layer (`layers.json`) bekannt sind.

1. **Deterministischer Vor-Pass:** Regel-Anwendung (§3.3) plus Portierung des Entry-Point-Detektors aus `extract-domain-context.py` (HTTP-Routen, CLI-Kommandos) als Kandidaten-Generator.
2. **Census-Agent (neu, 1 Spawn):** erhält erkannte Frameworks, `layers.json`, Graph-Zusammenfassung, Kandidatenliste. Auftrag: Kandidaten bestätigen/verwerfen und **gezielt ergänzen**, was Muster nicht sehen — Windows-Service-`OnStart`, Scheduled Tasks, Message-Queue-Consumer, COM-Registrierungen, Build-/Installer-Targets, IIS-Verdrahtung. **Pflichtfrage bei jedem Fund:** „Einzelfall — oder Mechanismus, aus dem eine Regel für das ganze Repo ableitbar ist?" Regeln landen in der Repo-Registry (§3.1), Einzelfälle als direkte Tags.
3. Ergebnis: `triggers.json` (das aufgelöste Trigger-Set mit Provenance) + Tags im Graph.

Census und Missions korrigieren sich gegenseitig: ein schlechter Census verrät sich durch riesige unerreichbare Flächen, und Missions fangen übersehene Entry Points ab (§6.2, Ergebnisart 2).

## 5. Phase 6.5b — Erreichbarkeitsanalyse (deterministisch, kein LLM)

Neues Script `skills/understand/compute-reachability.mjs`. Input: Graph + `triggers.json`. Kein Content-Read, reine Graph-Traversierung.

### 5.1 Algorithmus

1. **Forward-BFS** vom Trigger-Set über strukturtragende Kantentypen (§5.2) → Menge `reachable`.
2. **Satelliten-Fixpoint:** Ein Node gilt als `attached`, wenn er per Satelliten-Kantentyp auf einen `reachable`/`attached` Node **zeigt** (iterieren bis Fixpunkt). Satelliten seeden keine Forward-BFS — eine tsconfig macht nicht alles erreichbar, was sie importiert.
3. **Rest clustern:** Alle weder `reachable` noch `attached` Nodes werden zu **schwach zusammenhängenden Komponenten** gruppiert (Union-Find über alle Kanten ungeachtet der Richtung). Das ist die Insel-Liste; der A↔B-Fall ist eine 2-Node-Komponente.

### 5.2 Kantensemantik

| Klasse | Typen | Traversierung |
|---|---|---|
| Strukturtragend | `imports`, `calls`, `inherits`, `implements`, `exports`, `depends_on`, `defines_schema`, `serves`, `routes`, `provisions`, `triggers` | forward (Quelle → Ziel) |
| Containment | `contains` | **bidirektional** — Zugehörigkeit ist Identität, nicht Nutzung: wird eine Funktion erreicht, ist ihre Datei erreichbar und umgekehrt |
| Beides | `deploys` | forward **und** Attachment: ein (z. B. via CI-`triggers`) erreichbares Dockerfile macht deployten Code erreichbar; umgekehrt attacht ein Dockerfile, das auf erreichbaren Code zeigt |
| Satellit | `configures`, `documents`, `migrates`, `tested_by` | nur Attachment-Fixpunkt (§5.1 Schritt 2) |
| Schwach | `related` | **gar nicht** — ein „related"-Link rettet keine Insel |

Konsequenz der Satelliten-Regel für `tested_by`: Tests, die erreichbaren Code testen, sind angebunden; Produktionscode, der **nur** über Tests erreicht würde, bleibt unerreichbar — das ist gewollt und wird im Report separat ausgewiesen („nur über Tests referenziert").

### 5.3 Output

- `islands.json` (Tracking, `.understand-anything/`): pro Komponente `id`, Node-IDs, Dateien, Größe, dominante Kategorie, `status` (`unresolved` | `missioned` | `isolated` | `connected`), ggf. `confidence`, `verdictReason`, `missionId`, `updatedAt`. **Überlebt Runs** — Folge-Runs rechnen Erreichbarkeit neu, übernehmen aber vorhandene `isolated`-Verdikte samt Confidence, solange sich die Komponente nicht verändert hat.
- Lesbare Liste im Run-Report, nach Größe sortiert: „Schritt 1 Tracken, Schritt 2 Liste" ist damit immer erfüllt, auch wenn keine einzige Mission läuft.
- Jeder Node erhält `reachability: "reachable" | "attached" | "isolated" | "unresolved"` (Schema-Erweiterung in `packages/core`, Zod + Dashboard-Validierung).

## 6. Phase 6.5c — Research Missions

### 6.1 Neuer Agent: `island-researcher`

Missions bündeln Cluster nach Pfadnähe (mehrere Kleinstinseln pro Spawn, Obergrenze ~15 Dateien bzw. ~5 Cluster pro Mission). Input pro Mission: die Cluster (Dateien + Node-Zusammenfassungen), das Trigger-Set, die Framework-Liste, Zugriff auf den Quellcode.

### 6.2 Auftrag und Ergebnisarten

Pro Cluster gezielt nach eingehenden Referenzen im Restkorpus suchen: Grep nach Dateinamen, exportierten Symbolen, Config-Strings, DI-/Reflection-Registrierungen, dynamischen Imports, Build-Skripten. Zusätzlich prüfen, ob der Cluster selbst ein übersehener Entry Point ist. Genau eine von drei Ergebnisarten pro Cluster:

1. **Neue Kanten** — mit Evidence und Provenance (`origin: "island-mission"`, `missionId`), Format kompatibel zum bestehenden Patch-/Merge-Pfad.
2. **Neuer Trigger** — Tag + ggf. **neue Trigger-Regel** in der Repo-Registry. Pflichtfrage wie beim Census: Einzelfall oder Mechanismus? Ein gefundener Mechanismus (z. B. Reflection-Laden nach Namenskonvention) wird als Regel emittiert und rettet beim Recompute alle Geschwister.
3. **Verdikt `isolated`** — mit Confidence (`high`/`medium`/`low`) und Begründung (z. B. „Dead Code seit Umstellung X", „eigenständiges Wartungstool, bewusst unverdrahtet").

### 6.3 Budget-Loop (interaktiv)

1. Missions für die größten/nächstliegenden Cluster planen; **die ersten 10 laufen automatisch** (parallel, bestehende Concurrency-Grenzen der Pipeline).
2. Nach der Runde: Regel-Pass (§3.3) → Erreichbarkeit neu berechnen (§5) → `islands.json` aktualisieren. Eine gefundene Kante/Regel kann mehrere Cluster auf einmal anbinden.
3. Bleiben unbearbeitete Cluster, **Checkpoint per AskUserQuestion**: *1. Liste gemeinsam ansehen · 2. Limit um 10 erhöhen · 3. Stoppen — Rest bleibt als `unresolved` getrackt.* Loop bis Stopp oder Liste leer.

Nicht untersuchte Cluster sind kein Fehlerzustand: Status `unresolved`, sichtbar im Report, Wiedervorlage im nächsten Run.

## 7. Integration

- **Phase 6.5 in `skills/understand/SKILL.md`** (nach Phase 6 Review, vor Phase 7 Save), standardmäßig aktiv; `--skip-islands` schaltet ab. Kostenrahmen default: 1 Census-Spawn + max. 10 Mission-Spawns vor dem ersten Checkpoint.
- **Standalone-Skill `skills/understand-islands/SKILL.md`** (`/understand-islands [path]`): läuft auf bestehendem `knowledge-graph.json`, führt den Census aus, falls `triggers.json` fehlt, sonst direkt 6.5b/c. Nutzt dieselben Scripts/Agents; setzt `islands.json` fort statt neu zu beginnen.
- Der Inline-Validator (Phase 6) und `graph-reviewer` Check 7 bleiben unverändert (Degree-Check als billige Vorstufe); der Report verweist bei Orphan-Warnungen auf die Insel-Liste.

## 8. Testing

Vitest, Fixtures unter `tests/skill/` analog zu bestehenden Tests:

- `compute-reachability.mjs`: A↔B-Insel wird als 2-Node-Komponente erkannt; Satelliten-Config attacht (tsconfig → erreichbarer Code) ohne Forward-Seed; Multi-Root (zwei Trigger, zwei erreichbare Teilgraphen, keine Insel); „nur über Tests erreichbar" bleibt unerreichbar, wird aber ausgewiesen; `contains` bidirektional (erreichte Funktion macht Datei erreichbar).
- Regel-Pass: Glob-Trigger-Regel rettet Geschwister-Inseln in einem Durchlauf; `disables` überstimmt Pack-Regel; Zod-Schema weist defekte Regeln ab.
- Persistenz: `islands.json`-Merge über zwei Läufe (unverändertes `isolated`-Verdikt bleibt, veränderte Komponente wird `unresolved`).
- Mission-Output: Kanten-/Regel-/Verdikt-Format wird vom Merge-Pfad akzeptiert (Schema-Test, kein LLM im Test).

## 9. Bewusst außerhalb des Scopes

- **Dashboard-Visualisierung** der Inseln (Einfärbung, Filter) — separates Follow-up.
- **Befüllung umfangreicher Framework-Packs** (ASP.NET, WPF, Quartz, …) — die Architektur steht, das Füllen ist ein eigenes Thema; Regeln aus dem TDM-Korpus können exportiert werden.
- **Promotion-Tooling** (gelernte Regel → Pack) — vorerst manueller Copy-Vorgang, gleiche Datei-Form.
- **Gerichtete Dead-Branch-Analyse unterhalb von Datei-Ebene** (einzelne ungenutzte Funktionen in erreichbaren Dateien) — Kriterium ist vorerst die Komponente/Datei.
