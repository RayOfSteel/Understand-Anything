# Design: Deterministische Verbindungsschicht für Understand-Anything

**Datum:** 2026-07-02
**Status:** Entwurf, Phase ① detailliert und freigegeben
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
2. **Fork vs. Upstream-Contribution** (vor erstem Code): bestimmt Konventions- und Teststrenge. Understand-Anything ist ein fremdes Open-Source-Projekt.
3. **Ablageort projektspezifischer Regeln** (Phase ③/④): im Plugin ausgeliefert vs. `.understand-anything/rules/` im Ziel-Repo. Sicherheitsrelevant, falls Regeln Code enthalten dürften.
4. **Formalisierung des vorhandenen Ad-hoc-Patch-Formats** (Phase ②): In Nutzer-Repos existieren bereits handgeschriebene `.understand-anything/patches/*.patch.json` (`edges_to_add`/`edges_to_remove` + `_meta.rationale`) — Kandidat für das offizielle Patch-/Provenance-Format.

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

### 5.4 Verifikation

- Unit-Fixtures: block-scoped, file-scoped, verschachtelte Namespaces; Same-Namespace-Referenz ohne `using`; Alias; Typname nur im Kommentar (erwartet: je nach Filterstand dokumentiert).
- Regressionslauf der bestehenden Import-Map-Tests (andere Sprachen unberührt).
- Integrationsmaß: erneuter Scan von MachineSIC → erwartet ≈ 418 `imports`-Kanten (± Simulationstoleranz), Stichprobe von 10 zufälligen Kanten manuell gegen Quelltext geprüft.

### 5.5 Nicht-Ziele von Phase ①

XAML/Razor/DI-Verbindungen (Phase ③), Provenance (Phase ②), `global using`-Projektsemantik, `using static`-Präzision, Grammar-Authoring.

## 6. Phasen ②–⑤ im Rahmen

**② Provenance:** Kanten erhalten additive Felder `origin` (`"structural" | "llm" | "rule"`), `ruleId?`, `confidence?`, `evidence?`. Merge-Script und Schema-Validierung setzen/erhalten sie; Dashboard zeigt sie in der NodeInfo/Kanten-Ansicht an. Das vorhandene Ad-hoc-Patch-Format (Weggabelung 4) wird hier formalisiert.

**③ Linker-Infrastruktur + WPF-Pack:** Neue deterministische Pipeline-Phase nach dem Merge. Erste Regeln: XAML↔Code-behind über `x:Class`/Dateikonvention (mechanisch), XAML-Event-Attribut → Handler-Methode, XAML→ViewModel über `DataContext`/Bindings (heuristisch, niedrigere confidence), Razor `@inject`/Komponenten-Tags, DryIoc-Registrierung → `implements`/`depends_on`. Voraussetzungen: `.xaml` in XML-Config + XML/XAML-Grammatik aktivieren, XAML-Extractor. Regelformat = Weggabelung 1.

**④ Gap-Diagnose:** `/understand-diagnose-gaps` clustert isolierte/schwach verbundene Nodes (nach Extension, Pfadmuster, Parser-Output, Framework-Signalen), gibt 2–3 Samples pro Cluster an einen Diagnose-Agent, der Fix-Vorschläge mit Leverage/Aufwand/False-Positive-Risiko erzeugt — priorisiert als Liste, konsumierbar durch ③.

**⑤ Feedback-Loop:** Vom Dashboard aus („Kante ist falsch") über die Provenance aus ② zur verursachenden Regel; Agent schärft Scope/Validierung der Regel und erzeugt einen Regressionsfall.

## 7. Messbasis MachineSIC (Ist-Stand 2026-07-02)

920 Kanten: 419 contains, 233 exports, 92 calls, 88 depends_on, 35 configures, 22 implements, 12 related, 7 tested_by, 5 triggers, 5 inherits, 2 documents, **0 imports**. 79/147 C#-Dateien nur contains/exports. XAML: 9 Views, ø 1,0 Kanten, 1/9 Code-behind-Paarung, 0 Event-Handler-Kanten. 3/3 `.resx` isoliert.
