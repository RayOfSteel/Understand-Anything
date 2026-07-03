import { describe, it, expect, beforeAll } from "vitest";
import { createRequire } from "node:module";
import { Parser, Language } from "web-tree-sitter";
import {
  csharpClassFqnProvider,
  csharpMethodDeclProvider,
  csharpRegistrationProvider,
} from "../builtins/csharp.js";
import type { Fact } from "../facts.js";
import type { BuiltinProvider } from "../builtins/types.js";

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

function collect(provider: Pick<BuiltinProvider, "collect">, file: string, source: string): Fact[] {
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
