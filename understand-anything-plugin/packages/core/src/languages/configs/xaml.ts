import type { LanguageConfig } from "../types.js";

export const xamlConfig = {
  id: "xaml",
  displayName: "XAML",
  extensions: [".xaml"],
  treeSitter: {
    wasmPackage: "@understand-anything/tree-sitter-xml-wasm",
    wasmFile: "tree-sitter-xml.wasm",
  },
  concepts: [
    "WPF",
    "data binding",
    "code-behind",
    "resources",
    "styles",
    "templates",
    "routed events",
  ],
  filePatterns: {
    entryPoints: ["App.xaml"],
    barrels: [],
    tests: [],
    config: [],
  },
} satisfies LanguageConfig;
