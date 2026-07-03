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
