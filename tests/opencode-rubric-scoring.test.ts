import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { buildOpencodeRubricPayload } from "../src/agents/prompts/rubricPrompt.js";
import { runOpencodeRubricScoring } from "../src/agents/runners/opencodeRubricScoring.js";
import type {
  LoadedRubricSnapshot,
  RubricScoringPayload,
  RubricScoringResult,
} from "../src/types.js";

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

function extractScoringPayload(prompt: string): Record<string, unknown> {
  const marker = "scoring_payload:\n";
  const start = prompt.indexOf(marker);
  assert.notEqual(start, -1);
  return JSON.parse(prompt.slice(start + marker.length)) as Record<string, unknown>;
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

test("buildOpencodeRubricPayload omits risk taxonomy from rubric summary", () => {
  const rubricSnapshot: LoadedRubricSnapshot = {
    ...payload().rubric_summary,
    risk_taxonomy: [
      {
        code: "REQUIREMENT_NOT_IMPLEMENTED",
        level: "high",
        title: "需求未实现",
        description: "需求目标没有在生成代码中落地。",
      },
    ],
  };

  const scoringPayload = buildOpencodeRubricPayload({
    caseInput: {
      caseId: "case-1",
      promptText: "修复登录按钮无响应",
      originalProjectPath: "/case/original",
      generatedProjectPath: "/case/generated",
    },
    caseRoot: "/case",
    taskType: "bug_fix",
    constraintSummary: payload().task_understanding,
    rubricSnapshot,
  });

  assert.equal("risk_taxonomy" in scoringPayload.rubric_summary, false);
});

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
  assert.match(prompt, /执行任务前必须使用 hmos-rubric-scoring skill/);
  assert.match(prompt, /该 skill 中的输出契约和自检清单是本次输出的强制要求/);
  assert.match(prompt, /generated\//);
  assert.match(prompt, /patch\//);
  assert.match(prompt, /references\/risk-taxonomy\.yaml/);
  assert.match(prompt, /优先阅读 patch\/effective\.patch/);
  assert.match(prompt, /根据 patch 中出现的文件路径继续阅读相关 generated\/ 或 original\/ 上下文/);
  assert.match(prompt, /risks\[\]\.evidence/);
  assert.match(prompt, /真实行号/);
  assert.match(prompt, /禁止使用 patch hunk 行号/);
  assert.doesNotMatch(prompt, /initial_target_files/);
  assert.doesNotMatch(prompt, /最终答案的第一个非空字符必须是 \{/);
  assert.doesNotMatch(prompt, /最后一个非空字符必须是 \}/);
  assert.match(prompt, /不要输出分析过程/);
  assert.match(prompt, /自然语言前后缀/);
  assert.doesNotMatch(prompt, /严格遵守 system prompt 中的正确输出格式/);
  assert.doesNotMatch(prompt, /JSON 字符串中的英文双引号必须转义/);
  assert.doesNotMatch(prompt, /先改写为不含双引号的中文转述/);
  assert.doesNotMatch(prompt, /正确输出格式:/);
  assert.doesNotMatch(prompt, /输出前必须自检 JSON 语法/);
  assert.doesNotMatch(prompt, /item_scores 是数组/);
  assert.doesNotMatch(prompt, /deduction_trace 是对象/);
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

test("runOpencodeRubricScoring omits expected constraints from original prompt summary", async () => {
  let prompt = "";
  const result = await runOpencodeRubricScoring({
    sandboxRoot: "/sandbox/case",
    scoringPayload: {
      ...payload(),
      case_context: {
        ...payload().case_context,
        original_prompt_summary: [
          "任务描述：停车缴费元服务完成一多适配",
          "",
          "输入要求：帮我把当前的停车缴费元服务完成一多适配",
          "",
          "期望输出：constraints:",
          "  - id: RSP-MUST-01",
          "    name: 横向断点划分范围必须符合系统推荐值",
          "    kit:",
          '      - "ArkUI: GridRow / WidthBreakpoint"',
        ].join("\n"),
      },
    },
    runPrompt: async (request) => {
      prompt = request.prompt;
      return {
        requestTag: request.requestTag,
        rawEvents: "",
        rawText: JSON.stringify(finalAnswer()),
        elapsedMs: 1,
      };
    },
  });

  assert.equal(result.outcome, "success");
  const scoringPayload = extractScoringPayload(prompt);
  const caseContext = scoringPayload.case_context as Record<string, unknown>;

  assert.equal(
    caseContext.original_prompt_summary,
    "任务描述：停车缴费元服务完成一多适配\n\n输入要求：帮我把当前的停车缴费元服务完成一多适配",
  );
  assert.doesNotMatch(prompt, /期望输出/);
  assert.doesNotMatch(prompt, /RSP-MUST-01/);
  assert.doesNotMatch(prompt, /GridRow \/ WidthBreakpoint/);
});

test("runOpencodeRubricScoring omits expected constraints with prompt label variants", async () => {
  let prompt = "";
  const result = await runOpencodeRubricScoring({
    sandboxRoot: "/sandbox/case",
    scoringPayload: {
      ...payload(),
      case_context: {
        ...payload().case_context,
        original_prompt_summary: [
          "任务描述：停车缴费元服务完成一多适配",
          "",
          "输入要求：帮我把当前的停车缴费元服务完成一多适配",
          "",
          "期望输出 : constraints:",
          "  - id: RSP-MUST-01",
        ].join("\n"),
      },
    },
    runPrompt: async (request) => {
      prompt = request.prompt;
      return {
        requestTag: request.requestTag,
        rawEvents: "",
        rawText: JSON.stringify(finalAnswer()),
        elapsedMs: 1,
      };
    },
  });

  assert.equal(result.outcome, "success");
  const scoringPayload = extractScoringPayload(prompt);
  const caseContext = scoringPayload.case_context as Record<string, unknown>;

  assert.equal(
    caseContext.original_prompt_summary,
    "任务描述：停车缴费元服务完成一多适配\n\n输入要求：帮我把当前的停车缴费元服务完成一多适配",
  );
  assert.doesNotMatch(prompt, /RSP-MUST-01/);
});

test("runOpencodeRubricScoring retries once in the first session while preserving retry attempt logs", async () => {
  const calls: Array<{
    requestTag: string;
    title?: string;
    prompt: string;
    continueSessionId?: string;
  }> = [];
  const result = await runOpencodeRubricScoring({
    sandboxRoot: "/runs/20260427T031830_full_generation_8a3c0a1a/opencode-sandbox",
    scoringPayload: payload(),
    runPrompt: async (request) => {
      calls.push({
        requestTag: request.requestTag,
        title: request.title,
        prompt: request.prompt,
        continueSessionId: request.continueSessionId,
      });
      return {
        requestTag: request.requestTag,
        rawEvents: "{}\n",
        rawText:
          calls.length === 1 ? "我已经完成评分，但这里不是 JSON。" : JSON.stringify(finalAnswer()),
        elapsedMs: 1,
        sessionId: "ses_rubric_first",
      };
    },
  });

  assert.equal(result.outcome, "success");
  assert.equal(calls.length, 2);
  assert.equal(
    calls[0]?.requestTag,
    "rubric-scoring-case-1-20260427T031830_full_generation_8a3c0a1a",
  );
  assert.equal(
    calls[1]?.requestTag,
    "rubric-scoring-case-1-20260427T031830_full_generation_8a3c0a1a-retry-1",
  );
  assert.equal(calls[1]?.title, calls[1]?.requestTag);
  assert.equal(calls[0]?.continueSessionId, undefined);
  assert.equal(calls[1]?.continueSessionId, "ses_rubric_first");
  assert.match(calls[1]?.prompt ?? "", /rubric 评分 agent。本次是重试/);
  assert.match(calls[1]?.prompt ?? "", /本次是重试。仍必须使用 hmos-rubric-scoring skill/);
  assert.match(calls[1]?.prompt ?? "", /只修复 listed protocol errors/);
  assert.match(calls[1]?.prompt ?? "", /最终输出不是唯一 JSON object/);
  assert.match(calls[1]?.prompt ?? "", /严格遵守 system prompt 中的正确输出格式/);
  assert.doesNotMatch(calls[1]?.prompt ?? "", /正确输出格式:/);
  assert.match(calls[1]?.prompt ?? "", /最终答案的第一个非空字符必须是 \{/);
  assert.match(calls[1]?.prompt ?? "", /输出前必须自检 JSON 语法/);
  assert.match(calls[1]?.prompt ?? "", /每个 item_scores 条目必须先闭合自身对象/);
  assert.match(calls[1]?.prompt ?? "", /risks\[\]\.evidence/);
  assert.match(calls[1]?.prompt ?? "", /真实行号/);
  assert.match(calls[1]?.prompt ?? "", /禁止使用 patch hunk 行号/);
  assert.match(calls[1]?.prompt ?? "", /沿用上一轮对话中的 scoring_payload/);
  assert.doesNotMatch(calls[1]?.prompt ?? "", /rubric_retry_payload/);
  assert.doesNotMatch(calls[1]?.prompt ?? "", /scoring_payload:/);
  assert.doesNotMatch(calls[1]?.prompt ?? "", /original_prompt_summary/);
  assert.doesNotMatch(calls[1]?.prompt ?? "", /dimension_summaries/);
});

test("runOpencodeRubricScoring succeeds on the second retry after repeated protocol errors", async () => {
  const calls: string[] = [];
  const result = await runOpencodeRubricScoring({
    sandboxRoot: "/runs/20260427T031830_full_generation_8a3c0a1a/opencode-sandbox",
    scoringPayload: payload(),
    runPrompt: async (request) => {
      calls.push(request.requestTag);
      return {
        requestTag: request.requestTag,
        rawEvents: "{}\n",
        rawText: calls.length < 3 ? "不是合法 JSON" : JSON.stringify(finalAnswer()),
        elapsedMs: 1,
      };
    },
  });

  assert.equal(result.outcome, "success");
  assert.deepEqual(calls, [
    "rubric-scoring-case-1-20260427T031830_full_generation_8a3c0a1a",
    "rubric-scoring-case-1-20260427T031830_full_generation_8a3c0a1a-retry-1",
    "rubric-scoring-case-1-20260427T031830_full_generation_8a3c0a1a-retry-2",
  ]);
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
  assert.equal(
    calls[1]?.requestTag,
    "rubric-scoring-case-1-20260427T031830_full_generation_8a3c0a1a-retry-1",
  );
  assert.equal(calls[1]?.title, calls[1]?.requestTag);
  assert.match(calls[1]?.prompt ?? "", /rubric 评分 agent。本次是重试/);
  assert.match(calls[1]?.prompt ?? "", /本次是重试。仍必须使用 hmos-rubric-scoring skill/);
  assert.match(calls[1]?.prompt ?? "", /只修复 listed protocol errors/);
  assert.match(calls[1]?.prompt ?? "", /缺少 assistant 最终文本/);
  assert.match(calls[1]?.prompt ?? "", /严格遵守 system prompt 中的正确输出格式/);
  assert.doesNotMatch(calls[1]?.prompt ?? "", /正确输出格式:/);
  assert.match(calls[1]?.prompt ?? "", /risks\[\]\.evidence/);
  assert.match(calls[1]?.prompt ?? "", /真实行号/);
  assert.match(calls[1]?.prompt ?? "", /禁止使用 patch hunk 行号/);
  assert.match(calls[1]?.prompt ?? "", /沿用上一轮对话中的 scoring_payload/);
  assert.doesNotMatch(calls[1]?.prompt ?? "", /rubric_retry_payload/);
  assert.doesNotMatch(calls[1]?.prompt ?? "", /scoring_payload:/);
});

test("runOpencodeRubricScoring retries once after initial opencode timeout", async () => {
  const calls: string[] = [];
  const result = await runOpencodeRubricScoring({
    sandboxRoot: "/runs/20260427T031830_full_generation_8a3c0a1a/opencode-sandbox",
    scoringPayload: payload(),
    runPrompt: async (request) => {
      calls.push(request.requestTag);
      if (calls.length === 1) {
        throw new Error(`opencode 调用超时 request=${request.requestTag}`);
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
  assert.deepEqual(calls, [
    "rubric-scoring-case-1-20260427T031830_full_generation_8a3c0a1a",
    "rubric-scoring-case-1-20260427T031830_full_generation_8a3c0a1a-retry-1",
  ]);
});

test("runOpencodeRubricScoring succeeds on the second retry after an initial timeout", async () => {
  const calls: string[] = [];
  const result = await runOpencodeRubricScoring({
    sandboxRoot: "/runs/20260427T031830_full_generation_8a3c0a1a/opencode-sandbox",
    scoringPayload: payload(),
    runPrompt: async (request) => {
      calls.push(request.requestTag);
      if (calls.length < 3) {
        throw new Error(`opencode 调用超时 request=${request.requestTag}`);
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
  assert.deepEqual(calls, [
    "rubric-scoring-case-1-20260427T031830_full_generation_8a3c0a1a",
    "rubric-scoring-case-1-20260427T031830_full_generation_8a3c0a1a-retry-1",
    "rubric-scoring-case-1-20260427T031830_full_generation_8a3c0a1a-retry-2",
  ]);
});

test("runOpencodeRubricScoring fails when both retries also time out", async () => {
  const calls: string[] = [];
  const result = await runOpencodeRubricScoring({
    sandboxRoot: "/runs/20260427T031830_full_generation_8a3c0a1a/opencode-sandbox",
    scoringPayload: payload(),
    runPrompt: async (request) => {
      calls.push(request.requestTag);
      throw new Error(`opencode 调用超时 request=${request.requestTag}`);
    },
  });

  assert.equal(result.outcome, "request_failed");
  assert.match(result.failure_reason ?? "", /opencode 调用超时/);
  assert.deepEqual(calls, [
    "rubric-scoring-case-1-20260427T031830_full_generation_8a3c0a1a",
    "rubric-scoring-case-1-20260427T031830_full_generation_8a3c0a1a-retry-1",
    "rubric-scoring-case-1-20260427T031830_full_generation_8a3c0a1a-retry-2",
  ]);
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

test("runOpencodeRubricScoring ignores extra fields and coerces scalar strings", async () => {
  const answer = finalAnswer() as unknown as Record<string, unknown>;
  answer["extra_top_level"] = "ignored";
  answer.summary = {
    ...(answer.summary as Record<string, unknown>),
    extra_summary: "ignored",
  };
  answer.item_scores = [
    {
      ...finalAnswer().item_scores[0],
      score: "32",
      matched_band_score: "32",
      max_score: "999",
      review_required: "false",
      extra_item_note: "ignored",
    },
  ];
  answer.hard_gate_candidates = [
    {
      ...finalAnswer().hard_gate_candidates[0],
      triggered: "false",
      extra_gate_note: "ignored",
    },
  ];

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
  assert.equal(result.final_answer?.item_scores[0]?.score, 40);
  assert.equal(result.final_answer?.item_scores[0]?.matched_band_score, 40);
  assert.equal(result.final_answer?.item_scores[0]?.max_score, 40);
  assert.equal(result.final_answer?.item_scores[0]?.review_required, false);
  assert.equal(result.final_answer?.hard_gate_candidates[0]?.triggered, false);
  assert.equal(
    "extra_top_level" in (result.final_answer as unknown as Record<string, unknown>),
    false,
  );
  assert.equal(
    "extra_item_note" in
      (result.final_answer?.item_scores[0] as unknown as Record<string, unknown>),
    false,
  );
});

test("runOpencodeRubricScoring snaps tie scores upward to the nearest rubric band", async () => {
  const answer = finalAnswer();
  answer.item_scores[0] = {
    ...answer.item_scores[0],
    score: 30,
    matched_band_score: 30,
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
  assert.equal(result.final_answer?.item_scores[0]?.score, 40);
  assert.equal(result.final_answer?.item_scores[0]?.matched_band_score, 40);
});

test("runOpencodeRubricScoring still requires deduction trace after score snapping", async () => {
  const answer = finalAnswer();
  answer.item_scores[0] = {
    ...answer.item_scores[0],
    score: 12,
    matched_band_score: 12,
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

  assert.equal(result.outcome, "protocol_error");
  assert.match(result.failure_reason ?? "", /invalid_deduction_trace=功能正确性::缺陷修复完整度/);
});

test("runOpencodeRubricScoring rejects replacement risk fields without required names", async () => {
  const answer = finalAnswer() as unknown as Record<string, unknown>;
  answer.risks = [
    {
      risk_level: "medium",
      title: "风险标题",
      description: "风险说明",
      evidence: "generated/entry/src/main.ets",
    },
  ];

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
  assert.match(result.failure_reason ?? "", /risks\.0\.level|risks\[0\]\.level/);
});

test("runOpencodeRubricScoring requires risk_code for rubric risks", async () => {
  const answer = finalAnswer();
  answer.risks = [
    {
      id: 1,
      level: "medium",
      title: "模型自由生成的风险标题",
      description: "风险说明",
      evidence: "generated/entry/src/main.ets",
    },
  ];

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
  assert.match(result.failure_reason ?? "", /risks\.0\.risk_code|risks\[0\]\.risk_code/);
});

test("runOpencodeRubricScoring maps unknown risk_code to other issue", async () => {
  const answer = finalAnswer();
  answer.risks = [
    {
      id: 1,
      level: "high",
      title: "模型自由生成的风险标题",
      description: "风险说明",
      evidence: "generated/entry/src/main.ets",
      risk_code: "MODEL_GENERATED_UNKNOWN_CODE",
    },
  ];

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
  assert.equal(result.final_answer?.risks[0]?.risk_code, "OTHER_ISSUE");
  assert.equal(result.final_answer?.risks[0]?.title, "其他问题");
  assert.equal(result.final_answer?.risks[0]?.level, "medium");
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
  assert.match(calls[1]?.prompt ?? "", /risk_code/);
  assert.doesNotMatch(
    calls[1]?.prompt ?? "",
    /必须且只能包含 level、title、description、evidence 四个 string 字段/,
  );
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

test("rubric skill documents risk taxonomy priority and duplicate suppression rules", () => {
  const skillText = fs.readFileSync(
    path.resolve(process.cwd(), ".opencode/skills/hmos-rubric-scoring/SKILL.md"),
    "utf8",
  );

  assert.match(skillText, /风险 taxonomy 判定优先级/);
  assert.match(skillText, /真实 import、符号调用或可追溯到 Kit\/API 的封装/);
  assert.match(skillText, /同一代码位置、同一失败机制、同一 canonical code/);
  assert.match(skillText, /先判断是否为明确需求缺失/);
});
