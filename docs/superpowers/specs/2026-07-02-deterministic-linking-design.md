# Design: Deterministische Verbindungsschicht für Understand-Anything

**Datum:** 2026-07-02
**Status:** Phase ① umgesetzt und gemessen; Phase ② detailliert und freigegeben (2026-07-03)
**Prüfstein:** MachineSIC-Graph (`MachineSIC/.understand-anything/knowledge-graph.json`, 208 Dateien, 626 Nodes, 920 Edges)

## 1. Kontext und Motivation

Ein Stock-Lauf von `/understand` auf einer realen Multi-Repo-.NET-Solution (MachineSIC: ASP.NET Core, WPF, Blazor, DryIoc) hat zwei strukturelle Lücken empirisch belegt:

**Befund A — Die deterministische Verbindungsebene fehlt für C# vollständig.**
Der Graph enthält 0 `imports`-Kanten. Ursache: `resolveCSharpImport` in `skills/understand/extract-import-map.mjs` übersetzt `using X.Y.Z` in den Pfad-Suffix `X/Y/Z.cs` und prüft dessen Existenz (`resolveDottedFqn`, Zeile ~937). Das Java-Modell (Klasse = Dateiname, Package = Verzeichnis) gilt in C# nicht: `using` benennt einen Namespace, und Dateien heißen nach Typen. Ergebnis auf MachineSIC: 208/208 importMap-Einträge leer; 79 von 147 C#-Dateien hängen ausschließlich über `contains`/`exports` an ihren eigenen Membern.

**Befund B — Framework-Verdrahtung existiert nur als inkonsistente LLM-Leistung.**
Die vorhandene Konnektivität (92 `calls`, 88 `depends_on`, 22 `implements`) stammt aus der LLM-Phase und ist nicht reproduzierbar: Von 9 XAML-Views erhielt 1 die mechanisch triviale Code-behind-Kante (`View.xaml ↔ View.xaml.cs`), 7 erhielten stattdessen geratene (inhaltlich plausible) ViewModel-Kanten, Event-Handler-Kanten fehlen komplett, `inherits` wurde als „MVVM-Boilerplate" weitgehend ausgelassen (5 Kanten gesamt, obwohl z. B. `CommandBase → MoveCommandBase → MoveCommand` im Quelltext steht). Alle 3 `.resx`-Dateien sind isoliert.

**Konsequenz:** Der größte Qualitätshebel liegt nicht in der LLM-Phase, sondern darin, wiederkehrende Muster **vor** dem LLM deterministisch sichtbar zu machen — als Resolver-Fixes (Sprach-Ebene) und als Framework-Linker (Cross-File-Ebene).

## 2. Geklärte Grundsatzfrage: Grammatik vs. darüberliegende Schichten

Geprüft und entschieden: Framework-Unterstützung (z. B. WPF) wird **nicht** über Tree-Sitter-Grammatiken oder Grammar-Vererbung gebaut.

Belege:
- WPF-Code-behind ist syntaktisch normales C#. Die unveränderte `tree-sitter-c-sharp`-Grammatik parst eine typische WPF-Datei fehlerfrei und liefert alle relevanten Knoten (`partial`-Modifier, `InitializeComponent`-Aufruf, Event-Handler-Methode). Eine erbende „WPF-Grammatik" hätte keine Syntaxregel zu ergänzen.
- XAML ist syntaktisch XML; eine Grammatik existiert als npm-Paket und muss nur eingebunden werden (heute hat `languages/configs/xml.ts` weder `.xaml`-Extension noch `treeSitter`-Eintrag).
- Die WPF-Verbindung (`x:Class` ↔ `partial class`) ist eine Aussage über **zwei** Dateien. Ein Tree-Sitter-Parser erhält einen String und liefert einen Baum über den Bytes dieser einen Datei; im Ausgabeformat existiert kein Platz für dateiübergreifende Beziehungen.

Daraus die Schichtenregel für alle künftigen Fälle:
- **Syntax fehlt** (proprietäre DSL) → Grammatik/Parser ergänzen.
- **Fakten fehlen** (Attribut, Deklaration wird nicht extrahiert) → Extractor/Query auf bestehender Grammatik.
- **Kanten fehlen** (Fakten vorhanden, Verbindung nicht) → Linker.

Eine Grammar-Authoring-Pipeline (tree-sitter CLI + WASM-Build für eigene DSLs) ist **bewusst außerhalb des Scopes** dieses Designs; in MachineSIC existiert keine Datei mit unparsebarer Syntax. Sie kann als eigenes Folgeprojekt aufgesetzt werden, sobald ein konkreter DSL-Fall vorliegt.

## 3. Phasenplan (Ansatz: inkrementell, jede Phase einzeln lieferbar und an MachineSIC messbar)

| Phase | Inhalt | Messgröße am Prüfstein |
|---|---|---|
| ① | C#-Namespace-Resolver | `imports`-Kanten: 0 → ≈ 418 |
| ② | Provenance-Felder auf Kanten | jede Kante trägt Herkunft (`origin`, `ruleId`, `confidence`) |
| ③ | Linker-Infrastruktur + WPF-Pack | Code-behind-Paarung 9/9 statt 1/9; Event-Handler-Kanten > 0 |
| ④ | Gap-Diagnose (`/understand-diagnose-gaps`) | Cluster-Report über isolierte/schwach verbundene Nodes |
| ⑤ | Feedback-Loop (Dashboard → Regel) | falsche Kante → verursachende Regel identifizierbar |

Abhängigkeiten: ③ setzt ② voraus (Linker-Kanten brauchen Provenance ab dem ersten Tag). ④ erzeugt Vorschläge, die die Engine aus ③ konsumiert. ⑤ setzt ② und ③ voraus. ① ist unabhängig und zuerst, damit die Diagnose in ④ nicht die halbe Solution fälschlich als „unverbunden" meldet.

## 4. Offene Weggabelungen (je zu Beginn der betroffenen Phase zu entscheiden)

1. **Regelformat für Linker** (Phase ③): deklarative JSON-Regeln mit generischer Engine vs. TypeScript-Code-Linker vs. Hybrid. Tendenz aus der Diskussion: deklarativ mit engine-interner Linker-Schnittstelle als Escape-Hatch — **nicht final entschieden**.
2. **Fork vs. Upstream-Contribution** — **entschieden (2026-07-02): Fork.** Entwicklung auf dem eigenen Branch (`myMaster`); bestehende Konventionen (TypeScript strict, Vitest, ESM) werden beibehalten, weil sie der Wartbarkeit dienen, nicht wegen Upstream-Kompatibilität. Eine spätere Upstream-Contribution einzelner Phasen bleibt möglich, ist aber kein Gestaltungsziel.
3. **Ablageort projektspezifischer Regeln** (Phase ③/④): im Plugin ausgeliefert vs. `.understand-anything/rules/` im Ziel-Repo. Sicherheitsrelevant, falls Regeln Code enthalten dürften.
4. **Formalisierung des vorhandenen Ad-hoc-Patch-Formats** — **entschieden (2026-07-03): formalisieren + maschinell anwenden.** Das Ad-hoc-Format wird als offizielles Einzelfall-Patch-Format übernommen (bestehende Dateien bleiben unverändert gültig) und von einem Apply-Schritt in der Pipeline angewendet. Details in §7.2/§7.3. Generalisierte Muster-Regeln bleiben Phase ③.

## 5. Phase ① im Detail: C#-Namespace-Resolver (freigegeben)

### 5.1 Auflösungsstrategie (entschieden: „V2 + Same-Namespace")

Simulation beider Varianten auf MachineSIC (147 C#-Dateien, 147 mit Namespace-Deklaration, 52 Namespaces, größter 8 Dateien, 254 projektintern auflösbare `using`-Direktiven):

| Variante | Mechanik | Kanten | angeschlossene Dateien |
|---|---|---|---|
| V1 Namespace-Expansion | `using X` → alle Dateien mit `namespace X` | 822 | 139/147 |
| **V2 + Same-Namespace (gewählt)** | wie V1, Kante nur bei nachgewiesener Typ-Referenz; zusätzlich Referenzen innerhalb des eigenen Namespace (dort verlangt C# kein `using`) | 341 + 77 ≈ **418** | 122/147 (nur using-Anteil gemessen; mit Same-Namespace-Kanten mehr) |

Begründung: `imports`-Kanten speisen Layer-Analyse, Tour und Chat-Retrieval; V1 enthielte ≈ 480 Kanten ohne belegte Nutzung („liegt im selben using, wird nie benutzt"). Der V2-Filter bleibt vollständig deterministisch.

### 5.2 Änderungen

**Core — `packages/core/src/plugins/extractors/csharp-extractor.ts`:**
Neues optionales Feld `namespaces: string[]` in `StructuralAnalysis` (additiver Typ-/Zod-Change, kein bestehender Consumer bricht). Erfasst: block-scoped `namespace X { }`, file-scoped `namespace X;`, verschachtelt `A { B { } }` → `A.B`, mehrere Namespaces pro Datei. Deklarierte Typnamen liefert `classes` bereits.

**Skill — `skills/understand/extract-import-map.mjs`:**
C#-Auflösung wird zweiphasig:
- *Pass 1:* Über alle `.cs`-Dateien `csNamespaceIndex: Namespace → [{Datei, Typnamen}]` aufbauen. Wiederverwendung der ohnehin stattfindenden Tree-Sitter-Läufe, kein Doppel-Parse.
- *Pass 2:* `resolveCSharpImport` ersetzt den Pfad-Suffix-Probe-Ansatz: Kandidaten aus dem Index, dann Typ-Referenz-Filter (Wortgrenzen-Suche der Kandidaten-Typnamen im Quelltext der importierenden Datei, der im Script bereits im Speicher liegt). Zusätzlich pro Datei: derselbe Filter gegen die übrigen Dateien des eigenen Namespace.

**Unverändert:** Merge-Schritt (importMap-Wiederherstellung erzeugt die Kanten), Graph-Schema, Dashboard, Fingerprints.

### 5.3 Bewusste v1-Grenzen

- `global using` wirkt nur als Import der deklarierenden Datei, nicht projektweit.
- `using static A.B.C` wird wie `using A.B` behandelt.
- Typ-Referenz-Filter matcht auch Vorkommen in Kommentaren/Strings (falsch-positive Kanten möglich). Folgeverbesserung: Identifier aus dem Syntaxbaum statt Textsuche.
- Aliase (`using Foo = A.B.C;`) funktionieren über die bestehende Alias-Zielextraktion des Extractors.
- Dateien, die ausschließlich `struct`/`record`/`enum`/`delegate` deklarieren, können nicht als Kantenziel aufgelöst werden — der Namespace-Index speist sich nur aus den `class`- und `interface`-Deklarationen des Extractors (fehlende, nie falsche Kanten). Folgeverbesserung: mechanische Extractor-Erweiterung um die weiteren Deklarations-Cases.

### 5.4 Verifikation

- Unit-Fixtures: block-scoped, file-scoped, verschachtelte Namespaces; Same-Namespace-Referenz ohne `using`; Alias; Typname nur im Kommentar (erwartet: je nach Filterstand dokumentiert).
- Regressionslauf der bestehenden Import-Map-Tests (andere Sprachen unberührt).
- Integrationsmaß: erneuter Scan von MachineSIC → erwartet ≈ 418 `imports`-Kanten (± Simulationstoleranz), Stichprobe von 10 zufälligen Kanten manuell gegen Quelltext geprüft.

**Messergebnis (2026-07-02):** MachineSIC-Lauf: totalEdges=418 (Simulation: ≈418), filesWithImports=99/147 C#-Dateien. Stichprobe 11 Kanten (deterministisch, jede 41.): 11/11 korrekt — jede Quelldatei referenziert einen in der Zieldatei deklarierten Typ per `using`-Direktive (8×) oder Same-Namespace (3×), jeweils mit echter Typnutzung im Code. Auffälligkeiten: keine Falsch-Positiven in der Stichprobe; bei einer Kante (`IModuleSettingsResolver.cs → SettingValue.cs`) taucht der Typname zusätzlich in einem XML-Doc-Kommentar auf, die Kante ist aber durch reale Code-Nutzung gedeckt — die bekannte v1-Grenze „Text-Matching trifft auch Kommentare/Strings" (§5.3) blieb in der Stichprobe folgenlos.

### 5.5 Nicht-Ziele von Phase ①

XAML/Razor/DI-Verbindungen (Phase ③), Provenance (Phase ②), `global using`-Projektsemantik, `using static`-Präzision, Grammar-Authoring.

## 6. Phasen ②–⑤ im Rahmen

**② Provenance:** Kanten erhalten additive Felder `origin` (`"structural" | "llm" | "rule" | "manual"`), `ruleId?`, `confidence?`, `evidence?`. Merge-Script und Schema-Validierung setzen/erhalten sie; Dashboard zeigt sie in der NodeInfo/Kanten-Ansicht an. Das vorhandene Ad-hoc-Patch-Format (Weggabelung 4) wird hier formalisiert und maschinell angewendet. Detail in §7.

**③ Linker-Infrastruktur + WPF-Pack:** Neue deterministische Pipeline-Phase nach dem Merge. Erste Regeln: XAML↔Code-behind über `x:Class`/Dateikonvention (mechanisch), XAML-Event-Attribut → Handler-Methode, XAML→ViewModel über `DataContext`/Bindings (heuristisch, niedrigere confidence), Razor `@inject`/Komponenten-Tags, DryIoc-Registrierung → `implements`/`depends_on`. Voraussetzungen: `.xaml` in XML-Config + XML/XAML-Grammatik aktivieren, XAML-Extractor. Regelformat = Weggabelung 1.

**④ Gap-Diagnose:** `/understand-diagnose-gaps` clustert isolierte/schwach verbundene Nodes (nach Extension, Pfadmuster, Parser-Output, Framework-Signalen), gibt 2–3 Samples pro Cluster an einen Diagnose-Agent, der Fix-Vorschläge mit Leverage/Aufwand/False-Positive-Risiko erzeugt — priorisiert als Liste, konsumierbar durch ③.

**⑤ Feedback-Loop:** Vom Dashboard aus („Kante ist falsch") über die Provenance aus ② zur verursachenden Regel; Agent schärft Scope/Validierung der Regel und erzeugt einen Regressionsfall.

## 7. Phase ② im Detail: Provenance und Einzelfall-Patches (freigegeben)

### 7.1 Datenmodell

`GraphEdge` (`packages/core/src/types.ts`) erhält vier additive, optionale Felder:

```ts
export type EdgeOrigin = "structural" | "llm" | "rule" | "manual";

export interface GraphEdge {
  // ... bestehende Felder unverändert ...
  origin?: EdgeOrigin;   // wer hat die Kante erzeugt
  ruleId?: string;       // manual: Patch-Dateiname; rule (ab Phase ③): Regel-ID
  confidence?: number;   // 0–1: Sicherheit, DASS die Kante existiert
  evidence?: string;     // menschenlesbarer Beleg (z. B. note aus dem Patch)
}
```

Taxonomie (entschieden 2026-07-03): `structural` = deterministisch aus Analyse abgeleitet (importMap-Abgleich, Pfadkonventions-Linker), `llm` = LLM-Schluss, `rule` = generalisierte Linker-Regel (ab Phase ③), `manual` = handkuratierte Einzelfall-Behauptung aus einem Patch. Die Polarität (hinzufügen/entfernen) ist **keine** origin-Eigenschaft — sie lebt im Patch-/Regelformat; `origin` beschreibt nur existierende Kanten.

Abgrenzung `confidence` vs. `weight`: `weight` behält seine bestehende Semantik (Stärke/Wichtigkeit der Beziehung, wird vom Layout genutzt); `confidence` ist epistemisch — wie sicher ist die Existenz der Kante. Deterministische Herkünfte (`structural`, `manual`) tragen `confidence: 1.0`; bei `llm`-Kanten bleibt das Feld in Phase ② ungesetzt (keine Scheinzahlen — Kalibrierung wäre Phase-⑤-Arbeit).

Schema (`packages/core/src/schema.ts`): Die vier Felder werden **explizit** im `GraphEdgeSchema` deklariert — kein pauschales `.passthrough()`, damit Tippfehler-Felder weiterhin draußen bleiben und `origin` enum-validiert wird. `autoFixGraph` behandelt sie analog `weight`: ungültiger `origin`-Wert → Feld entfernen + auto-corrected-Issue; `confidence` wird auf [0, 1] geklemmt. `validateGraph` reicht die Felder beim Neuzusammenbau des Graph-Objekts durch (heute gehen unbekannte Kantenfelder genau dort verloren — dazu ein Regressionstest). Alte Graphen ohne die Felder validieren unverändert.

### 7.2 Patch-Format (formalisiertes Ad-hoc-Format)

Die 15 vorhandenen handgeschriebenen Dateien in Nutzer-Repos bleiben **unverändert gültig** (Akzeptanzkriterium; sie dienen als Test-Fixtures):

```json
{
  "_meta": { "title": "...", "rationale": "...", "created": "YYYY-MM-DD" },
  "edges_to_add": [
    { "source": "file:...", "target": "file:...", "type": "imports",
      "direction": "outgoing", "weight": 1.0, "note": "..." }
  ],
  "edges_to_remove": [
    { "source": "file:...", "target": "file:...", "type": "imports", "reason": "..." }
  ]
}
```

- **Ablage:** `.understand-anything/patches/*.patch.json` im analysierten Repo (bestehende Konvention). Reine Daten, kein Code — Weggabelung 3 (Sicherheit bei Code in Regeln) stellt sich hier nicht.
- **Normalisierung:** `direction: "outgoing"` → `forward`, `"incoming"` → `backward` (neue Einträge in `DIRECTION_ALIASES`); Edge-Typ-Aliase gelten wie überall.
- **Provenance beim Anwenden:** hinzugefügte Kanten erhalten `origin: "manual"`, `ruleId: <Patch-Dateiname>`, `confidence: 1.0`, `evidence: <note>`.
- **Entfernen** matcht exakt auf `(source, target, type)` nach Alias-Normalisierung. Keine Suppressions-Liste im Graphen (entschieden 2026-07-03): Die versionierten Patch-Dateien selbst sind die dauerhafte Dokumentation der Entfernungen samt Begründung; der Apply-Schritt protokolliert Entfernungen nur in seinem Report-Output.
- **Determinismus:** Patch-Dateien alphabetisch; pro Datei erst `edges_to_remove`, dann `edges_to_add`.
- **Erweiterbarkeit:** Das Format ist so angelegt, dass Phase ③ es um Muster-Regeln erweitern kann, ohne bestehende Dateien zu brechen (neue Top-Level-Abschnitte, keine Umdeutung vorhandener Felder).

### 7.3 Pipeline und Datenfluss (entschieden: Nachlauf-Script, Ansatz A)

Grundsatz: **Jeder deterministische Erzeuger stempelt seine eigenen Kanten** beim Erzeugen; ein Nachlauf-Script übernimmt Reklassifikation, Default und Patch-Apply.

**Neues Script `skills/understand/apply-graph-patches.mjs`** (lädt Core aus `dist/`, nur stderr-Logging, Per-Item-Resilienz, deterministische Verarbeitung):

```
node apply-graph-patches.mjs <graph.json> [--import-map <pfad>] [--patches <verzeichnis>]
```

Drei Schritte in fester Reihenfolge:
1. **Reklassifikation `structural`:** Jede `imports`-Kante zwischen zwei `file:`-Knoten, deren Zielpfad in `importMap[quellpfad]` steht, wird zu `origin: "structural"`, `confidence: 1.0`. Ohne `--import-map` entfällt der Schritt (Standalone-Modus). Bereits von einem Erzeuger gestempelte Kanten bleiben unangetastet.
2. **Default:** Jede Kante ohne `origin` erhält `origin: "llm"` — die Messgröße „jede Kante trägt Herkunft" ist damit strukturell garantiert.
3. **Patch-Apply:** Dateien aus `--patches` (Default: das Verzeichnis `patches/` neben der Graph-Datei, d. h. `<repo>/.understand-anything/patches/`) gemäß §7.2. Existiert eine hinzuzufügende Kante bereits, wird sie nicht dupliziert, sondern auf `manual`-Provenance hochgestuft (menschliche Behauptung = stärkerer Beleg); `description` bleibt erhalten. Fehlt ein referenzierter Knoten, wird der Eintrag mit Warnung übersprungen — Patches dürfen den Lauf nie abbrechen.

**Idempotenz ist Vertragsbestandteil:** Zweimaliges Anwenden auf denselben Graphen erzeugt byte-identischen Output.

**Einbettung:**
- `merge-batch-graphs.py` stempelt seine selbst erzeugten Pass-2-`tested_by`-Kanten mit `origin: "structural"`, `evidence: "path convention"` (lokale Änderung).
- `/understand` (SKILL.md) persistiert den importMap als `import-map.json` ins Intermediate-Verzeichnis und ruft das Script nach dem Graph-Review als letzten Schritt vor dem finalen Schreiben auf.
- `/understand-diff --auto-update` ruft dasselbe Script nach dem inkrementellen Merge auf — Patches überleben auch Inkrementalläufe.

**Konfliktregel bei Dedup:** Liefern mehrere Quellen dieselbe Kante `(source, target, type)`, gilt die Provenance-Priorität `manual > structural > rule > llm`; die `description` des LLM bleibt als Zusatzinformation erhalten.

### 7.4 Dashboard

Minimal gemäß Rahmen: In der Connections-Liste von `NodeInfo.tsx` erhält jede Kante ein kleines Origin-Badge (vier Farben, konsistent mit dem Theme) mit `title`-Tooltip für `ruleId`, `confidence`, `evidence`, sofern vorhanden. Kanten ohne `origin` (alte Graphen) zeigen kein Badge — kein Fehler, keine Layoutlücke. Ein Origin-Filter im FilterPanel ist Nicht-Ziel.

### 7.5 Fehlerbehandlung

Ungültige Patch-Datei (kaputtes JSON, fehlende Pflichtfelder) → Warnung auf stderr + Datei überspringen. Unbekannter Knoten → Eintrag überspringen. Kein Patches-Verzeichnis → No-op ohne Fehler. Alte Graphen ohne Provenance-Felder validieren unverändert.

### 7.6 Verifikation und Messgröße

- **Core-Tests:** `validateGraph` reicht die vier Felder durch (Regressionstest gegen den Verlust beim Neuzusammenbau); ungültige Werte werden auto-korrigiert; alte Graphen bleiben gültig.
- **Script-Tests:** add/remove/Upgrade vorhandener Kanten/Reklassifikation/Idempotenz/kaputte Patch-Dateien; die 15 realen KernelResearch-Patches als Fixtures — alle müssen ohne Änderung durchlaufen.
- **Merge-Script-Test:** Pass-2-`tested_by`-Kanten tragen den `structural`-Stempel.
- **Messgröße am Prüfstein (MachineSIC):** 100 % der Kanten tragen `origin`; die ≈ 418 `imports`-Kanten aus Phase ① werden als `structural` klassifiziert; der Abschlussbericht weist die Verteilung `structural`/`llm`/`manual` aus. Zweitprüfstein KernelResearch: alle 15 Patches wenden sauber an.

### 7.7 Nicht-Ziele von Phase ②

Generalisierte Muster-Regeln und Linker-Engine (Phase ③), Suppressions-Liste im Graphen, Origin-Filter im FilterPanel, confidence-Kalibrierung für LLM-Kanten (Phase ⑤), Änderungen an den LLM-Agenten-Prompts.

## 8. Messbasis MachineSIC (Ist-Stand 2026-07-02)

920 Kanten: 419 contains, 233 exports, 92 calls, 88 depends_on, 35 configures, 22 implements, 12 related, 7 tested_by, 5 triggers, 5 inherits, 2 documents, **0 imports**. 79/147 C#-Dateien nur contains/exports. XAML: 9 Views, ø 1,0 Kanten, 1/9 Code-behind-Paarung, 0 Event-Handler-Kanten. 3/3 `.resx` isoliert.
