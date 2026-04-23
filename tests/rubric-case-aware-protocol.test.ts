import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { buildRubricSnapshot } from "../src/agent/ruleAssistance.js";
import {
  parseRubricCaseAwarePlannerOutputStrict,
  validateRubricFinalAnswerAgainstSnapshot,
} from "../src/agent/rubricCaseAwareProtocol.js";
import { loadRubricForTaskType } from "../src/scoring/rubricLoader.js";
import type { LoadedRubricSnapshot, RubricScoringResult } from "../src/types.js";

const referenceRoot = path.resolve(process.cwd(), "references/scoring");

function buildFullScoreFinalAnswer(snapshot: LoadedRubricSnapshot): RubricScoringResult & {
  action: "final_answer";
} {
  return {
    action: "final_answer",
    summary: {
      overall_assessment: "未发现足够负面证据，按满分保留。",
      overall_confidence: "medium",
    },
    item_scores: snapshot.dimension_summaries.flatMap((dimension) =>
      dimension.item_summaries.map((item) => ({
        dimension_name: dimension.name,
        item_name: item.name,
        score: item.scoring_bands[0].score,
        max_score: item.weight,
        matched_band_score: item.scoring_bands[0].score,
        rationale: "未读取到足够负面证据，按满分保留。",
        evidence_used: [],
        confidence: "medium" as const,
        review_required: false,
      })),
    ),
    hard_gate_candidates: [],
    risks: [],
    strengths: [],
    main_issues: [],
  };
}

test("parseRubricCaseAwarePlannerOutputStrict accepts one tool_call object", () => {
  const parsed = parseRubricCaseAwarePlannerOutputStrict(
    JSON.stringify({
      action: "tool_call",
      tool: "read_patch",
      args: {},
      reason: "先查看补丁定位评分证据。",
    }),
  );

  assert.equal(parsed.action, "tool_call");
  assert.equal(parsed.tool, "read_patch");
});

test("validateRubricFinalAnswerAgainstSnapshot accepts complete full-score answer", async () => {
  const rubric = await loadRubricForTaskType("full_generation", referenceRoot);
  const snapshot = buildRubricSnapshot(rubric);
  const finalAnswer = buildFullScoreFinalAnswer(snapshot);
  const parsed = parseRubricCaseAwarePlannerOutputStrict(JSON.stringify(finalAnswer));
  assert.equal(parsed.action, "final_answer");

  const validation = validateRubricFinalAnswerAgainstSnapshot(parsed, snapshot);

  assert.deepEqual(validation, {
    ok: true,
    missing_item_keys: [],
    duplicate_item_keys: [],
    unexpected_item_keys: [],
    invalid_band_item_keys: [],
    invalid_weight_item_keys: [],
    invalid_deduction_trace_item_keys: [],
  });
});

test("validateRubricFinalAnswerAgainstSnapshot reports missing rubric items", async () => {
  const rubric = await loadRubricForTaskType("full_generation", referenceRoot);
  const snapshot = buildRubricSnapshot(rubric);
  const finalAnswer = buildFullScoreFinalAnswer(snapshot);
  finalAnswer.item_scores = finalAnswer.item_scores.slice(1);

  const validation = validateRubricFinalAnswerAgainstSnapshot(finalAnswer, snapshot);

  assert.equal(validation.ok, false);
  assert.ok(validation.missing_item_keys.length > 0);
});

test("validateRubricFinalAnswerAgainstSnapshot reports invalid declared band scores", async () => {
  const rubric = await loadRubricForTaskType("full_generation", referenceRoot);
  const snapshot = buildRubricSnapshot(rubric);
  const finalAnswer = buildFullScoreFinalAnswer(snapshot);
  finalAnswer.item_scores[0] = {
    ...finalAnswer.item_scores[0],
    score: 999,
    matched_band_score: 999,
  };

  const validation = validateRubricFinalAnswerAgainstSnapshot(finalAnswer, snapshot);

  assert.equal(validation.ok, false);
  assert.deepEqual(validation.invalid_band_item_keys, [
    `${finalAnswer.item_scores[0].dimension_name}::${finalAnswer.item_scores[0].item_name}`,
  ]);
});

test("validateRubricFinalAnswerAgainstSnapshot requires improvement suggestions for deducted items", async () => {
  const rubric = await loadRubricForTaskType("bug_fix", referenceRoot);
  const snapshot = buildRubricSnapshot(rubric);
  const finalAnswer = buildFullScoreFinalAnswer(snapshot);
  const firstDimension = snapshot.dimension_summaries[0];
  const firstItem = firstDimension.item_summaries[0];
  const deductedBand = firstItem.scoring_bands[1];
  assert.ok(deductedBand);
  finalAnswer.item_scores[0] = {
    ...finalAnswer.item_scores[0],
    score: deductedBand.score,
    matched_band_score: deductedBand.score,
    deduction_trace: {
      code_locations: ["workspace/entry/src/main/ets/pages/Index.ets:12"],
      impact_scope: "影响页面初始化稳定性",
      rubric_comparison: "未命中更高档，因为存在空值风险；命中当前档，因为主体路径仍可运行",
      deduction_reason: "发现空值未防御。",
      improvement_suggestion: "",
    },
  };

  const validation = validateRubricFinalAnswerAgainstSnapshot(finalAnswer, snapshot);

  assert.equal(validation.ok, false);
  assert.deepEqual(validation.invalid_deduction_trace_item_keys, [
    `${firstDimension.name}::${firstItem.name}`,
  ]);
});

test("parseRubricCaseAwarePlannerOutputStrict rejects markdown wrapped JSON", () => {
  assert.throws(
    () =>
      parseRubricCaseAwarePlannerOutputStrict(
        '```json\n{"action":"tool_call","tool":"read_patch","args":{}}\n```',
      ),
    /protocol_error/,
  );
});
