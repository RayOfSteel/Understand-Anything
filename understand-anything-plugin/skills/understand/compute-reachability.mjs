#!/usr/bin/env node
// understand-anything-plugin/skills/understand/compute-reachability.mjs
/**
 * compute-reachability.mjs  (spec 2026-07-05 §5)
 *
 * Deterministic trigger-reachability pass: applies trigger rules (plugin
 * packs + repo registry), seeds a BFS from entry-point nodes, attaches
 * satellites, clusters everything unreachable into island components, and
 * maintains the persistent tracking file .understand-anything/islands.json
 * (verdict retention + mission plan).
 *
 * Usage:
 *   node compute-reachability.mjs <graph.json> [--rules <dir>]...
 *     [--triggers <triggers.json>] [--verdicts <dir>]
 *     [--max-mission-clusters 5] [--max-mission-files 15]
 *
 * Without --rules, two default directories are loaded: <pluginRoot>/rules/triggers
 * and <projectRoot>/.understand-anything/rules/triggers. The graph file is
 * rewritten in place, only on success. Logging: stderr only; degradations are
 * prefixed "Warning: compute-reachability: ...". Running the script twice
 * produces byte-identical output (idempotence).
 */

import { dirname, join, resolve, sep } from 'node:path';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pluginRoot = resolve(__dirname, '../..');

const warn = (m) => console.error(`Warning: compute-reachability: ${m}`);

async function loadReachability() {
  const require = createRequire(resolve(pluginRoot, 'package.json'));
  try {
    return await import(
      pathToFileURL(require.resolve('@understand-anything/core/reachability')).href
    );
  } catch {
    return await import(
      pathToFileURL(resolve(pluginRoot, 'packages/core/dist/reachability/index.js')).href
    );
  }
}

function parseArgs(argv) {
  const args = {
    graphPath: null, ruleDirs: [], triggersPath: null, verdictsDir: null,
    maxClusters: 5, maxFiles: 15,
  };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--rules') args.ruleDirs.push(argv[++i]);
    else if (argv[i] === '--triggers') args.triggersPath = argv[++i];
    else if (argv[i] === '--verdicts') args.verdictsDir = argv[++i];
    else if (argv[i] === '--max-mission-clusters') args.maxClusters = parseInt(argv[++i], 10);
    else if (argv[i] === '--max-mission-files') args.maxFiles = parseInt(argv[++i], 10);
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

function readJson(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return fallback;
  }
}

/**
 * Reads persistent state that may be absent (fine, first run — stays silent)
 * or present-but-unparseable (not fine — warns and starts fresh).
 */
function readJsonOrWarn(path, label, fallback) {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch (e) {
    warn(`${label}: invalid JSON (${e.message}) — starting fresh`);
    return fallback;
  }
}

function readVerdicts(dir) {
  const verdicts = new Map(); // componentId -> {verdict, confidence, reason, missionId}
  const triggerAdds = [];
  let maxMission = 0;
  if (!dir || !existsSync(dir)) return { verdicts, triggerAdds, maxMission };
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
    const data = readJson(join(dir, f), null);
    if (!data || !Array.isArray(data.verdicts)) {
      warn(`verdict file ${f}: invalid — skipped`);
      continue;
    }
    const num = parseInt(String(data.missionId ?? '').replace(/^m-/, ''), 10);
    if (Number.isFinite(num)) maxMission = Math.max(maxMission, num);
    for (const v of data.verdicts) {
      if (!v.componentId || !v.verdict) continue;
      verdicts.set(v.componentId, { ...v, missionId: data.missionId });
      if (v.verdict === 'trigger') triggerAdds.push(...(v.triggerNodeIds ?? []));
    }
  }
  return { verdicts, triggerAdds, maxMission };
}

function planMissions(components, startId, maxClusters, maxFiles) {
  const eligible = components.filter((c) => c.status === 'unresolved' && !c.missionId);
  const byPrefix = new Map();
  for (const c of eligible) {
    const prefix = (c.files[0] ?? c.nodeIds[0] ?? '').split('/')[0];
    if (!byPrefix.has(prefix)) byPrefix.set(prefix, []);
    byPrefix.get(prefix).push(c);
  }
  const plan = [];
  let next = startId;
  for (const prefix of [...byPrefix.keys()].sort()) {
    const group = byPrefix.get(prefix).sort((a, b) => b.size - a.size || a.id.localeCompare(b.id));
    let current = null;
    for (const comp of group) {
      const fits = current
        && current.componentIds.length < maxClusters
        && current.fileCount + comp.files.length <= maxFiles;
      if (!fits) {
        current = { missionId: `m-${next++}`, componentIds: [], files: [], fileCount: 0 };
        plan.push(current);
      }
      current.componentIds.push(comp.id);
      current.files.push(...comp.files);
      current.fileCount += comp.files.length;
    }
  }
  return plan;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.graphPath) {
    warn('usage: compute-reachability.mjs <graph.json> [--rules <dir>]... [--triggers <file>] [--verdicts <dir>]');
    process.exit(1);
  }

  const graph = readJson(args.graphPath, null);
  if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
    warn(`cannot read graph file ${args.graphPath}`);
    process.exit(1);
  }
  if (graph.kind === 'knowledge') {
    console.log('compute-reachability: skipped (knowledge graph)');
    return;
  }

  let projectRoot = deriveProjectRoot(args.graphPath);
  if (projectRoot === null) {
    projectRoot = dirname(resolve(args.graphPath));
    warn(`graph path has no .understand-anything segment — using ${projectRoot} as project root`);
  }
  const uaDir = join(projectRoot, '.understand-anything');
  // Ensure the destination exists before ANY write (graph or islands.json) so a
  // fallback project root (no pre-existing .understand-anything dir) can never
  // leave the graph rewritten but islands.json write failing with ENOENT.
  mkdirSync(uaDir, { recursive: true });

  let ruleDirs = args.ruleDirs;
  if (ruleDirs.length === 0) {
    ruleDirs = [join(pluginRoot, 'rules', 'triggers'), join(uaDir, 'rules', 'triggers')];
  }

  let core;
  try {
    core = await loadReachability();
  } catch (e) {
    warn(`cannot load @understand-anything/core (${e.message}) — reachability step skipped`);
    console.log('compute-reachability: skipped (core unavailable)');
    return;
  }

  // 1. Rules + census trigger set.
  const { rules, warnings } = core.loadTriggerRuleDirs(ruleDirs);
  for (const w of warnings) warn(w);
  core.applyTriggerRules(graph.nodes, rules);

  const triggersPath = args.triggersPath ?? join(uaDir, 'triggers.json');
  const triggersFile = readJsonOrWarn(triggersPath, 'triggers.json', { add: [], remove: [] });
  const removeSet = new Set(triggersFile.remove ?? []);
  for (const node of graph.nodes) {
    if (removeSet.has(node.id)) {
      node.tags = (node.tags ?? []).filter((t) => t !== 'entry-point');
      delete node.triggeredBy;
    }
  }
  const { verdicts, triggerAdds, maxMission } = readVerdicts(args.verdictsDir);
  const triggerIds = new Set(
    graph.nodes.filter((n) => (n.tags ?? []).includes('entry-point')).map((n) => n.id),
  );
  for (const id of triggersFile.add ?? []) if (!removeSet.has(id)) triggerIds.add(id);
  for (const id of triggerAdds) if (!removeSet.has(id)) triggerIds.add(id);

  if (triggerAdds.length > 0) {
    const merged = [...new Set([...(triggersFile.add ?? []), ...triggerAdds])].sort();
    writeFileSync(triggersPath, JSON.stringify({ ...triggersFile, add: merged }, null, 2) + '\n', 'utf-8');
  }

  // 2. Engine.
  const result = core.computeReachability(graph, triggerIds);

  // 3. Merge with previous islands.json + verdicts.
  const islandsPath = join(uaDir, 'islands.json');
  const previous = readJsonOrWarn(
    islandsPath, 'islands.json', { components: [], resolvedComponents: [], missionCounter: 0 },
  );
  const prevById = new Map((previous.components ?? []).map((c) => [c.id, c]));
  const now = new Date().toISOString();

  const components = result.components.map((c) => {
    const prev = prevById.get(c.id);
    const verdict = verdicts.get(c.id);
    let status = 'unresolved';
    let extra = {};
    if (verdict && verdict.verdict === 'isolated') {
      status = 'isolated';
      extra = { confidence: verdict.confidence, verdictReason: verdict.reason, missionId: verdict.missionId };
    } else if (verdict) {
      extra = { missionId: verdict.missionId }; // connected/trigger claimed but still an island
    } else if (prev && prev.status === 'isolated') {
      status = 'isolated';
      extra = { confidence: prev.confidence, verdictReason: prev.verdictReason, missionId: prev.missionId };
    } else if (prev && prev.missionId) {
      extra = { missionId: prev.missionId };
    }
    return { ...c, status, ...extra, updatedAt: prev && prev.status === status ? prev.updatedAt : now };
  });

  const currentIds = new Set(components.map((c) => c.id));
  const resolvedComponents = [...(previous.resolvedComponents ?? [])];
  for (const prev of previous.components ?? []) {
    if (!currentIds.has(prev.id)) {
      resolvedComponents.push({ id: prev.id, status: 'connected', missionId: prev.missionId, updatedAt: now });
    }
  }

  const missionCounter = Math.max(previous.missionCounter ?? 0, maxMission);
  const missionPlan = planMissions(components, missionCounter + 1, args.maxClusters, args.maxFiles);

  // 4. Stamp node status.
  const isolatedNodes = new Set(
    components.filter((c) => c.status === 'isolated').flatMap((c) => c.nodeIds),
  );
  for (const node of graph.nodes) {
    node.reachability = isolatedNodes.has(node.id)
      ? 'isolated'
      : result.statusByNode.get(node.id) ?? 'unresolved';
  }

  // 5. Write graph + islands.json (graph first; islands.json is derived state).
  writeFileSync(args.graphPath, JSON.stringify(graph, null, 2) + '\n', 'utf-8');
  const islandsOut = {
    version: 1,
    updatedAt: now,
    triggerCount: triggerIds.size,
    onlyViaTests: result.onlyViaTests,
    missionCounter,
    components,
    resolvedComponents,
    missionPlan,
  };
  writeFileSync(islandsPath, JSON.stringify(islandsOut, null, 2) + '\n', 'utf-8');

  const counts = { reachable: 0, attached: 0, unresolved: 0, isolated: 0 };
  for (const node of graph.nodes) counts[node.reachability] = (counts[node.reachability] ?? 0) + 1;
  console.log(
    `compute-reachability: triggers=${triggerIds.size} reachable=${counts.reachable} ` +
      `attached=${counts.attached} islands=${components.length} unresolved=${counts.unresolved} ` +
      `isolated=${counts.isolated} missionsPlanned=${missionPlan.length}`,
  );
}

main().catch((e) => {
  warn(`unexpected failure: ${e?.stack ?? e}`);
  process.exit(1);
});
