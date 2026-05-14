# Remote Build Check Source Implementation Plan

**Goal:** Remote tasks already submit whether the project can compile. Keep the existing hvigor validation path when `HMOS_HVIGOR_BUILD_CHECK_ENABLED` is enabled; when the switch is disabled, use the remote build result directly in scoring and reporting.

**Architecture:** Carry `executionResult.isBuildSuccess` into workflow state as `remoteBuildSuccess`, extend `HvigorBuildCheckSummary` with `buildCheckSource`, and let `officialCodeLinterNode` synthesize a build-check summary from the remote result only when hvigor validation is disabled. Downstream scoring and report generation continue to consume `hvigorBuildCheckSummary`.

## Tasks

- [x] Map management-console remote task types to internal task types:
  - `new_development` -> `full_generation`
  - `incremental` -> `continuation`
  - `bugfix` -> `bug_fix`
- [x] Stop re-identifying remote task type after preparation; task understanding and classification read the fixed task type from workflow state.
- [x] Preserve `remoteBuildSuccess` from `remoteTask.executionResult.isBuildSuccess` through accepted remote workflow state.
- [x] Add `buildCheckSource: "remote" | "hvigor"` to build-check summaries.
- [x] If hvigor build check is enabled, keep running local hvigor validation and mark the source as `hvigor`.
- [x] If hvigor build check is disabled and `remoteBuildSuccess` exists, synthesize the build-check summary from the remote result and mark the source as `remote`.
- [x] Keep the existing disabled hvigor behavior for non-remote/local runs where no remote build result exists.
- [x] Make score-fusion risk text and report JSON source-aware.
- [x] Add tests for task-type mapping, fixed task type propagation, remote build result preservation, switch-dependent build checking, scoring cap behavior, and report schema output.

## Verification

- [x] `node --import tsx --test tests/remote-task-preparation-node.test.ts tests/official-code-linter-node.test.ts tests/score-fusion.test.ts tests/score-agent.test.ts tests/schema-validator.test.ts tests/remote-network-execution.test.ts`
- [x] `node --import tsx --test tests/input-classification-node.test.ts tests/opencode-task-understanding.test.ts`
- [x] `npm run build`

No commit was created because the user did not request one.
