# Agent Skill Output Contract Design

Date: 2026-05-06

## Background

The case-review scoring workflow currently uses three opencode agents:

- `hmos-understanding`: extracts task constraints from preprocessed case input.
- `hmos-rubric-scoring`: scores generated HarmonyOS code against rubric items.
- `hmos-rule-assessment`: assesses assisted rule candidates produced by static rule audit.

The current implementation already separates the three agents at the opencode agent level:

- Agent definitions and permissions live in `.opencode/opencode.template.json`.
- System prompts live in `.opencode/prompts/*.md`.
- Runtime config generation and prompt copying live in `src/opencode/opencodeConfig.ts`.
- Agent invocation and file-output protocol live in `src/opencode/opencodeCliRunner.ts`.
- Agent-specific prompt rendering, retry prompt rendering, schema validation, normalization, and coverage checks live in:
  - `src/agent/opencodeTaskUnderstanding.ts`
  - `src/agent/opencodeRubricScoring.ts`
  - `src/agent/opencodeRuleAssessment.ts`
- Workflow nodes call these runners from:
  - `src/nodes/taskUnderstandingNode.ts`
  - `src/nodes/rubricScoringAgentNode.ts`
  - `src/nodes/ruleAssessmentAgentNode.ts`

`AGENT.md` is the current operational reference for this setup. It documents the same three agents, their permissions, the sandbox layout, and the file-output protocol.

## Problem

The output constraints for the three agents are not strong enough during case review. The current prompts already contain strict JSON requirements, and the runner reads final JSON from `metadata/agent-output/*.json` instead of relying on long assistant text. Even so, the code contains retry and repair logic because agents can still occasionally produce invalid or incomplete output.

Observed risk areas in the implementation:

- The same role boundaries and output-contract rules are duplicated across system prompts, per-call prompts, and retry prompts.
- The most important protocol requirements are embedded as prose inside large prompts, making them harder to maintain consistently.
- Retry prompts must restate reduced versions of the contract, increasing the chance that first-run and retry behavior drift.
- `hmos-rubric-scoring` has the highest JSON-shape risk because it emits nested arrays, `deduction_trace`, `risks`, scores, and coverage for every rubric item.
- `hmos-rule-assessment` has rule coverage risk and currently needs local skeleton normalization to fill omitted candidates as `uncertain`.
- `hmos-understanding` is intentionally narrow, but still depends on prompt text to avoid reading business files and to return exactly four arrays.

The requested change is to strengthen the three agents by extracting each agent's responsibilities into a dedicated skill and triggering the corresponding skill at invocation time, so future maintenance changes are made in one place per role.

## Goals

1. Create one skill per agent:
   - `.opencode/skills/hmos-understanding/SKILL.md`
   - `.opencode/skills/hmos-rubric-scoring/SKILL.md`
   - `.opencode/skills/hmos-rule-assessment/SKILL.md`

2. Make each agent invocation explicitly trigger its corresponding skill before task execution.

3. Move role-specific responsibility boundaries, allowed inputs, forbidden behaviors, output schema requirements, and self-check steps into skills.

4. Keep system prompts small and stable:
   - Identify the agent role.
   - Require use of the matching skill.
   - Preserve the file-output protocol.
   - Preserve sandbox and permission boundaries.

5. Keep hard correctness checks in TypeScript:
   - JSON extraction.
   - Zod schema validation.
   - Coverage validation.
   - Score-band normalization.
   - Rule skeleton normalization.
   - Secure output-file path validation.

6. Reduce first-run protocol errors and retry frequency without weakening local validation.

## Non-Goals

- Do not change scoring semantics, rubric weights, rule packs, or score fusion.
- Do not remove retry logic in this change. Retry remains a safety net until production evidence shows it is unnecessary.
- Do not give agents shell, network, LSP, task, question, or external-directory permissions.
- Do not allow agents to write anywhere except `metadata/agent-output/*.json`.
- Do not rely on assistant final text for long JSON payloads.
- Do not move TypeScript schema validation into prompts or skills.

## Current Flow

### Task Understanding

`taskUnderstandingNode` collects project structure, workspace structure, patch summary, case rules, and builds an opencode sandbox. It calls `runOpencodeTaskUnderstanding`, which renders a prompt and invokes agent `hmos-understanding` with output file:

```text
metadata/agent-output/task-understanding.json
```

The runner parses the output as a `ConstraintSummary` containing:

- `explicitConstraints`
- `contextualConstraints`
- `implicitConstraints`
- `classificationHints`

The task-understanding agent is configured with `glob`, `grep`, and `list` denied, so it should only read the prompt file written by the runner.

### Rubric Scoring

`rubricScoringPromptBuilderNode` builds `RubricScoringPayload`. `rubricScoringAgentNode` calls `runOpencodeRubricScoring`, which invokes agent `hmos-rubric-scoring` with output file:

```text
metadata/agent-output/rubric-scoring.json
```

The runner validates:

- top-level schema
- required summary fields
- item score shape
- finite numbers
- boolean-like fields
- hard gate shape
- risk shape
- coverage of every rubric item
- deduction trace on deducted items

It also snaps score values to allowed scoring bands during normalization.

### Rule Assessment

`ruleAgentPromptBuilderNode` builds an `AgentBootstrapPayload`. `ruleAssessmentAgentNode` calls `runOpencodeRuleAssessment`, which invokes agent `hmos-rule-assessment` with output file:

```text
metadata/agent-output/rule-assessment.json
```

The runner validates:

- top-level schema
- decision enum
- confidence enum
- boolean-like `needs_human_review`
- coverage of expected candidate `rule_id`s

It normalizes through the local candidate skeleton, preserving only known candidates and filling omitted ones as `uncertain` with `needs_human_review=true`.

## Recommended Approach

Use dedicated skills as role contracts and keep the agents as permission and runtime shells.

This is the recommended option because it gives each role a maintainable contract file while preserving the current runtime isolation, file-output protocol, and TypeScript validation. It directly addresses the maintenance issue without taking correctness away from code.

### Approach A: Prompt-Only Hardening

Continue strengthening `.opencode/prompts/*.md` and per-call prompt strings.

Pros:

- Smallest implementation change.
- No opencode skill permission or runtime-copy changes.

Cons:

- Keeps duplicating role contracts across prompts and retry prompts.
- Makes long prompts harder to audit.
- Does not satisfy the explicit requirement to extract responsibilities into skills.

### Approach B: Skill-Backed Agents

Create three skills, trigger the matching skill from each system prompt and run prompt, and allow only the matching skill for each agent.

Pros:

- One maintainable contract per role.
- System prompts become thin wrappers.
- Retry prompts can refer back to the same skill contract.
- Local validation remains authoritative.
- Matches the requested direction.

Cons:

- Requires runtime config generation to copy `.opencode/skills`.
- Requires opencode template permission changes.
- Requires tests to assert skill files and skill-trigger instructions.

### Approach C: Agent Split Plus Deterministic JSON Renderer

Keep role reasoning in agents but move final JSON generation into deterministic local code fed by a smaller structured agent result.

Pros:

- Strongest control over final shape.
- Could reduce malformed JSON further.

Cons:

- Larger design change.
- Requires new intermediate schemas per role.
- Risks changing scoring behavior, not just agent contract maintenance.
- Too broad for the current request.

## Design

### Skill Layout

Add project-local opencode skills:

```text
.opencode/skills/
  hmos-understanding/
    SKILL.md
  hmos-rubric-scoring/
    SKILL.md
  hmos-rule-assessment/
    SKILL.md
```

Each `SKILL.md` should contain:

- YAML frontmatter with `name` and `description`.
- Role boundary.
- Allowed input sources.
- Forbidden actions.
- Required output file protocol.
- Exact output JSON contract.
- Coverage requirements.
- Self-check checklist before writing `output_file`.
- Retry behavior, where applicable.

The skill body should be concise and imperative. It should avoid duplicating large input payload descriptions that already live in TypeScript prompt builders.

### Reference Migration Layout

During implementation, migrate only reference material that a skill may need while executing. Do not copy reference files into a skill merely because they are related to the workflow; oversized skill-scoped references encourage agents to read outside the intended evidence path. Do not delete the root `references/` directory in the same change, because existing code and tests still use `DEFAULT_REFERENCE_ROOT=references/scoring`.

Target layout:

```text
.opencode/skills/
  hmos-understanding/
  hmos-rubric-scoring/
  hmos-rule-assessment/
    references/
      rules/
        arkts-language.yaml
        arkts-performance.yaml
```

Reference ownership:

- `hmos-understanding` should not receive business scoring or rule references. Its skill file must state that it uses only the preprocessed prompt payload.
- `hmos-rubric-scoring` should not receive skill-scoped scoring references. Runtime prompt construction already loads and trims `references/scoring/rubric.yaml` into `scoring_payload.rubric_summary`, which is the authoritative source for dimensions, items, scoring bands, hard gates, scoring notes, common risks, and report emphasis. `report_result_schema.json` is enforced by prompts, validators, and tests; it should not be copied into the skill.
- `hmos-rule-assessment` owns only the rule-pack YAML exports from `references/rules`. These files are optional execution references and should be read only when `bootstrap_payload.assisted_rule_candidates` lacks enough rule text or when the original `rule_id` definition must be confirmed. It should not receive `rules_application.md`, because scoring/rubric mapping belongs to score fusion and report generation, not candidate rule decision.

Migration constraints:

- Exclude `.DS_Store` and other local metadata files.
- Preserve file names for the retained rule-pack YAML files.
- Keep root `references/scoring` and `references/rules` until a later implementation step changes `referenceRoot`, sandbox copying, tests, and documentation.
- Update `src/opencode/opencodeConfig.ts` runtime-copy logic to copy skill directories recursively, including any retained `references/`.
- Update tests to assert that unnecessary skill-scoped references are absent, retained rule-pack YAML files are copied, and root references are still available during the transitional phase.

### Skill: `hmos-understanding`

Purpose: extract constraints from preprocessed `agent_input` without inspecting sandbox business files.

Required behavior:

- Read only the prompt file specified by the user message.
- Use only `agent_input` or `constraint_draft`.
- Do not read `generated/`, `original/`, `patch/`, `metadata/metadata.json`, or `references/`.
- Do not call `glob`, `grep`, `list`, shell, network, task, or question tools.
- If information is incomplete, return low-confidence constraints based on provided summaries instead of exploring files.

Output contract:

```json
{
  "explicitConstraints": ["中文短句"],
  "contextualConstraints": ["中文短句"],
  "implicitConstraints": ["中文短句"],
  "classificationHints": ["full_generation"]
}
```

Required self-check:

- Top level has exactly the four contract fields.
- All four fields are arrays.
- Array items are strings.
- No Markdown, prose prefix, code fence, or extra fields.
- Write the JSON object to `metadata/agent-output/task-understanding.json`.
- Final assistant reply is only `{"output_file":"metadata/agent-output/task-understanding.json"}`.

### Skill: `hmos-rubric-scoring`

Purpose: score every rubric item using sandbox evidence and the provided rubric payload.

Required behavior:

- Prioritize `patch/effective.patch`; do not start from a preset target-file list.
- Follow file paths in the patch to read relevant `generated/` or `original/` context only.
- Use `workspace_project_structure` to choose representative files when changed files are large and patch-following evidence is insufficient.
- Cover every `dimension_name + item_name` from `rubric_summary.dimension_summaries`.
- Do not add, omit, or duplicate rubric items.
- Each `score` must be one of the item's declared scoring band scores.
- `matched_band_score` must equal `score`.
- `max_score` must equal the item's weight.
- Full-score items do not need `deduction_trace`.
- Deducted items must include a complete `deduction_trace`.
- Evidence paths must be sandbox-relative.
- When negative evidence is insufficient, keep full score and lower `confidence` or set `review_required=true`.

Output contract:

```json
{
  "summary": {
    "overall_assessment": "中文总体评价",
    "overall_confidence": "high"
  },
  "item_scores": [
    {
      "dimension_name": "维度名",
      "item_name": "评分项名",
      "score": 40,
      "max_score": 40,
      "matched_band_score": 40,
      "rationale": "中文评分依据",
      "evidence_used": ["generated/path/file.ets"],
      "confidence": "high",
      "review_required": false,
      "deduction_trace": {
        "code_locations": ["generated/path/file.ets:12"],
        "impact_scope": "影响范围",
        "rubric_comparison": "未命中更高档，因为...；命中当前档，因为...",
        "deduction_reason": "扣分原因",
        "improvement_suggestion": "最小修复建议"
      }
    }
  ],
  "hard_gate_candidates": [
    {
      "gate_id": "G1",
      "triggered": false,
      "reason": "中文说明",
      "confidence": "high"
    }
  ],
  "risks": [
    {
      "level": "low",
      "title": "风险标题",
      "description": "风险描述",
      "evidence": "证据摘要"
    }
  ],
  "strengths": ["优势"],
  "main_issues": ["主要问题"]
}
```

Required self-check:

- JSON starts with `{` and ends with `}`.
- No Markdown, prose prefix, code fence, or extra fields.
- Every rubric item appears exactly once.
- `risks` is always an array; empty risk list is `[]`.
- Risk objects contain only `level`, `title`, `description`, and `evidence`.
- Deducted items include `deduction_trace.code_locations`, `impact_scope`, `rubric_comparison`, `deduction_reason`, and `improvement_suggestion`.
- Write the JSON object to `metadata/agent-output/rubric-scoring.json`.
- Final assistant reply is only `{"output_file":"metadata/agent-output/rubric-scoring.json"}`.

### Skill: `hmos-rule-assessment`

Purpose: assess only the provided assisted rule candidates.

Required behavior:

- Use only `bootstrap_payload` or retry candidate IDs plus sandbox evidence.
- Prioritize `patch/effective.patch`, then follow patch file paths into relevant `generated/` or `original/` context.
- Read `references/rules/*.yaml` only when the candidate rule text or meaning is insufficient in `bootstrap_payload`, or when the original `rule_id` definition must be confirmed.
- Cover every `assisted_rule_candidates[].rule_id`.
- Do not add, omit, or duplicate `rule_id`.
- Do not assess rules outside the candidate list.
- Use `decision="uncertain"` and `needs_human_review=true` when the evidence is insufficient.
- Evidence paths must be sandbox-relative.

Output contract:

```json
{
  "summary": {
    "assistant_scope": "说明读取范围和判定范围",
    "overall_confidence": "high"
  },
  "rule_assessments": [
    {
      "rule_id": "R1",
      "decision": "pass",
      "confidence": "high",
      "reason": "中文判定依据",
      "evidence_used": ["generated/path/file.ets"],
      "needs_human_review": false
    }
  ]
}
```

Required self-check:

- JSON starts with `{` and ends with `}`.
- No Markdown, prose prefix, code fence, or extra fields.
- `decision` is one of `violation`, `pass`, `not_applicable`, `uncertain`.
- `confidence` and `overall_confidence` are one of `high`, `medium`, `low`.
- `evidence_used` is always a string array.
- Every candidate `rule_id` appears exactly once.
- Write the JSON object to `metadata/agent-output/rule-assessment.json`.
- Final assistant reply is only `{"output_file":"metadata/agent-output/rule-assessment.json"}`.

## Invocation Changes

### System Prompts

Reduce `.opencode/prompts/*.md` to a thin agent wrapper:

- State the role.
- Require invoking the matching skill before doing the task.
- Preserve sandbox and output-file requirements.
- State that the skill contract is authoritative for role behavior and JSON shape.

Example pattern:

```text
你是评分流程中的 rubric 评分 agent。
在执行任何评分前，必须使用 hmos-rubric-scoring skill，并严格遵守该 skill 的职责边界、证据边界、JSON 输出契约和写入 output_file 协议。
只能阅读当前 sandbox 目录内允许的文件；不能运行命令，不能访问网络，不能修改业务文件。
```

The full JSON shape should live in the skill, not in both the system prompt and per-call prompt.

### Per-Call Prompts

Update prompt rendering in the three runner files:

- `renderTaskUnderstandingPrompt`
- `renderRetryTaskUnderstandingPrompt`
- `renderRubricScoringPrompt`
- `renderRubricScoringRetryPrompt`
- `renderRuleAssessmentPrompt`
- `renderRuleAssessmentRetryPrompt`

Each prompt should include an explicit skill trigger line near the top:

```text
执行任务前必须使用 hmos-rubric-scoring skill。该 skill 中的输出契约和自检清单是本次输出的强制要求。
```

Retry prompts should say:

```text
本次是重试。仍必须使用 hmos-rubric-scoring skill，但只修复 listed protocol errors，不重新评分。
```

The prompt should continue to include concrete runtime input payloads and failure-specific guidance generated by TypeScript. The skill owns stable role contract text; TypeScript owns dynamic case data and failure-specific repair instructions.

### Runner Output Protocol

Keep the existing runner behavior in `src/opencode/opencodeCliRunner.ts`:

- Write prompt to `metadata/opencode-prompts/<requestTag>.md`.
- Pass an opencode run message telling the agent to read the prompt file.
- Require writing JSON to `metadata/agent-output/<name>.json`.
- Read final JSON from that file.
- Reject output paths outside `metadata/agent-output/[a-z-]+.json`.
- Remove stale output before each run.

No protocol weakening is allowed.

## Opencode Config Changes

### Skill Permissions

The current template denies `skill` globally and per agent. Change agent-level permissions so each agent may use only its own skill.

Before implementation, verify the exact per-skill permission syntax against the opencode CLI version used in this repository. If the CLI supports object-style permission matching for `skill`, use the target shape below:

```json
{
  "agent": {
    "hmos-understanding": {
      "permission": {
        "skill": {
          "*": "deny",
          "hmos-understanding": "allow"
        }
      }
    },
    "hmos-rubric-scoring": {
      "permission": {
        "skill": {
          "*": "deny",
          "hmos-rubric-scoring": "allow"
        }
      }
    },
    "hmos-rule-assessment": {
      "permission": {
        "skill": {
          "*": "deny",
          "hmos-rule-assessment": "allow"
        }
      }
    }
  },
  "permission": {
    "skill": "deny"
  }
}
```

Keep global `permission.skill` denied so default access remains closed. The agent-level override should be the only path to skill use. If the deployed CLI only supports coarse `skill: "allow" | "deny"` rather than per-skill matching, keep global `skill` denied and either:

- set `skill: "allow"` only on the three scoring agents while relying on explicit prompt-trigger tests and local skill names, or
- postpone permission changes until per-skill matching is available.

The preferred implementation is per-agent, per-skill allowlisting.

### Runtime Skill Copying

Extend `src/opencode/opencodeConfig.ts` so runtime generation copies `.opencode/skills` to both runtime locations:

```text
.opencode/runtime/skills/
.opencode/runtime/xdg-config/opencode/skills/
```

The existing `copyFilesFromDirectory` helper only copies files one level deep and is sufficient for prompts and formatters, but not for skill directories. Add a recursive directory copy helper for `.opencode/skills`.

The runtime copy should be optional-safe:

- If `.opencode/skills` is missing, throw a clear `OpencodeConfigError` once the template references skills.
- If any required `SKILL.md` is missing, throw a clear `OpencodeConfigError`.
- Do not copy `.opencode/runtime`.

## Documentation Changes

Update `AGENT.md` after implementation:

- Add the skills directory to "定义位置".
- Document each skill and which agent is allowed to use it.
- Update permission notes from "skill deny" to "global deny, per-agent allow own skill only".
- Document that role contracts live in `.opencode/skills/*/SKILL.md`.
- Keep the output protocol section unchanged except for noting that prompts must trigger the matching skill.

## Testing Plan

### Config Tests

Update `tests/opencode-config.test.ts`:

- Assert `.opencode/opencode.template.json` defines skill permissions per agent.
- Assert global skill permission remains deny.
- Assert `hmos-understanding` only allows `hmos-understanding`.
- Assert `hmos-rubric-scoring` only allows `hmos-rubric-scoring`.
- Assert `hmos-rule-assessment` only allows `hmos-rule-assessment`.
- Assert every `SKILL.md` contains "文件输出协议", "强制输出格式", and the expected output file.

### Runtime Generation Tests

Update `tests/opencode-config-generation.test.ts`:

- Copy `.opencode/skills` into temp repo fixtures.
- Assert runtime skill files are copied to `.opencode/runtime/skills`.
- Assert runtime XDG skill files are copied to `.opencode/runtime/xdg-config/opencode/skills`.
- Assert missing skill directories or missing `SKILL.md` produce a clear config error.

### Prompt Runner Tests

Update agent tests:

- `tests/opencode-task-understanding.test.ts`
- `tests/opencode-rubric-scoring.test.ts`
- `tests/opencode-rule-assessment.test.ts`

Assert first-run prompts include:

- matching skill name
- "必须使用 ... skill"
- output file path

Assert retry prompts include:

- matching skill name
- "本次是重试"
- "只修复 listed protocol errors" where applicable
- no full payload leakage in retry prompts, preserving existing retry compactness tests

### Existing Validation Tests

Keep existing tests that assert:

- incomplete rubric item coverage is rejected
- replacement rubric fields are rejected
- invalid deduction trace is rejected
- rule coverage is normalized through local skeleton
- stale output files are removed
- missing output files fail
- output path escape is rejected

These local checks remain the final enforcement layer even after skills are introduced.

## Acceptance Criteria

1. Three skill files exist and clearly define each agent's responsibility and output contract.
2. Each system prompt requires using the matching skill.
3. Each first-run and retry prompt explicitly triggers the matching skill.
4. `.opencode/opencode.template.json` keeps global `skill` denied and allows only the matching skill per agent.
5. Runtime config generation copies skill directories into both runtime skill locations.
6. `AGENT.md` documents the new skill-backed architecture.
7. Existing output-file protocol remains unchanged.
8. TypeScript validation and retry behavior remain in place.
9. Relevant tests pass with updated assertions.
10. No agent gains shell, network, task, question, LSP, code-search, or external-directory permission.

## Migration Steps

1. Add the three `.opencode/skills/*/SKILL.md` files.
2. Move stable role contracts and JSON output examples from system prompts into the skills.
3. Rewrite `.opencode/prompts/*.md` as thin wrappers that require the matching skill.
4. Update per-call and retry prompt renderers to include explicit skill trigger lines.
5. Update `.opencode/opencode.template.json` skill permissions.
6. Extend `src/opencode/opencodeConfig.ts` to copy skill directories into runtime config locations.
7. Update `AGENT.md`.
8. Update config, runtime-generation, and agent prompt tests.
9. Run focused tests:

```text
npm test -- tests/opencode-config.test.ts tests/opencode-config-generation.test.ts tests/opencode-task-understanding.test.ts tests/opencode-rubric-scoring.test.ts tests/opencode-rule-assessment.test.ts tests/opencode-cli-runner.test.ts
```

10. Run the full test suite if focused tests pass.

## Rollback Plan

The change is mostly additive and can be rolled back safely:

- Revert `.opencode/skills`.
- Restore `.opencode/prompts/*.md` to the previous full-contract prompts.
- Restore `skill: "deny"` at agent level.
- Remove runtime skill copying.
- Revert tests that assert skill behavior.

The runner output-file protocol and TypeScript validators do not need rollback.

## Implementation Checks

1. Confirm the exact opencode config syntax for per-skill permission matching in the currently deployed opencode CLI version before editing `.opencode/opencode.template.json`.
2. Keep the full JSON skeletons in skills unless verification shows the deployed CLI does not reliably trigger skills from system and run prompts. If that happens, duplicate the skeleton in system prompts as a compatibility fallback.
3. Optionally add lightweight production metrics for retry frequency by agent before and after the change. This is not required for implementation, but it would make the improvement measurable.

## References

- `AGENT.md`
- `.opencode/opencode.template.json`
- `.opencode/prompts/hmos-understanding-system.md`
- `.opencode/prompts/hmos-rubric-scoring-system.md`
- `.opencode/prompts/hmos-rule-assessment-system.md`
- `src/opencode/opencodeConfig.ts`
- `src/opencode/opencodeCliRunner.ts`
- `src/agent/opencodeTaskUnderstanding.ts`
- `src/agent/opencodeRubricScoring.ts`
- `src/agent/opencodeRuleAssessment.ts`
- `src/workflow/scoreWorkflow.ts`
- opencode skill documentation: `https://opencode.ai/docs/skills/`
