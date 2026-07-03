import type { Node } from "web-tree-sitter";
import type { Fact } from "../facts.js";
import type { BuiltinProvider, WarnFn } from "./types.js";

const CLASS_LIKE = new Set([
  "class_declaration",
  "interface_declaration",
  "record_declaration",
  "struct_declaration",
  "enum_declaration",
]);
const REGISTER_METHODS = new Set(["Register", "RegisterMany", "RegisterInstance"]);

interface ClassInfo {
  fqn: string;
  name: string;
  methods: string[];
}
interface RegistrationInfo {
  serviceRaw: string;
  implRaw: string;
}
interface FileInfo {
  usings: string[];
  namespaces: string[];
  classes: ClassInfo[];
  registrations: RegistrationInfo[];
}

const cache = new WeakMap<Node, FileInfo>();

function findChild(node: Node, type: string): Node | null {
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i);
    if (c?.type === type) return c;
  }
  return null;
}

/** Same field/fallback strategy as csharp-extractor.ts namespaceName (re-implemented). */
function namespaceName(node: Node): string | null {
  const n =
    node.childForFieldName("name") ??
    findChild(node, "qualified_name") ??
    findChild(node, "identifier");
  return n ? n.text : null;
}

function collectClass(node: Node, ns: string, info: FileInfo): void {
  const nameNode = node.childForFieldName("name");
  if (!nameNode) return;
  const name = nameNode.text;
  const methods: string[] = [];
  const body = node.childForFieldName("body");
  if (body) {
    for (let i = 0; i < body.childCount; i++) {
      const m = body.child(i);
      if (m?.type !== "method_declaration") continue;
      const mName = m.childForFieldName("name");
      if (mName) methods.push(mName.text);
    }
  }
  info.classes.push({ fqn: ns ? `${ns}.${name}` : name, name, methods });
}

function walkNamespaceBody(nsNode: Node, parentNs: string, info: FileInfo): void {
  const body = nsNode.childForFieldName("body");
  if (!body) return;
  for (let i = 0; i < body.childCount; i++) {
    const child = body.child(i);
    if (!child) continue;
    if (CLASS_LIKE.has(child.type)) {
      collectClass(child, parentNs, info);
    } else if (child.type === "namespace_declaration") {
      const ns = namespaceName(child);
      const full = ns ? (parentNs ? `${parentNs}.${ns}` : ns) : parentNs;
      if (ns) info.namespaces.push(full);
      walkNamespaceBody(child, full, info);
    }
  }
}

function collectRegistrations(node: Node, info: FileInfo): void {
  if (node.type === "invocation_expression") {
    const fn = node.childForFieldName("function");
    let generic: Node | null = null;
    if (fn?.type === "member_access_expression") {
      const name = fn.childForFieldName("name");
      if (name?.type === "generic_name") generic = name;
    } else if (fn?.type === "generic_name") {
      generic = fn;
    }
    if (generic) {
      const ident = findChild(generic, "identifier");
      if (ident && REGISTER_METHODS.has(ident.text)) {
        const argList = findChild(generic, "type_argument_list");
        if (argList) {
          const typeArgs: string[] = [];
          for (let i = 0; i < argList.namedChildCount; i++) {
            const t = argList.namedChild(i);
            if (t) typeArgs.push(t.text);
          }
          if (typeArgs.length === 2) {
            info.registrations.push({ serviceRaw: typeArgs[0], implRaw: typeArgs[1] });
          }
        }
      }
    }
  }
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i);
    if (c) collectRegistrations(c, info);
  }
}

/**
 * One walk per file, shared by all three providers via WeakMap cache.
 * File-scoped namespaces apply to all following top-level declarations
 * (the declarations are siblings of the namespace node in the grammar).
 */
function analyze(root: Node): FileInfo {
  const cached = cache.get(root);
  if (cached) return cached;
  const info: FileInfo = { usings: [], namespaces: [], classes: [], registrations: [] };
  let fileScopedNs = "";
  for (let i = 0; i < root.childCount; i++) {
    const child = root.child(i);
    if (!child) continue;
    switch (child.type) {
      case "using_directive": {
        const target = findChild(child, "qualified_name") ?? findChild(child, "identifier");
        if (target) info.usings.push(target.text);
        break;
      }
      case "file_scoped_namespace_declaration": {
        const ns = namespaceName(child);
        if (ns) {
          fileScopedNs = ns;
          info.namespaces.push(ns);
        }
        break;
      }
      case "namespace_declaration": {
        const ns = namespaceName(child);
        if (ns) info.namespaces.push(ns);
        walkNamespaceBody(child, ns ?? "", info);
        break;
      }
      default:
        if (CLASS_LIKE.has(child.type)) collectClass(child, fileScopedNs, info);
    }
  }
  collectRegistrations(root, info);
  cache.set(root, info);
  return info;
}

export const csharpClassFqnProvider: BuiltinProvider = {
  name: "csharp.classFqn",
  extensions: [".cs"],
  languageId: "csharp",
  collect(file, _source, root) {
    if (!root) return [];
    return analyze(root).classes.map((c) => ({ file, value: c.fqn, name: c.name }));
  },
};

export const csharpMethodDeclProvider: BuiltinProvider = {
  name: "csharp.methodDecl",
  extensions: [".cs"],
  languageId: "csharp",
  collect(file, _source, root) {
    if (!root) return [];
    return analyze(root).classes.flatMap((c) =>
      c.methods.map((m) => ({ file, classFqn: c.fqn, name: m })),
    );
  },
};

/** Strip generic arguments: "IRepo<Foo>" → "IRepo". */
function baseTypeName(raw: string): string {
  const idx = raw.indexOf("<");
  return idx === -1 ? raw : raw.slice(0, idx);
}

function resolveType(
  raw: string,
  usings: string[],
  namespaces: string[],
  fqnIndex: Set<string>,
  file: string,
  warn: WarnFn,
): string | null {
  const base = baseTypeName(raw).trim();
  if (base.includes(".")) {
    if (fqnIndex.has(base)) return base;
    warn(`csharp.registration: ${file}: qualified type '${base}' not found in project — dropped`);
    return null;
  }
  const candidates = [
    ...new Set([...namespaces, ...usings].map((p) => `${p}.${base}`).filter((c) => fqnIndex.has(c))),
  ];
  if (candidates.length === 1) return candidates[0];
  warn(
    `csharp.registration: ${file}: type '${base}' ${candidates.length === 0 ? "not resolvable" : "ambiguous"} via using context — dropped`,
  );
  return null;
}

export const csharpRegistrationProvider: BuiltinProvider = {
  name: "csharp.registration",
  extensions: [".cs"],
  languageId: "csharp",
  dependsOn: ["csharp.classFqn"],
  collect(file, _source, root) {
    if (!root) return [];
    const info = analyze(root);
    return info.registrations.map((r) => ({
      file,
      _serviceRaw: r.serviceRaw,
      _implRaw: r.implRaw,
      _usings: JSON.stringify(info.usings),
      _namespaces: JSON.stringify(info.namespaces),
    }));
  },
  finalize(own, all, warn) {
    const fqnIndex = new Set((all.get("csharp.classFqn") ?? []).map((f) => f.value));
    const out: Fact[] = [];
    for (const f of own) {
      const usings = JSON.parse(f._usings) as string[];
      const namespaces = JSON.parse(f._namespaces) as string[];
      const serviceFqn = resolveType(f._serviceRaw, usings, namespaces, fqnIndex, f.file, warn);
      const implFqn = resolveType(f._implRaw, usings, namespaces, fqnIndex, f.file, warn);
      if (serviceFqn && implFqn) out.push({ file: f.file, serviceFqn, implFqn });
    }
    return out;
  },
};
