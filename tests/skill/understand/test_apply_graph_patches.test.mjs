import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(
  __dirname,
  '../../../understand-anything-plugin/skills/understand/apply-graph-patches.mjs',
);

/** Minimal valid graph: two file nodes and the given edges. */
function makeGraph(edges, extraNodes = []) {
  return {
    version: '1.0.0',
    project: {
      name: 'p', languages: [], frameworks: [], description: '',
      analyzedAt: '2026-01-01T00:00:00Z', gitCommitHash: 'abc',
    },
    nodes: [
      { id: 'file:a.cs', type: 'file', name: 'a.cs', summary: 's', tags: [], complexity: 'simple' },
      { id: 'file:b.cs', type: 'file', name: 'b.cs', summary: 's', tags: [], complexity: 'simple' },
      ...extraNodes,
    ],
    edges,
    layers: [],
    tour: [],
  };
}

function edge(overrides = {}) {
  return {
    source: 'file:a.cs',
    target: 'file:b.cs',
    type: 'imports',
    direction: 'forward',
    weight: 0.7,
    ...overrides,
  };
}

/**
 * Write graph (+ optional scan result / patch files) into a temp dir and run
 * the script. Returns { status, stderr, graph } where graph is the re-read
 * graph file content.
 */
function runScript({ graph, importMap = null, patches = null, extraArgs = [] }) {
  const root = mkdtempSync(join(tmpdir(), 'ua-agp-test-'));
  const graphPath = join(root, 'knowledge-graph.json');
  writeFileSync(graphPath, JSON.stringify(graph, null, 2) + '\n', 'utf-8');
  const args = [SCRIPT, graphPath, ...extraArgs];
  if (importMap !== null) {
    const scanPath = join(root, 'scan-result.json');
    writeFileSync(scanPath, JSON.stringify({ importMap }), 'utf-8');
    args.push('--scan-result', scanPath);
  }
  if (patches !== null) {
    const patchDir = join(root, 'patches');
    mkdirSync(patchDir, { recursive: true });
    for (const [name, content] of Object.entries(patches)) {
      writeFileSync(
        join(patchDir, name),
        typeof content === 'string' ? content : JSON.stringify(content, null, 2),
        'utf-8',
      );
    }
    args.push('--patches', patchDir);
  }
  const result = spawnSync('node', args, { encoding: 'utf-8' });
  let updated = null;
  try {
    updated = JSON.parse(readFileSync(graphPath, 'utf-8'));
  } catch {
    /* unreadable on hard failure */
  }
  return { status: result.status, stderr: result.stderr, graph: updated, graphPath, root };
}

const roots = [];
afterEach(() => {
  while (roots.length) rmSync(roots.pop(), { recursive: true, force: true });
});

describe('apply-graph-patches.mjs — reclassification and llm default', () => {
  it('stamps an importMap-backed imports edge as structural with confidence 1.0', () => {
    const r = runScript({
      graph: makeGraph([edge()]),
      importMap: { 'a.cs': ['b.cs'] },
    });
    roots.push(r.root);
    expect(r.status).toBe(0);
    const e = r.graph.edges[0];
    expect(e.origin).toBe('structural');
    expect(e.confidence).toBe(1.0);
  });

  it('upgrades an llm-stamped imports edge that the importMap backs', () => {
    const r = runScript({
      graph: makeGraph([edge({ origin: 'llm' })]),
      importMap: { 'a.cs': ['b.cs'] },
    });
    roots.push(r.root);
    expect(r.graph.edges[0].origin).toBe('structural');
    expect(r.graph.edges[0].confidence).toBe(1.0);
  });

  it('leaves producer-stamped edges untouched during reclassification', () => {
    const r = runScript({
      graph: makeGraph([edge({ origin: 'manual', ruleId: 'x.patch.json', confidence: 1.0 })]),
      importMap: { 'a.cs': ['b.cs'] },
    });
    roots.push(r.root);
    expect(r.graph.edges[0].origin).toBe('manual');
    expect(r.graph.edges[0].ruleId).toBe('x.patch.json');
  });

  it('defaults unmatched and non-imports edges to origin llm without confidence', () => {
    const r = runScript({
      graph: makeGraph([
        edge({ target: 'file:b.cs', type: 'calls' }),
        edge({ source: 'file:b.cs', target: 'file:a.cs' }),
      ]),
      importMap: { 'a.cs': ['b.cs'] },
    });
    roots.push(r.root);
    for (const e of r.graph.edges) {
      expect(e.origin).toBe('llm');
      expect(e.confidence).toBeUndefined();
    }
  });

  it('runs standalone without --scan-result: only defaults are applied', () => {
    const r = runScript({ graph: makeGraph([edge()]) });
    roots.push(r.root);
    expect(r.status).toBe(0);
    expect(r.graph.edges[0].origin).toBe('llm');
  });

  it('warns and continues when the scan result is unreadable', () => {
    const r = runScript({
      graph: makeGraph([edge()]),
      importMap: null,
      extraArgs: ['--scan-result', 'does-not-exist.json'],
    });
    roots.push(r.root);
    expect(r.status).toBe(0);
    expect(r.stderr).toContain('Warning: apply-graph-patches:');
    expect(r.graph.edges[0].origin).toBe('llm');
  });

  it('exits non-zero when the graph file is missing', () => {
    const result = spawnSync('node', [SCRIPT, 'no-such-graph.json'], { encoding: 'utf-8' });
    expect(result.status).toBe(1);
  });
});

describe('apply-graph-patches.mjs — patch application', () => {
  const patchMeta = { title: 't', rationale: 'r', created: '2026-07-03' };

  it('adds a new edge with manual provenance and normalized direction', () => {
    const r = runScript({
      graph: makeGraph([]),
      patches: {
        'a-add.patch.json': {
          _meta: patchMeta,
          edges_to_add: [
            {
              source: 'file:a.cs', target: 'file:b.cs', type: 'imports',
              direction: 'outgoing', weight: 1.0, note: 'hand-verified include',
            },
          ],
        },
      },
    });
    roots.push(r.root);
    expect(r.status).toBe(0);
    expect(r.graph.edges).toHaveLength(1);
    const e = r.graph.edges[0];
    expect(e.origin).toBe('manual');
    expect(e.ruleId).toBe('a-add.patch.json');
    expect(e.confidence).toBe(1.0);
    expect(e.evidence).toBe('hand-verified include');
    expect(e.direction).toBe('forward');
  });

  it('upgrades an existing edge instead of duplicating, keeping description and weight', () => {
    const r = runScript({
      graph: makeGraph([edge({ origin: 'llm', description: 'llm said so', weight: 0.4 })]),
      patches: {
        'a-add.patch.json': {
          _meta: patchMeta,
          edges_to_add: [
            { source: 'file:a.cs', target: 'file:b.cs', type: 'imports', note: 'confirmed' },
          ],
        },
      },
    });
    roots.push(r.root);
    expect(r.graph.edges).toHaveLength(1);
    const e = r.graph.edges[0];
    expect(e.origin).toBe('manual');
    expect(e.ruleId).toBe('a-add.patch.json');
    expect(e.description).toBe('llm said so');
    expect(e.weight).toBe(0.4);
    expect(e.evidence).toBe('confirmed');
  });

  it('manual upgrade also overrides a structural stamp (priority invariant)', () => {
    const r = runScript({
      graph: makeGraph([edge()]),
      importMap: { 'a.cs': ['b.cs'] },
      patches: {
        'a-add.patch.json': {
          _meta: patchMeta,
          edges_to_add: [
            { source: 'file:a.cs', target: 'file:b.cs', type: 'imports', note: 'human says yes' },
          ],
        },
      },
    });
    roots.push(r.root);
    expect(r.graph.edges[0].origin).toBe('manual');
  });

  it('removes matching edges across all directions and type aliases', () => {
    const r = runScript({
      graph: makeGraph([
        edge({ direction: 'forward' }),
        edge({ direction: 'bidirectional' }),
        edge({ type: 'calls' }),
      ]),
      patches: {
        'b-remove.patch.json': {
          _meta: patchMeta,
          edges_to_remove: [
            { source: 'file:a.cs', target: 'file:b.cs', type: 'import', reason: 'misrouted' },
          ],
        },
      },
    });
    roots.push(r.root);
    // "import" alias → imports; both direction variants removed, calls kept.
    expect(r.graph.edges).toHaveLength(1);
    expect(r.graph.edges[0].type).toBe('calls');
  });

  it('skips entries with unknown nodes but applies the rest (per-item resilience)', () => {
    const r = runScript({
      graph: makeGraph([]),
      patches: {
        'c-mixed.patch.json': {
          _meta: patchMeta,
          edges_to_add: [
            { source: 'file:ghost.cs', target: 'file:b.cs', type: 'imports' },
            { source: 'file:a.cs', target: 'file:b.cs', type: 'imports' },
          ],
        },
      },
    });
    roots.push(r.root);
    expect(r.status).toBe(0);
    expect(r.stderr).toContain('Warning: apply-graph-patches:');
    expect(r.graph.edges).toHaveLength(1);
    expect(r.graph.edges[0].source).toBe('file:a.cs');
  });

  it('skips a broken patch file with a warning and still applies later files', () => {
    const r = runScript({
      graph: makeGraph([]),
      patches: {
        'a-broken.patch.json': '{ not json',
        'b-good.patch.json': {
          _meta: patchMeta,
          edges_to_add: [{ source: 'file:a.cs', target: 'file:b.cs', type: 'imports' }],
        },
      },
    });
    roots.push(r.root);
    expect(r.status).toBe(0);
    expect(r.stderr).toContain('Warning: apply-graph-patches: skipping patch a-broken.patch.json');
    expect(r.graph.edges).toHaveLength(1);
  });

  it('skips a patch file without _meta.title', () => {
    const r = runScript({
      graph: makeGraph([]),
      patches: {
        'a-no-meta.patch.json': {
          edges_to_add: [{ source: 'file:a.cs', target: 'file:b.cs', type: 'imports' }],
        },
      },
    });
    roots.push(r.root);
    expect(r.stderr).toContain('missing _meta.title');
    expect(r.graph.edges).toHaveLength(0);
  });

  it('processes files alphabetically with removes before adds per file', () => {
    const r = runScript({
      graph: makeGraph([]),
      patches: {
        // Within one file: remove is a no-op, then add creates the edge.
        'a-first.patch.json': {
          _meta: patchMeta,
          edges_to_remove: [{ source: 'file:a.cs', target: 'file:b.cs', type: 'imports', reason: 'reset' }],
          edges_to_add: [{ source: 'file:a.cs', target: 'file:b.cs', type: 'imports' }],
        },
        // Later file removes what the earlier one added → net: gone.
        'z-last.patch.json': {
          _meta: patchMeta,
          edges_to_remove: [{ source: 'file:a.cs', target: 'file:b.cs', type: 'imports', reason: 'retracted' }],
        },
      },
    });
    roots.push(r.root);
    expect(r.graph.edges).toHaveLength(0);
  });

  it('is idempotent: applying twice yields byte-identical output', () => {
    const r = runScript({
      graph: makeGraph([edge(), edge({ type: 'calls' })]),
      importMap: { 'a.cs': ['b.cs'] },
      patches: {
        'a-add.patch.json': {
          _meta: patchMeta,
          edges_to_add: [
            { source: 'file:a.cs', target: 'file:b.cs', type: 'depends_on', note: 'n' },
          ],
          edges_to_remove: [
            { source: 'file:b.cs', target: 'file:a.cs', type: 'imports', reason: 'x' },
          ],
        },
      },
    });
    roots.push(r.root);
    const firstRun = readFileSync(r.graphPath, 'utf-8');
    const scanPath = join(r.root, 'scan-result.json');
    const patchDir = join(r.root, 'patches');
    const second = spawnSync(
      'node',
      [SCRIPT, r.graphPath, '--scan-result', scanPath, '--patches', patchDir],
      { encoding: 'utf-8' },
    );
    expect(second.status).toBe(0);
    const secondRun = readFileSync(r.graphPath, 'utf-8');
    expect(secondRun).toBe(firstRun);
  });

  it('accepts all 15 real KernelResearch patch files at format level', () => {
    const fixtureDir = resolve(__dirname, 'fixtures/kernelresearch-patches');
    const r = runScript({ graph: makeGraph([]) , patches: {} });
    roots.push(r.root);
    const result = spawnSync(
      'node',
      [SCRIPT, r.graphPath, '--patches', fixtureDir],
      { encoding: 'utf-8' },
    );
    expect(result.status).toBe(0);
    // Node-level skips are expected (this synthetic graph lacks the nodes),
    // but no file may be rejected at format level.
    expect(result.stderr).not.toContain('skipping patch');
    expect(result.stderr).toContain('patchFiles=15');
  });
});
