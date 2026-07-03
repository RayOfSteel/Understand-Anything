# Design: Deterministische Verbindungsschicht für Understand-Anything

**Datum:** 2026-07-02
**Status:** Phase ① umgesetzt und gemessen; Phase ② umgesetzt und gemessen (2026-07-03); Phase ③ detailliert und freigegeben (2026-07-03)
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

1. **Regelformat für Linker** (Phase ③) — **entschieden (2026-07-03): deklarative JSON-Regeln mit Tree-Sitter-Queries als Matching-Primitiv, engine-interne `builtin:`-Fakten-Provider als Escape-Hatch.** Regeln sind reine Daten (Queries + Join-Deklaration, kein ausführbarer Code); was eine Query nicht ausdrücken kann (abgeleitete/aufgelöste Werte wie FQNs), liefert ein im Plugin implementierter Provider. Details in §8.1/§8.2. Damit maximiert Phase ③ zugleich die Tree-Sitter-Nutzung der Pipeline — die Regel-Mechanik läuft über Queries auf bestehenden Grammatiken, nicht über Regex oder handgeschriebene Einzelfall-Extraktoren.
2. **Fork vs. Upstream-Contribution** — **entschieden (2026-07-02): Fork.** Entwicklung auf dem eigenen Branch (`myMaster`); bestehende Konventionen (TypeScript strict, Vitest, ESM) werden beibehalten, weil sie der Wartbarkeit dienen, nicht wegen Upstream-Kompatibilität. Eine spätere Upstream-Contribution einzelner Phasen bleibt möglich, ist aber kein Gestaltungsziel.
3. **Ablageort projektspezifischer Regeln** (Phase ③/④) — **entschieden (2026-07-03): beides, additiv.** Framework-Packs werden im Plugin ausgeliefert (`understand-anything-plugin/rules/*.json`); zusätzlich lädt die Engine `.understand-anything/rules/*.json` aus dem Ziel-Repo. Das Sicherheitsargument ist durch die Format-Entscheidung (Weggabelung 1) entschärft: Regeln sind reine Daten — eine bösartige oder defekte Regel kann schlimmstenfalls nichts matchen, falsche Kanten behaupten oder die Analyse verlangsamen, aber keinen Code ausführen. Phase ④ schreibt Regelvorschläge in das projektlokale Verzeichnis, Phase ⑤ schärft sie dort.
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

**③ Linker-Infrastruktur + WPF-Pack:** Neue deterministische Pipeline-Phase nach dem Merge. Erste Regeln: XAML↔Code-behind über `x:Class`/Dateikonvention (mechanisch), XAML-Event-Attribut → Handler-Methode, XAML→ViewModel über `xmlns`-Typverwendung (heuristisch, niedrigere confidence), Razor `@inject`/Komponenten-Tags, DryIoc-Registrierung → `implements`/`configures`. Voraussetzungen: eigene `xaml`-Language-Config + XML-Grammatik als vendored wasm. Regelformat = Weggabelung 1. Scope-Entscheidung (2026-07-03): WPF-, Razor- und DryIoc-Pack in **einer** Phase. Detail in §8.

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

Schema (`packages/core/src/schema.ts`): Die vier Felder werden **explizit** im `GraphEdgeSchema` deklariert — kein pauschales `.passthrough()`, damit Tippfehler-Felder weiterhin draußen bleiben und `origin` enum-validiert wird. `autoFixGraph` behandelt sie analog `weight`: ungültiger `origin`-Wert → Feld entfernen + auto-corrected-Issue; `confidence` wird auf [0, 1] geklemmt. `validateGraph` reicht die Felder beim Neuzusammenbau des Graph-Objekts durch (heute gehen unbekannte Kantenfelder genau dort verloren — dazu ein Regressionstest). Dass dieses Strippen real ist, zeigt der Bestand: `recover_imports_from_scan` markiert wiederhergestellte Kanten seit jeher mit `recoveredFromImportMap: true` (`merge-batch-graphs.py:978`), und genau dieses Feld überlebt die Schema-Validierung heute nicht. Alte Graphen ohne die Felder validieren unverändert.

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

#### 7.2.1 Akzeptiertes Legacy-Format (Bestand: KernelResearch)

Befund aus der Umsetzung (Task 4): 13 der 15 realen KernelResearch-Patch-Dateien folgen nicht dem obigen kanonischen Format, sondern einer älteren Ad-hoc-Konvention. Der Loader in `apply-graph-patches.mjs` akzeptiert beide Formate; kanonische Felder gewinnen immer, Legacy-Felder greifen nur als Fallback:

- **Abschnitts-Aliase:** `edges_added` → `edges_to_add`, `edges_removed` → `edges_to_remove` (nur wenn der kanonische Abschnitt fehlt).
- **Feld-Aliase pro Eintrag:** `from`/`src` → `source`, `to`/`dst` → `target`, `kind` → `type`, `annotation` → `note` (die `src`/`dst`-Variante kommt in T09/T10 vor).
- **Titel-Fallback:** `_meta.title` → Top-Level-`title` → Top-Level-`id`; fehlt alles, wird die Datei mit Warnung übersprungen.
- **Fehlende Edge-Abschnitte** gelten als leer — eine reine Summary-Index-Datei (wie `2026-05-25-security-review-consolidated.patch.json`) läuft als No-op durch.
- **`nodes_added` wird nicht unterstützt:** Node-Einträge werden mit `Warning:` ignoriert; Kanten-Einträge, die solche nie angelegten Knoten referenzieren, werden per Regelfall „unbekannter Knoten" einzeln übersprungen.
- **Upgrade-Pfad-Grenze:** Beim Hochstufen einer bereits existierenden Kante auf `manual` werden `direction` und `weight` des Patch-Eintrags ignoriert — der Match läuft über `(source, target, type)` über alle `direction`-Werte hinweg. Wer eine Kantenrichtung umdrehen will, muss die Kante per `edges_to_remove` entfernen und per `edges_to_add` neu anlegen.

### 7.3 Pipeline und Datenfluss (entschieden: Nachlauf-Script, Ansatz A)

Grundsatz: **Jeder deterministische Erzeuger stempelt seine eigenen Kanten** beim Erzeugen; ein Nachlauf-Script übernimmt Reklassifikation, Default und Patch-Apply.

**Erzeuger-Stempel in `merge-batch-graphs.py`** (lokale Änderungen an den beiden bestehenden deterministischen Kanten-Produzenten):
- `recover_imports_from_scan` (Zeile ~972): wiederhergestellte `imports`-Kanten erhalten `origin: "structural"`, `confidence: 1.0` direkt beim Anlegen — die Funktion weiß per Konstruktion, dass ihre Kanten aus dem importMap stammen. Das bestehende Feld `recoveredFromImportMap` bleibt unangetastet.
- `tested_by`-Linker Pass 2 (Zeile ~697): ergänzte Kanten erhalten `origin: "structural"`, `evidence: "path convention"`.

Weil gestempelte Kanten über `batch-existing.json` in Inkrementalläufe hineinwandern, bleibt die Klassifikation zwischen Voll- und Inkrementallauf konsistent — der Stempel am Erzeuger ist die primäre Verteidigung, die Reklassifikation im Script nur die zweite (für `imports`-Kanten, die das LLM selbst emittiert hat).

**Neues Script `skills/understand/apply-graph-patches.mjs`** (lädt Core aus `dist/`, nur stderr-Logging, Warnungen mit `Warning:`-Präfix, Per-Item-Resilienz, deterministische Verarbeitung):

```
node apply-graph-patches.mjs <graph.json> [--scan-result <pfad>] [--patches <verzeichnis>]
```

Drei Schritte in fester Reihenfolge:
1. **Reklassifikation `structural`:** Jede `imports`-Kante zwischen zwei `file:`-Knoten, deren Zielpfad in `importMap[quellpfad]` steht, wird zu `origin: "structural"`, `confidence: 1.0`. Der importMap kommt aus dem bereits persistierten `scan-result.json` (Phase-7-Cleanup bewahrt diese Datei ausdrücklich, SKILL.md „preserving scan-result.json"); die Zuordnung Knoten-ID ↔ Pfad folgt exakt der bestehenden Konvention `file:<importMap-Pfad>` aus `recover_imports_from_scan`. Ohne `--scan-result` entfällt der Schritt (Standalone-Modus). Kanten mit `origin: "llm"` werden dabei ebenfalls hochgestuft (structural ist der stärkere Beleg — nötig, damit die Prioritäts-Invariante auch gilt, wenn ein Standalone-Lauf den Default vor einem Voll-Lauf gesetzt hat); Kanten mit `origin` `structural`/`rule`/`manual` bleiben unangetastet.
2. **Default:** Jede Kante ohne `origin` erhält `origin: "llm"` — die Messgröße „jede Kante trägt Herkunft" ist damit strukturell garantiert.
3. **Patch-Apply:** Dateien aus `--patches` (Default: das Verzeichnis `patches/` neben der Graph-Datei, d. h. `<repo>/.understand-anything/patches/`) gemäß §7.2. Patch-Einträge matchen auf `(source, target, type)` nach Alias-Normalisierung, über alle `direction`-Werte hinweg. Existiert eine hinzuzufügende Kante bereits, wird sie nicht dupliziert, sondern auf `manual`-Provenance hochgestuft — das gilt ausdrücklich auch für in Schritt 1 gestempelte `structural`-Kanten (menschliche Behauptung = stärkster Beleg); `description` bleibt erhalten. Fehlt ein referenzierter Knoten, wird der Eintrag mit Warnung übersprungen — Patches dürfen den Lauf nie abbrechen.

Die Schrittfolge stellt als Invariante her: Nach dem Lauf trägt jede Kante die stärkste zutreffende Provenance gemäß `manual > structural > rule > llm`.

**Idempotenz ist Vertragsbestandteil:** Zweimaliges Anwenden auf denselben Graphen erzeugt byte-identischen Output.

**Einbettung (an den real existierenden Hook-Punkten):**
- `/understand` (SKILL.md): Das Script läuft zu Beginn von **Phase 6 (REVIEW)** auf `assembled-graph.json`, **vor** der inline-deterministischen Validierung bzw. dem `--review`-Pfad — die bestehenden Qualitäts-Gates prüfen damit das gepatchte Ergebnis, nicht umgekehrt. Seine `Warning:`-Zeilen werden wie bei allen Phasen in `$PHASE_WARNINGS` gesammelt und erscheinen im Abschlussbericht (etablierte Observability-Konvention).
- **Auto-Update-Hook** (`hooks/auto-update-prompt.md`, der Post-Commit-Pfad — ein `--auto-update`-Flag auf `/understand-diff` existiert nicht): Der Hook merged im Agenten-Speicher und schreibt dann `knowledge-graph.json`; das Script läuft direkt danach in-place auf der geschriebenen Datei, vor `meta.json` und Abschlussbericht. `scan-result.json` wird genutzt, sofern vorhanden. Patches überleben damit auch Inkrementalläufe.

**Dedup-Realität und Konfliktregel:** Die bestehenden Merge-Pfade deduplizieren unterschiedlich — der Voll-Merge nach `(source, target, type, direction)` mit Gewichts-Präferenz (`merge-batch-graphs.py:833`), Auto-Update-Hook und Core-Normalisierung nach `(source, target, type)`. Phase ② vereinheitlicht das nicht; die Provenance-Priorität `manual > structural > rule > llm` wird als End-Invariante durch die Schrittfolge des Apply-Scripts hergestellt, nicht durch Umbau der Dedup-Logiken. Die `description` des LLM bleibt bei Upgrades als Zusatzinformation erhalten.

### 7.4 Dashboard

Minimal gemäß Rahmen: In der Connections-Liste von `NodeInfo.tsx` erhält jede Kante ein kleines Origin-Badge (vier Farben, konsistent mit dem Theme) mit `title`-Tooltip für `ruleId`, `confidence`, `evidence`, sofern vorhanden. Kanten ohne `origin` (alte Graphen) zeigen kein Badge — kein Fehler, keine Layoutlücke. Ein Origin-Filter im FilterPanel ist Nicht-Ziel.

### 7.5 Fehlerbehandlung und Observability

Ungültige Patch-Datei (kaputtes JSON, fehlende Pflichtfelder) → Warnung auf stderr + Datei überspringen. Unbekannter Knoten → Eintrag überspringen. Kein Patches-Verzeichnis → No-op ohne Fehler. Alte Graphen ohne Provenance-Felder validieren unverändert.

Jede Degradierung (übersprungene Patch-Datei, übersprungener Eintrag, fehlendes scan-result.json) wird als `Warning:`-präfixierte stderr-Zeile ausgegeben und vom aufrufenden Ablauf in `$PHASE_WARNINGS` gesammelt — kein stiller Drop (etablierte Invariante aus dem Semantic-Batching-Design, dort §„Warnings"). Zusätzlich schreibt das Script eine Zusammenfassung (reklassifiziert/gestempelt/hinzugefügt/entfernt/übersprungen) auf stderr.

**Bekannte v1-Grenze:** Die Merge-Pfade außerhalb des `/understand`-Kernablaufs (`merge-subdomain-graphs.py` — höheres Gewicht gewinnt; `merge-knowledge-graph.py` — first wins) kennen die Provenance-Priorität nicht; dort kann eine gestempelte Kante durch eine ungestempelte Dublette ersetzt werden. Gegenmittel ist die Idempotenz des Apply-Scripts (erneuter Lauf stellt `manual`-Kanten und Defaults wieder her); provenance-bewusste Dedup-Präferenz in diesen Pfaden ist Follow-up, nicht Phase-②-Scope.

### 7.6 Verifikation und Messgröße

- **Core-Tests:** `validateGraph` reicht die vier Felder durch (Regressionstest gegen den Verlust beim Neuzusammenbau); ungültige Werte werden auto-korrigiert; alte Graphen bleiben gültig.
- **Script-Tests:** add/remove/Upgrade vorhandener Kanten/Reklassifikation/Idempotenz/kaputte Patch-Dateien; die 15 realen KernelResearch-Patches als Fixtures — alle müssen ohne Änderung durchlaufen.
- **Merge-Script-Test:** Pass-2-`tested_by`-Kanten tragen den `structural`-Stempel.
- **Messgröße am Prüfstein (MachineSIC):** 100 % der Kanten tragen `origin`; die ≈ 418 `imports`-Kanten aus Phase ① werden als `structural` klassifiziert; der Abschlussbericht weist die Verteilung `structural`/`llm`/`manual` aus. Zweitprüfstein KernelResearch: alle 15 Patches wenden sauber an.

**Messergebnis (2026-07-03):**

- **MachineSIC** (147 C#-Dateien aus `fingerprints.json`): `extract-import-map` liefert `filesScanned=147 filesWithImports=99 totalEdges=418` (Punktlandung auf der Phase-①-Zahl). `recover_imports_from_scan` stellt `recovered=418` `imports`-Kanten mit `origin: "structural"` her; der anschließende Apply-Lauf meldet `reclassified=0 defaulted=920` — die Reklassifikation von 0 bestätigt, dass der Erzeuger-Stempel greift und das Script nichts nachstempeln muss. Endverteilung: **1338 Kanten gesamt, `structural`=418 (alle `imports`), `llm`=920, `manual`=0, ohne `origin`=0** (Assert erfüllt). Die 7 `tested_by`-Kanten tragen hier `llm`, nicht `structural`: das simulierte Segment fuhr nur die Import-Recovery; der `tested_by`-Stempel sitzt im Pass-2-Linker des Merge-Laufs, der in dieser Messung nicht durchlaufen wurde (per Merge-Script-Test separat abgedeckt).
- **KernelResearch** (Graph mit 22997 Kanten, 15 reale Patch-Dateien): Exit 0, Summary `reclassified=0 defaulted=22997 patchFiles=15 added=0 upgraded=20 removed=0 skipped=123`. Endverteilung: **`llm`=22977, `manual`=20, ohne `origin`=0**. Die 20 Upgrades stammen aus den beiden kanonisch formatierten Patches (`clr-entrypoints-to-cocor` 10, `cocor-callback-chain` 10 — deren `file:`-Knoten existieren im Graphen). Alle 123 Skips sind „unbekannter Knoten"-Adds aus den Legacy-Dateien T01–T12 (T01=11, T02=17, T03=8, T04=7, T05=9, T06=14, T07=11, T08=16, T09=5, T10=3, T11=7, T12=15): sie referenzieren synthetische Knoten-IDs (`fn:`, `scr:`, `case:`, `op:`, `contract:`, …), die per `nodes_added` hätten entstehen sollen — `nodes_added` wird laut §7.2.1 ignoriert (109 Node-Einträge über 12 Dateien, je mit Warnung), also fehlen die Knoten erwartungsgemäß. Ein `edges_to_remove`-Eintrag (`cocor-callback-chain`: tlsbSocP.h → SocP/…/cocInterpreter.h) matcht keine Kante — die zu entfernende Fehlkante existiert im aktuellen Graphen nicht; protokollierter No-op, kein Fehler. `security-review-consolidated` ist der Summary-Index ohne Edge-Abschnitte (No-op).
- **Idempotenz:** Beide Apply-Läufe ein zweites Mal identisch ausgeführt; `cmp` bestätigt byte-identische Dateien (MachineSIC: Zweitlauf `reclassified=0 defaulted=0`; KernelResearch: Zweitlauf meldet erneut `upgraded=20 skipped=123`, ändert aber kein Byte).

### 7.7 Nicht-Ziele von Phase ②

Generalisierte Muster-Regeln und Linker-Engine (Phase ③), Suppressions-Liste im Graphen, Origin-Filter im FilterPanel, confidence-Kalibrierung für LLM-Kanten (Phase ⑤), Änderungen an den LLM-Agenten-Prompts, Vereinheitlichung der Dedup-Schlüssel über alle Merge-Pfade, provenance-bewusste Dedup-Präferenz in Domain-/Knowledge-Merges (siehe §7.5).

## 8. Phase ③ im Detail: Linker-Engine und Regel-Packs (freigegeben)

### 8.1 Regelformat

Regeln sind JSON-Dateien, validiert durch ein Zod-Schema in core. Kein YAML — nicht wegen eines fehlenden Parsers (core hat bereits ein `yaml`-Dependency), sondern wegen Format-Konsistenz: Patches (§7.2) und Regeln sind beides deklarative Graph-Eingriffe und sollen dieselbe Notation sprechen; die Agenten aus Phase ④/⑤ schreiben beide Formate gleich gut. Mehrzeilige Tree-Sitter-Queries werden als String-Array notiert (Zeilen, beim Laden per `\n` gejoint).

Eine Regel besteht aus drei Blöcken — Metadaten, Fakten, Link:

```json
{
  "id": "wpf.event-handler",
  "description": "XAML-Event-Attribut -> Handler-Methode im Code-behind",
  "confidence": 0.9,
  "edge": { "type": "calls", "direction": "forward" },
  "facts": {
    "xClass": { "language": "xaml", "query": [
      "(Attribute (Name) @n",
      "  (#eq? @n \"x:Class\")",
      "  (AttValue) @value)"
    ], "transform": { "value": "stripQuotes" } },
    "attr": { "language": "xaml", "query": [
      "(Attribute (Name) @name",
      "  (AttValue) @value)"
    ], "transform": { "value": "stripQuotes" } },
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
}
```

**Fakten-Quellen, zwei Arten:**
- **Query-Fakten:** eine Tree-Sitter-Query pro Sprache (Sprach-ID der Language-Config); jede Match-Instanz wird ein Fakt `{ file, <capture-Name>: <Text> }`. Für direkte Syntax-Captures (Attribute, Tags, Aufrufformen). Die Knotennamen im Beispiel sind die realen der XML-Grammatik v0.7.0 (`Attribute`/`Name`/`AttValue`, verifiziert gegen deren `node-types.json`); weil `AttValue` die Anführungszeichen enthält, erlaubt das Format pro Capture eine optionale deklarative Nachbehandlung `transform` — v1 kennt genau eine: `stripQuotes` (umschließende `"`/`'` entfernen).
- **`builtin:`-Fakten (der Escape-Hatch):** engine-intern implementierte Provider für alles, was eine einzelne Query nicht ausdrücken kann — abgeleitete oder aufgelöste Werte (FQN-Stitching über Namespace-Verschachtelung, `using`-Kontext-Auflösung, Razor-Direktiven ohne reife Grammatik). Provider sind TypeScript in core (`packages/core/src/linker/builtins/`) und werden mit dem Plugin ausgeliefert — „im Plugin" heißt in diesem Design durchgängig: nicht im Ziel-Repo. Regeln referenzieren Provider per Name; der Katalog steht in §8.3.

**Join-Sprache bewusst winzig:** `where` ist eine Konjunktion von Gleichheits-Bedingungen der Form `faktA.feld == faktB.feld` über Fakt-Felder (`file`, Capture-Namen, Provider-Felder) — kein Ausdrucks-Interpreter, keine Funktionen, keine Regex im Join. Was mehr Logik braucht, wird ein `builtin`. `source`/`target` benennen je ein Fakt-`file`; `evidence` ist ein Template mit `{fakt.feld}`-Interpolation. `edge.type` wird gegen `EdgeTypeSchema.options` validiert (Phase-②-Lehre: Patch-Kanten umgingen die Typ-Validierung); `direction` gegen das Direction-Enum inkl. Aliase.

**Ablage und Ladereihenfolge (Weggabelung 3):** Plugin-Packs aus `understand-anything-plugin/rules/*.json`, danach projektlokale Regeln aus `.understand-anything/rules/*.json` — beide alphabetisch, additiv, gleiches Schema. Kollidierende Regel-IDs: die zuletzt geladene (projektlokale) gewinnt mit Warnung — ein Projekt kann damit eine Pack-Regel gezielt überschreiben oder per `"enabled": false` deaktivieren.

### 8.2 Engine-Architektur und Pipeline-Einbettung

**Aufteilung Engine/CLI:** Die Engine ist TypeScript in `packages/core/src/linker/` (Regel-Schema, Fakten-Provider, Query-Runner, Join-/Kanten-Erzeugung) — strict-typisiert, per Vitest unit-testbar. Ein dünner CLI-Wrapper `skills/understand/apply-link-rules.mjs` lädt core per `createRequire` mit dist-Fallback — das in Phase ② gehärtete Muster von `apply-graph-patches.mjs`. Der try/catch um das Core-Laden umschließt **nur** das Laden (`engine=null`-Muster gemäß Phase-②-Re-Review-Befund): Ist core nicht ladbar, degradiert das Script zu einem No-op mit Warnung; ein Fehler in der Anwendung selbst wird nicht als Ladefehler etikettiert.

```
node apply-link-rules.mjs <graph.json> [--rules <verzeichnis>]...

```

Ohne `--rules` lädt das Script die zwei Default-Verzeichnisse aus §8.1: das `rules/`-Verzeichnis des Plugins (relativ zum Script-Standort aufgelöst) und `<projektwurzel>/.understand-anything/rules/` — die Projektwurzel wird aus dem Graph-Pfad abgeleitet (alles vor dem Pfadsegment `.understand-anything`), womit sowohl `knowledge-graph.json` als auch `intermediate/assembled-graph.json` korrekt behandelt werden (der Phase-②-Patch-Default hat genau diese Schwäche als bekanntes Follow-up). Explizite `--rules`-Angaben ersetzen beide Defaults; fehlende Verzeichnisse sind No-ops. Dieselbe Projektwurzel ist die Basis für das Lesen der Quelldateien.

**Position in der Pipeline:** Merge → **apply-link-rules (neu)** → apply-graph-patches → Validierung. Der Linker braucht den fertigen Graphen (Datei-Knoten als Kantenanker); die manuellen Patches laufen danach, damit die Prioritäts-Invariante `manual > structural > rule > llm` mechanisch gilt — ein Patch kann eine frische `rule`-Kante noch entfernen oder auf `manual` hochstufen. Einbettung an denselben zwei Hook-Punkten wie §7.3: SKILL.md Phase 6 (vor dem Patch-Schritt, `$PHASE_WARNINGS`-Anbindung, Renumbering inkl. Sprungziel-Prüfung) und Auto-Update-Hook 3d (vor dem Patch-Aufruf, self-contained `$PLUGIN_ROOT`-Resolution wird mitgenutzt).

**Datenfluss innerhalb des Scripts:**
1. Graph laden, Datei-Knoten inventarisieren (Pfad ↔ Knoten-ID `file:<relpath>`, dieselbe Konvention wie §7.3 Schritt 1).
2. Regeln laden (§8.1); defekte Regel = Warnung + Skip, nie Abbruch.
3. Nur die Dateien parsen, deren Sprache von mindestens einer geladenen Regel referenziert wird (web-tree-sitter, Grammatik aus der Language-Config; MachineSIC: 147 `.cs` + 9 `.xaml`).
4. Fakten sammeln: Query-Fakten je Regel + referenzierte `builtin:`-Provider (jeder Provider läuft höchstens einmal pro Datei, Ergebnisse werden zwischen Regeln geteilt).
5. Joins auswerten → Kandidaten-Kanten mit `origin: "rule"`, `ruleId: <Regel-ID>`, `confidence` aus der Regel, `evidence` aus dem Template, `weight: 1.0`.
6. Einfügen mit Prioritätslogik: existiert `(source, target, type)` bereits (Match über alle `direction`-Werte, wie §7.2.1) mit `origin` `llm` oder ungesetzt → Upgrade auf `rule` (+`ruleId`/`confidence`/`evidence`; `description` bleibt erhalten); mit `origin` `structural`, `manual` oder `rule` → unangetastet (first rule wins, deterministisch durch Ladereihenfolge); sonst append. Unbekannter Quell-/Ziel-Knoten → Eintrag überspringen mit Warnung.

**Determinismus und Idempotenz:** keine Zeit-/Zufallsquellen, Dateien und Regeln in sortierter Reihenfolge, Kanten-Einfügung stabil sortiert. Zweimaliges Anwenden erzeugt byte-identischen Output (Vertragsbestandteil wie §7.3). Write-only-on-success.

**Kanten-Granularität v1:** Datei→Datei. Member-Details (Handler-Methodenname, Komponententag) wandern in `evidence`; Kanten auf Member-Knoten sind dokumentierte Erweiterung, kein v1-Scope.

### 8.3 Regel-Packs und builtin-Provider-Katalog

**Voraussetzung XAML:** Neue Language-Config `packages/core/src/languages/configs/xaml.ts` (id `xaml`, Extension `.xaml`) mit vendored Grammatik nach dem vollständigen Dart-Vertrag (Codex-Befund 2026-07-03 — der Loader resolvet `require.resolve("${wasmPackage}/${wasmFile}")`, `tree-sitter-plugin.ts:143`): neues Workspace-Paket `packages/tree-sitter-xml-wasm/` mit `package.json` (`"name": "@understand-anything/tree-sitter-xml-wasm"`, `"main": "tree-sitter-xml.wasm"`, `"files": ["tree-sitter-xml.wasm", "BUILD.md"]`), core-Dependency `"@understand-anything/tree-sitter-xml-wasm": "workspace:*"`, Config-Eintrag `treeSitter: { wasmPackage: "@understand-anything/tree-sitter-xml-wasm", wasmFile: "tree-sitter-xml.wasm" }`. Das wasm existiert fertig als GitHub-Release-Asset von `tree-sitter-grammars/tree-sitter-xml` v0.7.0 (verifiziert 2026-07-03). Die bestehende `xml.ts`-Config bleibt unangetastet — keine Verhaltensänderung für `.xml`-Dateien.

**Razor bewusst ohne Grammatik:** `tree-sitter-razor` ist auf npm unpubliziert und das GitHub-Repo (tris203) jung und ohne Releases (verifiziert 2026-07-03). Razor-Fakten kommen daher aus `builtin:`-Providern mit deterministischer Direktiven-Extraktion; ein späterer Grammatik-Umstieg ändert nur die Provider-Implementierung, nicht die Regeln.

**builtin-Provider v1** (alle in `packages/core/src/linker/builtins/`):

| Provider | Felder pro Fakt | Mechanik |
|---|---|---|
| `csharp.classFqn` | `file`, `value` (FQN), `name` (Kurzname) | Klassen-/Interface-Deklarationen mit Namespace-Stitching. **Eigener Tree-Walk in core** nach dem Muster des Phase-①-Extractors (dieselben abgedeckten Fälle: block-scoped, file-scoped, verschachtelt) — dessen Walker sind privat und sein Output paart Klassen nicht mit Namespaces, direkte Wiederverwendung ist nicht möglich (Codex-Befund 2026-07-03) |
| `csharp.methodDecl` | `file`, `classFqn`, `name` | Methodendeklarationen samt umgebender Klassen-FQN (gleicher Tree-Walk wie `csharp.classFqn`) |
| `csharp.registration` | `file`, `serviceFqn`, `implFqn` | `Register`-Familie (`Register<TService, TImpl>`, `RegisterMany`, `RegisterInstance` mit 2 Typargumenten) via Tree-Sitter-Query auf `invocation_expression`; Typargumente per `using`-Kontext der registrierenden Datei zu FQN aufgelöst — **Re-Implementierung des Phase-①-Auflösungsansatzes in core** (die Originallogik lebt un-exportiert im Skill-CLI `extract-import-map.mjs` und ist aus core nicht importierbar; Codex-Befund 2026-07-03). Kandidatenindex ist der linker-eigene `csharp.classFqn`-Faktenbestand |
| `xaml.typeUsage` | `file`, `value` (FQN) | xmlns-Mapping (`xmlns:p="clr-namespace:X.Y"`) + präfixierte Element-Tags (`p:Foo`) → `X.Y.Foo`; Präfix-Zerlegung und Konkatenation liegen bewusst im Provider, nicht in der Join-Sprache |
| `razor.inject` | `file`, `typeName` (wie notiert), `typeFqn?` (falls auflösbar) | `@inject <Typ> <Name>`-Direktiven; Auflösung qualifiziert per FQN, sonst eindeutiger Kurzname gegen `csharp.classFqn` (mehrdeutig → kein Fakt, Warnung) |
| `razor.componentTag` | `file`, `name` | PascalCase-Tags im Markup (`<FooComponent …>`) |
| `razor.componentDecl` | `file`, `name` | `.razor`-Datei als Komponente (Name = Basename) |

**WPF-Pack** (`rules/wpf.json`, 3 Regeln):

| Regel | Mechanik | Kante | confidence |
|---|---|---|---|
| `wpf.code-behind` | `x:Class`-Attributwert == `csharp.classFqn.value` | cs —`implements`→ xaml | 1.0 |
| `wpf.event-handler` | generischer Join: Attributwert == Methodenname in der `x:Class`-Klasse — keine feste Event-Namensliste; ein `{Binding …}`-Wert matcht nie einen Methodennamen | xaml —`calls`→ cs | 0.9 |
| `wpf.xmlns-viewmodel` | `xmlns:p="clr-namespace:X.Y"` + Typverwendung `p:Foo` im selben Dokument == `classFqn` `X.Y.Foo` | xaml —`depends_on`→ cs | 0.8 |

**Razor-Pack** (`rules/razor.json`, 2 Regeln):

| Regel | Mechanik | Kante | confidence |
|---|---|---|---|
| `razor.inject` | `razor.inject.typeFqn` == `csharp.classFqn.value` | razor —`depends_on`→ cs | 0.9 |
| `razor.component-tag` | `razor.componentTag.name` == `razor.componentDecl.name` (eindeutiger Basename, sonst skip) | razor —`depends_on`→ razor | 0.9 |

**DryIoc-Pack** (`rules/dryioc.json`, 2 Regeln):

| Regel | Mechanik | Kante | confidence |
|---|---|---|---|
| `dryioc.implements` | `registration.implFqn` == `classFqn.value` (Impl-Datei) und `registration.serviceFqn` == `classFqn.value` (Service-Datei); `Register<IFoo, Foo>()` beweist die Implementierung | Foo.cs —`implements`→ IFoo.cs | 1.0 |
| `dryioc.registration` | Composition-Root-Datei → registrierte Impl-Datei | Registrar —`configures`→ Foo.cs | 1.0 |

`wpf.code-behind` und `wpf.event-handler` sind auf der XAML-Seite vollständig als Query-Fakten + Join ausdrückbar (reine Attribut-Queries). `wpf.xmlns-viewmodel` ist es **nicht** — die Regel braucht Präfix-Zerlegung (`vm:Foo` → Präfix + Lokalname) und Namespace-Konkatenation (`X.Y` + `.Foo`), was die Gleichheits-Join-Sprache bewusst nicht kann; dafür liefert der builtin-Provider `xaml.typeUsage` (`file`, `value` = aufgelöste FQN) die fertig aufgelösten Typverwendungen aus xmlns-Mapping + präfixierten Element-Tags (Ergänzung im Katalog oben). Die C#- und Razor-Seiten laufen über die builtin-Provider.

### 8.4 Fehlerbehandlung und Observability

Konsequente Übernahme des §7.5-Musters: Ungültige Regeldatei (kaputtes JSON, Schema-Verstoß) → `Warning:` + Datei überspringen. Nicht kompilierende Query → `Warning:` + Regel überspringen. Grammatik nicht ladbar (wasm fehlt/inkompatibel) → alle Regeln dieser Sprache überspringen, Rest läuft. Unlesbare/unparsebare Quelldatei → `Warning:` + Datei überspringen. Unbekannter Knoten → Eintrag überspringen (Zähler). Kein Regel-Verzeichnis → No-op ohne Fehler. Jede Degradierung als `Warning:`-präfixierte stderr-Zeile, vom Aufrufer in `$PHASE_WARNINGS` gesammelt; nur stderr-Ausgabe. Summary-Zeile am Ende: `apply-link-rules: rules=N files=N added=N upgraded=N skippedRules=N skippedEdges=N`.

### 8.5 Mitgenommene Follow-ups (einzige Nicht-Linker-Arbeiten der Phase)

1. **Hook-Cleanup-Fix:** Der Auto-Update-Hook löscht mit `rm -rf intermediate` die `scan-result.json`, die sein eigener Schritt 3d Punkt 2 beim Folgelauf braucht (Divergenz zu SKILL.md, issue #293). Wird im Zuge der ohnehin anstehenden Hook-Einbettung behoben: Cleanup bewahrt `scan-result.json`.
2. **origin-Enum-Single-Source:** `EdgeOriginSchema` wird alleinige Quelle des Enum-Literals (`types.ts` per `z.infer`, `autoFixGraph` per `.options`) — bevor der Linker als erster `rule`-Producer dazukommt. Die übrigen Ledger-Follow-ups bleiben ausdrücklich außerhalb des Phase-③-Scopes.

### 8.6 Verifikation und Messgrößen

- **Core-Unit-Tests (Vitest):** Regel-Schema (gültig/ungültig/enabled:false/ID-Kollision), Join-Auswertung inkl. Drei-Fakten-Join und Null-Treffer, evidence-Template, Upgrade-/Prioritätslogik gegen alle vier origin-Werte, jeder builtin-Provider einzeln gegen kleine Quelltext-Fixtures, Query-Runner gegen die echte XML-Grammatik.
- **CLI-End-to-End (spawnSync-Harness wie `test_apply_graph_patches`):** Mini-Fixture-Projekt pro Pack (2–3 Dateien), Idempotenz-Byte-Vergleich, Degradationspfade (defekte Regel, fehlende Grammatik, unknown node, core nicht ladbar), projektlokale Regel inkl. Override einer Pack-Regel.
- **Messgrößen am Prüfstein MachineSIC** (Messergebnis wird nach Umsetzung hier in §8.6 nachgetragen, analog §7.6): Code-behind-Paarung **9/9** (§3), Event-Handler-Kanten **> 0** (§3), je Pack Kantenzahl + manuelle Stichprobe, **0** veränderte `structural`-/`manual`-Kanten, Idempotenz byte-identisch, von Regeln bestätigte `llm`-Kanten erscheinen als Upgrade-Zähler. Razor-/DryIoc-Zahlen werden gemessen und mit Stichprobe belegt (MachineSIC enthält Blazor und DryIoc; keine Vorab-Simulation wie bei Phase ①).

### 8.7 Bewusste v1-Grenzen

- Razor-Typauflösung kennt `_Imports.razor` nur als weitere `@using`-Quelle; mehrdeutige Kurznamen erzeugen keine Kante (fehlende, nie falsche Kanten).
- Der generische Event-Handler-Join kann theoretisch ein Nicht-Event-Attribut treffen, dessen Wert zufällig ein Methodenname ist (daher 0.9, nicht 1.0).
- `wpf.xmlns-viewmodel` sieht nur explizite Typverwendung im XAML; `DataContext`-Zuweisungen im Code-behind bleiben unerkannt.
- `csharp.registration` deckt die generische `Register`-Familie ab; Convention-Scanning (`RegisterMany` per Assembly-Scan ohne Typargumente) und Factory-Lambdas bleiben unerkannt.
- Kanten enden auf Datei-Knoten; Member-Knoten-Granularität ist Erweiterung.

### 8.8 Nicht-Ziele von Phase ③

Grammar-Authoring (§2), Razor-Grammatik-Vendoring, Member-Knoten-Kanten, Origin-Filter im Dashboard, Gap-Diagnose (Phase ④), Feedback-Loop (Phase ⑤), Abarbeitung der übrigen Ledger-Follow-ups, Vereinheitlichung der Dedup-Schlüssel über alle Merge-Pfade.

## 9. Messbasis MachineSIC (Ist-Stand 2026-07-02)

920 Kanten: 419 contains, 233 exports, 92 calls, 88 depends_on, 35 configures, 22 implements, 12 related, 7 tested_by, 5 triggers, 5 inherits, 2 documents, **0 imports**. 79/147 C#-Dateien nur contains/exports. XAML: 9 Views, ø 1,0 Kanten, 1/9 Code-behind-Paarung, 0 Event-Handler-Kanten. 3/3 `.resx` isoliert.
