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
