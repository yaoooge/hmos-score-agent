# Parallel Rubric and Rule Scoring Design

## Background

The current workflow loads a rubric and invokes an agent, but the agent only assists uncertain rule judgments. Final scoring is produced by `computeScoreBreakdown`, which initializes rubric items at the maximum band and applies rule-driven penalties. This does not match the target model where the rubric is the primary scoring basis and rules act as modifiers.

The current `featureExtractionNode` is also a placeholder. It returns static descriptive strings, is passed into scoring as an unused input, and is only written to `intermediate/feature-extraction.json` or summarized in logs. Removing it from the blocking workflow does not change current scoring behavior.

## Goals

- Make rubric-based agent scoring the primary score source.
- Keep deterministic and agent-assisted rule evaluation as auxiliary evidence and modifiers.
- Run the rubric scoring agent and rule assessment agent in parallel to reduce wall-clock latency.
- Remove `featureExtractionNode` from the critical path because it currently has no scoring effect.
- Preserve stable fallback behavior when either agent fails or returns invalid output.
- Keep result output compatible with the existing report schema unless a schema extension is explicitly added later.

## Non-Goals

- Do not add build or compile verification as part of this change.
- Do not redesign the full report schema in the first implementation.
- Do not make rules independently produce a second total score.
- Do not keep the placeholder feature extraction node as a required scoring dependency.

## Current Issues

### Rubric Is Not the Primary Scorer

`rubricPreparationNode` produces `rubricSnapshot`, but the existing agent prompt asks for judgments only over `assisted_rule_candidates`. The agent output schema contains rule assessments, not rubric item scores.

`scoringOrchestrationNode` reloads the rubric and calls `computeScoreBreakdown`. That function uses rubric dimensions as a score container, initializes each item at its best band, and then modifies scores based on mapped rule violations. Rubric band criteria are not interpreted by an agent.

### Feature Extraction Has No Real Effect

`featureExtractionNode` currently returns fixed placeholder values:

- `状态管理类型待静态扫描增强`
- `存在 original/workspace 双工程对照输入`
- `命名与关键字提取已预留规则接口`
- patch presence text

The only code paths using `featureExtraction` are:

- State storage.
- Persisting `intermediate/feature-extraction.json`.
- Node summary logging.
- Passing it into `computeScoreBreakdown`, where no field is read.
- Test fixtures that satisfy current function signatures.

The node should be removed from the required workflow. If future real features are needed, they should be implemented as either an optional evidence builder or as case-aware tools used by the rubric agent.

## Recommended Architecture

Use two parallel branches after task classification:

```text
remoteTaskPreparation
  -> taskUnderstanding
  -> inputClassification
  -> parallel:
       rubricPreparation
       ruleAudit
  -> parallel:
       rubricScoringPromptBuilder -> rubricScoringAgent
       ruleAgentPromptBuilder -> ruleAssessmentAgent -> ruleMerge
  -> scoreFusionOrchestration
  -> reportGeneration
  -> artifactPostProcess
  -> persistAndUpload
```

The important latency reduction comes from running the two LLM calls concurrently:

```text
rubricScoringAgent || ruleAssessmentAgent
```

The expected wall-clock model changes from:

```text
rule_agent_time + rubric_agent_time + deterministic_time
```

to:

```text
max(rule_agent_time, rubric_agent_time) + deterministic_time + fusion_time
```

## Workflow Nodes

### `rubricPreparationNode`

Keep this node. It should load the task-specific rubric and produce `rubricSnapshot`.

It can run immediately after `inputClassificationNode` because it only needs `taskType` and `referenceRoot`.

### `ruleAuditNode`

Keep this node. It should run deterministic rule evaluation and identify uncertain rule candidates.

It can also run immediately after `inputClassificationNode`. It does not need the removed feature extraction output.

### `rubricScoringPromptBuilderNode`

New node.

Responsibilities:

- Build a rubric scoring payload from `caseInput`, `taskType`, `constraintSummary`, `rubricSnapshot`, patch metadata, and available case paths.
- Give the agent the full rubric scoring bands for the selected task type.
- Tell the agent to evaluate each rubric item directly against code evidence.
- Produce `rubricScoringPromptText` and `rubricScoringPayload`.

This prompt must not ask the agent to judge rule IDs. Rules are handled by the rule branch.

### `rubricScoringAgentNode`

New node.

Responsibilities:

- Invoke the model with a strict JSON protocol.
- Allow bounded read-only case tools, similar to the existing case-aware rule runner.
- Return structured rubric item scores, evidence, rationale, confidence, review flags, hard gate candidates, risks, strengths, and main issues.
- Return a failure status and no score if the agent fails or violates protocol.

### `ruleAgentPromptBuilderNode`

Rename or replace the current `agentPromptBuilderNode`.

Responsibilities:

- Preserve the current rule-agent payload behavior.
- Build prompts only for `assistedRuleCandidates`.
- Write `ruleAgentPromptText` and `ruleAgentBootstrapPayload`.

This name avoids implying that the current prompt is a general scoring prompt.

### `ruleAssessmentAgentNode`

Rename or retain the current `agentAssistedRuleNode`.

Responsibilities:

- Continue judging uncertain rule candidates.
- Return `agentAssistedRuleResults`, `agentTurns`, and `agentToolTrace`.
- Preserve fallback behavior when there are no candidates or no configured agent client.

### `ruleMergeNode`

Keep this node.

Responsibilities:

- Merge deterministic rule results and rule-agent results.
- Produce `mergedRuleAuditResults`.
- Preserve fallback results for skipped, failed, and invalid agent outputs.

### `scoreFusionOrchestrationNode`

New node replacing `scoringOrchestrationNode` for the primary path.

Responsibilities:

- Use rubric agent item scores as the base score.
- Apply deterministic and merged rule results as modifiers.
- Apply hard gate score caps.
- Add human review items for low confidence, agent failures, uncertain rule judgments, missing patch context, and score boundary bands.
- Produce the existing `ScoreComputation` shape for report generation.

## State Model Changes

Add rubric scoring state:

```ts
rubricScoringPayload: Annotation<RubricScoringPayload>();
rubricScoringPromptText: Annotation<string>();
rubricScoringResult: Annotation<RubricScoringResult>();
rubricAgentRunStatus: Annotation<AgentRunStatus>();
rubricAgentTurns: Annotation<CaseAwareAgentTurn[]>();
rubricAgentToolTrace: Annotation<CaseToolTraceItem[]>();
```

Rename rule agent state where practical:

```ts
ruleAgentBootstrapPayload: Annotation<AgentBootstrapPayload>();
ruleAgentPromptText: Annotation<string>();
ruleAgentRunStatus: Annotation<AgentRunStatus>();
```

The existing names can be retained during migration if minimizing code churn is more important than naming clarity.

Remove feature extraction state from the required score path:

```ts
featureExtraction: Annotation<FeatureExtraction>();
```

The type can remain temporarily if tests or compatibility code still reference it, but it should not be required by scoring or workflow edges.

## Rubric Agent Output

Introduce a strict result type:

```ts
interface RubricScoringResult {
  summary: {
    overall_assessment: string;
    overall_confidence: ConfidenceLevel;
  };
  item_scores: Array<{
    dimension_name: string;
    item_name: string;
    score: number;
    max_score: number;
    matched_band_score: number;
    rationale: string;
    evidence_used: string[];
    confidence: ConfidenceLevel;
    review_required: boolean;
  }>;
  hard_gate_candidates: Array<{
    gate_id: "G1" | "G2" | "G3" | "G4";
    triggered: boolean;
    reason: string;
    confidence: ConfidenceLevel;
  }>;
  risks: RiskItem[];
  strengths: string[];
  main_issues: string[];
}
```

Validation rules:

- Every rubric item in `rubricSnapshot.dimension_summaries` must appear exactly once.
- `score` must be one of the declared rubric band scores for that item.
- `matched_band_score` must equal `score`.
- `max_score` must equal the item weight.
- Unknown dimensions or items are invalid.
- Missing evidence should set `confidence = low` and `review_required = true`.

## Score Fusion Rules

The score fusion principle is:

```text
final score = rubric base score + rule modifiers
```

Rules must not create an independent second total score.

### Base Score

When `rubricAgentRunStatus === "success"`:

- Sum `rubricScoringResult.item_scores`.
- Aggregate by dimension.
- Use rubric agent rationale and evidence as the initial submetric details.

When rubric scoring fails:

- Fall back to the current deterministic scoring engine.
- Add a human review item indicating the score is a fallback precheck.
- Mark low confidence where appropriate.

### Rule Modifiers

Use `mergedRuleAuditResults` to adjust rubric item scores:

- `must_rule` violation: medium-to-heavy penalty on mapped rubric items.
- `forbidden_pattern` violation: heavy penalty, risk item, possible hard gate.
- `should_rule` violation: light penalty or confidence reduction.
- `case_rule` P0 violation: hard gate candidate and mandatory human review.
- `待人工复核`: no direct severe penalty by default, but lower confidence and add review item.

The existing rule-to-metric mapping can be reused initially, but it should modify rubric agent scores rather than starting from full marks.

### Hard Gates

Hard gate sources:

- Rubric agent hard gate candidates with medium or high confidence.
- Deterministic rule conditions already implemented.
- P0 case rule violations.

Apply the strictest cap among triggered gates.

### Human Review

Add review items when:

- Rubric agent fails or returns invalid output.
- Rule agent fails or returns invalid output.
- Any item confidence is low.
- Any rule result is `待人工复核`.
- Hard gate is triggered.
- The final score falls into configured boundary bands.
- Bug fix or continuation lacks patch context.

## Feature Extraction Removal

Remove `featureExtractionNode` from workflow edges.

Current:

```text
inputClassification -> featureExtraction -> ruleAudit
```

Target:

```text
inputClassification -> rubricPreparation
inputClassification -> ruleAudit
```

Also remove or update:

- `src/workflow/scoreWorkflow.ts` import and node registration.
- `src/workflow/state.ts` required `featureExtraction` annotation if no compatibility need remains.
- `src/scoring/scoringEngine.ts` `featureExtraction` input field.
- `src/nodes/persistAndUploadNode.ts` write of `intermediate/feature-extraction.json`.
- `src/workflow/observability` node labels, node IDs, and summaries for feature extraction.
- README and design docs that list `featureExtractionNode` as an active node.
- Tests that only exist to summarize or pass placeholder feature extraction data.

If preserving backward artifact compatibility matters, write a small compatibility artifact instead:

```json
{
  "status": "removed",
  "reason": "featureExtractionNode was a placeholder and no longer participates in scoring"
}
```

Do not keep this compatibility write in the critical path.

## Persistence Changes

Persist separate agent artifacts:

- `inputs/rubric-scoring-prompt.txt`
- `inputs/rubric-scoring-payload.json`
- `inputs/rule-agent-prompt.txt`
- `inputs/rule-agent-bootstrap-payload.json`
- `intermediate/rubric-agent-result.json`
- `intermediate/rubric-agent-turns.json`
- `intermediate/rubric-agent-tool-trace.json`
- `intermediate/rule-agent-result.json`
- `intermediate/rule-agent-turns.json`
- `intermediate/rule-agent-tool-trace.json`
- `intermediate/rule-audit-merged.json`
- `intermediate/score-fusion.json`

The old `inputs/agent-prompt.txt` can be kept as an alias during transition, but new names should be explicit.

## Testing Strategy

Add or update unit tests for:

- `featureExtractionNode` removed from workflow order.
- Rubric agent output validation accepts complete valid output.
- Rubric agent output validation rejects missing rubric items.
- Rubric agent output validation rejects scores outside declared bands.
- Score fusion uses rubric agent scores as base.
- Score fusion applies `must_rule` and `forbidden_pattern` modifiers.
- Score fusion applies hard gate caps.
- Rubric agent failure falls back to current deterministic scoring.
- Rule agent failure still produces a rubric-based score with review items.
- Both agents failing returns current fallback score with low confidence review markers.

Add integration tests for:

- No assisted rule candidates: rubric scoring still runs and rule branch skips quickly.
- Assisted rule candidates present: rubric and rule branches both contribute to final output.
- Remote task flow still produces `result.json` and `report.html`.

## Migration Plan

1. Introduce rubric scoring types and validation.
2. Add rubric scoring prompt builder and agent node.
3. Split rule prompt naming from generic agent naming.
4. Implement score fusion using rubric scores as base.
5. Rewire workflow into parallel rubric and rule branches.
6. Remove `featureExtractionNode` from workflow edges and scoring inputs.
7. Update persistence artifact names.
8. Update docs and tests.
9. Run build and score test suite.
10. Compare runtime and score output on representative local cases.

## Implementation Defaults

- Do not keep `feature-extraction.json` as a compatibility artifact. The removed node should not continue writing placeholder data.
- Keep existing generic agent state names as aliases for one migration step, but introduce explicit rubric and rule agent artifact names for new outputs.
- Do not extend `report_result_schema.json` in the first implementation. Put agent status and fusion notes into existing report metadata or human review items where necessary.

## Recommendation

Implement the parallel dual-agent workflow and remove `featureExtractionNode` from the required path in the same change set. The current feature extraction output has no scoring value, and keeping it as a dependency would make the new parallel graph more complex without improving results.

Use rubric agent scoring as the primary score source. Use merged rule audit results only as modifiers, hard gate triggers, risks, and human review signals. This matches the intended rubric-first architecture and should reduce scoring latency by overlapping the two model calls.
