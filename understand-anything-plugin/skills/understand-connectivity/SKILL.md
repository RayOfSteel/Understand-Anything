---
name: understand-connectivity
description: Investigate isolated or weakly connected Understand Anything graph areas and produce graph patches for missed relationships
argument-hint: ["[--target <node-id-or-path>] [--budget <N>] [--interactive]"]
---

# /understand-connectivity

Investigates disconnected graph areas in `.understand-anything/knowledge-graph.json` and writes graph patches that can be merged by `/understand --regenerate`.

## Instructions

### Phase 0: Resolve Project And Inputs

1. Set `PROJECT_ROOT` to the current working directory unless a path argument is supplied.
2. Verify `$PROJECT_ROOT/.understand-anything/knowledge-graph.json` exists. If not, stop and tell the user to run `/understand` first.
3. Parse:
   - `--target <node-id-or-path>` for targeted investigation
   - `--budget <N>` for candidate count, default `25`
   - `--interactive` for orchestrator checkpoints
4. Ensure `$PROJECT_ROOT/.understand-anything/intermediate` exists.

### Phase 1: Build Candidates

If `--target` is supplied, create a single candidate for that node or file path. Otherwise run:

```bash
node <SKILL_DIR>/build-connectivity-candidates.mjs \
  "$PROJECT_ROOT" \
  "$PROJECT_ROOT/.understand-anything/knowledge-graph.json" \
  "$PROJECT_ROOT/.understand-anything/intermediate/connectivity-candidates.json" \
  "<budget>"
```

The CLI walks `$PROJECT_ROOT` once for basename references and feeds the counts into ranking, so the top candidates are nodes whose basenames appear most often in other files (high-impact missed edges). Zero-reference candidates are tagged as "likely orphan / dead code" in their `reasons[]` and pushed down — investigate them last, or skip them in favor of the next pass.

Read `connectivity-candidates.json`.

### Phase 2: Interactive Checkpoint

Only when `--interactive` is present, ask:

```text
Next I will inspect the highest-signal disconnected graph areas and look for concrete source-backed relationships. I have the candidate list and the current graph loaded. Any advice for the agent before I start?
```

Persist any answer as an injection record in `$PROJECT_ROOT/.understand-anything/intermediate/injections/`.

### Phase 3: Investigation

For each selected candidate:

1. Load node details and adjacent graph context from `knowledge-graph.json`.
2. Load available prior attempt artifacts from `.understand-anything/runs/` when present.
3. Inspect source files only as needed to verify concrete relationships.
4. Write graph patch output to:
   ```text
   $PROJECT_ROOT/.understand-anything/intermediate/connectivity-<index>.patch.json
   ```
5. Write deferred work output to:
   ```text
   $PROJECT_ROOT/.understand-anything/intermediate/connectivity-<index>.deferred-work.json
   ```

Patch shape:

```json
{
  "version": "1.0.0",
  "targetGraph": "knowledge",
  "source": "connectivity-pass",
  "nodes": [],
  "edges": [
    {
      "source": "config:Application/resources/foo.xml",
      "target": "file:Application/src/ResourceLoader.cs",
      "type": "configures",
      "direction": "forward",
      "weight": 0.8
    }
  ],
  "invalidations": []
}
```

### Phase 4: Report

Write `$PROJECT_ROOT/.understand-anything/intermediate/connectivity-report.json`:

```json
{
  "version": "1.0.0",
  "patchesWritten": ["<patch paths>"],
  "deferredWorkWritten": ["<deferred work paths>"],
  "summary": "<short summary>"
}
```

Tell the user to run `/understand --regenerate` to merge the patches, or run `/understand --regenerate --connectivity-pass` to include this flow in one regenerate pass.
