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
