import type { Node } from "web-tree-sitter";
import type { Fact } from "../facts.js";
import { stripQuotes } from "../query-facts.js";
import type { BuiltinProvider } from "./types.js";

const TAG_TYPES = new Set(["STag", "EmptyElemTag"]);
const CLR_PREFIX = "clr-namespace:";

function visit(node: Node, fn: (n: Node) => void): void {
  fn(node);
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i);
    if (c) visit(c, fn);
  }
}

/**
 * xmlns prefix mapping + prefixed element tags → resolved FQNs.
 * Prefix splitting and namespace concatenation live deliberately here,
 * not in the equality-join language (spec §8.3).
 */
export const xamlTypeUsageProvider: BuiltinProvider = {
  name: "xaml.typeUsage",
  extensions: [".xaml"],
  languageId: "xaml",
  collect(file, _source, root) {
    if (!root) return [];
    const prefixToNs = new Map<string, string>();
    const tagNames: string[] = [];
    visit(root, (n) => {
      if (n.type === "Attribute") {
        const name = n.childForFieldName("name") ?? n.namedChild(0);
        const value = n.namedChild(n.namedChildCount - 1);
        if (!name || !value || name.type !== "Name" || value.type !== "AttValue") return;
        if (name.text.startsWith("xmlns:")) {
          const prefix = name.text.slice("xmlns:".length);
          const v = stripQuotes(value.text);
          if (v.startsWith(CLR_PREFIX)) {
            prefixToNs.set(prefix, v.slice(CLR_PREFIX.length).split(";")[0]);
          }
        }
      } else if (TAG_TYPES.has(n.type)) {
        const name = n.namedChild(0);
        if (name?.type === "Name" && name.text.includes(":")) tagNames.push(name.text);
      }
    });
    const values = new Set<string>();
    for (const tag of tagNames) {
      const [prefix, local] = tag.split(":", 2);
      const ns = prefixToNs.get(prefix);
      if (ns && local) values.add(`${ns}.${local}`);
    }
    const facts: Fact[] = [];
    for (const value of [...values].sort()) facts.push({ file, value });
    return facts;
  },
};
