import assert from "node:assert/strict";
import test from "node:test";
import { runOpencodeRubricScoring } from "../src/agent/opencodeRubricScoring.js";
import type { RubricScoringPayload, RubricScoringResult } from "../src/types.js";

function payload(): RubricScoringPayload {
  return {
    case_context: {
      case_id: "case-1",
      case_root: "/case",
      task_type: "bug_fix",
      original_prompt_summary: "修复登录按钮无响应",
      original_project_path: "/case/original",
      generated_project_path: "/case/generated",
      effective_patch_path: "/case/patch/effective.patch",
    },
    task_understanding: {
      explicitConstraints: ["修复登录按钮点击"],
      contextualConstraints: [],
      implicitConstraints: [],
      classificationHints: ["bug_fix"],
    },
    rubric_summary: {
      task_type: "bug_fix",
      evaluation_mode: "test",
      scenario: "test",
      scoring_method: "test",
      scoring_note: "test",
      common_risks: [],
      report_emphasis: [],
      dimension_summaries: [
        {
          name: "功能正确性",
          weight: 40,
          intent: "验证问题是否修复",
          item_summaries: [
            {
              name: "缺陷修复完整度",
              weight: 40,
              scoring_bands: [
                { score: 40, criteria: "完整修复" },
                { score: 20, criteria: "部分修复" },
                { score: 0, criteria: "未修复" },
              ],
            },
          ],
        },
      ],
      hard_gates: [{ id: "G1", score_cap: 60 }],
      review_rule_summary: [],
    },
    initial_target_files: ["generated/entry/src/main.ets"],
    response_contract: {
      output_language: "zh-CN",
      json_only: true,
      required_top_level_fields: [
        "summary",
        "item_scores",
        "hard_gate_candidates",
        "risks",
        "strengths",
        "main_issues",
      ],
    },
  };
}

function finalAnswer(): RubricScoringResult {
  return {
    summary: {
      overall_assessment: "登录按钮响应已修复。",
      overall_confidence: "high",
    },
    item_scores: [
      {
        dimension_name: "功能正确性",
        item_name: "缺陷修复完整度",
        score: 40,
        max_score: 40,
        matched_band_score: 40,
        rationale: "点击处理路径已补齐。",
        evidence_used: ["generated/entry/src/main.ets"],
        confidence: "high",
        review_required: false,
      },
    ],
    hard_gate_candidates: [
      {
        gate_id: "G1",
        triggered: false,
        reason: "未触发硬门禁。",
        confidence: "high",
      },
    ],
    risks: [],
    strengths: ["修复路径清晰"],
    main_issues: [],
  };
}

test("runOpencodeRubricScoring returns existing rubric result shape without replacement fields", async () => {
  let prompt = "";
  let requestTag = "";
  let title = "";
  let agent = "";
  let outputFile = "";
  const sandboxRoot = "/runs/20260427T031830_full_generation_8a3c0a1a/opencode-sandbox";
  const result = await runOpencodeRubricScoring({
    sandboxRoot,
    scoringPayload: payload(),
    runPrompt: async (request) => {
      prompt = request.prompt;
      requestTag = request.requestTag;
      title = request.title ?? "";
      agent = request.agent ?? "";
      outputFile = request.outputFile ?? "";
      return {
        requestTag: request.requestTag,
        rawEvents: "{}\n",
        rawText: JSON.stringify(finalAnswer()),
        elapsedMs: 10,
      };
    },
  });

  assert.equal(prompt.includes("tool" + "_call"), false);
  assert.equal(prompt.includes("total_score"), false);
  assert.match(prompt, /generated\//);
  assert.match(prompt, /patch\//);
  assert.match(prompt, /最终答案的第一个非空字符必须是 \{/);
  assert.match(prompt, /最后一个非空字符必须是 \}/);
  assert.match(prompt, /不要输出分析过程/);
  assert.match(prompt, /不要输出自然语言前后缀/);
  assert.match(prompt, /严格遵守 system prompt 中的正确输出格式/);
  assert.doesNotMatch(prompt, /正确输出格式:/);
  assert.match(prompt, /输出前必须自检 JSON 语法/);
  assert.match(prompt, /item_scores 是数组/);
  assert.match(prompt, /deduction_trace 是对象/);
  assert.doesNotMatch(prompt, /"deduction_trace"\s*:/);
  assert.match(prompt, /output_file: metadata\/agent-output\/rubric-scoring\.json/);
  assert.equal(requestTag, "rubric-scoring-case-1-20260427T031830_full_generation_8a3c0a1a");
  assert.equal(title, requestTag);
  assert.equal(agent, "hmos-rubric-scoring");
  assert.equal(outputFile, "metadata/agent-output/rubric-scoring.json");
  assert.equal(result.outcome, "success");
  assert.equal(result.final_answer?.item_scores[0]?.dimension_name, "功能正确性");
  assert.equal(result.final_answer?.item_scores[0]?.score, 40);
  assert.equal(result.raw_events, "{}\n");
});

test("runOpencodeRubricScoring retries once with strict format guidance after protocol error", async () => {
  const calls: Array<{ requestTag: string; title?: string; prompt: string }> = [];
  const result = await runOpencodeRubricScoring({
    sandboxRoot: "/runs/20260427T031830_full_generation_8a3c0a1a/opencode-sandbox",
    scoringPayload: payload(),
    runPrompt: async (request) => {
      calls.push({ requestTag: request.requestTag, title: request.title, prompt: request.prompt });
      return {
        requestTag: request.requestTag,
        rawEvents: "{}\n",
        rawText: calls.length === 1 ? "我已经完成评分，但这里不是 JSON。" : JSON.stringify(finalAnswer()),
        elapsedMs: 1,
      };
    },
  });

  assert.equal(result.outcome, "success");
  assert.equal(calls.length, 2);
  assert.equal(calls[0]?.requestTag, "rubric-scoring-case-1-20260427T031830_full_generation_8a3c0a1a");
  assert.equal(calls[1]?.requestTag, "rubric-scoring-case-1-20260427T031830_full_generation_8a3c0a1a-retry-1");
  assert.equal(calls[1]?.title, calls[1]?.requestTag);
  assert.match(calls[1]?.prompt ?? "", /rubric 评分 agent。本次是重试/);
  assert.match(calls[1]?.prompt ?? "", /最终输出不是唯一 JSON object/);
  assert.match(calls[1]?.prompt ?? "", /严格遵守 system prompt 中的正确输出格式/);
  assert.doesNotMatch(calls[1]?.prompt ?? "", /正确输出格式:/);
  assert.match(calls[1]?.prompt ?? "", /最终答案的第一个非空字符必须是 \{/);
  assert.match(calls[1]?.prompt ?? "", /输出前必须自检 JSON 语法/);
  assert.match(calls[1]?.prompt ?? "", /每个 item_scores 条目必须先闭合自身对象/);
  assert.match(calls[1]?.prompt ?? "", /沿用上一轮对话中的 scoring_payload/);
  assert.doesNotMatch(calls[1]?.prompt ?? "", /rubric_retry_payload/);
  assert.doesNotMatch(calls[1]?.prompt ?? "", /scoring_payload:/);
  assert.doesNotMatch(calls[1]?.prompt ?? "", /original_prompt_summary/);
  assert.doesNotMatch(calls[1]?.prompt ?? "", /dimension_summaries/);
});

test("runOpencodeRubricScoring retries once with strict format guidance after request failure", async () => {
  const calls: Array<{ requestTag: string; title?: string; prompt: string }> = [];
  const result = await runOpencodeRubricScoring({
    sandboxRoot: "/runs/20260427T031830_full_generation_8a3c0a1a/opencode-sandbox",
    scoringPayload: payload(),
    runPrompt: async (request) => {
      calls.push({ requestTag: request.requestTag, title: request.title, prompt: request.prompt });
      if (calls.length === 1) {
        throw new Error("opencode 输出中缺少 assistant 最终文本");
      }
      return {
        requestTag: request.requestTag,
        rawEvents: "{}\n",
        rawText: JSON.stringify(finalAnswer()),
        elapsedMs: 1,
      };
    },
  });

  assert.equal(result.outcome, "success");
  assert.equal(calls.length, 2);
  assert.equal(calls[1]?.requestTag, "rubric-scoring-case-1-20260427T031830_full_generation_8a3c0a1a-retry-1");
  assert.equal(calls[1]?.title, calls[1]?.requestTag);
  assert.match(calls[1]?.prompt ?? "", /rubric 评分 agent。本次是重试/);
  assert.match(calls[1]?.prompt ?? "", /缺少 assistant 最终文本/);
  assert.match(calls[1]?.prompt ?? "", /严格遵守 system prompt 中的正确输出格式/);
  assert.doesNotMatch(calls[1]?.prompt ?? "", /正确输出格式:/);
  assert.match(calls[1]?.prompt ?? "", /沿用上一轮对话中的 scoring_payload/);
  assert.doesNotMatch(calls[1]?.prompt ?? "", /rubric_retry_payload/);
  assert.doesNotMatch(calls[1]?.prompt ?? "", /scoring_payload:/);
});

test("runOpencodeRubricScoring rejects incomplete rubric item coverage", async () => {
  const answer = finalAnswer();
  answer.item_scores = [];
  const result = await runOpencodeRubricScoring({
    sandboxRoot: "/sandbox/case",
    scoringPayload: payload(),
    runPrompt: async (request) => ({
      requestTag: request.requestTag,
      rawEvents: "",
      rawText: JSON.stringify(answer),
      elapsedMs: 1,
    }),
  });

  assert.equal(result.outcome, "protocol_error");
  assert.match(result.failure_reason ?? "", /missing=功能正确性::缺陷修复完整度/);
});

test("runOpencodeRubricScoring rejects replacement scoring fields", async () => {
  const result = await runOpencodeRubricScoring({
    sandboxRoot: "/sandbox/case",
    scoringPayload: payload(),
    runPrompt: async (request) => ({
      requestTag: request.requestTag,
      rawEvents: "",
      rawText: JSON.stringify({
        total_score: 40,
        item_scores: [
          {
            item_id: "功能正确性::缺陷修复完整度",
            score: 40,
            reason: "ok",
          },
        ],
      }),
      elapsedMs: 1,
    }),
  });

  assert.equal(result.outcome, "protocol_error");
  assert.match(result.failure_reason ?? "", /summary/);
});

test("runOpencodeRubricScoring normalizes item scores through the local rubric skeleton", async () => {
  const answer = finalAnswer();
  const rawItem = { ...answer.item_scores[0], max_score: 999 } as Record<string, unknown>;
  delete rawItem.matched_band_score;
  const duplicate = { ...answer.item_scores[0], rationale: "重复项应被本地骨架去重。" };
  const unexpected = {
    ...answer.item_scores[0],
    dimension_name: "未知维度",
    item_name: "未知评分项",
  };

  const result = await runOpencodeRubricScoring({
    sandboxRoot: "/sandbox/case",
    scoringPayload: payload(),
    runPrompt: async (request) => ({
      requestTag: request.requestTag,
      rawEvents: "",
      rawText: JSON.stringify({
        ...answer,
        item_scores: [unexpected, rawItem, duplicate],
      }),
      elapsedMs: 1,
    }),
  });

  assert.equal(result.outcome, "success");
  assert.equal(result.final_answer?.item_scores.length, 1);
  assert.equal(result.final_answer?.item_scores[0]?.dimension_name, "功能正确性");
  assert.equal(result.final_answer?.item_scores[0]?.item_name, "缺陷修复完整度");
  assert.equal(result.final_answer?.item_scores[0]?.max_score, 40);
  assert.equal(result.final_answer?.item_scores[0]?.matched_band_score, 40);
  assert.equal(result.final_answer?.item_scores[0]?.rationale, "点击处理路径已补齐。");
});

test("runOpencodeRubricScoring retry prompt targets concrete protocol failures", async () => {
  const calls: Array<{ requestTag: string; prompt: string }> = [];
  const answer = finalAnswer();
  const result = await runOpencodeRubricScoring({
    sandboxRoot: "/runs/20260427T031830_full_generation_8a3c0a1a/opencode-sandbox",
    scoringPayload: payload(),
    runPrompt: async (request) => {
      calls.push({ requestTag: request.requestTag, prompt: request.prompt });
      return {
        requestTag: request.requestTag,
        rawEvents: "{}\n",
        rawText:
          calls.length === 1
            ? JSON.stringify({
                ...answer,
                item_scores: [
                  {
                    ...answer.item_scores[0],
                    score: 20,
                    matched_band_score: 20,
                  },
                ],
              })
            : JSON.stringify(answer),
        elapsedMs: 1,
      };
    },
  });

  assert.equal(result.outcome, "success");
  assert.equal(calls.length, 2);
  assert.match(calls[1]?.prompt ?? "", /invalid_deduction_trace=功能正确性::缺陷修复完整度/);
  assert.match(calls[1]?.prompt ?? "", /只修复 listed protocol errors/);
  assert.match(calls[1]?.prompt ?? "", /invalid_deduction_trace/);
  assert.doesNotMatch(calls[1]?.prompt ?? "", /rubric_retry_payload/);
});

test("runOpencodeRubricScoring does not hard-validate rubric comparison wording", async () => {
  const answer = finalAnswer();
  answer.item_scores[0] = {
    ...answer.item_scores[0],
    score: 20,
    matched_band_score: 20,
    deduction_trace: {
      code_locations: ["generated/entry/src/main.ets:1"],
      impact_scope: "影响范围",
      rubric_comparison: "这里没有使用固定比较短语，但仍然说明了评分依据。",
      deduction_reason: "扣分原因",
      improvement_suggestion: "改进建议",
    },
  };

  const result = await runOpencodeRubricScoring({
    sandboxRoot: "/sandbox/case",
    scoringPayload: payload(),
    runPrompt: async (request) => ({
      requestTag: request.requestTag,
      rawEvents: "",
      rawText: JSON.stringify(answer),
      elapsedMs: 1,
    }),
  });

  assert.equal(result.outcome, "success");
});
