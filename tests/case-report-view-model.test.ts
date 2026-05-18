import assert from "node:assert/strict";
import test from "node:test";
import { buildCaseReportViewModel } from "../web/src/pages/caseReportViewModel.js";

test("buildCaseReportViewModel extracts score summary and report sections", () => {
  const viewModel = buildCaseReportViewModel({
    basic_info: {
      task_type: "bug_fix",
      target_description: "修复列表闪退",
    },
    overall_conclusion: {
      total_score: 82,
      hard_gate_triggered: false,
      summary: "修复基本有效，存在轻微风险。",
    },
    dimension_results: [
      {
        dimension_name: "改动精准度",
        score: 18,
        max_score: 20,
        comment: "命中主要根因。",
      },
    ],
    risks: [
      {
        id: 1,
        level: "medium",
        title: "状态同步风险",
        description: "异步返回后可能覆盖新状态。",
        evidence: "Index.ets:42",
      },
    ],
    human_review_items: [
      {
        id: "review-1",
        title: "确认异步状态覆盖",
        reason: "需要人工查看边界场景。",
      },
    ],
    official_linter_summary: {
      runStatus: "success",
      effectiveFindingCount: 2,
    },
  });

  assert.deepEqual(viewModel.summary, {
    totalScore: 82,
    hardGateTriggered: false,
    conclusion: "修复基本有效，存在轻微风险。",
    taskType: "bug_fix",
    targetDescription: "修复列表闪退",
  });
  assert.deepEqual(viewModel.dimensions, [
    {
      name: "改动精准度",
      score: 18,
      maxScore: 20,
      comment: "命中主要根因。",
      itemCount: 0,
    },
  ]);
  assert.equal(viewModel.risks[0]?.title, "状态同步风险");
  assert.equal(viewModel.humanReviewItems[0]?.title, "确认异步状态覆盖");
  assert.deepEqual(viewModel.linterSummary, {
    runStatus: "success",
    effectiveFindingCount: 2,
  });
});

test("buildCaseReportViewModel tolerates sparse result data", () => {
  const viewModel = buildCaseReportViewModel({ overall_conclusion: { total_score: 0 } });

  assert.equal(viewModel.summary.totalScore, 0);
  assert.equal(viewModel.summary.conclusion, undefined);
  assert.deepEqual(viewModel.dimensions, []);
  assert.deepEqual(viewModel.risks, []);
  assert.deepEqual(viewModel.humanReviewItems, []);
});
