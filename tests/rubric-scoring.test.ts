import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
  buildRubricScoringPayload,
  parseRubricScoringResultStrict,
  renderRubricScoringPrompt,
} from "../src/agent/rubricScoring.js";
import { buildRubricSnapshot } from "../src/agent/ruleAssistance.js";
import { loadRubricForTaskType } from "../src/scoring/rubricLoader.js";
import type { ConstraintSummary } from "../src/types.js";

const referenceRoot = path.resolve(process.cwd(), "references/scoring");

const constraintSummary: ConstraintSummary = {
  explicitConstraints: ["新增餐厅列表页面"],
  contextualConstraints: ["保持工程结构"],
  implicitConstraints: ["有 patch"],
  classificationHints: ["full_generation"],
};

test("parseRubricScoringResultStrict accepts complete rubric item coverage", async () => {
  const rubric = await loadRubricForTaskType("full_generation", referenceRoot);
  const snapshot = buildRubricSnapshot(rubric);
  const itemScores = snapshot.dimension_summaries.flatMap((dimension) =>
    dimension.item_summaries.map((item) => ({
      dimension_name: dimension.name,
      item_name: item.name,
      score: item.scoring_bands[0].score,
      max_score: item.weight,
      matched_band_score: item.scoring_bands[0].score,
      rationale: `根据 ${item.name} 的最高档标准，当前证据满足要求。`,
      evidence_used: ["workspace/entry/src/main/ets/pages/Index.ets"],
      confidence: "high",
      review_required: false,
    })),
  );

  const parsed = parseRubricScoringResultStrict(
    JSON.stringify({
      summary: {
        overall_assessment: "整体满足 rubric 高分要求。",
        overall_confidence: "high",
      },
      item_scores: itemScores,
      hard_gate_candidates: [],
      risks: [],
      strengths: ["结构清晰"],
      main_issues: [],
    }),
    snapshot,
  );

  assert.equal(parsed.item_scores.length, itemScores.length);
});

test("parseRubricScoringResultStrict rejects missing rubric items", async () => {
  const rubric = await loadRubricForTaskType("full_generation", referenceRoot);
  const snapshot = buildRubricSnapshot(rubric);
  const firstDimension = snapshot.dimension_summaries[0];
  const firstItem = firstDimension.item_summaries[0];

  assert.throws(
    () =>
      parseRubricScoringResultStrict(
        JSON.stringify({
          summary: {
            overall_assessment: "只返回了一个 item。",
            overall_confidence: "medium",
          },
          item_scores: [
            {
              dimension_name: firstDimension.name,
              item_name: firstItem.name,
              score: firstItem.scoring_bands[0].score,
              max_score: firstItem.weight,
              matched_band_score: firstItem.scoring_bands[0].score,
              rationale: "证据不足。",
              evidence_used: [],
              confidence: "low",
              review_required: true,
            },
          ],
          hard_gate_candidates: [],
          risks: [],
          strengths: [],
          main_issues: [],
        }),
        snapshot,
      ),
    /missing rubric scoring items/,
  );
});

test("parseRubricScoringResultStrict rejects scores outside declared bands", async () => {
  const rubric = await loadRubricForTaskType("full_generation", referenceRoot);
  const snapshot = buildRubricSnapshot(rubric);
  const itemScores = snapshot.dimension_summaries.flatMap((dimension, dimensionIndex) =>
    dimension.item_summaries.map((item, itemIndex) => ({
      dimension_name: dimension.name,
      item_name: item.name,
      score: dimensionIndex === 0 && itemIndex === 0 ? 999 : item.scoring_bands[0].score,
      max_score: item.weight,
      matched_band_score:
        dimensionIndex === 0 && itemIndex === 0 ? 999 : item.scoring_bands[0].score,
      rationale: "评分说明",
      evidence_used: ["workspace/entry/src/main/ets/pages/Index.ets"],
      confidence: "medium",
      review_required: false,
    })),
  );

  assert.throws(
    () =>
      parseRubricScoringResultStrict(
        JSON.stringify({
          summary: {
            overall_assessment: "存在非法分数。",
            overall_confidence: "medium",
          },
          item_scores: itemScores,
          hard_gate_candidates: [],
          risks: [],
          strengths: [],
          main_issues: [],
        }),
        snapshot,
      ),
    /score must match declared rubric band/,
  );
});

test("renderRubricScoringPrompt forbids rule-id judgement and requires item scores", async () => {
  const rubric = await loadRubricForTaskType("bug_fix", referenceRoot);
  const snapshot = buildRubricSnapshot(rubric);
  const payload = buildRubricScoringPayload({
    caseInput: {
      caseId: "case-1",
      promptText: "修复页面 bug",
      originalProjectPath: "/case/original",
      generatedProjectPath: "/case/workspace",
      patchPath: "/case/diff/changes.patch",
    },
    caseRoot: "/case",
    effectivePatchPath: "/case/diff/changes.patch",
    taskType: "bug_fix",
    constraintSummary,
    rubricSnapshot: snapshot,
  });

  const prompt = renderRubricScoringPrompt(payload);

  assert.match(prompt, /逐项输出 rubric item 的评分/);
  assert.match(prompt, /不要判断规则 ID/);
  assert.match(prompt, /item_scores/);
});
