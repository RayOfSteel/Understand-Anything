import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(
  __dirname,
  '../../../understand-anything-plugin/skills/understand/compute-reachability.mjs',
);

const fileNode = (rel, tags = []) => ({
  id: `file:${rel}`, type: 'file', name: rel.split('/').pop(),
  filePath: rel, summary: 's', tags, complexity: 'simple',
});
const edge = (s, t, type) => ({
  source: `file:${s}`, target: `file:${t}`, type, direction: 'forward', weight: 0.7,
});

function makeProject({ nodes, edges, kind, localTriggerRules, triggersFile, verdicts, existingIslands } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'ua-reach-'));
  const ua = join(root, '.understand-anything');
  mkdirSync(ua, { recursive: true });
  const graph = {
    version: '1.0.0', ...(kind ? { kind } : {}),
    project: { name: 'p', languages: [], frameworks: [], description: '',
      analyzedAt: '2026-01-01T00:00:00Z', gitCommitHash: 'abc' },
    nodes, edges, layers: [], tour: [],
  };
  const graphPath = join(ua, 'knowledge-graph.json');
  writeFileSync(graphPath, JSON.stringify(graph, null, 2) + '\n', 'utf-8');
  if (localTriggerRules) {
    const rd = join(ua, 'rules', 'triggers');
    mkdirSync(rd, { recursive: true });
    writeFileSync(join(rd, 'local.json'), JSON.stringify(localTriggerRules, null, 2), 'utf-8');
  }
  if (triggersFile) writeFileSync(join(ua, 'triggers.json'), JSON.stringify(triggersFile), 'utf-8');
  if (verdicts) {
    const vd = join(ua, 'intermediate', 'mission-results');
    mkdirSync(vd, { recursive: true });
    for (const [name, v] of Object.entries(verdicts)) {
      writeFileSync(join(vd, name), JSON.stringify(v), 'utf-8');
    }
  }
  if (existingIslands) writeFileSync(join(ua, 'islands.json'), JSON.stringify(existingIslands), 'utf-8');
  return { root, ua, graphPath };
}

function run(graphPath, extra = []) {
  const res = spawnSync('node', [SCRIPT, graphPath, ...extra], { encoding: 'utf-8' });
  return { ...res, graph: JSON.parse(readFileSync(graphPath, 'utf-8')) };
}
const islands = (ua) => JSON.parse(readFileSync(join(ua, 'islands.json'), 'utf-8'));

// Baseline fixture: main.ts is a trigger via local glob rule; a<->b is an island.
const BASE = () => ({
  nodes: [fileNode('src/main.ts'), fileNode('src/a.ts'), fileNode('src/b.ts'), fileNode('src/used.ts')],
  edges: [edge('src/main.ts', 'src/used.ts', 'imports'),
          edge('src/a.ts', 'src/b.ts', 'imports'), edge('src/b.ts', 'src/a.ts', 'imports')],
  localTriggerRules: [{
    id: 'trigger:local:main', kind: 'trigger',
    match: { type: 'glob', pattern: 'src/main.ts' }, confidence: 1.0, source: 'user',
  }],
});

describe('compute-reachability.mjs', () => {
  it('tags triggers, stamps reachability, writes islands.json with the a<->b island', () => {
    const { ua, graphPath } = makeProject(BASE());
    const { status, stdout, graph } = run(graphPath);
    expect(status).toBe(0);
    expect(stdout).toMatch(/compute-reachability: triggers=1 reachable=2 attached=0 islands=1/);
    const main = graph.nodes.find((n) => n.id === 'file:src/main.ts');
    expect(main.tags).toContain('entry-point');
    expect(main.triggeredBy).toEqual(['trigger:local:main']);
    expect(main.reachability).toBe('reachable');
    expect(graph.nodes.find((n) => n.id === 'file:src/a.ts').reachability).toBe('unresolved');
    const isl = islands(ua);
    expect(isl.components).toHaveLength(1);
    expect(isl.components[0].size).toBe(2);
    expect(isl.components[0].status).toBe('unresolved');
    expect(isl.missionPlan).toHaveLength(1);
    expect(isl.missionPlan[0].missionId).toBe('m-1');
  });

  it('is idempotent: second run produces byte-identical graph', () => {
    const { graphPath } = makeProject(BASE());
    run(graphPath);
    const first = readFileSync(graphPath, 'utf-8');
    run(graphPath);
    expect(readFileSync(graphPath, 'utf-8')).toBe(first);
  }, 15000);

  it('skips knowledge graphs without writing', () => {
    const { ua, graphPath } = makeProject({ ...BASE(), kind: 'knowledge' });
    const before = readFileSync(graphPath, 'utf-8');
    const { status, stdout } = run(graphPath);
    expect(status).toBe(0);
    expect(stdout).toMatch(/skipped \(knowledge graph\)/);
    expect(readFileSync(graphPath, 'utf-8')).toBe(before);
    expect(existsSync(join(ua, 'islands.json'))).toBe(false);
  });

  it('triggers.json add/remove overrides rules (census veto wins)', () => {
    const base = BASE();
    const { graphPath } = makeProject({
      ...base,
      triggersFile: { add: ['file:src/a.ts'], remove: ['file:src/main.ts'], notes: '' },
    });
    const { graph, stdout } = run(graphPath);
    expect(stdout).toMatch(/triggers=1 /);
    expect(graph.nodes.find((n) => n.id === 'file:src/a.ts').reachability).toBe('reachable');
    const main = graph.nodes.find((n) => n.id === 'file:src/main.ts');
    expect(main.reachability).toBe('unresolved');
    expect(main.tags).not.toContain('entry-point');
  });

  it('folds isolated verdicts and retains them across runs while unchanged', () => {
    const base = BASE();
    const p1 = makeProject(base);
    const r1 = run(p1.graphPath);
    const compId = islands(p1.ua).components[0].id;
    expect(r1.status).toBe(0);
    // second run with a verdict for that component
    const p2 = makeProject({
      ...base,
      verdicts: {
        'm-1.json': {
          missionId: 'm-1',
          verdicts: [{ componentId: compId, verdict: 'isolated', confidence: 'high', reason: 'dead code' }],
        },
      },
    });
    run(p2.graphPath, ['--verdicts', join(p2.ua, 'intermediate', 'mission-results')]);
    let isl = islands(p2.ua);
    expect(isl.components[0].status).toBe('isolated');
    expect(isl.components[0].confidence).toBe('high');
    expect(isl.components[0].missionId).toBe('m-1');
    expect(isl.missionCounter).toBe(1);
    const g = JSON.parse(readFileSync(p2.graphPath, 'utf-8'));
    expect(g.nodes.find((n) => n.id === 'file:src/a.ts').reachability).toBe('isolated');
    // third run WITHOUT verdicts dir: verdict retained via islands.json merge
    run(p2.graphPath);
    isl = islands(p2.ua);
    expect(isl.components[0].status).toBe('isolated');
    expect(isl.components[0].verdictReason).toBe('dead code');
    expect(isl.missionPlan).toHaveLength(0); // isolated components are never re-planned
  }, 15000);

  it('a learned local rule rescues the island on recompute and archives it as connected', () => {
    const base = BASE();
    const p = makeProject(base);
    run(p.graphPath);
    expect(islands(p.ua).components).toHaveLength(1);
    // mission learns: everything under src/a* is a trigger (silly but deterministic)
    const rd = join(p.ua, 'rules', 'triggers');
    mkdirSync(rd, { recursive: true });
    writeFileSync(join(rd, 'mission-m-1.json'), JSON.stringify([{
      id: 'trigger:mission:a', kind: 'trigger',
      match: { type: 'glob', pattern: 'src/a.ts' }, confidence: 0.8, source: 'mission:m-1',
    }]), 'utf-8');
    run(p.graphPath);
    const isl = islands(p.ua);
    expect(isl.components).toHaveLength(0);
    expect(isl.resolvedComponents).toHaveLength(1);
    expect(isl.resolvedComponents[0].status).toBe('connected');
  });

  it('warns (but still succeeds) when persistent state files are corrupted', () => {
    const { ua, graphPath } = makeProject(BASE());
    writeFileSync(join(ua, 'islands.json'), '{ not valid json', 'utf-8');
    writeFileSync(join(ua, 'triggers.json'), '{ also not valid', 'utf-8');
    const { status, stderr } = run(graphPath);
    expect(status).toBe(0);
    expect(stderr).toContain('islands.json: invalid JSON');
    expect(stderr).toContain('triggers.json: invalid JSON');
    expect(stderr).toContain('starting fresh');
  });

  it('creates the fallback .understand-anything dir before writing when the graph has no ancestor', () => {
    const root = mkdtempSync(join(tmpdir(), 'ua-reach-noua-'));
    const graphPath = join(root, 'graph.json');
    const graph = {
      version: '1.0.0',
      project: { name: 'p', languages: [], frameworks: [], description: '',
        analyzedAt: '2026-01-01T00:00:00Z', gitCommitHash: 'abc' },
      nodes: [fileNode('src/main.ts'), fileNode('src/a.ts'), fileNode('src/b.ts')],
      edges: [edge('src/a.ts', 'src/b.ts', 'imports'), edge('src/b.ts', 'src/a.ts', 'imports')],
      layers: [], tour: [],
    };
    writeFileSync(graphPath, JSON.stringify(graph, null, 2) + '\n', 'utf-8');
    const { status, stderr, graph: outGraph } = run(graphPath);
    expect(status).toBe(0);
    expect(stderr).toMatch(/using .* as project root/);
    expect(outGraph.nodes.every((n) => typeof n.reachability === 'string')).toBe(true);
    const uaDir = join(root, '.understand-anything');
    expect(existsSync(join(uaDir, 'islands.json'))).toBe(true);
  });

  it('keeps a connected-verdict island unresolved but records its missionId', () => {
    const base = BASE();
    const p1 = makeProject(base);
    const r1 = run(p1.graphPath);
    const compId = islands(p1.ua).components[0].id;
    expect(r1.status).toBe(0);
    const p2 = makeProject({
      ...base,
      verdicts: {
        'm-1.json': {
          missionId: 'm-1',
          verdicts: [{ componentId: compId, verdict: 'connected', confidence: 'high', reason: 'wired up' }],
        },
      },
    });
    const r2 = run(p2.graphPath, ['--verdicts', join(p2.ua, 'intermediate', 'mission-results')]);
    expect(r2.status).toBe(0);
    const isl = islands(p2.ua);
    expect(isl.components).toHaveLength(1);
    expect(isl.components[0].status).toBe('unresolved');
    expect(isl.components[0].missionId).toBe('m-1');
    const g = JSON.parse(readFileSync(p2.graphPath, 'utf-8'));
    expect(g.nodes.some((n) => n.reachability === 'isolated')).toBe(false);
  }, 15000);

  it('folds trigger verdicts: triggerNodeIds become entry points on recompute', () => {
    const base = BASE();
    const p = makeProject(base);
    run(p.graphPath);
    const compId = islands(p.ua).components[0].id;
    const vd = join(p.ua, 'intermediate', 'mission-results');
    mkdirSync(vd, { recursive: true });
    writeFileSync(join(vd, 'm-1.json'), JSON.stringify({
      missionId: 'm-1',
      verdicts: [{
        componentId: compId, verdict: 'trigger', confidence: 'high',
        reason: 'standalone tool', triggerNodeIds: ['file:src/a.ts'],
      }],
    }), 'utf-8');
    run(p.graphPath, ['--verdicts', vd]);
    let isl = islands(p.ua);
    expect(isl.components).toHaveLength(0);
    expect(isl.resolvedComponents.some((c) => c.id === compId)).toBe(true);
    // third run WITHOUT --verdicts: the trigger must have survived via the
    // triggers.json write-back, not merely as in-memory seeding for the run above.
    run(p.graphPath);
    isl = islands(p.ua);
    expect(isl.components).toHaveLength(0);
    expect(isl.resolvedComponents.some((c) => c.id === compId)).toBe(true);
  }, 15000);

  it('accepts the exact output format documented in agents/trigger-census.md', () => {
    const base = BASE();
    // Fixture built explicitly (not spread from BASE()'s edges): src/a.ts and
    // src/b.ts are two SEPARATE singleton islands with no edge between them
    // and no edge to the reachable set. That makes the two rescue mechanisms
    // topologically independent — islands=0 is reachable only if BOTH the
    // `add` (rescues a.ts) AND the learned rule (rescues b.ts) actually fire.
    // If either mechanism silently breaks, one singleton island remains and
    // islands >= 1. (With BASE()'s mutual a<->b edges, rescuing either one
    // alone was enough to reach the other, so that fixture couldn't tell the
    // two mechanisms apart.)
    const { graphPath } = makeProject({
      nodes: [fileNode('src/main.ts'), fileNode('src/used.ts'), fileNode('src/a.ts'), fileNode('src/b.ts')],
      edges: [edge('src/main.ts', 'src/used.ts', 'imports')],
      triggersFile: { add: ['file:src/a.ts'], remove: [], notes: 'census smoke' },
      localTriggerRules: [
        ...base.localTriggerRules,
        {
          id: 'trigger:census:scr', kind: 'trigger',
          match: { type: 'glob', pattern: 'src/b.ts' },
          description: 'x', evidence: 'y', confidence: 0.9, source: 'census',
        },
      ],
    });
    const { status, stdout, graph } = run(graphPath);
    expect(status).toBe(0);
    expect(stdout).toMatch(/islands=0/); // both a (via add) and b (via learned rule) must be rescued
    expect(graph.nodes.find((n) => n.id === 'file:src/a.ts').reachability).toBe('reachable'); // rescued by add
    expect(graph.nodes.find((n) => n.id === 'file:src/b.ts').reachability).toBe('reachable'); // rescued by learned rule
  });

  it('mission plan groups by top path segment and respects caps', () => {
    const nodes = [fileNode('src/main.ts')];
    const edges = [];
    for (let i = 0; i < 8; i++) nodes.push(fileNode(`legacy/iso${i}.ts`));
    for (let i = 0; i < 3; i++) nodes.push(fileNode(`tools/t${i}.ts`));
    const { ua, graphPath } = makeProject({ ...BASE(), nodes, edges });
    run(graphPath);
    const plan = islands(ua).missionPlan;
    // 8 legacy singletons → 2 missions (cap 5 clusters), 3 tools singletons → 1 mission
    const legacyMissions = plan.filter((m) => m.files.every((f) => f.startsWith('legacy/')));
    const toolsMissions = plan.filter((m) => m.files.every((f) => f.startsWith('tools/')));
    expect(legacyMissions).toHaveLength(2);
    expect(toolsMissions).toHaveLength(1);
    for (const m of plan) {
      expect(m.componentIds.length).toBeLessThanOrEqual(5);
      expect(m.fileCount).toBeLessThanOrEqual(15);
    }
  });
});
