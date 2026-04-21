# Case-Aware Agent Protocol Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the scattered, permissive case-aware agent protocol flow with a single strict protocol module, unified runner result semantics, and downstream consumption of canonical per-rule final answers.

**Architecture:** Introduce `src/agent/caseAwareProtocol.ts` as the sole owner of agent action schemas, strict parsing, final-answer completeness validation, and runner result types. Refactor prompt rendering, runner orchestration, merge, persistence, and reporting to consume canonical protocol objects instead of reparsing raw model text or inferring result usability from scattered state fields.

**Tech Stack:** TypeScript, Node.js, Zod, LangGraph state annotations, node:test, tsx, npm scripts

---

## File Map

- Create: `src/agent/caseAwareProtocol.ts`
  Responsibility: Define canonical `tool_call` and `final_answer` schemas, strict parser, final-answer candidate coverage validator, runner outcome/result types, and small formatting helpers for protocol errors.

- Modify: `src/agent/caseAwarePrompt.ts`
  Responsibility: Keep only prompt rendering; remove parser schemas, JSON-fragment scanning, old provider-shape normalization, and executable full JSON examples.

- Modify: `src/agent/caseAwareAgentRunner.ts`
  Responsibility: Use the protocol module for parsing and completeness validation; return one `CaseAwareRunnerResult`; keep the existing tool loop and at most one repair attempt for incomplete final answers.

- Modify: `src/agent/ruleAssistance.ts`
  Responsibility: Remove duplicate final-answer schema and raw text parsing from merge helpers; map canonical `CaseAwareAgentFinalAnswer` to `RuleAuditResult`.

- Modify: `src/nodes/agentAssistedRuleNode.ts`
  Responsibility: Store the canonical runner result in workflow state and keep `skipped` / `not_enabled` as node-level states outside runner outcome.

- Modify: `src/nodes/ruleMergeNode.ts`
  Responsibility: Merge deterministic results with `state.agentRunnerResult.final_answer`; never parse `state.agentRawOutputText`.

- Modify: `src/nodes/persistAndUploadNode.ts`
  Responsibility: Persist `intermediate/agent-runner-result.json`, `intermediate/agent-turns.json`, and `intermediate/agent-tool-trace.json`; stop writing a mixed `status/raw/parsed_result` artifact as the primary agent result.

- Modify: `src/nodes/reportGenerationNode.ts`
  Responsibility: Ensure `rule_audit_results` and case rule results preserve per-rule agent conclusions from canonical final answer through merged results; keep rule YAML out of the report.

- Modify: `src/workflow/state.ts`
  Responsibility: Add `agentRunnerResult`; stop using `agentRawOutputText` and `forcedFinalizeReason` as downstream business inputs.

- Modify: `src/types.ts`
  Responsibility: Export or re-export canonical protocol result types needed by state and nodes without duplicating schema definitions.

- Test: `tests/case-aware-protocol.test.ts`
  Responsibility: Cover strict parsing, old-shape rejection, multiple-object rejection, and final-answer coverage validation.

- Test: `tests/case-aware-agent-runner.test.ts`
  Responsibility: Update runner assertions to the new `outcome`, `final_answer`, `tool_trace`, and `failure_reason` semantics.

- Test: `tests/agent-assisted-rule.test.ts`
  Responsibility: Update merge helper tests to pass canonical final answer objects instead of raw JSON text.

- Test: `tests/score-agent.test.ts`
  Responsibility: Verify persisted agent artifacts use the new runner-result shape and reports keep per-rule agent conclusions without embedding rules YAML.

---

### Task 1: Add Canonical Protocol Module

**Files:**
- Create: `src/agent/caseAwareProtocol.ts`
- Modify: `src/types.ts`
- Create: `tests/case-aware-protocol.test.ts`

- [ ] **Step 1: Write strict parser and validation tests**

Create `tests/case-aware-protocol.test.ts` with:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  parseCaseAwarePlannerOutputStrict,
  validateCaseAwareFinalAnswerAgainstCandidates,
} from "../src/agent/caseAwareProtocol.js";
import type { AssistedRuleCandidate, CaseAwareAgentFinalAnswer } from "../src/types.js";

const candidates: AssistedRuleCandidate[] = [
  {
    rule_id: "HM-REQ-010-01",
    rule_source: "must_rule",
    why_uncertain: "需要确认是否展示当前位置",
    local_preliminary_signal: "unknown",
    evidence_files: ["workspace/entry/src/main/ets/home/HomePage.ets"],
    evidence_snippets: ["Text(this.currentCity)"],
  },
  {
    rule_id: "HM-REQ-010-02",
    rule_source: "must_rule",
    why_uncertain: "需要确认是否调用定位能力",
    local_preliminary_signal: "unknown",
    evidence_files: ["workspace/entry/src/main/ets/home/HomePageVM.ets"],
    evidence_snippets: ["requestLocationPermission()"],
  },
];

test("parseCaseAwarePlannerOutputStrict accepts one canonical tool_call object", () => {
  const parsed = parseCaseAwarePlannerOutputStrict(
    JSON.stringify({
      action: "tool_call",
      tool: "read_file",
      args: { path: "workspace/entry/src/main/ets/home/HomePage.ets" },
      reason: "需要确认页面是否展示当前位置",
    }),
  );

  assert.equal(parsed.action, "tool_call");
  assert.equal(parsed.tool, "read_file");
});

test("parseCaseAwarePlannerOutputStrict accepts one canonical final_answer object", () => {
  const parsed = parseCaseAwarePlannerOutputStrict(
    JSON.stringify({
      action: "final_answer",
      summary: {
        assistant_scope: "本次仅辅助候选规则判定",
        overall_confidence: "medium",
      },
      rule_assessments: [
        {
          rule_id: "HM-REQ-010-01",
          decision: "pass",
          confidence: "high",
          reason: "页面中展示了当前位置。",
          evidence_used: ["workspace/entry/src/main/ets/home/HomePage.ets"],
          needs_human_review: false,
        },
      ],
    }),
  );

  assert.equal(parsed.action, "final_answer");
  assert.equal(parsed.rule_assessments[0]?.rule_id, "HM-REQ-010-01");
});

test("parseCaseAwarePlannerOutputStrict rejects prose around JSON", () => {
  assert.throws(
    () =>
      parseCaseAwarePlannerOutputStrict(
        '好的，下面是结果：{"action":"tool_call","tool":"read_patch","args":{},"reason":"先看补丁"}',
      ),
    /protocol_error/,
  );
});

test("parseCaseAwarePlannerOutputStrict rejects multiple JSON objects", () => {
  assert.throws(
    () =>
      parseCaseAwarePlannerOutputStrict(
        '{"action":"tool_call","tool":"read_patch","args":{},"reason":"先看补丁"}{"action":"tool_call","tool":"read_file","args":{"path":"a"},"reason":"再看文件"}',
      ),
    /protocol_error/,
  );
});

test("parseCaseAwarePlannerOutputStrict rejects unrecognized final_answer fields", () => {
  assert.throws(
    () =>
      parseCaseAwarePlannerOutputStrict(
        JSON.stringify({
          action: "final_answer",
          summary: {
            assistant_scope: "本次仅辅助候选规则判定",
            overall_confidence: "medium",
          },
          rule_assessments: [],
          extra_payload: {},
        }),
      ),
    /protocol_error/,
  );
});

test("validateCaseAwareFinalAnswerAgainstCandidates accepts complete unique coverage", () => {
  const finalAnswer: CaseAwareAgentFinalAnswer = {
    action: "final_answer",
    summary: {
      assistant_scope: "本次仅辅助候选规则判定",
      overall_confidence: "medium",
    },
    rule_assessments: [
      {
        rule_id: "HM-REQ-010-02",
        decision: "violation",
        confidence: "medium",
        reason: "未发现定位调用。",
        evidence_used: ["workspace/entry/src/main/ets/home/HomePageVM.ets"],
        needs_human_review: false,
      },
      {
        rule_id: "HM-REQ-010-01",
        decision: "pass",
        confidence: "high",
        reason: "页面中展示了当前位置。",
        evidence_used: ["workspace/entry/src/main/ets/home/HomePage.ets"],
        needs_human_review: false,
      },
    ],
  };

  assert.deepEqual(validateCaseAwareFinalAnswerAgainstCandidates(finalAnswer, candidates), {
    ok: true,
    missing_rule_ids: [],
    duplicate_rule_ids: [],
    unexpected_rule_ids: [],
  });
});

test("validateCaseAwareFinalAnswerAgainstCandidates reports missing and duplicate rule ids", () => {
  const finalAnswer: CaseAwareAgentFinalAnswer = {
    action: "final_answer",
    summary: {
      assistant_scope: "本次仅辅助候选规则判定",
      overall_confidence: "low",
    },
    rule_assessments: [
      {
        rule_id: "HM-REQ-010-01",
        decision: "uncertain",
        confidence: "low",
        reason: "证据不足。",
        evidence_used: [],
        needs_human_review: true,
      },
      {
        rule_id: "HM-REQ-010-01",
        decision: "uncertain",
        confidence: "low",
        reason: "重复输出。",
        evidence_used: [],
        needs_human_review: true,
      },
    ],
  };

  const validation = validateCaseAwareFinalAnswerAgainstCandidates(finalAnswer, candidates);

  assert.equal(validation.ok, false);
  assert.deepEqual(validation.missing_rule_ids, ["HM-REQ-010-02"]);
  assert.deepEqual(validation.duplicate_rule_ids, ["HM-REQ-010-01"]);
});
```

- [ ] **Step 2: Run the protocol test and verify it fails**

Run:

```bash
npm test -- tests/case-aware-protocol.test.ts
```

Expected: FAIL because `src/agent/caseAwareProtocol.ts` does not exist.

- [ ] **Step 3: Add runner result types to `src/types.ts`**

Add these exports near the existing agent types:

```ts
export type CaseAwareRunnerOutcome =
  | "success"
  | "request_failed"
  | "protocol_error"
  | "tool_budget_exhausted";

export interface CaseAwareRunnerResult {
  outcome: CaseAwareRunnerOutcome;
  final_answer?: CaseAwareAgentFinalAnswer;
  final_answer_raw_text?: string;
  failure_reason?: string;
  turns: CaseAwareAgentTurn[];
  tool_trace: CaseToolTraceItem[];
}

export interface CaseAwareFinalAnswerValidation {
  ok: boolean;
  missing_rule_ids: string[];
  duplicate_rule_ids: string[];
  unexpected_rule_ids: string[];
}
```

- [ ] **Step 4: Create `src/agent/caseAwareProtocol.ts`**

Implement the canonical protocol module:

```ts
import { z } from "zod";
import { caseToolNameSchema } from "./caseToolSchemas.js";
import type {
  AssistedRuleCandidate,
  CaseAwareAgentFinalAnswer,
  CaseAwareAgentPlannerOutput,
  CaseAwareFinalAnswerValidation,
} from "../types.js";

export class CaseAwareProtocolError extends Error {
  constructor(message: string) {
    super(`protocol_error: ${message}`);
    this.name = "CaseAwareProtocolError";
  }
}

export const caseAwareFinalAnswerSchema = z
  .object({
    action: z.literal("final_answer"),
    summary: z
      .object({
        assistant_scope: z.string().min(1),
        overall_confidence: z.enum(["high", "medium", "low"]),
      })
      .strict(),
    rule_assessments: z
      .array(
        z
          .object({
            rule_id: z.string().min(1),
            decision: z.enum(["violation", "pass", "not_applicable", "uncertain"]),
            confidence: z.enum(["high", "medium", "low"]),
            reason: z.string().min(1),
            evidence_used: z.array(z.string()),
            needs_human_review: z.boolean(),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

export const caseAwareToolCallSchema = z
  .object({
    action: z.literal("tool_call"),
    tool: caseToolNameSchema,
    args: z.record(z.string(), z.unknown()),
    reason: z.string(),
  })
  .strict();

export const caseAwarePlannerOutputSchema = z.union([
  caseAwareToolCallSchema,
  caseAwareFinalAnswerSchema,
]);

export function parseCaseAwarePlannerOutputStrict(rawText: string): CaseAwareAgentPlannerOutput {
  const trimmed = rawText.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    throw new CaseAwareProtocolError("output must be one top-level JSON object without prose");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new CaseAwareProtocolError(`invalid JSON: ${message}`);
  }

  const result = caseAwarePlannerOutputSchema.safeParse(parsed);
  if (!result.success) {
    throw new CaseAwareProtocolError(z.prettifyError(result.error));
  }
  return result.data;
}

export function validateCaseAwareFinalAnswerAgainstCandidates(
  finalAnswer: CaseAwareAgentFinalAnswer,
  candidates: AssistedRuleCandidate[],
): CaseAwareFinalAnswerValidation {
  const expectedRuleIds = candidates.map((candidate) => candidate.rule_id);
  const expected = new Set(expectedRuleIds);
  const seen = new Set<string>();
  const duplicate = new Set<string>();
  const unexpected = new Set<string>();

  for (const assessment of finalAnswer.rule_assessments) {
    if (seen.has(assessment.rule_id)) {
      duplicate.add(assessment.rule_id);
    }
    seen.add(assessment.rule_id);
    if (!expected.has(assessment.rule_id)) {
      unexpected.add(assessment.rule_id);
    }
  }

  const missingRuleIds = expectedRuleIds.filter((ruleId) => !seen.has(ruleId));
  const duplicateRuleIds = finalAnswer.rule_assessments
    .map((assessment) => assessment.rule_id)
    .filter((ruleId, index, all) => all.indexOf(ruleId) !== index)
    .filter((ruleId, index, all) => all.indexOf(ruleId) === index);
  const unexpectedRuleIds = Array.from(unexpected);

  return {
    ok:
      missingRuleIds.length === 0 &&
      duplicateRuleIds.length === 0 &&
      unexpectedRuleIds.length === 0,
    missing_rule_ids: missingRuleIds,
    duplicate_rule_ids: duplicateRuleIds,
    unexpected_rule_ids: unexpectedRuleIds,
  };
}

export function describeFinalAnswerValidationFailure(
  validation: CaseAwareFinalAnswerValidation,
): string {
  const parts = [
    validation.missing_rule_ids.length > 0
      ? `missing=${validation.missing_rule_ids.join(",")}`
      : "",
    validation.duplicate_rule_ids.length > 0
      ? `duplicate=${validation.duplicate_rule_ids.join(",")}`
      : "",
    validation.unexpected_rule_ids.length > 0
      ? `unexpected=${validation.unexpected_rule_ids.join(",")}`
      : "",
  ].filter(Boolean);
  return parts.join("; ") || "unknown final_answer validation failure";
}
```

- [ ] **Step 5: Run the protocol test and verify it passes**

Run:

```bash
npm test -- tests/case-aware-protocol.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 1**

Run:

```bash
git add src/agent/caseAwareProtocol.ts src/types.ts tests/case-aware-protocol.test.ts
git commit -m "feat: add strict case-aware agent protocol"
```

Expected: commit succeeds.

---

### Task 2: Remove Parser Logic From Prompt Rendering

**Files:**
- Modify: `src/agent/caseAwarePrompt.ts`
- Modify: `tests/case-aware-agent-runner.test.ts`
- Modify: `tests/agent-assisted-rule.test.ts`

- [ ] **Step 1: Add tests that enforce prompt/parser separation**

In `tests/case-aware-agent-runner.test.ts`, replace the parser import from `caseAwarePrompt.ts` with `caseAwareProtocol.ts`:

```ts
import { parseCaseAwarePlannerOutputStrict } from "../src/agent/caseAwareProtocol.js";
import { renderCaseAwareBootstrapPrompt } from "../src/agent/caseAwarePrompt.js";
```

Add this test:

```ts
test("bootstrap prompt avoids full executable JSON examples that can be parsed as actions", () => {
  const prompt = renderCaseAwareBootstrapPrompt(sampleBootstrapPayload);

  assert.doesNotMatch(prompt, /合法 tool_call 示例/);
  assert.doesNotMatch(prompt, /合法 final_answer 示例/);
  assert.doesNotMatch(prompt, /"action": "tool_call"/);
  assert.doesNotMatch(prompt, /"action": "final_answer"/);
  assert.match(prompt, /只输出一个 JSON object/);
  assert.match(prompt, /rule_assessments 必须逐条覆盖/);
});
```

Add this parser import smoke test:

```ts
test("strict parser is owned by caseAwareProtocol", () => {
  const parsed = parseCaseAwarePlannerOutputStrict(
    JSON.stringify({
      action: "tool_call",
      tool: "read_patch",
      args: {},
      reason: "先看补丁",
    }),
  );

  assert.equal(parsed.action, "tool_call");
});
```

- [ ] **Step 2: Run targeted tests and verify they fail**

Run:

```bash
npm test -- tests/case-aware-agent-runner.test.ts tests/agent-assisted-rule.test.ts
```

Expected: FAIL because `caseAwarePrompt.ts` still exports parser logic and still contains full JSON examples.

- [ ] **Step 3: Delete parser and compatibility code from `src/agent/caseAwarePrompt.ts`**

Remove these elements from `src/agent/caseAwarePrompt.ts`:

```ts
import { z } from "zod";
import { caseToolNameSchema } from "./caseToolSchemas.js";
const finalAnswerSchema = ...
const toolCallSchema = ...
const plannerOutputSchema = ...
type NestedModelFinalAnswer = ...
function extractJsonObjectFrom(...)
function extractJsonObjectCandidates(...)
function normalizePlannerOutput(...)
export function parseCaseAwarePlannerOutput(...)
function inferOverallConfidence(...)
function normalizeRuleAssessments(...)
```

Keep only prompt rendering exports:

```ts
import type { AgentBootstrapPayload } from "../types.js";
import { renderAgentBootstrapPrompt } from "./ruleAssistance.js";

export function renderCaseAwareBootstrapPrompt(payload: AgentBootstrapPayload): string {
  return renderAgentBootstrapPrompt(payload);
}

export function renderCaseAwareFollowupPrompt(input: {
  bootstrapPayload: AgentBootstrapPayload;
  turn: number;
  latestObservation: string;
}): string {
  return [
    "你正在继续同一个 case-aware 辅助判定任务。",
    "下面是最近一次工具调用返回的结果，请结合已有上下文继续决定下一步。",
    "如果证据已经足够，请直接输出 final_answer。",
    "如果你准备输出 final_answer，必须补齐每一条候选规则的 rule_assessments，不能只给总体判断。",
    "如果还需要补查，请继续输出 tool_call，但必须控制在剩余预算内。",
    `当前回合: ${input.turn}`,
    "最近一次工具观察结果：",
    input.latestObservation,
    "",
    "原始 bootstrap 载荷如下：",
    JSON.stringify(input.bootstrapPayload, null, 2),
  ].join("\n");
}
```

- [ ] **Step 4: Replace full JSON examples in `renderAgentBootstrapPrompt`**

In `src/agent/ruleAssistance.ts`, replace the section that appends `"合法 tool_call 示例："` and `"合法 final_answer 示例："` with a compact textual contract:

```ts
"输出结构约束：",
"tool_call 必须包含 action=tool_call、tool、args、reason。",
"final_answer 必须包含 action=final_answer、summary、rule_assessments。",
"summary 必须包含 assistant_scope 与 overall_confidence。",
"每条 assessment 必须包含 rule_id、decision、confidence、reason、evidence_used、needs_human_review。",
"不要输出示例 JSON，不要输出 markdown，不要输出额外解释。",
```

- [ ] **Step 5: Keep repair prompt canonical but non-example-heavy**

In `renderCaseAwareRepairPrompt`, replace the full `JSON.stringify(...)` sample with field-level requirements:

```ts
"请直接输出一个完整 JSON object，字段要求如下：",
"顶层 action 必须为 final_answer。",
"summary.assistant_scope 使用中文说明本次辅助范围。",
"summary.overall_confidence 只能为 high、medium、low。",
"rule_assessments 必须覆盖下方全部 rule_id，每条包含 rule_id、decision、confidence、reason、evidence_used、needs_human_review。",
"如果某条规则证据不足，decision 使用 uncertain，needs_human_review 使用 true。",
```

- [ ] **Step 6: Run targeted tests and verify they pass**

Run:

```bash
npm test -- tests/case-aware-agent-runner.test.ts tests/agent-assisted-rule.test.ts tests/case-aware-protocol.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit Task 2**

Run:

```bash
git add src/agent/caseAwarePrompt.ts src/agent/ruleAssistance.ts tests/case-aware-agent-runner.test.ts tests/agent-assisted-rule.test.ts
git commit -m "refactor: separate prompt rendering from agent protocol parsing"
```

Expected: commit succeeds.

---

### Task 3: Refactor Runner To Return One Structured Result

**Files:**
- Modify: `src/agent/caseAwareAgentRunner.ts`
- Modify: `src/nodes/agentAssistedRuleNode.ts`
- Modify: `src/workflow/state.ts`
- Modify: `tests/case-aware-agent-runner.test.ts`

- [ ] **Step 1: Update runner tests to new result semantics**

In `tests/case-aware-agent-runner.test.ts`, update assertions:

```ts
assert.equal(result.outcome, "success");
assert.equal(result.turns.length, 2);
assert.equal(result.tool_trace.length, 1);
assert.equal(result.final_answer?.action, "final_answer");
assert.equal(result.final_answer_raw_text, JSON.stringify(result.final_answer, null, 2));
```

Replace the old invalid-output test with:

```ts
test("case-aware runner returns protocol_error for invalid model output", async () => {
  const result = await runCaseAwareAgent({
    caseRoot: "/tmp/case-root",
    bootstrapPayload: sampleBootstrapPayload,
    completeJsonPrompt: async () => "not-json",
  });

  assert.equal(result.outcome, "protocol_error");
  assert.equal(result.final_answer, undefined);
  assert.match(result.failure_reason ?? "", /protocol_error/);
});
```

Replace the old nested compatibility test with:

```ts
test("case-aware runner rejects unrecognized final_answer fields", async () => {
  const result = await runCaseAwareAgent({
    caseRoot: "/tmp/case-root",
    bootstrapPayload: sampleBootstrapPayload,
    completeJsonPrompt: async () =>
      JSON.stringify({
        action: "final_answer",
        summary: {
          assistant_scope: "本次仅辅助候选规则判定",
          overall_confidence: "high",
        },
        rule_assessments: [],
        extra_payload: {
          confidence: "high",
          summary: "证据已足够",
          rule_results: [{ rule_id: "HM-REQ-010-03", result: "fail" }],
        },
      }),
  });

  assert.equal(result.outcome, "protocol_error");
  assert.equal(result.final_answer, undefined);
});
```

Update incomplete final-answer test assertions:

```ts
assert.equal(result.outcome, "success");
assert.equal(result.turns.length, 2);
assert.equal(result.turns[0]?.action, "final_answer");
assert.equal(result.turns[0]?.status, "error");
assert.equal(result.final_answer?.rule_assessments.length, 2);
```

- [ ] **Step 2: Run runner tests and verify they fail**

Run:

```bash
npm test -- tests/case-aware-agent-runner.test.ts
```

Expected: FAIL because `runCaseAwareAgent` still returns `status`, `finalAnswer`, and `toolTrace`.

- [ ] **Step 3: Refactor runner imports and return type**

In `src/agent/caseAwareAgentRunner.ts`, replace parser import:

```ts
import {
  describeFinalAnswerValidationFailure,
  parseCaseAwarePlannerOutputStrict,
  validateCaseAwareFinalAnswerAgainstCandidates,
} from "./caseAwareProtocol.js";
```

Change function return type to:

```ts
}): Promise<CaseAwareRunnerResult> {
```

Use these internal variables:

```ts
let outcome: CaseAwareRunnerResult["outcome"] | undefined;
let failureReason: string | undefined;
let finalAnswerRawText: string | undefined;
let finalAnswer: CaseAwareAgentFinalAnswer | undefined;
```

- [ ] **Step 4: Refactor parse failure and request failure paths**

Use:

```ts
try {
  rawText = await input.completeJsonPrompt(prompt);
} catch (error) {
  outcome = "request_failed";
  failureReason = error instanceof Error ? error.message : String(error);
  await input.logger?.error(`case-aware 模型调用失败 turn=${turn} error=${failureReason}`);
  break;
}

let decision;
try {
  decision = parseCaseAwarePlannerOutputStrict(rawText);
} catch (error) {
  outcome = "protocol_error";
  failureReason = error instanceof Error ? error.message : String(error);
  await input.logger?.warn(`case-aware 输出违反协议 turn=${turn} error=${failureReason}`);
  break;
}
```

- [ ] **Step 5: Move final-answer completeness through protocol validation**

Replace `findMissingCandidateRuleIds(...)` usage with:

```ts
const validation = validateCaseAwareFinalAnswerAgainstCandidates(
  decision,
  input.bootstrapPayload.assisted_rule_candidates,
);

if (!validation.ok) {
  finalAnswerRawText = JSON.stringify(decision, null, 2);
  turns.push({
    turn,
    action: "final_answer",
    status: "error",
    raw_output_text: rawText,
  });
  latestObservation = JSON.stringify(
    {
      validation_error: "incomplete_final_answer",
      message: "final_answer 必须补齐每一条候选规则的结论，不能只输出总体判断或部分 rule_assessments。",
      missing_rule_ids: validation.missing_rule_ids,
      duplicate_rule_ids: validation.duplicate_rule_ids,
      unexpected_rule_ids: validation.unexpected_rule_ids,
      received_rule_ids: decision.rule_assessments.map((item) => item.rule_id),
    },
    null,
    2,
  );
  repairPrompt = renderCaseAwareRepairPrompt({
    bootstrapPayload: input.bootstrapPayload,
    turn: turn + 1,
    missingRuleIds: validation.missing_rule_ids,
    receivedRuleIds: decision.rule_assessments.map((item) => item.rule_id),
    latestObservation,
  });
  if (turn >= maxTurns) {
    outcome = "protocol_error";
    failureReason = describeFinalAnswerValidationFailure(validation);
    break;
  }
  continue;
}
```

- [ ] **Step 6: Return canonical success result**

On success:

```ts
finalAnswer = decision;
finalAnswerRawText = JSON.stringify(decision, null, 2);
outcome = "success";
turns.push({
  turn,
  action: "final_answer",
  status: "success",
  raw_output_text: rawText,
});
break;
```

At function end:

```ts
return {
  outcome: outcome ?? "protocol_error",
  final_answer: finalAnswer,
  final_answer_raw_text: finalAnswerRawText,
  failure_reason: failureReason,
  turns,
  tool_trace: toolTrace,
};
```

Remove the local `findMissingCandidateRuleIds` helper after this refactor.

- [ ] **Step 7: Map tool budget failures to `tool_budget_exhausted`**

When tool execution returns budget errors, set:

```ts
outcome = "tool_budget_exhausted";
failureReason = toolResult.error.code;
break;
```

For graph routing returning no executor step, set:

```ts
outcome = "tool_budget_exhausted";
failureReason = "tool_budget_exceeded";
break;
```

- [ ] **Step 8: Add runner result state**

In `src/workflow/state.ts`, import `CaseAwareRunnerResult` and add:

```ts
agentRunnerResult: Annotation<CaseAwareRunnerResult>(),
```

Keep `agentTurns` and `agentToolTrace`. Do not use `agentRawOutputText` and `forcedFinalizeReason` in new downstream logic.

- [ ] **Step 9: Update `agentAssistedRuleNode`**

For no candidates:

```ts
return {
  agentRunnerMode: "case_aware",
  agentRunStatus: "not_enabled",
  agentRunnerResult: undefined,
  agentTurns: [],
  agentToolTrace: [],
};
```

For no client:

```ts
return {
  agentRunnerMode: "case_aware",
  agentRunStatus: "skipped",
  agentRunnerResult: undefined,
  agentTurns: [],
  agentToolTrace: [],
};
```

For runner success:

```ts
const agentRunStatus = runnerResult.final_answer ? "success" : "invalid_output";
return {
  agentRunnerMode: "case_aware",
  agentRunStatus,
  agentRunnerResult: runnerResult,
  agentAssistedRuleResults: runnerResult.final_answer,
  agentTurns: runnerResult.turns,
  agentToolTrace: runnerResult.tool_trace,
};
```

For caught exceptions:

```ts
return {
  agentRunnerMode: "case_aware",
  agentRunStatus: "failed",
  agentRunnerResult: {
    outcome: "request_failed",
    failure_reason: message,
    turns: [],
    tool_trace: [],
  },
  agentTurns: [],
  agentToolTrace: [],
};
```

- [ ] **Step 10: Run runner tests and build**

Run:

```bash
npm test -- tests/case-aware-agent-runner.test.ts
npm run build
```

Expected: both PASS.

- [ ] **Step 11: Commit Task 3**

Run:

```bash
git add src/agent/caseAwareAgentRunner.ts src/nodes/agentAssistedRuleNode.ts src/workflow/state.ts src/types.ts tests/case-aware-agent-runner.test.ts
git commit -m "refactor: unify case-aware runner result semantics"
```

Expected: commit succeeds.

---

### Task 4: Make Merge, Report, and Persist Consume Canonical Results

**Files:**
- Modify: `src/agent/ruleAssistance.ts`
- Modify: `src/nodes/ruleMergeNode.ts`
- Modify: `src/nodes/persistAndUploadNode.ts`
- Modify: `src/nodes/reportGenerationNode.ts`
- Modify: `tests/agent-assisted-rule.test.ts`
- Modify: `tests/score-agent.test.ts`

- [ ] **Step 1: Update merge tests to pass canonical final answers**

In `tests/agent-assisted-rule.test.ts`, replace `agentOutputText` with `agentFinalAnswer`:

```ts
test("mergeRuleAuditResults maps not_applicable assessments to 不涉及", () => {
  const merged = mergeRuleAuditResults({
    deterministicRuleResults: [],
    assistedRuleCandidates: [
      {
        rule_id: "ARKTS-SHOULD-003",
        rule_source: "should_rule",
        why_uncertain: "需要语义判断",
        local_preliminary_signal: "unknown",
        evidence_files: ["entry/src/main/ets/pages/Index.ets"],
        evidence_snippets: ["let ready = false;"],
      },
    ],
    agentFinalAnswer: {
      action: "final_answer",
      summary: {
        assistant_scope: "本次仅辅助弱规则判定",
        overall_confidence: "high",
      },
      rule_assessments: [
        {
          rule_id: "ARKTS-SHOULD-003",
          decision: "not_applicable",
          confidence: "high",
          reason: "未看到相关实现证据，当前不涉及。",
          evidence_used: [],
          needs_human_review: false,
        },
      ],
    },
  });

  assert.equal(merged.agentRunStatus, "success");
  assert.equal(merged.mergedRuleAuditResults[0]?.result, "不涉及");
  assert.equal(merged.mergedRuleAuditResults[0]?.conclusion, "未看到相关实现证据，当前不涉及。");
});
```

Add a per-rule preservation test:

```ts
test("mergeRuleAuditResults preserves per-rule agent judgement details", () => {
  const merged = mergeRuleAuditResults({
    deterministicRuleResults: [],
    assistedRuleCandidates: [
      {
        rule_id: "HM-REQ-010-02",
        rule_summary: "需要调用定位能力刷新本地资讯",
        rule_source: "must_rule",
        why_uncertain: "需要语义判断",
        local_preliminary_signal: "unknown",
        evidence_files: ["workspace/entry/src/main/ets/home/HomePageVM.ets"],
        evidence_snippets: ["requestLocationPermission()"],
      },
    ],
    agentFinalAnswer: {
      action: "final_answer",
      summary: {
        assistant_scope: "本次仅辅助候选规则判定",
        overall_confidence: "medium",
      },
      rule_assessments: [
        {
          rule_id: "HM-REQ-010-02",
          decision: "violation",
          confidence: "medium",
          reason: "未发现 Location Kit 调用。",
          evidence_used: ["workspace/entry/src/main/ets/home/HomePageVM.ets"],
          needs_human_review: false,
        },
      ],
    },
  });

  assert.equal(merged.agentAssistedRuleResults?.rule_assessments[0]?.reason, "未发现 Location Kit 调用。");
  assert.equal(merged.mergedRuleAuditResults[0]?.result, "不满足");
  assert.match(merged.mergedRuleAuditResults[0]?.conclusion ?? "", /未发现 Location Kit 调用/);
});
```

- [ ] **Step 2: Run merge tests and verify they fail**

Run:

```bash
npm test -- tests/agent-assisted-rule.test.ts
```

Expected: FAIL because `mergeRuleAuditResults` still requires `agentOutputText`.

- [ ] **Step 3: Refactor `mergeRuleAuditResults` input**

In `src/agent/ruleAssistance.ts`, replace:

```ts
type MergeRuleAuditResultsInput = {
  deterministicRuleResults: RuleAuditResult[];
  assistedRuleCandidates: AssistedRuleCandidate[];
  agentOutputText: string;
};
```

with:

```ts
type MergeRuleAuditResultsInput = {
  deterministicRuleResults: RuleAuditResult[];
  assistedRuleCandidates: AssistedRuleCandidate[];
  agentFinalAnswer?: CaseAwareAgentFinalAnswer;
};
```

Remove the local `agentResponseSchema` and `JSON.parse(agentOutputText)` logic.

- [ ] **Step 4: Implement canonical merge fallback**

Use:

```ts
export function mergeRuleAuditResults(input: MergeRuleAuditResultsInput): MergeRuleAuditResultsOutput {
  const agentResult = input.agentFinalAnswer;
  if (!agentResult) {
    return {
      agentRunStatus: "invalid_output",
      agentAssistedRuleResults: null,
      mergedRuleAuditResults: [
        ...input.deterministicRuleResults,
        ...input.assistedRuleCandidates.map((candidate) => ({
          rule_id: candidate.rule_id,
          rule_summary: candidate.rule_summary ?? candidate.rule_name,
          rule_source: candidate.rule_source,
          result: "待人工复核" as const,
          conclusion: `Agent 未产出有效判定，候选规则 ${candidate.rule_id} 已回退为待人工复核。`,
        })),
      ],
    };
  }

  const assessmentByRuleId = new Map(
    agentResult.rule_assessments.map((assessment) => [assessment.rule_id, assessment]),
  );

  return {
    agentRunStatus: "success",
    agentAssistedRuleResults: {
      summary: agentResult.summary,
      rule_assessments: agentResult.rule_assessments,
    },
    mergedRuleAuditResults: [
      ...input.deterministicRuleResults,
      ...input.assistedRuleCandidates.map((candidate) => {
        const assessment = assessmentByRuleId.get(candidate.rule_id);
        if (!assessment) {
          return {
            rule_id: candidate.rule_id,
            rule_summary: candidate.rule_summary ?? candidate.rule_name,
            rule_source: candidate.rule_source,
            result: "待人工复核" as const,
            conclusion: `Agent 未提供规则 ${candidate.rule_id} 的分条判定，已回退为待人工复核。`,
          };
        }

        return {
          rule_id: candidate.rule_id,
          rule_summary: candidate.rule_summary ?? candidate.rule_name,
          rule_source: candidate.rule_source,
          result: mapAgentDecisionToRuleResult(assessment.decision),
          conclusion: assessment.reason,
        };
      }),
    ],
  };
}
```

Keep or add:

```ts
function mapAgentDecisionToRuleResult(
  decision: "violation" | "pass" | "not_applicable" | "uncertain",
): RuleAuditResult["result"] {
  switch (decision) {
    case "violation":
      return "不满足";
    case "pass":
      return "满足";
    case "not_applicable":
      return "不涉及";
    case "uncertain":
      return "待人工复核";
  }
}
```

- [ ] **Step 5: Refactor `ruleMergeNode`**

Replace raw-output gating with:

```ts
const finalAnswer = state.agentRunnerResult?.final_answer;
if (state.agentRunStatus === "skipped" || state.agentRunStatus === "not_enabled") {
  ...
}

const merged = mergeRuleAuditResults({
  deterministicRuleResults: state.deterministicRuleResults ?? [],
  assistedRuleCandidates: state.assistedRuleCandidates ?? [],
  agentFinalAnswer: finalAnswer,
});
```

Set:

```ts
agentRunStatus: finalAnswer ? "success" : (state.agentRunStatus ?? merged.agentRunStatus),
agentAssistedRuleResults: merged.agentAssistedRuleResults ?? undefined,
mergedRuleAuditResults: merged.mergedRuleAuditResults,
```

- [ ] **Step 6: Refactor persistence artifacts**

In `src/nodes/persistAndUploadNode.ts`, replace `intermediate/agent-assisted-rule-result.json` payload with:

```ts
await deps.artifactStore.writeJson(
  state.caseDir,
  "intermediate/agent-runner-result.json",
  state.agentRunnerResult ?? {
    outcome:
      state.agentRunStatus === "skipped" || state.agentRunStatus === "not_enabled"
        ? state.agentRunStatus
        : "protocol_error",
    turns: state.agentTurns ?? [],
    tool_trace: state.agentToolTrace ?? [],
  },
);
```

Keep:

```ts
await deps.artifactStore.writeJson(
  state.caseDir,
  "intermediate/agent-turns.json",
  state.agentTurns ?? [],
);
await deps.artifactStore.writeJson(
  state.caseDir,
  "intermediate/agent-tool-trace.json",
  state.agentToolTrace ?? [],
);
```

Do not write rules YAML content into `result.json` or `report.html`.

- [ ] **Step 7: Ensure report consumes merged per-rule conclusions**

In `src/nodes/reportGenerationNode.ts`, keep `rule_audit_results` based on `effectiveRuleAuditResultsWithSummary`. Add no YAML fields. If a test needs explicit evidence, verify:

```ts
assert.equal(
  (resultJson.rule_audit_results as Array<{ rule_id: string; conclusion: string }>).find(
    (item) => item.rule_id === "HM-REQ-010-02",
  )?.conclusion,
  "未发现 Location Kit 调用。",
);
assert.equal(JSON.stringify(resultJson).includes("must_rules:"), false);
```

- [ ] **Step 8: Update score workflow regression test**

In `tests/score-agent.test.ts`, add assertions against persisted paths:

```ts
assert.equal(writtenJsonPaths.includes("intermediate/agent-runner-result.json"), true);
assert.equal(writtenJsonPaths.includes("intermediate/agent-turns.json"), true);
assert.equal(writtenJsonPaths.includes("intermediate/agent-tool-trace.json"), true);
assert.equal(writtenJsonPaths.includes("intermediate/agent-assisted-rule-result.json"), false);
```

If the test uses an in-memory artifact store, derive `writtenJsonPaths` from the store's captured writes:

```ts
const writtenJsonPaths = artifactStore.jsonWrites.map((write) => write.relativePath);
```

- [ ] **Step 9: Run targeted tests**

Run:

```bash
npm test -- tests/agent-assisted-rule.test.ts tests/score-agent.test.ts
```

Expected: PASS.

- [ ] **Step 10: Commit Task 4**

Run:

```bash
git add src/agent/ruleAssistance.ts src/nodes/ruleMergeNode.ts src/nodes/persistAndUploadNode.ts src/nodes/reportGenerationNode.ts tests/agent-assisted-rule.test.ts tests/score-agent.test.ts
git commit -m "refactor: consume canonical agent final answers downstream"
```

Expected: commit succeeds.

---

### Task 5: Remove Legacy State Usage and Run Full Verification

**Files:**
- Modify: `src/workflow/state.ts`
- Modify: `src/workflow/observability/nodeSummaries.ts`
- Modify: any files found by legacy state search
- Test: all existing tests

- [ ] **Step 1: Search for legacy raw-output business usage**

Run:

```bash
rg -n "agentRawOutputText|forcedFinalizeReason|finalAnswerRawText|finalAnswer|toolTrace|agentOutputText|parseCaseAwarePlannerOutput" src tests
```

Expected:

- `agentRawOutputText` and `forcedFinalizeReason` should not appear in downstream merge/report/persist business logic.
- `finalAnswerRawText`, `finalAnswer`, `toolTrace`, and `agentOutputText` should not appear as old runner API names.
- `parseCaseAwarePlannerOutput` should not appear; only `parseCaseAwarePlannerOutputStrict` should be used.

- [ ] **Step 2: Remove or update remaining legacy references**

Use these replacements:

```ts
runnerResult.finalAnswer -> runnerResult.final_answer
runnerResult.finalAnswerRawText -> runnerResult.final_answer_raw_text
runnerResult.toolTrace -> runnerResult.tool_trace
runnerResult.status -> runnerResult.outcome
agentOutputText -> agentFinalAnswer
parseCaseAwarePlannerOutput -> parseCaseAwarePlannerOutputStrict
```

If `src/workflow/observability/nodeSummaries.ts` summarizes agent status, make it read:

```ts
const agentOutcome = state.agentRunnerResult?.outcome ?? state.agentRunStatus ?? "not_enabled";
```

- [ ] **Step 3: Run formatting check**

Run:

```bash
npm run format:check
```

Expected: PASS. If it fails only because touched files need formatting, run:

```bash
npm run format
```

Then re-run:

```bash
npm run format:check
```

- [ ] **Step 4: Run full test suite**

Run:

```bash
npm test
```

Expected: PASS with all node:test files passing.

- [ ] **Step 5: Run build**

Run:

```bash
npm run build
```

Expected: PASS with TypeScript compilation exit code 0.

- [ ] **Step 6: Run lint**

Run:

```bash
npm run lint
```

Expected: PASS with no ESLint errors.

- [ ] **Step 7: Run one scoring smoke test if fixtures are available**

Run the same scoring command used by current project smoke tests. If the existing test fixture command is in `tests/score-agent.test.ts`, use that command. If no standalone fixture command exists, run:

```bash
npm test -- tests/score-agent.test.ts
```

Expected:

- scoring workflow completes
- `intermediate/agent-runner-result.json` is written
- report/result JSON retain per-rule agent conclusions when a canonical `final_answer` exists
- report/result JSON do not include rules YAML contents from `references/rules/`

- [ ] **Step 8: Commit Task 5**

Run:

```bash
git status --short
git add src tests
git commit -m "chore: verify case-aware protocol hardening"
```

Expected: commit succeeds if there are remaining cleanup changes. If `git status --short` is empty, do not create an empty commit.

---

## Self-Review Checklist

- [ ] Spec goal 1 covered: `src/agent/caseAwareProtocol.ts` becomes the single protocol owner.
- [ ] Spec goal 2 covered: parser accepts only one top-level JSON object and rejects prose, multiple objects, and legacy shapes.
- [ ] Spec goal 3 covered: runner returns `CaseAwareRunnerResult` with `outcome`, optional `final_answer`, turns, and tool trace.
- [ ] Spec goal 4 covered: final answer coverage validation requires every candidate rule and downstream report keeps per-rule conclusions.
- [ ] Spec goal 5 covered: persistence writes `agent-runner-result.json`, `agent-turns.json`, and `agent-tool-trace.json`.
- [ ] Non-goals respected: no `caseTools` rewrite, no scoring engine redesign, no rules YAML in reports, no provider-specific compatibility hacks.
- [ ] Compatibility policy respected: no non-canonical field aliases or nested business result structures.
- [ ] Verification complete: targeted protocol tests, runner tests, merge/report tests, full test suite, build, lint, and format check.
