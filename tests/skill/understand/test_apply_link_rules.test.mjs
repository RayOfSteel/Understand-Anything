import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(
  __dirname,
  '../../../understand-anything-plugin/skills/understand/apply-link-rules.mjs',
);

const FIXTURE_SOURCES = {
  'Views/MainWindow.xaml':
    '<Window x:Class="Demo.MainWindow" Loaded="OnLoaded"\n' +
    '        xmlns:vm="clr-namespace:Demo.ViewModels;assembly=Demo">\n' +
    '  <Grid><vm:MainViewModel/></Grid>\n' +
    '</Window>\n',
  'Views/MainWindow.xaml.cs':
    'namespace Demo {\n  public partial class MainWindow {\n' +
    '    void OnLoaded(object s, System.EventArgs e) { }\n  }\n}\n',
  'ViewModels/MainViewModel.cs':
    'namespace Demo.ViewModels;\npublic class MainViewModel { }\n',
  'Services/IGreeter.cs': 'namespace Demo.Services;\npublic interface IGreeter { }\n',
  'Services/Greeter.cs':
    'namespace Demo.Services;\npublic class Greeter : IGreeter { }\n',
  'Bootstrap.cs':
    'using Demo.Services;\nnamespace Demo {\n  public class Bootstrap {\n' +
    '    void Init(dynamic container) { container.Register<IGreeter, Greeter>(); }\n  }\n}\n',
  'Pages/_Imports.razor': '@using Demo.Services\n',
  'Pages/Hello.razor': '@inject IGreeter Greeter\n<h1>hi</h1>\n',
  'Pages/Index.razor': '<div><Hello /></div>\n',
};

function fileNode(rel) {
  return {
    id: `file:${rel}`, type: 'file', name: rel.split('/').pop(),
    summary: 's', tags: [], complexity: 'simple',
  };
}

function makeFixtureProject({ edges = [], dropNodes = [], localRules = null } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'ua-alr-test-'));
  for (const [rel, content] of Object.entries(FIXTURE_SOURCES)) {
    mkdirSync(join(root, dirname(rel)), { recursive: true });
    writeFileSync(join(root, rel), content, 'utf-8');
  }
  const uaDir = join(root, '.understand-anything');
  mkdirSync(uaDir, { recursive: true });
  const nodes = Object.keys(FIXTURE_SOURCES)
    .filter((rel) => !dropNodes.includes(rel))
    .map(fileNode);
  const graph = {
    version: '1.0.0',
    project: {
      name: 'p', languages: [], frameworks: [], description: '',
      analyzedAt: '2026-01-01T00:00:00Z', gitCommitHash: 'abc',
    },
    nodes, edges, layers: [], tour: [],
  };
  const graphPath = join(uaDir, 'knowledge-graph.json');
  writeFileSync(graphPath, JSON.stringify(graph, null, 2) + '\n', 'utf-8');
  if (localRules) {
    const rulesDir = join(uaDir, 'rules');
    mkdirSync(rulesDir, { recursive: true });
    for (const [name, content] of Object.entries(localRules)) {
      writeFileSync(
        join(rulesDir, name),
        typeof content === 'string' ? content : JSON.stringify(content, null, 2),
        'utf-8',
      );
    }
  }
  return { root, graphPath };
}

function runScript(graphPath, extraArgs = []) {
  const result = spawnSync('node', [SCRIPT, graphPath, ...extraArgs], { encoding: 'utf-8' });
  let graph = null;
  try { graph = JSON.parse(readFileSync(graphPath, 'utf-8')); } catch { /* hard failure */ }
  return { status: result.status, stderr: result.stderr, stdout: result.stdout, graph };
}

function ruleEdges(graph, ruleId) {
  return graph.edges.filter((e) => e.ruleId === ruleId);
}

describe('apply-link-rules.mjs (end-to-end, default plugin packs)', () => {
  it('fires every one of the seven pack rules exactly once on the fixture project', () => {
    const { graphPath } = makeFixtureProject();
    const { status, stderr, graph } = runScript(graphPath);
    expect(status).toBe(0);
    expect(stderr).toContain('added=7');
    const expectations = [
      ['wpf.code-behind', 'file:Views/MainWindow.xaml.cs', 'file:Views/MainWindow.xaml', 'implements', 1.0],
      ['wpf.event-handler', 'file:Views/MainWindow.xaml', 'file:Views/MainWindow.xaml.cs', 'calls', 0.9],
      ['wpf.xmlns-viewmodel', 'file:Views/MainWindow.xaml', 'file:ViewModels/MainViewModel.cs', 'depends_on', 0.8],
      ['razor.inject', 'file:Pages/Hello.razor', 'file:Services/IGreeter.cs', 'depends_on', 0.9],
      ['razor.component-tag', 'file:Pages/Index.razor', 'file:Pages/Hello.razor', 'depends_on', 0.9],
      ['dryioc.implements', 'file:Services/Greeter.cs', 'file:Services/IGreeter.cs', 'implements', 1.0],
      ['dryioc.registration', 'file:Bootstrap.cs', 'file:Services/Greeter.cs', 'configures', 1.0],
    ];
    for (const [ruleId, source, target, type, confidence] of expectations) {
      const edges = ruleEdges(graph, ruleId);
      expect(edges, ruleId).toHaveLength(1);
      expect(edges[0]).toMatchObject({ source, target, type, confidence, origin: 'rule', weight: 1.0 });
      expect(edges[0].evidence).toBeTruthy();
    }
  });

  it('is byte-identical on the second run (idempotence)', () => {
    const { graphPath } = makeFixtureProject();
    expect(runScript(graphPath).status).toBe(0);
    const first = readFileSync(graphPath, 'utf-8');
    expect(runScript(graphPath).status).toBe(0);
    expect(readFileSync(graphPath, 'utf-8')).toBe(first);
  });

  it('upgrades an existing llm edge instead of duplicating, leaves manual edges alone', () => {
    const { graphPath } = makeFixtureProject({
      edges: [
        { source: 'file:Services/Greeter.cs', target: 'file:Services/IGreeter.cs', type: 'implements', direction: 'forward', weight: 0.6, origin: 'llm', description: 'guessed' },
        { source: 'file:Bootstrap.cs', target: 'file:Services/Greeter.cs', type: 'configures', direction: 'forward', weight: 1.0, origin: 'manual', ruleId: 'patch.json' },
      ],
    });
    const { stderr, graph } = runScript(graphPath);
    expect(stderr).toContain('upgraded=1');
    expect(stderr).toContain('added=5');
    const upgraded = ruleEdges(graph, 'dryioc.implements')[0];
    expect(upgraded).toMatchObject({ origin: 'rule', description: 'guessed', weight: 0.6 });
    const manual = graph.edges.find((e) => e.origin === 'manual');
    expect(manual.ruleId).toBe('patch.json');
  });

  it('skips edges whose nodes are missing from the graph, with a warning', () => {
    // Deviation from the brief's literal fixture expectation (documented per
    // its own escape hatch): the engine's file inventory (engine.ts step 4)
    // is derived strictly from graph.nodes, so a dropped node starves fact
    // collection for that file upstream of join evaluation — the join never
    // produces a candidate edge, so apply.ts's "unknown node" branch (which
    // only fires for a candidate whose source/target isn't in graph.nodes)
    // is structurally unreachable from this drop. The actually-observed
    // degradation path is the csharp/razor builtins' own "not resolvable"
    // warning when they can't map a short type name via using/namespace
    // context — which is the correct place for this to surface, since the
    // dropped file's class fact was never collected. The rule-level
    // consequence (no dangling edge, no crash) is what actually matters here.
    const { graphPath } = makeFixtureProject({ dropNodes: ['Services/IGreeter.cs'] });
    const { status, stderr, graph } = runScript(graphPath);
    expect(status).toBe(0);
    expect(stderr).toContain('not resolvable');
    expect(ruleEdges(graph, 'razor.inject')).toHaveLength(0);
    expect(ruleEdges(graph, 'dryioc.implements')).toHaveLength(0);
  });

  it('loads project-local rules and lets them override pack rules by id', () => {
    const { graphPath } = makeFixtureProject({
      localRules: {
        'local.json': [
          {
            id: 'wpf.code-behind',
            description: 'override: disabled',
            enabled: false,
            confidence: 1.0,
            edge: { type: 'implements' },
            facts: { cls: { builtin: 'csharp.classFqn' } },
            link: { where: ['cls.value == cls.value'], source: 'cls.file', target: 'cls.file' },
          },
        ],
      },
    });
    const { stderr, graph } = runScript(graphPath);
    expect(stderr).toContain('overridden');
    expect(ruleEdges(graph, 'wpf.code-behind')).toHaveLength(0);
    expect(stderr).toContain('added=6');
  });

  it('skips a defective rule file with a warning and keeps going', () => {
    const { graphPath } = makeFixtureProject({ localRules: { 'broken.json': '{ nope' } });
    const { status, stderr } = runScript(graphPath);
    expect(status).toBe(0);
    expect(stderr).toContain('invalid JSON');
    expect(stderr).toContain('added=7');
  });

  it('skips rules whose language has no grammar, with a warning (spec §8.6 degradation path)', () => {
    const { graphPath } = makeFixtureProject({
      localRules: {
        'nolang.json': {
          id: 'x.nolang',
          confidence: 1.0,
          edge: { type: 'calls' },
          facts: { f: { language: 'nolang', query: ['(x) @a'] } },
          link: { where: ['f.file == f.file'], source: 'f.file', target: 'f.file' },
        },
      },
    });
    const { status, stderr } = runScript(graphPath);
    expect(status).toBe(0);
    expect(stderr).toContain("language 'nolang'");
    expect(stderr).toContain('skippedRules=1');
    expect(stderr).toContain('added=7');
  });

  it('explicit --rules replaces both defaults', () => {
    const { root, graphPath } = makeFixtureProject();
    const emptyDir = join(root, 'empty-rules');
    mkdirSync(emptyDir);
    const { status, stderr, graph } = runScript(graphPath, ['--rules', emptyDir]);
    expect(status).toBe(0);
    expect(stderr).toContain('rules=0');
    expect(graph.edges).toEqual([]);
  });

  it('degrades to a warning no-op when core is not loadable (script copied out of the plugin)', () => {
    const { root, graphPath } = makeFixtureProject();
    const orphan = join(root, 'orphan');
    mkdirSync(orphan, { recursive: true });
    const copied = join(orphan, 'apply-link-rules.mjs');
    cpSync(SCRIPT, copied);
    const before = readFileSync(graphPath, 'utf-8');
    const result = spawnSync('node', [copied, graphPath], { encoding: 'utf-8' });
    expect(result.status).toBe(0);
    expect(result.stderr).toContain('cannot load @understand-anything/core');
    expect(readFileSync(graphPath, 'utf-8')).toBe(before);
  });
});
