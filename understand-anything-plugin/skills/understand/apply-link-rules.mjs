#!/usr/bin/env node
/**
 * apply-link-rules.mjs
 *
 * Deterministic rule-based linking pass (spec 2026-07-02 §8): declarative
 * JSON rules (tree-sitter queries + builtin fact providers) add framework
 * edges with origin "rule" to the knowledge graph. Runs BEFORE
 * apply-graph-patches.mjs so manual patches keep the last word
 * (priority invariant manual > structural > rule > llm).
 *
 * Usage:
 *   node apply-link-rules.mjs <graph.json> [--rules <dir>]...
 *
 * Without --rules, two default directories are loaded: the plugin's rules/
 * directory and <projectRoot>/.understand-anything/rules/. The project root
 * is everything before the ".understand-anything" segment of the graph path.
 *
 * The graph file is rewritten in place, only on success. Logging: stderr
 * only; degradations are prefixed "Warning: apply-link-rules: ...".
 * Running the script twice produces byte-identical output (idempotence).
 */

import { dirname, join, resolve, sep } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pluginRoot = resolve(__dirname, '../..');

function warn(msg) {
  console.error(`Warning: apply-link-rules: ${msg}`);
}

function info(msg) {
  console.error(msg);
}

async function loadLinker() {
  const require = createRequire(resolve(pluginRoot, 'package.json'));
  try {
    return await import(pathToFileURL(require.resolve('@understand-anything/core/linker')).href);
  } catch {
    return await import(
      pathToFileURL(resolve(pluginRoot, 'packages/core/dist/linker/index.js')).href
    );
  }
}

function parseArgs(argv) {
  const args = { graphPath: null, ruleDirs: [] };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--rules') args.ruleDirs.push(argv[++i]);
    else rest.push(argv[i]);
  }
  args.graphPath = rest[0] ?? null;
  return args;
}

/** Everything before the ".understand-anything" path segment, if present. */
function deriveProjectRoot(graphPath) {
  const parts = resolve(graphPath).split(sep);
  const idx = parts.indexOf('.understand-anything');
  if (idx > 0) return parts.slice(0, idx).join(sep);
  return null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.graphPath) {
    warn('usage: apply-link-rules.mjs <graph.json> [--rules <dir>]...');
    process.exit(1);
  }

  let graphRaw;
  try {
    graphRaw = readFileSync(args.graphPath, 'utf-8');
  } catch (e) {
    warn(`cannot read graph file ${args.graphPath} (${e.message})`);
    process.exit(1);
  }
  let graph;
  try {
    graph = JSON.parse(graphRaw);
  } catch (e) {
    warn(`graph file is not valid JSON (${e.message})`);
    process.exit(1);
  }
  if (!Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
    warn('graph file has no nodes/edges arrays');
    process.exit(1);
  }

  let projectRoot = deriveProjectRoot(args.graphPath);
  if (projectRoot === null) {
    projectRoot = dirname(resolve(args.graphPath));
    warn(
      `graph path has no .understand-anything segment — using ${projectRoot} as project root, project-local rules skipped`,
    );
  }

  let ruleDirs = args.ruleDirs;
  if (ruleDirs.length === 0) {
    ruleDirs = [join(pluginRoot, 'rules')];
    if (deriveProjectRoot(args.graphPath) !== null) {
      ruleDirs.push(join(projectRoot, '.understand-anything', 'rules'));
    }
  }

  // Task-8-Vertrag + Phase-②-Re-Review-Lehre: try/catch NUR ums Laden.
  let linker = null;
  try {
    linker = await loadLinker();
  } catch (e) {
    warn(`cannot load @understand-anything/core (${e.message}) — link step skipped`);
  }

  let report = null;
  if (linker) {
    report = await linker.applyLinkRules(graph, { ruleDirs, projectRoot });
    for (const w of report.warnings) warn(w);
    writeFileSync(args.graphPath, JSON.stringify(graph, null, 2) + '\n', 'utf-8');
  }

  const r = report ?? { rules: 0, files: 0, added: 0, upgraded: 0, skippedRules: 0, skippedEdges: 0 };
  info(
    `apply-link-rules: rules=${r.rules} files=${r.files} added=${r.added} ` +
      `upgraded=${r.upgraded} skippedRules=${r.skippedRules} skippedEdges=${r.skippedEdges}`,
  );
}

main().catch((e) => {
  warn(`unexpected failure: ${e?.stack ?? e}`);
  process.exit(1);
});
