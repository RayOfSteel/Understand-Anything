#!/usr/bin/env node
/**
 * apply-graph-patches.mjs
 *
 * Provenance post-pass for the knowledge graph (spec 2026-07-02 §7.3):
 *   1. imports edges backed by the scan importMap → origin "structural",
 *      confidence 1.0 (edges stamped structural/rule/manual are left alone;
 *      llm-stamped edges are upgraded — structural is the stronger claim).
 *   2. every edge without an origin → origin "llm".
 *   3. single-case patches from .understand-anything/patches/*.patch.json
 *      are applied (per file: removes first, then adds; added/upgraded
 *      edges carry origin "manual", ruleId = patch file name).
 *
 * Usage:
 *   node apply-graph-patches.mjs <graph.json> [--scan-result <path>] [--patches <dir>]
 *
 * The graph file is rewritten in place, only on success. Logging: stderr
 * only; degradations are prefixed "Warning: apply-graph-patches: ...".
 * Running the script twice produces byte-identical output (idempotence).
 */

import { basename, dirname, join, resolve } from 'node:path';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pluginRoot = resolve(__dirname, '../..');

async function loadCoreAliases() {
  const require = createRequire(resolve(pluginRoot, 'package.json'));
  let mod;
  try {
    mod = await import(pathToFileURL(require.resolve('@understand-anything/core/schema')).href);
  } catch {
    mod = await import(pathToFileURL(resolve(pluginRoot, 'packages/core/dist/schema.js')).href);
  }
  return { EDGE_TYPE_ALIASES: mod.EDGE_TYPE_ALIASES, DIRECTION_ALIASES: mod.DIRECTION_ALIASES };
}

function warn(msg) {
  console.error(`Warning: apply-graph-patches: ${msg}`);
}

function info(msg) {
  console.error(msg);
}

function parseArgs(argv) {
  const args = { graphPath: null, scanResultPath: null, patchesDir: null };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--scan-result') args.scanResultPath = argv[++i];
    else if (a === '--patches') args.patchesDir = argv[++i];
    else rest.push(a);
  }
  args.graphPath = rest[0] ?? null;
  return args;
}

// ── Step 1: reclassify importMap-backed imports edges ─────────────────────

function reclassifyStructural(graph, importMap) {
  const backed = new Set();
  for (const [src, targets] of Object.entries(importMap)) {
    if (!Array.isArray(targets)) continue;
    for (const tgt of targets) {
      if (typeof tgt === 'string' && tgt) backed.add(`file:${src}|file:${tgt}`);
    }
  }
  let count = 0;
  for (const e of graph.edges) {
    if (e.type !== 'imports') continue;
    // Producer stamps (structural/rule/manual) win; llm upgrades to structural.
    if (e.origin !== undefined && e.origin !== 'llm') continue;
    if (!backed.has(`${e.source}|${e.target}`)) continue;
    e.origin = 'structural';
    e.confidence = 1.0;
    count++;
  }
  return count;
}

// ── Step 2: default origin ─────────────────────────────────────────────────

function defaultLlmOrigin(graph) {
  let count = 0;
  for (const e of graph.edges) {
    if (e.origin === undefined) {
      e.origin = 'llm';
      count++;
    }
  }
  return count;
}

// ── Step 3: single-case patches ────────────────────────────────────────────

const VALID_DIRECTIONS = new Set(['forward', 'backward', 'bidirectional']);

function normalizeEdgeType(type, EDGE_TYPE_ALIASES) {
  const t = String(type ?? '').toLowerCase();
  return EDGE_TYPE_ALIASES[t] ?? t;
}

function normalizeDirection(direction, DIRECTION_ALIASES) {
  const d = String(direction ?? 'forward').toLowerCase();
  const mapped = DIRECTION_ALIASES[d] ?? d;
  return VALID_DIRECTIONS.has(mapped) ? mapped : 'forward';
}

/**
 * Normalize a legacy hand-written patch (pre-§7.2 KernelResearch convention)
 * to the canonical shape: `edges_added`/`edges_removed` become
 * `edges_to_add`/`edges_to_remove`, and entry fields `from`/`to`/`kind`
 * become `source`/`target`/`type`. Canonical fields always win.
 */
function normalizeLegacyPatch(data) {
  const legacyEntry = (entry) => {
    if (!entry || typeof entry !== 'object') return entry;
    const e = { ...entry };
    if (e.source === undefined && typeof e.from === 'string') e.source = e.from;
    if (e.target === undefined && typeof e.to === 'string') e.target = e.to;
    if (e.type === undefined && typeof e.kind === 'string') e.type = e.kind;
    return e;
  };
  if (!Array.isArray(data.edges_to_add) && Array.isArray(data.edges_added)) {
    data.edges_to_add = data.edges_added.map(legacyEntry);
  }
  if (!Array.isArray(data.edges_to_remove) && Array.isArray(data.edges_removed)) {
    data.edges_to_remove = data.edges_removed.map(legacyEntry);
  }
}

function loadPatchFiles(patchesDir) {
  if (!existsSync(patchesDir)) return [];
  const names = readdirSync(patchesDir)
    .filter((n) => n.endsWith('.patch.json'))
    .sort();
  const patches = [];
  for (const name of names) {
    let data;
    try {
      data = JSON.parse(readFileSync(join(patchesDir, name), 'utf-8'));
    } catch (err) {
      warn(`skipping patch ${name}: ${err.message}`);
      continue;
    }
    if (typeof data !== 'object' || data === null || Array.isArray(data)) {
      warn(`skipping patch ${name}: not a JSON object`);
      continue;
    }
    normalizeLegacyPatch(data);
    // §7.2 requires _meta.title; legacy files carry a top-level title or id.
    const title =
      (typeof data._meta === 'object' && data._meta !== null && data._meta.title) ||
      data.title ||
      data.id;
    if (!title) {
      warn(`skipping patch ${name}: missing _meta.title`);
      continue;
    }
    // Missing edge sections are treated as empty (§7.2 extensibility: files may
    // carry only future top-level sections, e.g. legacy summary indexes).
    if (Array.isArray(data.nodes_added) && data.nodes_added.length > 0) {
      warn(`${name}: nodes_added is not supported — ${data.nodes_added.length} node entries ignored`);
    }
    patches.push({ name, data });
  }
  return patches;
}

function applyPatches(graph, patchesDir, aliases) {
  const stats = { files: 0, added: 0, upgraded: 0, removed: 0, skipped: 0 };
  const patches = loadPatchFiles(patchesDir);
  const { EDGE_TYPE_ALIASES, DIRECTION_ALIASES } = aliases;
  const nodeIds = new Set((graph.nodes ?? []).map((n) => n.id));

  for (const { name, data } of patches) {
    stats.files++;

    for (const entry of data.edges_to_remove ?? []) {
      if (!entry || !entry.source || !entry.target || !entry.type) {
        warn(`${name}: edges_to_remove entry missing source/target/type — skipped`);
        stats.skipped++;
        continue;
      }
      const type = normalizeEdgeType(entry.type, EDGE_TYPE_ALIASES);
      const before = graph.edges.length;
      graph.edges = graph.edges.filter(
        (e) =>
          !(
            e.source === entry.source &&
            e.target === entry.target &&
            normalizeEdgeType(e.type, EDGE_TYPE_ALIASES) === type
          ),
      );
      const removed = before - graph.edges.length;
      stats.removed += removed;
      if (removed === 0) {
        info(`apply-graph-patches: ${name}: remove ${entry.source} -> ${entry.target} (${type}) matched no edge`);
      }
    }

    for (const entry of data.edges_to_add ?? []) {
      if (!entry || !entry.source || !entry.target || !entry.type) {
        warn(`${name}: edges_to_add entry missing source/target/type — skipped`);
        stats.skipped++;
        continue;
      }
      if (!nodeIds.has(entry.source) || !nodeIds.has(entry.target)) {
        warn(`${name}: add ${entry.source} -> ${entry.target}: unknown node — skipped`);
        stats.skipped++;
        continue;
      }
      const type = normalizeEdgeType(entry.type, EDGE_TYPE_ALIASES);
      const existing = graph.edges.find(
        (e) =>
          e.source === entry.source &&
          e.target === entry.target &&
          normalizeEdgeType(e.type, EDGE_TYPE_ALIASES) === type,
      );
      if (existing) {
        existing.origin = 'manual';
        existing.ruleId = name;
        existing.confidence = 1.0;
        if (typeof entry.note === 'string' && entry.note) existing.evidence = entry.note;
        stats.upgraded++;
        continue;
      }
      const newEdge = {
        source: entry.source,
        target: entry.target,
        type,
        direction: normalizeDirection(entry.direction, DIRECTION_ALIASES),
        weight: typeof entry.weight === 'number' ? Math.max(0, Math.min(1, entry.weight)) : 1.0,
        origin: 'manual',
        ruleId: name,
        confidence: 1.0,
      };
      if (typeof entry.note === 'string' && entry.note) newEdge.evidence = entry.note;
      graph.edges.push(newEdge);
      stats.added++;
    }
  }
  return stats;
}

async function main() {
  const { graphPath, scanResultPath, patchesDir } = parseArgs(process.argv.slice(2));
  if (!graphPath) {
    console.error(
      'Usage: node apply-graph-patches.mjs <graph.json> [--scan-result <path>] [--patches <dir>]',
    );
    process.exit(1);
  }

  let graph;
  try {
    graph = JSON.parse(readFileSync(graphPath, 'utf-8'));
  } catch (err) {
    console.error(`apply-graph-patches: cannot read graph ${graphPath}: ${err.message}`);
    process.exit(1);
  }
  if (!graph || !Array.isArray(graph.edges)) {
    console.error('apply-graph-patches: graph.edges is missing or not an array');
    process.exit(1);
  }

  let reclassified = 0;
  if (scanResultPath) {
    try {
      const scan = JSON.parse(readFileSync(scanResultPath, 'utf-8'));
      if (scan && typeof scan.importMap === 'object' && scan.importMap !== null) {
        reclassified = reclassifyStructural(graph, scan.importMap);
      } else {
        warn(`no importMap in ${basename(scanResultPath)} — reclassification skipped`);
      }
    } catch (err) {
      warn(
        `cannot read scan result ${basename(scanResultPath)}: ${err.message} — reclassification skipped`,
      );
    }
  }

  const defaulted = defaultLlmOrigin(graph);

  const resolvedPatchesDir =
    patchesDir ?? join(dirname(resolve(graphPath)), 'patches');
  const aliases = await loadCoreAliases();
  const stats = applyPatches(graph, resolvedPatchesDir, aliases);

  writeFileSync(graphPath, JSON.stringify(graph, null, 2) + '\n', 'utf-8');
  info(
    `apply-graph-patches: reclassified=${reclassified} defaulted=${defaulted} ` +
      `patchFiles=${stats.files} added=${stats.added} upgraded=${stats.upgraded} ` +
      `removed=${stats.removed} skipped=${stats.skipped}`,
  );
}

await main();
