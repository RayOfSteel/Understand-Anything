---
name: understand-islands
description: Check an existing knowledge graph for node chains unreachable from any trigger/entry point, and investigate them with budgeted island research missions
argument-hint: [project-path] [--skip-missions]
---

# /understand-islands

Run the trigger-reachability check (spec 2026-07-05) on an EXISTING
knowledge graph — without re-running the full `/understand` pipeline.
Tracks unreachable island components in `.understand-anything/islands.json`,
lists them, and investigates them with interactively budgeted
`island-researcher` missions. Resumes where a previous run stopped
(existing verdicts and mission ids are retained).

## Instructions

1. **Resolve the project.** `$PROJECT_ROOT` = path from `$ARGUMENTS`, else
   the current working directory. `$GRAPH` =
   `$PROJECT_ROOT/.understand-anything/knowledge-graph.json`. If `$GRAPH`
   does not exist, tell the user: `No knowledge graph found. Run /understand first.`
   and stop. If the graph has `"kind": "knowledge"`, tell the user
   reachability only applies to codebase graphs and stop.

2. **Locate the scripts.** `<SKILL_DIR>` =
   `${CLAUDE_PLUGIN_ROOT}/skills/understand/` (the sibling skill's
   directory — compute-reachability.mjs, apply-graph-patches.mjs live
   there).

3. **Deterministic pass.** Run:

   ```bash
   node <SKILL_DIR>/compute-reachability.mjs "$GRAPH"
   ```

   Surface stderr `Warning:` lines to the user. Read
   `$PROJECT_ROOT/.understand-anything/islands.json`; print the island
   list (component id, size, dominantCategory, first 3 files; sorted by
   size, max 20 rows). If there are no islands: report
   `All node chains are reachable from a trigger. Nothing to do.` and stop.

4. **Census (only if `triggers.json` is missing).** If
   `$PROJECT_ROOT/.understand-anything/triggers.json` does not exist,
   dispatch the `trigger-census` agent (at `agents/trigger-census.md`) with:

   > Census the triggers of the project at `$PROJECT_ROOT`.
   > `$GRAPH_PATH` = `$GRAPH`
   > `$SCAN_RESULT` = `$PROJECT_ROOT/.understand-anything/intermediate/scan-result.json` (may be missing — then derive frameworks from the graph's `project.frameworks`)
   > `$LAYERS` = derive from the graph's `layers` array
   > `$ISLANDS` = `$PROJECT_ROOT/.understand-anything/islands.json`
   > Write `triggers.json` (and optionally `rules/triggers/census-learned.json`) as specified in your instructions.

   Then re-run the step-3 command and refresh the island list.

5. **Missions.** If `--skip-missions` is in `$ARGUMENTS`, report the
   tracked state and stop. Otherwise run the identical mission loop as
   `/understand` Phase 6.5 step 4 (first 10 missions free, then
   AskUserQuestion checkpoint: view list / 10 more / stop), with `$GRAPH`
   in place of the assembled-graph path in both script invocations.

6. **Report.** Summarize: triggers, reachable/attached counts, islands by
   status (`isolated` with confidence, `unresolved`), missions run, and
   that state persists in `islands.json` / `triggers.json` /
   `rules/triggers/` / `patches/` for the next run.
