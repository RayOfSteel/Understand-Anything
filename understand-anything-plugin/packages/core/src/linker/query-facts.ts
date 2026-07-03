import { Query, type Language, type Node } from "web-tree-sitter";
import type { Fact } from "./facts.js";

/** Remove one pair of matching surrounding quotes (`"` or `'`), if present. */
export function stripQuotes(value: string): string {
  if (
    value.length >= 2 &&
    (value[0] === '"' || value[0] === "'") &&
    value[value.length - 1] === value[0]
  ) {
    return value.slice(1, -1);
  }
  return value;
}

/** Compile a rule query (lines are joined with newlines). Throws on syntax errors. */
export function compileQuery(language: Language, lines: string[]): Query {
  return new Query(language, lines.join("\n"));
}

/** Run a compiled query over one file's tree and collect one fact per match. */
export function collectQueryFacts(
  query: Query,
  root: Node,
  file: string,
  transform: Record<string, string> = {},
): Fact[] {
  const facts: Fact[] = [];
  for (const match of query.matches(root)) {
    const fact: Fact = { file };
    for (const capture of match.captures) {
      const raw = capture.node.text;
      fact[capture.name] = transform[capture.name] === "stripQuotes" ? stripQuotes(raw) : raw;
    }
    facts.push(fact);
  }
  return facts;
}
