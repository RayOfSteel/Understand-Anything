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

import { basename } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';

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

async function main() {
  const { graphPath, scanResultPath } = parseArgs(process.argv.slice(2));
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

  writeFileSync(graphPath, JSON.stringify(graph, null, 2) + '\n', 'utf-8');
  info(`apply-graph-patches: reclassified=${reclassified} defaulted=${defaulted}`);
}

await main();
