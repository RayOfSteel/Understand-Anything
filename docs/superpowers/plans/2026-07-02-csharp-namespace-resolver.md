# C#-Namespace-Resolver Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** C#-`using`-Direktiven und Same-Namespace-Referenzen werden deterministisch zu projektinternen Datei-Abhängigkeiten aufgelöst (Spec: `docs/superpowers/specs/2026-07-02-deterministic-linking-design.md`, Phase ①, Strategie „V2 + Same-Namespace").

**Architecture:** Der `CSharpExtractor` (Core) erfasst zusätzlich die deklarierten Namespaces jeder Datei. `extract-import-map.mjs` baut daraus in einem Pre-Pass einen Index `Namespace → [{Datei, Typnamen}]` und ersetzt den bisherigen Pfad-Suffix-Probe-Ansatz: Eine Kante entsteht nur, wenn die importierende Datei einen Typ der Zieldatei per Wortgrenzen-Match referenziert. Merge, Schema und Dashboard bleiben unverändert.

**Tech Stack:** TypeScript (strict, ESM), web-tree-sitter (WASM), Vitest, Node ≥ 22, pnpm ≥ 10.

## Global Constraints

- Repo: `C:\1_Develop_\Repos\Mine\Understand-Anything\Understand-Anything`, Branch `myMaster` (Fork-Modus — bestehende Konventionen einhalten, keine Upstream-Rücksichten).
- Alle Kommandos vom Repo-Root ausführen, sofern nicht anders angegeben.
- `extract-import-map.mjs`: Logging **nur** auf stderr (stdout ist reserviert); Per-File-Resilienz erhalten — ein Datei-Fehler setzt `importMap[path] = []`, bricht nie das Script ab.
- `StructuralAnalysis`-Erweiterung muss additiv sein (optionales Feld) — kein bestehender Consumer darf brechen.
- Das Script lädt `@understand-anything/core` aus `dist/` — nach Core-Änderungen vor Script-Tests `pnpm --filter @understand-anything/core build` ausführen.
- Git-Warnungen `LF will be replaced by CRLF` sind bekannt und ignorierbar.

---

### Task 1: `namespaces`-Feld in StructuralAnalysis + CSharpExtractor

**Files:**
- Modify: `understand-anything-plugin/packages/core/src/types.ts:169-181` (Interface `StructuralAnalysis`)
- Modify: `understand-anything-plugin/packages/core/src/plugins/extractors/csharp-extractor.ts:129-279`
- Test: `understand-anything-plugin/packages/core/src/plugins/extractors/__tests__/csharp-extractor.test.ts`

**Interfaces:**
- Consumes: bestehende Typen `StructuralAnalysis`, `TreeSitterNode`, Helper `findChild` (bereits importiert).
- Produces: `StructuralAnalysis.namespaces?: string[]` — vom CSharpExtractor **immer** gesetzt (ggf. leeres Array), dedupliziert, verschachtelte Namespaces als gepunktete Pfade (`A.B`). Task 2 verlässt sich auf exakt dieses Feld.

- [ ] **Step 1: Failing Tests schreiben**

In `csharp-extractor.test.ts` als neuen `describe`-Block auf oberster Ebene (neben den bestehenden `extractStructure - …`-Blöcken) einfügen — das vorhandene `parse()`-Helper und `extractor` werden wiederverwendet:

```ts
describe("extractStructure - namespaces", () => {
  it("records a block-scoped namespace", () => {
    const { tree, parser, root } = parse(`namespace MyApp.Views {
    public class CustomerView { }
}
`);
    const result = extractor.extractStructure(root);
    expect(result.namespaces).toEqual(["MyApp.Views"]);
    tree.delete();
    parser.delete();
  });

  it("records a file-scoped namespace", () => {
    const { tree, parser, root } = parse(`namespace MyApp.Services;

public class UserService { }
`);
    const result = extractor.extractStructure(root);
    expect(result.namespaces).toEqual(["MyApp.Services"]);
    tree.delete();
    parser.delete();
  });

  it("records nested namespaces as dotted paths", () => {
    const { tree, parser, root } = parse(`namespace A {
    namespace B {
        public class C { }
    }
}
`);
    const result = extractor.extractStructure(root);
    expect(result.namespaces).toEqual(["A", "A.B"]);
    tree.delete();
    parser.delete();
  });

  it("records multiple top-level namespaces deduplicated", () => {
    const { tree, parser, root } = parse(`namespace First { public class A { } }
namespace Second { public class B { } }
namespace First { public class C { } }
`);
    const result = extractor.extractStructure(root);
    expect(result.namespaces).toEqual(["First", "Second"]);
    tree.delete();
    parser.delete();
  });

  it("returns an empty array when no namespace is declared", () => {
    const { tree, parser, root } = parse(`public class Global { }
`);
    const result = extractor.extractStructure(root);
    expect(result.namespaces).toEqual([]);
    tree.delete();
    parser.delete();
  });
});
```

- [ ] **Step 2: Tests laufen lassen — müssen fehlschlagen**

Run: `pnpm --filter @understand-anything/core exec vitest run src/plugins/extractors/__tests__/csharp-extractor.test.ts`
Expected: FAIL — `result.namespaces` ist `undefined` (Feld existiert noch nicht).

- [ ] **Step 3: Typ erweitern**

In `packages/core/src/types.ts`, im Interface `StructuralAnalysis`, direkt nach der `exports`-Zeile (Zeile 173) ergänzen:

```ts
  // Declared namespaces (C#; dotted for nested). Optional for backward compat.
  namespaces?: string[];
```

- [ ] **Step 4: Extractor implementieren**

In `csharp-extractor.ts`:

`extractStructure` (Zeile 129–138) ersetzen durch:

```ts
  extractStructure(rootNode: TreeSitterNode): StructuralAnalysis {
    const functions: StructuralAnalysis["functions"] = [];
    const classes: StructuralAnalysis["classes"] = [];
    const imports: StructuralAnalysis["imports"] = [];
    const exports: StructuralAnalysis["exports"] = [];
    const namespaces: string[] = [];

    this.walkTopLevel(rootNode, functions, classes, imports, exports, namespaces);

    return { functions, classes, imports, exports, namespaces: [...new Set(namespaces)] };
  }
```

Privaten Helper vor `walkTopLevel` ergänzen (nutzt das bestehende `findChild`):

```ts
  /**
   * Extract the dotted name of a namespace_declaration or
   * file_scoped_namespace_declaration. The grammar exposes it as the `name`
   * field (qualified_name or identifier); fall back to child scan for
   * grammar-version robustness.
   */
  private namespaceName(node: TreeSitterNode): string | null {
    const nameNode =
      node.childForFieldName("name") ??
      findChild(node, "qualified_name") ??
      findChild(node, "identifier");
    return nameNode ? nameNode.text : null;
  }
```

`walkTopLevel` (Zeile 209–244): Signatur um den Parameter `namespaces: string[]` erweitern; die zwei Namespace-Cases ersetzen durch:

```ts
        case "namespace_declaration": {
          const ns = this.namespaceName(child);
          if (ns) namespaces.push(ns);
          this.walkNamespaceBody(child, functions, classes, imports, exports, namespaces, ns ?? "");
          break;
        }

        case "file_scoped_namespace_declaration": {
          // File-scoped namespace: declarations are siblings at the root,
          // not children of this node. Record the name only.
          const ns = this.namespaceName(child);
          if (ns) namespaces.push(ns);
          break;
        }
```

`walkNamespaceBody` (Zeile 250–279): Signatur um `namespaces: string[], parentNs: string` erweitern; den `namespace_declaration`-Case (verschachtelt) ersetzen durch:

```ts
        case "namespace_declaration": {
          const ns = this.namespaceName(child);
          const full = ns ? (parentNs ? `${parentNs}.${ns}` : ns) : parentNs;
          if (ns) namespaces.push(full);
          this.walkNamespaceBody(child, functions, classes, imports, exports, namespaces, full);
          break;
        }
```

Der bestehende Top-Level-Aufruf `this.walkNamespaceBody(child, …)` in `walkTopLevel` übergibt `ns ?? ""` als `parentNs` (siehe oben).

- [ ] **Step 5: Tests laufen lassen — müssen bestehen**

Run: `pnpm --filter @understand-anything/core exec vitest run src/plugins/extractors/__tests__/csharp-extractor.test.ts`
Expected: PASS (alle bestehenden + 5 neue Tests).

- [ ] **Step 6: Gesamte Core-Suite als Regression**

Run: `pnpm --filter @understand-anything/core test`
Expected: PASS — kein bestehender Test bricht (Feld ist additiv).

- [ ] **Step 7: Commit**

```bash
git add understand-anything-plugin/packages/core/src/types.ts understand-anything-plugin/packages/core/src/plugins/extractors/csharp-extractor.ts understand-anything-plugin/packages/core/src/plugins/extractors/__tests__/csharp-extractor.test.ts
git commit -m "feat(core): capture declared C# namespaces in StructuralAnalysis"
```

---

### Task 2: Namespace-Index-Resolver in extract-import-map.mjs

**Files:**
- Modify: `understand-anything-plugin/skills/understand/extract-import-map.mjs` (Anker: Zeilen ~385-400 Kontextaufbau, ~966-978 C#-Resolver, ~1439-1441 Dispatch, ~1525 Hauptablauf, ~1572-1599 Loop-Branch)
- Test: `tests/skill/understand/test_extract_import_map.test.mjs` (bestehender C#-`describe`-Block, Zeile ~869)

**Interfaces:**
- Consumes: `StructuralAnalysis.namespaces: string[]` und `classes[].name` aus Task 1 (via `registry.analyzeFile(path, content)`); vorhandene Script-Helper `toPosix`, `readFilesParallel`, `join`, `buildSuffixIndex` (letzterer verliert seinen C#-Nutzer).
- Produces: unveränderte `importMap`-Ausgabeform `{ <path>: [<resolvedPath>…] }` — nachgelagerte Consumer (Merge-Script) unverändert.

- [ ] **Step 1: Core bauen (Script lädt dist/)**

Run: `pnpm --filter @understand-anything/core build`
Expected: Build ohne Fehler.

- [ ] **Step 2: Failing Tests schreiben**

Im bestehenden Block `describe('extract-import-map.mjs — C# resolver', …)` (Zeile 869): den vorhandenen Test **behalten** (er prüft jetzt den Typ-FQN-Fallback), Titel ändern auf `'resolves type-FQN usings (using N.T) to the declaring file'`. Dahinter fünf neue Tests einfügen:

```js
  it('resolves namespace usings via declared-namespace index, gated by type reference', () => {
    projectRoot = setupTree({
      'App/Program.cs':
        `using MyApp.Services;\n\nnamespace MyApp.App {\n  class Program { void Run() { var s = new UserService(); } }\n}\n`,
      'Services/UserService.cs':
        `namespace MyApp.Services { public class UserService { } }\n`,
      'Services/MailService.cs':
        `namespace MyApp.Services { public class MailService { } }\n`,
    });

    const result = runScript(projectRoot, {
      projectRoot,
      files: [
        { path: 'App/Program.cs', language: 'csharp', fileCategory: 'code' },
        { path: 'Services/UserService.cs', language: 'csharp', fileCategory: 'code' },
        { path: 'Services/MailService.cs', language: 'csharp', fileCategory: 'code' },
      ],
    });

    expect(result.status).toBe(0);
    // UserService wird referenziert -> Kante; MailService nicht -> keine Kante
    expect(result.output.importMap['App/Program.cs']).toEqual(['Services/UserService.cs']);
  });

  it('resolves same-namespace references without any using directive', () => {
    projectRoot = setupTree({
      'Commands/MoveCommand.cs':
        `namespace App.Commands {\n  internal sealed class MoveCommand : MoveCommandBase { }\n}\n`,
      'Commands/MoveCommandBase.cs':
        `namespace App.Commands {\n  internal abstract class MoveCommandBase { }\n}\n`,
    });

    const result = runScript(projectRoot, {
      projectRoot,
      files: [
        { path: 'Commands/MoveCommand.cs', language: 'csharp', fileCategory: 'code' },
        { path: 'Commands/MoveCommandBase.cs', language: 'csharp', fileCategory: 'code' },
      ],
    });

    expect(result.status).toBe(0);
    expect(result.output.importMap['Commands/MoveCommand.cs']).toEqual(['Commands/MoveCommandBase.cs']);
    // Keine Rückkante: die Basisklasse referenziert MoveCommand nicht
    expect(result.output.importMap['Commands/MoveCommandBase.cs']).toEqual([]);
  });

  it('resolves alias usings via their target (using Foo = N.T)', () => {
    projectRoot = setupTree({
      'App/Program.cs':
        `using Svc = MyApp.Services.UserService;\n\nnamespace MyApp.App {\n  class Program { void Run() { Svc s = null; } }\n}\n`,
      'Services/UserService.cs':
        `namespace MyApp.Services { public class UserService { } }\n`,
    });

    const result = runScript(projectRoot, {
      projectRoot,
      files: [
        { path: 'App/Program.cs', language: 'csharp', fileCategory: 'code' },
        { path: 'Services/UserService.cs', language: 'csharp', fileCategory: 'code' },
      ],
    });

    expect(result.status).toBe(0);
    // Der Extractor liefert das Alias-Ziel (MyApp.Services.UserService) als
    // Import-Source; der Typ-FQN-Fallback loest es auf.
    expect(result.output.importMap['App/Program.cs']).toEqual(['Services/UserService.cs']);
  });

  it('documents the v1 limit: a type name inside a comment counts as a reference', () => {
    projectRoot = setupTree({
      'App/Program.cs':
        `using MyApp.Services;\n\nnamespace MyApp.App {\n  // TODO: later use MailService here\n  class Program { }\n}\n`,
      'Services/MailService.cs':
        `namespace MyApp.Services { public class MailService { } }\n`,
    });

    const result = runScript(projectRoot, {
      projectRoot,
      files: [
        { path: 'App/Program.cs', language: 'csharp', fileCategory: 'code' },
        { path: 'Services/MailService.cs', language: 'csharp', fileCategory: 'code' },
      ],
    });

    expect(result.status).toBe(0);
    // Bewusste v1-Grenze (Spec §5.3): Wortgrenzen-Match ueber den gesamten
    // Quelltext, Kommentare eingeschlossen. Bei Verschaerfung auf
    // Syntaxbaum-Identifier kippt die Erwartung auf [].
    expect(result.output.importMap['App/Program.cs']).toEqual(['Services/MailService.cs']);
  });

  it('resolves usings against file-scoped namespaces', () => {
    projectRoot = setupTree({
      'App/Program.cs':
        `using MyApp.Services;\n\nnamespace MyApp.App;\n\nclass Program { void Run() { var s = new UserService(); } }\n`,
      'Services/UserService.cs':
        `namespace MyApp.Services;\n\npublic class UserService { }\n`,
    });

    const result = runScript(projectRoot, {
      projectRoot,
      files: [
        { path: 'App/Program.cs', language: 'csharp', fileCategory: 'code' },
        { path: 'Services/UserService.cs', language: 'csharp', fileCategory: 'code' },
      ],
    });

    expect(result.status).toBe(0);
    expect(result.output.importMap['App/Program.cs']).toEqual(['Services/UserService.cs']);
  });
```

- [ ] **Step 3: Tests laufen lassen — neue müssen fehlschlagen**

Run: `pnpm exec vitest run tests/skill/understand/test_extract_import_map.test.mjs -t "C# resolver"`
Expected: Der Typ-FQN-Test besteht (alter Mechanismus trifft zufällig), die fünf neuen Tests FAIL (bzw. der Kommentar-Limit-Test kann je nach altem Verhalten zufällig bestehen — maßgeblich ist Step 5) (leere importMap-Einträge).

- [ ] **Step 4: Resolver implementieren**

In `extract-import-map.mjs` vier Änderungen:

**(a)** Den Block „C# resolver" (Kommentar + `resolveCSharpImport`, Zeilen ~966–978) ersetzen durch:

```js
// ---------------------------------------------------------------------------
// C# resolver (namespace-index based)
//
// C# `using X` names a NAMESPACE, and files are named after TYPES, so the
// dotted-path probe used for Java/Kotlin essentially always misses in real
// .NET solutions (namespace != file path). Instead:
//   Pass 1 (buildCsNamespaceContext): analyze every .cs file once and index
//     which files declare which namespaces and which type names each file
//     declares.
//   Pass 2 (resolveCSharpFileImports): `using X` candidates are the files
//     declaring namespace X; an edge is added only when the importing file's
//     source references one of the candidate's type names (word-boundary
//     match). `using N.T` (type-FQN / using-static / alias target) where T
//     is a type declared in namespace N resolves to T's file directly.
//     Files sharing a namespace need no `using` in C#, so the same
//     type-reference gate runs against same-namespace siblings too.
//
// Known v1 limits (see docs/superpowers/specs/2026-07-02-deterministic-
// linking-design.md §5.3): global usings act as imports of their own file
// only; type references inside comments/strings count as matches.
// ---------------------------------------------------------------------------

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function referencesType(content, typeName) {
  if (!typeName) return false;
  return new RegExp(`\\b${escapeRegex(typeName)}\\b`).test(content);
}

/**
 * Pre-pass over all C# code files. Returns
 *   csAnalyses:       Map<posixPath, { analysis, content }>
 *   csNamespaceIndex: Map<namespace, Array<{ path, types: string[] }>>
 * Read/analyze failures are warned and skipped; the main loop then yields
 * importMap[path] = [] for those files.
 */
async function buildCsNamespaceContext(projectRoot, files, registry) {
  const csAnalyses = new Map();
  const csNamespaceIndex = new Map();
  const csFiles = files.filter(
    (f) => f.fileCategory === 'code' && f.language === 'csharp',
  );
  if (csFiles.length === 0) return { csAnalyses, csNamespaceIndex };

  const reads = await readFilesParallel(
    csFiles.map((f) => ({ key: toPosix(f.path), absPath: join(projectRoot, f.path) })),
  );
  for (const { key, raw, err } of reads) {
    if (err) {
      process.stderr.write(
        `Warning: extract-import-map: C# pre-pass read failed for ${key} (${err.message})\n`,
      );
      continue;
    }
    let analysis;
    try {
      analysis = registry.analyzeFile(key, raw);
    } catch (e) {
      process.stderr.write(
        `Warning: extract-import-map: C# pre-pass analyze failed for ${key} (${e.message})\n`,
      );
      continue;
    }
    csAnalyses.set(key, { analysis, content: raw });
    const types = (analysis?.classes ?? []).map((c) => c.name);
    for (const ns of analysis?.namespaces ?? []) {
      if (!csNamespaceIndex.has(ns)) csNamespaceIndex.set(ns, []);
      csNamespaceIndex.get(ns).push({ path: key, types });
    }
  }
  for (const arr of csNamespaceIndex.values()) {
    arr.sort((a, b) => a.path.localeCompare(b.path));
  }
  return { csAnalyses, csNamespaceIndex };
}

/**
 * Resolve all project-internal dependencies of one C# file. Returns a Set
 * of posix paths (importer excluded).
 */
function resolveCSharpFileImports(path, analysis, content, csCtx) {
  const out = new Set();
  const { csNamespaceIndex } = csCtx;

  const addIfReferenced = (candidate) => {
    if (candidate.path === path || out.has(candidate.path)) return;
    for (const t of candidate.types) {
      if (referencesType(content, t)) {
        out.add(candidate.path);
        return;
      }
    }
  };

  for (const imp of analysis?.imports ?? []) {
    const u = (imp.source ?? '').replace(/\.\*$/, '');
    if (!u) continue;

    const nsCandidates = csNamespaceIndex.get(u);
    if (nsCandidates) {
      for (const c of nsCandidates) addIfReferenced(c);
      continue;
    }

    // Type-FQN fallback: `using N.T` where T is a type declared in N.
    const lastDot = u.lastIndexOf('.');
    if (lastDot > 0) {
      const nsPart = u.slice(0, lastDot);
      const typePart = u.slice(lastDot + 1);
      for (const c of csNamespaceIndex.get(nsPart) ?? []) {
        if (c.path !== path && c.types.includes(typePart)) out.add(c.path);
      }
    }
  }

  // Same-namespace siblings need no `using` in C#.
  for (const ns of analysis?.namespaces ?? []) {
    for (const c of csNamespaceIndex.get(ns) ?? []) addIfReferenced(c);
  }

  return out;
}
```

**(b)** Im Kontextaufbau (`buildResolutionContext`): die Zeile `const csIndex = buildSuffixIndex(files, p => p.endsWith('.cs'));` (~389) und das Feld `csIndex,` im Rückgabeobjekt (~399) entfernen.

**(c)** Im `resolveImport`-Dispatch: den Block `if (lang === 'csharp') { return resolveCSharpImport(src, file, ctx); }` (~1439–1441) ersatzlos entfernen (C# läuft nicht mehr über den generischen Pfad).

**(d)** Im Hauptablauf: nach `const ctx = await buildResolutionContext(projectRoot, files);` (~1525) ergänzen:

```js
  // C# pre-pass: namespace/type index (needs tree-sitter).
  const csCtx = treeSitterReady
    ? await buildCsNamespaceContext(projectRoot, files, registry)
    : { csAnalyses: new Map(), csNamespaceIndex: new Map() };
```

In der Datei-Schleife, direkt nach dem Ruby-Branch (`if (file.language === 'ruby') { … }`), einen weiteren Branch einfügen:

```js
      } else if (file.language === 'csharp') {
        const cached = csCtx.csAnalyses.get(path);
        if (cached) {
          for (const out of resolveCSharpFileImports(path, cached.analysis, cached.content, csCtx)) {
            if (ctx.fileSet.has(out)) resolvedSet.add(out);
          }
        }
      } else {
```

(der bisherige `} else {`-Zweig mit `registry.analyzeFile` bleibt für alle übrigen Sprachen unverändert dahinter).

- [ ] **Step 5: Tests laufen lassen — müssen bestehen**

Run: `pnpm exec vitest run tests/skill/understand/test_extract_import_map.test.mjs -t "C# resolver"`
Expected: PASS (Typ-FQN-Regression + 5 neue).

- [ ] **Step 6: Gesamte Import-Map-Suite als Regression**

Run: `pnpm exec vitest run tests/skill/understand/test_extract_import_map.test.mjs`
Expected: PASS — insbesondere die Blöcke „tree-sitter init graceful failure", „per-file failure resilience" und „output schema invariants" (unser Branch respektiert `treeSitterReady` und die Leere-Array-Semantik).

- [ ] **Step 7: Lint**

Run: `pnpm lint`
Expected: keine neuen Findings.

- [ ] **Step 8: Commit**

```bash
git add understand-anything-plugin/skills/understand/extract-import-map.mjs tests/skill/understand/test_extract_import_map.test.mjs
git commit -m "feat(skill): resolve C# usings via declared-namespace index with type-reference gate"
```

---

### Task 3: Integrationsmessung am Prüfstein MachineSIC

**Files:**
- Create: `C:\Users\kl5888\AppData\Local\Temp\claude\...\scratchpad\phase1\machinesic-input.json` (Wegwerf-Input, NICHT committen)
- Modify: `docs/superpowers/specs/2026-07-02-deterministic-linking-design.md` (Messergebnis in §5.4 nachtragen)

**Interfaces:**
- Consumes: `MachineSIC/.understand-anything/intermediate/scan-result.json` — enthält `files: [{path, language, fileCategory, …}]` (208 Einträge) in exakt der vom Script erwarteten Form.
- Produces: dokumentiertes Messergebnis (Kantenzahl + Stichprobe) im Spec.

- [ ] **Step 1: Input aus dem vorhandenen Scan ableiten und Script ausführen**

```bash
node -e "
const fs = require('fs');
const scan = JSON.parse(fs.readFileSync('C:/1_Develop_/Repos/Mine/Understand-Anything/MachineSIC/.understand-anything/intermediate/scan-result.json','utf-8'));
const input = {
  projectRoot: 'C:/1_Develop_/Repos/Mine/Understand-Anything/MachineSIC',
  files: scan.files.map(f => ({ path: f.path, language: f.language, fileCategory: f.fileCategory })),
};
fs.mkdirSync(process.env.SCRATCH + '/phase1', { recursive: true });
fs.writeFileSync(process.env.SCRATCH + '/phase1/machinesic-input.json', JSON.stringify(input));
"
node understand-anything-plugin/skills/understand/extract-import-map.mjs "$SCRATCH/phase1/machinesic-input.json" "$SCRATCH/phase1/machinesic-output.json"
```

(`$SCRATCH` = Scratchpad-Verzeichnis der Session; beliebiger temporärer Ordner ist gleichwertig.)

Expected (stderr): `extract-import-map: filesScanned=208 filesWithImports=<n> totalEdges=<m>` mit `m` im Korridor **300–500** (Simulationswert: ≈ 418; Abweichung erklärbar durch Tree-Sitter-genauere Typlisten gegenüber der Regex-Simulation).

- [ ] **Step 2: Stichprobe von 10 Kanten gegen den Quelltext prüfen**

```bash
node -e "
const fs = require('fs');
const out = JSON.parse(fs.readFileSync(process.env.SCRATCH + '/phase1/machinesic-output.json','utf-8'));
const edges = [];
for (const [src, targets] of Object.entries(out.importMap)) {
  for (const t of targets) edges.push([src, t]);
}
console.log('totalEdges:', edges.length);
// deterministische Stichprobe: jede Math.floor(n/10)-te Kante
const step = Math.max(1, Math.floor(edges.length / 10));
for (let i = 0; i < edges.length; i += step) console.log(edges[i][0], '->', edges[i][1]);
"
```

Für jede der ~10 Kanten manuell prüfen: Referenziert die Quelldatei tatsächlich einen Typ der Zieldatei (using + Typnutzung oder Same-Namespace-Nutzung)? Erwartung: ≥ 9/10 eindeutig korrekt; Auffälligkeiten (z. B. Kommentar-Treffer) als bekannte v1-Grenze notieren, nicht fixen.

- [ ] **Step 3: Ergebnis im Spec dokumentieren**

In `docs/superpowers/specs/2026-07-02-deterministic-linking-design.md` §5.4 am Ende ergänzen (Zahlen durch Messwerte ersetzen):

```markdown
**Messergebnis (2026-07-02):** MachineSIC-Lauf: totalEdges=<m> (Simulation: ≈418), filesWithImports=<n>/147 C#-Dateien. Stichprobe 10 Kanten: <k>/10 korrekt; Auffälligkeiten: <…>.
```

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-07-02-deterministic-linking-design.md
git commit -m "docs: record MachineSIC integration measurement for phase 1 resolver"
```

---

## Hinweis für die Ausführung

Der neue Resolver wird erst bei einem erneuten `/understand`-Lauf (inkrementell reicht nicht — `--full`, da sich keine Datei-Fingerprints geändert haben) in den Knowledge Graph übernommen; Task 3 misst deshalb bewusst nur die `importMap`-Ebene. Der Graph-Neuaufbau ist kein Teil dieses Plans.
