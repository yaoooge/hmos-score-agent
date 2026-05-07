# Remove Task Understanding Representative Files Design

## Context

The task understanding agent currently receives `agent_input.projectStructure.representativeFiles`, a precomputed list of source-like project files. This list can be large and does not materially improve the task understanding stage because the agent is not allowed to explore business files at this stage. The useful early signals are the original prompt, module paths, top-level entries, implementation hints, and patch summary.

## Goal

Stop generating and passing `representativeFiles` during the task understanding preparation stage.

## Design

Remove `representativeFiles` from `ProjectStructureSummary` so the field is no longer part of the shared structure summary generated before task understanding. `collectProjectStructure()` will continue scanning enough files to derive `modulePaths`, `implementationHints`, `topLevelEntries`, and `omittedFileCount`, but it will not build a representative file list.

The task understanding opencode prompt will no longer mention `representativeFiles` in its instructions. The retry constraint draft will also avoid the old "representative files" fallback line and will rely on module paths plus implementation hints for contextual constraints.

Downstream code that truly needs file-level evidence should use `patchSummary.changedFiles`, sandbox metadata, or agent-side file inspection in later scoring stages. This keeps the earliest agent prompt compact while preserving the context needed for classification and constraint extraction.

## Testing

Focused tests will assert that the first task understanding prompt does not contain a `representativeFiles` key, that the retry prompt does not synthesize "代表文件" context, and that the node result no longer exposes `workspaceProjectStructure.representativeFiles`.

Run:

```bash
node --import tsx --test tests/opencode-task-understanding.test.ts tests/task-understanding-node.test.ts
```
