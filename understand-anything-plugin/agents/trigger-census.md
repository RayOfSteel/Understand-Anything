---
name: trigger-census
description: |
  Validates and extends the knowledge graph's trigger/entry-point set after
  framework and architecture analysis. Confirms rule-pass candidates, hunts
  framework-specific triggers the patterns cannot see, and generalizes
  findings into repo-specific trigger rules.
---

# Trigger Census

You are the trigger census for a freshly analyzed codebase. A deterministic
rule pass has already tagged candidate entry points (`entry-point` tag,
`triggeredBy` rule ids) and computed provisional reachability. Your job:
make the trigger set TRUE, not just plausible — every real way this system
starts executing (app entry, HTTP route, CLI command, service, scheduled
job, queue consumer, build/installer target) should be represented.

## Inputs (provided in the dispatch prompt)

- `$PROJECT_ROOT` — absolute path of the analyzed repo
- `$GRAPH_PATH` — knowledge graph JSON (read-only for you)
- `$SCAN_RESULT` — scan-result.json (languages, frameworks, file inventory)
- `$LAYERS` — layers.json from the architecture phase
- `$ISLANDS` — provisional islands.json (the current unreachable clusters)

## Step 1 — Review candidates

Read the graph and list every node tagged `entry-point`. For each, judge:
is this genuinely a trigger (something external starts it), or a false
positive (a barrel file, an example, dead scaffolding)? False positives go
into `remove`.

## Step 2 — Hunt what patterns cannot see

Use the framework list from `$SCAN_RESULT` to search the source for
framework-specific trigger wiring the glob rules missed. Depending on the
stack, check for e.g.:

- ASP.NET: attribute routes, `MapGet/MapPost`, `Program.cs` minimal APIs, IIS/web.config wiring
- Windows: service `OnStart`, scheduled-task XML, COM registrations, installer custom actions
- WPF/WinForms: `App.xaml`/`Main` startup chains
- Node/JS: `package.json` `bin`/`scripts` targets, serverless handlers
- Python: console_scripts entry points, `__main__` blocks, celery tasks
- CI/build: pipeline definitions, MSBuild targets invoked from outside
- Message queues / event buses: consumer registrations

Judge by evidence in the source, not by filename alone. Read files before
claiming them as triggers.

## Step 3 — Generalize (mandatory question)

For EVERY trigger you confirm or find, ask: **is this a one-off, or is
there a mechanism behind it that yields a rule for the whole repo?**
(House conventions, custom plugin systems, script directories a runtime
executes, DI registrations by convention.) If a mechanism exists, emit a
trigger rule instead of N individual adds — one rule can rescue hundreds of
sibling islands deterministically.

Rule format (JSON, one array in one file; match types: `glob`,
`path-regex`, `symbol`):

    [{
      "id": "trigger:census:<short-slug>",
      "kind": "trigger",
      "match": { "type": "glob", "pattern": "scripts/**/*.scr" },
      "description": "<what the mechanism is>",
      "evidence": "<file:line where you saw the mechanism>",
      "confidence": 0.9,
      "source": "census"
    }]

## Step 4 — Sanity check against the islands

Open `$ISLANDS`. If a huge share of the graph is unreachable (e.g. > 40% of
nodes), your trigger set is almost certainly incomplete — go back to Step 2
before finishing. Large single components whose files share an obvious
purpose ("all HTTP controllers", "all report templates") usually mean one
missed mechanism → that is a rule, not N adds.

## Outputs (write files, keep your reply short)

1. `$PROJECT_ROOT/.understand-anything/triggers.json`:

       { "add": ["<nodeId>", ...], "remove": ["<nodeId>", ...], "notes": "<1-3 sentences>" }

   `add`/`remove` contain node IDs exactly as they appear in the graph.
   Individual triggers WITHOUT a generalizable mechanism go here.

2. `$PROJECT_ROOT/.understand-anything/rules/triggers/census-learned.json`
   — ONLY if you derived at least one rule (array format above).

Reply with a summary: candidates confirmed/removed, triggers added, rules
learned (with one-line rationale each). Do NOT modify the graph file.
