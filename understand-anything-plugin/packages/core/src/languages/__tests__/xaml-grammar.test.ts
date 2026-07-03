import { describe, it, expect, beforeAll } from "vitest";
import { createRequire } from "node:module";
import { Parser, Language, Query } from "web-tree-sitter";
import { builtinLanguageConfigs } from "../configs/index.js";

const require = createRequire(import.meta.url);
let xamlLang: Language;

beforeAll(async () => {
  await Parser.init();
  const wasmPath = require.resolve(
    "@understand-anything/tree-sitter-xml-wasm/tree-sitter-xml.wasm",
  );
  xamlLang = await Language.load(wasmPath);
});

describe("vendored XAML (XML) grammar", () => {
  it("registers a xaml language config with the vendored wasm package", () => {
    const cfg = builtinLanguageConfigs.find((c) => c.id === "xaml");
    expect(cfg?.extensions).toContain(".xaml");
    expect(cfg?.treeSitter?.wasmPackage).toBe("@understand-anything/tree-sitter-xml-wasm");
    expect(cfg?.treeSitter?.wasmFile).toBe("tree-sitter-xml.wasm");
  });

  it("parses WPF markup and answers Attribute/Name/AttValue queries", () => {
    const parser = new Parser();
    parser.setLanguage(xamlLang);
    const tree = parser.parse(
      '<Window x:Class="Demo.MainWindow" Loaded="OnLoaded"><Grid/></Window>',
    );
    const q = new Query(xamlLang, "(Attribute (Name) @n (AttValue) @v)");
    const pairs = q
      .matches(tree!.rootNode)
      .map((m) => Object.fromEntries(m.captures.map((c) => [c.name, c.node.text])));
    expect(pairs).toContainEqual({ n: "x:Class", v: '"Demo.MainWindow"' });
    expect(pairs).toContainEqual({ n: "Loaded", v: '"OnLoaded"' });
  });
});
