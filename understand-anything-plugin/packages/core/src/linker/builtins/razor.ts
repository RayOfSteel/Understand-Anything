import type { Fact } from "../facts.js";
import type { BuiltinProvider, WarnFn } from "./types.js";

const USING_RE = /^\s*@using\s+([\w.]+)/;
const INJECT_RE = /^\s*@inject\s+(\S+)\s+\S+/;
const TAG_RE = /<([A-Z][A-Za-z0-9]*)[\s/>]/g;

function baseName(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? path : path.slice(slash + 1);
}

function dirName(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "" : path.slice(0, slash + 1);
}

export const razorUsingDirectiveProvider: BuiltinProvider = {
  name: "razor.usingDirective",
  extensions: [".razor"],
  languageId: null,
  collect(file, source) {
    const facts: Fact[] = [];
    for (const line of source.split(/\r?\n/)) {
      const m = USING_RE.exec(line);
      if (m) facts.push({ file, namespace: m[1] });
    }
    return facts;
  },
};

export const razorComponentDeclProvider: BuiltinProvider = {
  name: "razor.componentDecl",
  extensions: [".razor"],
  languageId: null,
  collect(file) {
    const base = baseName(file);
    if (base.startsWith("_")) return [];
    return [{ file, name: base.replace(/\.razor$/i, "") }];
  },
  finalize(own, _all, warn) {
    const byName = new Map<string, Fact[]>();
    for (const f of own) {
      const list = byName.get(f.name) ?? [];
      list.push(f);
      byName.set(f.name, list);
    }
    const out: Fact[] = [];
    for (const [name, list] of byName) {
      if (list.length === 1) out.push(list[0]);
      else warn(`razor.componentDecl: component name '${name}' is ambiguous (${list.length} files) — dropped`);
    }
    return out;
  },
};

export const razorComponentTagProvider: BuiltinProvider = {
  name: "razor.componentTag",
  extensions: [".razor"],
  languageId: null,
  collect(file, source) {
    const names = new Set<string>();
    for (const m of source.matchAll(TAG_RE)) names.add(m[1]);
    return [...names].sort().map((name) => ({ file, name }));
  },
};

function usingsForFile(file: string, usingTable: Fact[]): string[] {
  const result: string[] = [];
  for (const u of usingTable) {
    const isImports = baseName(u.file) === "_Imports.razor";
    // Eigene Direktiven immer; _Imports.razor gilt für sein Verzeichnis und alles darunter.
    if (u.file === file || (isImports && file.startsWith(dirName(u.file)))) {
      result.push(u.namespace);
    }
  }
  return result;
}

function resolveInject(
  typeName: string,
  usings: string[],
  fqnIndex: Set<string>,
  shortIndex: Map<string, string[]>,
  file: string,
  warn: WarnFn,
): string | null {
  if (typeName.includes(".")) {
    if (fqnIndex.has(typeName)) return typeName;
    warn(`razor.inject: ${file}: qualified type '${typeName}' not found — dropped`);
    return null;
  }
  const viaUsings = [
    ...new Set(usings.map((u) => `${u}.${typeName}`).filter((c) => fqnIndex.has(c))),
  ];
  if (viaUsings.length === 1) return viaUsings[0];
  const short = shortIndex.get(typeName) ?? [];
  if (short.length === 1) return short[0];
  warn(
    `razor.inject: ${file}: type '${typeName}' ${short.length === 0 ? "not resolvable" : "ambiguous"} — dropped`,
  );
  return null;
}

export const razorInjectProvider: BuiltinProvider = {
  name: "razor.inject",
  extensions: [".razor"],
  languageId: null,
  dependsOn: ["csharp.classFqn", "razor.usingDirective"],
  collect(file, source) {
    const facts: Fact[] = [];
    for (const line of source.split(/\r?\n/)) {
      const m = INJECT_RE.exec(line);
      if (!m) continue;
      const raw = m[1];
      const idx = raw.indexOf("<");
      facts.push({ file, typeName: idx === -1 ? raw : raw.slice(0, idx) });
    }
    return facts;
  },
  finalize(own, all, warn) {
    const classTable = all.get("csharp.classFqn") ?? [];
    const usingTable = all.get("razor.usingDirective") ?? [];
    const fqnIndex = new Set(classTable.map((f) => f.value));
    const shortIndex = new Map<string, string[]>();
    for (const f of classTable) {
      const list = shortIndex.get(f.name) ?? [];
      list.push(f.value);
      shortIndex.set(f.name, list);
    }
    const out: Fact[] = [];
    for (const f of own) {
      const usings = usingsForFile(f.file, usingTable);
      const typeFqn = resolveInject(f.typeName, usings, fqnIndex, shortIndex, f.file, warn);
      if (typeFqn) out.push({ file: f.file, typeName: f.typeName, typeFqn });
    }
    return out;
  },
};
