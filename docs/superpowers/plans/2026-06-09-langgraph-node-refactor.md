# LangGraph Node Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the scoring LangGraph so task understanding remains the shared prerequisite, while linter, rule, and rubric branches run in parallel and HTML report generation is removed.

**Architecture:** Move deterministic patch scope preparation into reusable helpers, rename workflow state from `constraintSummary` to `taskUnderstanding`, and collapse thin prompt-builder graph nodes into `rulePreparationNode` and `rubricPreparationNode`. The graph should have one shared post-preparation topology for both new remote tasks and prepared-state resume.

**Tech Stack:** TypeScript, Node test runner, LangGraph `StateGraph`, existing OpenCode runners and scoring rule engine.

---

## File Structure

- Modify `src/workflow/graph/state.ts`: add `taskUnderstanding`, patch scope fields, `normalizedRuleImpacts`; remove `htmlReport` state.
- Modify `src/workflow/graph/scoreWorkflow.ts`: replace graph nodes and edges with the new topology for both fresh and prepared runs.
- Create `src/rules/evidence/patchEvidenceSummary.ts`: shared helper for effective patch generation and patch scope summary.
- Modify `src/rules/evidence/collectEvidence.ts`: reuse prepared patch scope when present.
- Modify `src/rules/core/ruleEngine.ts`: accept optional prepared `evidenceSummary`.
- Modify `src/workflow/nodes/remoteTaskPreparation/index.ts`: materialize effective patch and patch scope in preparation.
- Modify `src/workflow/nodes/taskUnderstanding/index.ts`: require `taskType`, consume prepared patch summary, persist `task-understanding.json`.
- Create `src/workflow/nodes/rulePreparation/index.ts`: combine rule audit and rule agent payload construction.
- Modify `src/workflow/nodes/rubricPreparation/index.ts`: build final rubric scoring payload.
- Modify `src/agents/normalization/ruleAssistance.ts`: remove `rubricSnapshot` from rule agent payload contract.
- Modify `src/workflow/nodes/officialCodeLinter/index.ts`: read patch scope from state and `taskUnderstanding`.
- Modify `src/workflow/nodes/ruleMerge/index.ts`: emit normalized rule impacts.
- Modify `src/workflow/nodes/scoreFusionOrchestration/index.ts`: prefer normalized impacts while preserving existing fallback.
- Modify `src/workflow/nodes/persistAndUpload/index.ts`: stop writing `report.html`, write task understanding artifact name.
- Modify `src/service/index.ts`: remove accepted-flow task classification and require `taskUnderstanding`.
- Modify observability files under `src/workflow/observability/`: remove deleted node labels, add `rulePreparationNode` summaries.
- Modify `src/workflow/nodes/index.ts`: export new node and stop exporting deleted graph nodes.
- Modify `docs/ARCHITECTURE.md`: document the new single topology and artifact contract.
- Modify tests: `tests/score-workflow-topology.test.ts`, `tests/score-agent.test.ts`, `tests/task-understanding-node.test.ts`, `tests/official-code-linter-node.test.ts`, `tests/workflow-node-summary.test.ts`, `tests/rule-agent-linter-boundary.test.ts`, `tests/remote-task-preparation-node.test.ts`, `tests/rule-merge-node.test.ts`.

## Tasks

### Task 1: Graph Topology RED Test

**Files:**
- Modify: `tests/score-workflow-topology.test.ts`

- [ ] **Step 1: Replace topology test with new graph assertions**

```ts
assert.equal(source.includes('addNode("inputClassificationNode"'), false);
assert.equal(source.includes('addNode("ruleAuditNode"'), false);
assert.equal(source.includes('addNode("rubricScoringPromptBuilderNode"'), false);
assert.equal(source.includes('addNode("ruleAgentPromptBuilderNode"'), false);
assert.equal(source.includes('addNode("artifactPostProcessNode"'), false);
assert.match(source, /\.addEdge\("taskUnderstandingNode", "officialCodeLinterNode"\)/);
assert.match(source, /\.addEdge\("taskUnderstandingNode", "rulePreparationNode"\)/);
assert.match(source, /\.addEdge\("taskUnderstandingNode", "rubricPreparationNode"\)/);
assert.match(source, /\.addEdge\("opencodeSandboxPreparationNode", "officialCodeLinterNode"\)/);
assert.match(source, /\.addEdge\("opencodeSandboxPreparationNode", "rulePreparationNode"\)/);
assert.match(source, /\.addEdge\("opencodeSandboxPreparationNode", "rubricPreparationNode"\)/);
assert.match(source, /\.addEdge\("rulePreparationNode", "ruleAssessmentAgentNode"\)/);
assert.match(source, /\.addEdge\("rubricPreparationNode", "rubricScoringAgentNode"\)/);
```

- [ ] **Step 2: Run the topology test and confirm RED**

Run: `node --import tsx --test tests/score-workflow-topology.test.ts`

Expected: FAIL because old nodes and old edges are still present.

### Task 2: State And Task Understanding Rename

**Files:**
- Modify: `src/workflow/graph/state.ts`
- Modify: `src/workflow/nodes/taskUnderstanding/index.ts`
- Modify: `tests/task-understanding-node.test.ts`
- Modify: `tests/workflow-custom-events.test.ts`
- Modify: `src/workflow/observability/nodeSummaries.ts`

- [ ] **Step 1: Update tests to expect `taskUnderstanding` and `task-understanding.json`**

Replace assertions such as `result.constraintSummary` with `result.taskUnderstanding`, and persisted path `intermediate/constraint-summary.json` with `intermediate/task-understanding.json`.

- [ ] **Step 2: Run focused tests and confirm RED**

Run: `node --import tsx --test tests/task-understanding-node.test.ts tests/workflow-custom-events.test.ts`

Expected: FAIL because the node still writes `constraintSummary`.

- [ ] **Step 3: Implement state rename at workflow boundary**

In `state.ts`, add `taskUnderstanding: Annotation<ConstraintSummary>()`, patch scope fields `changedFiles`, `changedLineNumbersByFile`, `changedFileCount`, and remove `htmlReport`.

In `taskUnderstandingNode`, throw `new Error("taskUnderstandingNode requires taskType in state.")` when `state.taskType` is absent, persist to `intermediate/task-understanding.json`, and return `taskUnderstanding`.

- [ ] **Step 4: Run focused tests and confirm GREEN**

Run: `node --import tsx --test tests/task-understanding-node.test.ts tests/workflow-custom-events.test.ts tests/workflow-node-summary.test.ts`

Expected: PASS after summaries read `taskUnderstanding`.

### Task 3: Patch Scope Preparation

**Files:**
- Create: `src/rules/evidence/patchEvidenceSummary.ts`
- Modify: `src/workflow/nodes/remoteTaskPreparation/index.ts`
- Modify: `src/rules/evidence/collectEvidence.ts`
- Modify: `src/rules/core/ruleEngine.ts`
- Modify: `tests/remote-task-preparation-node.test.ts`
- Modify: `tests/rule-engine.test.ts`

- [ ] **Step 1: Add tests for prepared patch scope**

In remote preparation tests, assert returned state includes `effectivePatchPath`, `changedFiles`, `changedLineNumbersByFile`, `changedFileCount`, and `hasPatch`.

- [ ] **Step 2: Run focused tests and confirm RED**

Run: `node --import tsx --test tests/remote-task-preparation-node.test.ts`

Expected: FAIL because remote preparation does not generate patch scope.

- [ ] **Step 3: Add helper and use it**

Create `preparePatchEvidenceSummary({ caseInput, caseDir, artifactStore? })` that filters or generates effective patch, parses changed files and added lines via existing `parsePatchScope`, and returns updated `caseInput`, `effectivePatchPath`, `hasPatch`, `changedFiles`, `changedLineNumbersByFile`, `changedFileCount`, plus an `EvidenceSummary`-compatible summary.

- [ ] **Step 4: Wire helper into remote preparation and rule engine**

Remote preparation should call the helper and return patch scope fields. `runRuleEngine` should accept `preparedEvidenceSummary?: EvidenceSummary` and pass it to `collectEvidence` so rule and linter branches share scope.

- [ ] **Step 5: Run focused tests and confirm GREEN**

Run: `node --import tsx --test tests/remote-task-preparation-node.test.ts tests/rule-engine.test.ts`

Expected: PASS.

### Task 4: Merge Rule Preparation And Rule Payload

**Files:**
- Create: `src/workflow/nodes/rulePreparation/index.ts`
- Modify: `src/agents/normalization/ruleAssistance.ts`
- Modify: `tests/agent-assisted-rule.test.ts`
- Modify: `tests/rule-agent-linter-boundary.test.ts`
- Modify: `tests/score-agent.test.ts`

- [ ] **Step 1: Update rule payload tests**

Assert `AgentBootstrapPayload` has only `case_context`, `task_understanding`, and `assisted_rule_candidates`; assert no `rubric_summary`.

- [ ] **Step 2: Run focused tests and confirm RED**

Run: `node --import tsx --test tests/agent-assisted-rule.test.ts tests/rule-agent-linter-boundary.test.ts`

Expected: FAIL because current payload includes `rubric_summary`.

- [ ] **Step 3: Implement `rulePreparationNode`**

The node should run `runRuleEngine`, use `state.taskUnderstanding.crossDeviceAdaptation`, build `ruleAgentBootstrapPayload`, and return existing rule audit fields plus the payload.

- [ ] **Step 4: Run focused tests and confirm GREEN**

Run: `node --import tsx --test tests/agent-assisted-rule.test.ts tests/rule-agent-linter-boundary.test.ts tests/score-agent.test.ts`

Expected: PASS after test migration from `ruleAuditNode` to `rulePreparationNode`.

### Task 5: Merge Rubric Preparation And Rubric Payload

**Files:**
- Modify: `src/workflow/nodes/rubricPreparation/index.ts`
- Modify: `tests/score-agent.test.ts`
- Modify: `tests/opencode-rubric-scoring.test.ts`

- [ ] **Step 1: Move rubric payload expectations to `rubricPreparationNode`**

Tests should call `rubricPreparationNode` and assert it returns both `rubricSnapshot` and `rubricScoringPayload`.

- [ ] **Step 2: Run focused tests and confirm RED**

Run: `node --import tsx --test tests/score-agent.test.ts tests/opencode-rubric-scoring.test.ts`

Expected: FAIL because `rubricPreparationNode` does not yet return payload.

- [ ] **Step 3: Implement payload creation in rubric preparation**

Move `buildWorkspaceProjectStructureContext` logic from `rubricScoringPromptBuilderNode` and call `buildOpencodeRubricPayload` with `taskUnderstanding`.

- [ ] **Step 4: Run focused tests and confirm GREEN**

Run: `node --import tsx --test tests/score-agent.test.ts tests/opencode-rubric-scoring.test.ts`

Expected: PASS.

### Task 6: Graph, Service, Observability, And Persistence

**Files:**
- Modify: `src/workflow/graph/scoreWorkflow.ts`
- Modify: `src/service/index.ts`
- Modify: `src/workflow/observability/nodeLabels.ts`
- Modify: `src/workflow/observability/nodeSummaries.ts`
- Modify: `src/workflow/observability/types.ts`
- Modify: `src/workflow/nodes/index.ts`
- Modify: `src/workflow/nodes/persistAndUpload/index.ts`
- Modify: `tests/workflow-node-summary.test.ts`
- Modify: `tests/workflow-event-logger.test.ts`
- Modify: `tests/score-workflow-topology.test.ts`

- [ ] **Step 1: Update graph imports, nodes, and edges**

Fresh run: `remoteTaskPreparationNode -> taskUnderstandingNode -> officialCodeLinterNode/rulePreparationNode/rubricPreparationNode`.

Prepared run: `opencodeSandboxPreparationNode -> officialCodeLinterNode/rulePreparationNode/rubricPreparationNode`.

Both join through `ruleMergeNode`, `scoreFusionOrchestrationNode`, `reportGenerationNode`, `persistAndUploadNode`.

- [ ] **Step 2: Remove service accepted-flow classification**

Remove `inputClassificationNode` import and invocation, and require `taskUnderstanding` in `toAcceptedRemoteWorkflowState`.

- [ ] **Step 3: Stop writing HTML report**

Remove `artifactPostProcessNode` from graph and make persistence write only `outputs/result.json` plus existing intermediate JSON artifacts.

- [ ] **Step 4: Run focused tests and confirm GREEN**

Run: `node --import tsx --test tests/score-workflow-topology.test.ts tests/workflow-node-summary.test.ts tests/workflow-event-logger.test.ts tests/score-agent.test.ts`

Expected: PASS.

### Task 7: Official Linter And Rule Merge Normalization

**Files:**
- Modify: `src/workflow/nodes/officialCodeLinter/index.ts`
- Modify: `src/workflow/nodes/ruleMerge/index.ts`
- Modify: `src/workflow/nodes/scoreFusionOrchestration/index.ts`
- Modify: `src/types.ts`
- Modify: `tests/official-code-linter-node.test.ts`
- Modify: `tests/rule-merge-node.test.ts`
- Modify: `tests/score-fusion.test.ts`

- [ ] **Step 1: Update tests for state patch scope and normalized impacts**

Official linter tests should pass `changedFiles` and `changedLineNumbersByFile` directly on state. Rule merge tests should assert `normalizedRuleImpacts`.

- [ ] **Step 2: Run focused tests and confirm RED**

Run: `node --import tsx --test tests/official-code-linter-node.test.ts tests/rule-merge-node.test.ts`

Expected: FAIL before implementation.

- [ ] **Step 3: Implement linter state reads and normalized impact builder**

Map non-violations to `none`, P0 case constraints to `hard_gate`, must/forbidden to `cap`, should to `deduct`, official severity to unified severity, and missing official profiles to `review_only`.

- [ ] **Step 4: Run focused tests and confirm GREEN**

Run: `node --import tsx --test tests/official-code-linter-node.test.ts tests/rule-merge-node.test.ts tests/score-fusion.test.ts`

Expected: PASS.

### Task 8: Docs, Build, And E2E Acceptance

**Files:**
- Modify: `docs/ARCHITECTURE.md`

- [ ] **Step 1: Update architecture doc**

Replace old node diagram and node table with the single new topology from the spec. Document that `outputs/report.html` is no longer generated.

- [ ] **Step 2: Run full verification**

Run:

```bash
npm run build
node --import tsx --test tests/score-workflow-topology.test.ts tests/remote-task-preparation-node.test.ts tests/task-understanding-node.test.ts tests/official-code-linter-node.test.ts tests/rule-merge-node.test.ts tests/workflow-node-summary.test.ts tests/workflow-event-logger.test.ts tests/score-agent.test.ts
npm test
```

Expected: all pass. If sandbox blocks local listening, rerun the specific affected test command outside sandbox with approval.

- [ ] **Step 3: Run local API E2E**

Terminal 1:

```bash
npm run dev:api
```

Terminal 2:

```bash
latest_remote_task=$(ls -t .local-cases/*/inputs/remote-task.json | head -1)
curl -i --max-time 600 -H 'Content-Type: application/json' --data-binary @"$latest_remote_task" http://127.0.0.1:3000/score/run-remote-task
```

Expected: new case has `outputs/result.json`, no `outputs/report.html`, prompt payload files match final field shape, and workflow logs do not contain removed node names.

