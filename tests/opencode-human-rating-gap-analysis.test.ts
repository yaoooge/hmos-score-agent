import assert from "node:assert/strict";
import test from "node:test";
import { runOpencodeHumanRatingGapAnalysis } from "../src/agents/runners/opencodeHumanRatingGapAnalysis.js";
import type {
  HumanRatingGapAnalysis,
  HumanRatingRecord,
} from "../src/datasets/humanRating/humanRatingTypes.js";

function manualRatingRecord(): HumanRatingRecord {
  return {
    taskId: 88,
    testCaseId: 188,
    caseName: "电视台云服务新增全屏播放",
    reviewedAt: "2026-05-09T02:30:00.000Z",
    reviewer: "alice",
    manualRating: "L1",
    basis: "无法编译运行。",
    autoScore: 92,
    autoRating: "L5",
    gapQualified: true,
    gapRule: "manual=L1 autoScore>=70",
  };
}

function finalAnswer(): HumanRatingGapAnalysis {
  return {
    primaryConclusion: "scoring_system_needs_improvement",
    confidence: "medium",
    reasonSummary: "自动评分漏判编译失败。",
    humanRatingReview: {
      needsImprovement: false,
      reason: "人工依据符合 L1 标准。",
    },
    scoringSystemReview: {
      needsImprovement: true,
      reason: "评分系统缺少构建失败 hard gate。",
    },
    evidence: ["outputs/result.json: overall_conclusion.total_score=92"],
    recommendedActions: ["补充构建失败 hard gate。"],
  };
}

test("runOpencodeHumanRatingGapAnalysis invokes dedicated agent and validates output", async () => {
  let prompt = "";
  let agent = "";
  let outputFile = "";
  let requestTag = "";
  const result = await runOpencodeHumanRatingGapAnalysis({
    sandboxRoot: "/runs/20260509T023000_case/opencode-sandbox",
    manualRatingRecord: manualRatingRecord(),
    resultJson: {
      overall_conclusion: { total_score: 92 },
      risks: [],
    },
    runPrompt: async (request) => {
      prompt = request.prompt;
      agent = request.agent ?? "";
      outputFile = request.outputFile ?? "";
      requestTag = request.requestTag;
      return {
        requestTag: request.requestTag,
        rawEvents: "{}\n",
        rawText: JSON.stringify(finalAnswer()),
        elapsedMs: 10,
      };
    },
  });

  assert.match(prompt, /必须使用 hmos-human-rating-gap-analysis skill/);
  assert.match(prompt, /manual_rating_record/);
  assert.match(prompt, /result_json/);
  assert.match(prompt, /output_file: metadata\/agent-output\/human-rating-gap-analysis\.json/);
  assert.equal(agent, "hmos-human-rating-gap-analysis");
  assert.equal(outputFile, "metadata/agent-output/human-rating-gap-analysis.json");
  assert.equal(requestTag, "human-rating-gap-analysis-88-20260509T023000_case");
  assert.equal(result.outcome, "success");
  assert.equal(result.final_answer?.primaryConclusion, "scoring_system_needs_improvement");
  assert.equal(result.raw_events, "{}\n");
});

test("runOpencodeHumanRatingGapAnalysis rejects malformed analysis output", async () => {
  const result = await runOpencodeHumanRatingGapAnalysis({
    sandboxRoot: "/runs/20260509T023000_case/opencode-sandbox",
    manualRatingRecord: manualRatingRecord(),
    resultJson: { overall_conclusion: { total_score: 92 } },
    runPrompt: async (request) => ({
      requestTag: request.requestTag,
      rawEvents: "{}\n",
      rawText: JSON.stringify({
        primaryConclusion: "scoring_system_needs_improvement",
        confidence: "medium",
        reasonSummary: "缺少 evidence 和 recommendedActions。",
        humanRatingReview: { needsImprovement: false, reason: "x" },
        scoringSystemReview: { needsImprovement: true, reason: "x" },
        evidence: [],
        recommendedActions: [],
      }),
      elapsedMs: 1,
    }),
  });

  assert.equal(result.outcome, "protocol_error");
  assert.match(result.failure_reason ?? "", /evidence/);
});
