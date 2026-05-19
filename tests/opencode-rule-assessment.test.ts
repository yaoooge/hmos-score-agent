import assert from "node:assert/strict";
import test from "node:test";
import { runOpencodeRuleAssessment } from "../src/agent/opencodeRuleAssessment.js";
import type { AgentBootstrapPayload } from "../src/types.js";

function payload(): AgentBootstrapPayload {
  return {
    case_context: {
      case_id: "case-1",
      case_root: "/case",
      task_type: "bug_fix",
      original_prompt_summary: "实现登录页",
      original_project_path: "/case/original",
      generated_project_path: "/case/generated",
      effective_patch_path: "/case/patch/effective.patch",
    },
    task_understanding: {
      explicitConstraints: ["必须实现登录"],
      contextualConstraints: [],
      implicitConstraints: [],
      classificationHints: [],
    },
    rubric_summary: {
      task_type: "bug_fix",
      evaluation_mode: "test",
      scenario: "test",
      scoring_method: "test",
      scoring_note: "test",
      common_risks: [],
      report_emphasis: [],
      dimension_summaries: [],
      hard_gates: [],
      review_rule_summary: [],
    },
    assisted_rule_candidates: [
      {
        rule_id: "R1",
        rule_source: "should_rule",
        why_uncertain: "需要上下文",
        local_preliminary_signal: "unknown",
        evidence_files: ["generated/entry/src/main.ets"],
        evidence_snippets: ["SHOULD_NOT_BE_SENT_TO_RULE_AGENT"],
        kit: ["ArkUI: Tabs / TabContent"],
        target_checks: [
          {
            target: "**/pages/MainPage.ets",
            ast_signals: [],
            llm_prompt: "检查底部导航栏是否使用 Tabs + TabContent 组件实现",
          },
        ],
      },
    ],
  };
}

function payloadWithTwoRules(): AgentBootstrapPayload {
  return {
    ...payload(),
    assisted_rule_candidates: [
      ...payload().assisted_rule_candidates,
      {
        rule_id: "R2",
        rule_source: "should_rule",
        why_uncertain: "需要上下文",
        local_preliminary_signal: "unknown",
        evidence_files: ["generated/entry/src/feature.ets"],
        evidence_snippets: [],
      },
    ],
  };
}

function extractPromptPayload(prompt: string): Record<string, unknown> {
  const marker = "bootstrap_payload:\n";
  const start = prompt.indexOf(marker);
  assert.notEqual(start, -1);
  return JSON.parse(prompt.slice(start + marker.length)) as Record<string, unknown>;
}

function finalAnswer() {
  return {
    summary: {
      assistant_scope: "读取 sandbox 后完成判定。",
      overall_confidence: "high",
    },
    rule_assessments: [
      {
        rule_id: "R1",
        decision: "pass",
        confidence: "high",
        reason: "补丁未见违反规则的实现。",
        evidence_used: ["generated/entry/src/main.ets"],
        needs_human_review: false,
      },
    ],
  };
}

function finalAnswerWithTwoRules() {
  return {
    ...finalAnswer(),
    rule_assessments: [
      ...finalAnswer().rule_assessments,
      {
        rule_id: "R2",
        decision: "pass",
        confidence: "medium",
        reason: "补丁未见违反第二条规则的实现。",
        evidence_used: ["generated/entry/src/feature.ets"],
        needs_human_review: false,
      },
    ],
  };
}

test("runOpencodeRuleAssessment prompts opencode to inspect sandbox and returns existing rule result shape", async () => {
  let prompt = "";
  let requestTag = "";
  let title = "";
  let agent = "";
  let outputFile = "";
  const sandboxRoot = "/runs/20260427T031830_full_generation_8a3c0a1a/opencode-sandbox";
  const result = await runOpencodeRuleAssessment({
    sandboxRoot,
    bootstrapPayload: payload(),
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
        elapsedMs: 12,
      };
    },
  });

  assert.equal(prompt.includes("tool" + "_call"), false);
  assert.match(prompt, /执行任务前必须使用 hmos-rule-assessment skill/);
  assert.match(prompt, /该 skill 中的输出契约和自检清单是本次输出的强制要求/);
  assert.doesNotMatch(prompt, /表单重置完整/);
  assert.match(prompt, /generated\//);
  assert.match(prompt, /original\//);
  assert.match(prompt, /patch\//);
  assert.doesNotMatch(prompt, /references\//);
  assert.match(prompt, /优先阅读 patch\/effective\.patch/);
  assert.match(prompt, /根据 patch 中出现的文件路径继续阅读相关 generated\/ 或 original\/ 上下文/);
  assert.doesNotMatch(prompt, /rubric_summary/);
  assert.doesNotMatch(prompt, /evidence_snippets/);
  assert.doesNotMatch(prompt, /SHOULD_NOT_BE_SENT_TO_RULE_AGENT/);
  assert.doesNotMatch(prompt, /未接入静态判定器本身不是人工复核理由/);
  assert.doesNotMatch(prompt, /新增代码未发现该规则相关问题时/);
  assert.doesNotMatch(prompt, /同一候选规则包含多个 target_checks 时，必须逐个 target 审视/);
  assert.doesNotMatch(prompt, /候选规则包含 kit 时，必须重点核查指定 Kit/);
  assert.doesNotMatch(prompt, /ArkUI 内置组件型 kit 不要求 import/);
  assert.doesNotMatch(prompt, /非 ArkUI kit 若 static_precheck\.signal_status 为 partial_matched/);
  assert.doesNotMatch(prompt, /不能仅凭同名函数或相似命名直接判定 pass/);
  assert.match(prompt, /ArkUI: Tabs \/ TabContent/);
  assert.match(prompt, /target_checks/);
  assert.doesNotMatch(prompt, /initial_target_files/);
  assert.match(prompt, /output_file: metadata\/agent-output\/rule-assessment\.json/);
  assert.doesNotMatch(prompt, /严格遵守 system prompt 中的正确输出格式/);
  assert.doesNotMatch(prompt, /JSON 字符串中的英文双引号必须转义/);
  assert.doesNotMatch(prompt, /先改写为不含双引号的中文转述/);
  assert.doesNotMatch(prompt, /正确输出格式:/);
  assert.doesNotMatch(prompt, /"rule_assessments"\s*:/);
  assert.equal(requestTag, "rule-assessment-case-1-20260427T031830_full_generation_8a3c0a1a");
  assert.equal(title, requestTag);
  assert.equal(agent, "hmos-rule-assessment");
  assert.equal(outputFile, "metadata/agent-output/rule-assessment.json");
  assert.equal(result.outcome, "success");
  assert.deepEqual(result.final_answer?.rule_assessments[0], {
    rule_id: "R1",
    decision: "pass",
    confidence: "high",
    reason: "补丁未见违反规则的实现。",
    evidence_used: ["generated/entry/src/main.ets"],
    needs_human_review: false,
  });
  assert.equal(result.raw_events, "{}\n");
});

test("runOpencodeRuleAssessment compacts duplicate case rule file hints in prompt payload", async () => {
  let prompt = "";
  const result = await runOpencodeRuleAssessment({
    sandboxRoot: "/sandbox/case",
    bootstrapPayload: {
      ...payload(),
      assisted_rule_candidates: [
        {
          ...payload().assisted_rule_candidates[0],
          is_case_rule: true,
          evidence_files: [
            "generated/a.ets",
            "generated/b.ets",
            "generated/c.ets",
            "generated/d.ets",
            "generated/e.ets",
            "generated/f.ets",
            "generated/g.ets",
            "generated/h.ets",
          ],
          static_precheck: {
            target_matched: true,
            target_files: [
              "generated/a.ets",
              "generated/b.ets",
              "generated/c.ets",
              "generated/d.ets",
              "generated/e.ets",
              "generated/f.ets",
              "generated/g.ets",
              "generated/h.ets",
            ],
            matched_files: ["generated/f.ets", "generated/b.ets"],
            signal_status: "partial_matched",
            matched_tokens: ["Tabs"],
            summary: "Kit 静态锚点命中 1/2。",
          },
        },
      ],
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
  const promptPayload = extractPromptPayload(prompt);
  const candidates = promptPayload.assisted_rule_candidates as Array<Record<string, unknown>>;
  const candidate = candidates[0] as Record<string, unknown>;
  const staticPrecheck = candidate.static_precheck as Record<string, unknown>;

  assert.equal("evidence_files" in candidate, false);
  assert.equal("target_files" in staticPrecheck, false);
  assert.equal(staticPrecheck.target_file_count, 8);
  assert.deepEqual(staticPrecheck.representative_files, [
    "generated/f.ets",
    "generated/b.ets",
    "generated/a.ets",
    "generated/c.ets",
    "generated/d.ets",
  ]);
});

test("runOpencodeRuleAssessment compacts static-precheck candidates even when they are built-in rules", async () => {
  let prompt = "";
  const result = await runOpencodeRuleAssessment({
    sandboxRoot: "/sandbox/case",
    bootstrapPayload: {
      ...payload(),
      assisted_rule_candidates: [
        {
          ...payload().assisted_rule_candidates[0],
          rule_id: "RSP-MUST-01",
          rule_source: "must_rule",
          rule_name: "横向断点划分范围必须符合系统推荐值",
          priority: "P0",
          evidence_files: [
            "generated/commons/lib_common/Index.ets",
            "generated/commons/lib_common/src/main/ets/constants/BreakpointConstants.ets",
            "generated/features/home/src/main/ets/components/TelevisionLikeView.ets",
          ],
          static_precheck: {
            target_matched: true,
            target_files: [
              "generated/commons/lib_common/Index.ets",
              "generated/commons/lib_common/src/main/ets/constants/BreakpointConstants.ets",
              "generated/features/home/src/main/ets/components/TelevisionLikeView.ets",
            ],
            matched_files: [],
            signal_status: "none_matched",
            matched_tokens: [],
            summary:
              "静态预判在目标文件中命中了 0/0 个 AST 信号。Kit 静态锚点强证据命中 0/1。",
          },
        },
      ],
    },
    runPrompt: async (request) => {
      prompt = request.prompt;
      return {
        requestTag: request.requestTag,
        rawEvents: "",
        rawText: JSON.stringify({
          summary: finalAnswer().summary,
          rule_assessments: [
            {
              ...finalAnswer().rule_assessments[0],
              rule_id: "RSP-MUST-01",
            },
          ],
        }),
        elapsedMs: 1,
      };
    },
  });

  assert.equal(result.outcome, "success");
  const promptPayload = extractPromptPayload(prompt);
  const candidates = promptPayload.assisted_rule_candidates as Array<Record<string, unknown>>;
  const candidate = candidates[0] as Record<string, unknown>;
  const staticPrecheck = candidate.static_precheck as Record<string, unknown>;

  assert.equal("evidence_files" in candidate, false);
  assert.equal("target_files" in staticPrecheck, false);
  assert.equal(staticPrecheck.target_file_count, 3);
  assert.deepEqual(staticPrecheck.representative_files, []);
});

test("runOpencodeRuleAssessment omits expected constraints from original prompt summary", async () => {
  let prompt = "";
  const result = await runOpencodeRuleAssessment({
    sandboxRoot: "/sandbox/case",
    bootstrapPayload: {
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
          "    name: 横向断点划分范围必须符合系统推荐值",
          "    kit:",
          "      - \"ArkUI: GridRow / WidthBreakpoint\"",
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
  const promptPayload = extractPromptPayload(prompt);
  const caseContext = promptPayload.case_context as Record<string, unknown>;

  assert.equal(
    caseContext.original_prompt_summary,
    "任务描述：停车缴费元服务完成一多适配\n\n输入要求：帮我把当前的停车缴费元服务完成一多适配",
  );
  assert.doesNotMatch(prompt, /RSP-MUST-01/);
  assert.doesNotMatch(prompt, /GridRow \/ WidthBreakpoint/);
});

test("runOpencodeRuleAssessment retries once with strict format guidance after protocol error", async () => {
  const calls: Array<{ requestTag: string; title?: string; prompt: string }> = [];
  const result = await runOpencodeRuleAssessment({
    sandboxRoot: "/runs/20260427T031830_full_generation_8a3c0a1a/opencode-sandbox",
    bootstrapPayload: payload(),
    runPrompt: async (request) => {
      calls.push({ requestTag: request.requestTag, title: request.title, prompt: request.prompt });
      return {
        requestTag: request.requestTag,
        rawEvents: "{}\n",
        rawText: calls.length === 1 ? "规则判定完成，但这里不是 JSON。" : JSON.stringify(finalAnswer()),
        elapsedMs: 1,
      };
    },
  });

  assert.equal(result.outcome, "success");
  assert.equal(calls.length, 2);
  assert.equal(calls[0]?.requestTag, "rule-assessment-case-1-20260427T031830_full_generation_8a3c0a1a");
  assert.equal(calls[1]?.requestTag, "rule-assessment-case-1-20260427T031830_full_generation_8a3c0a1a-retry-1");
  assert.equal(calls[1]?.title, calls[1]?.requestTag);
  assert.match(calls[1]?.prompt ?? "", /规则判定 agent。本次是重试/);
  assert.match(calls[1]?.prompt ?? "", /本次是重试。仍必须使用 hmos-rule-assessment skill/);
  assert.match(calls[1]?.prompt ?? "", /只修复 listed protocol errors/);
  assert.match(calls[1]?.prompt ?? "", /reason 与该 rule_id 的候选规则语义不相关/);
  assert.match(calls[1]?.prompt ?? "", /相关性修正不视为违规重判/);
  assert.match(calls[1]?.prompt ?? "", /最终输出不是唯一 JSON object/);
  assert.match(calls[1]?.prompt ?? "", /严格遵守 system prompt 中的正确输出格式/);
  assert.match(calls[1]?.prompt ?? "", /candidate_rule_ids/);
  assert.doesNotMatch(calls[1]?.prompt ?? "", /正确输出格式:/);
  assert.doesNotMatch(calls[1]?.prompt ?? "", /rule_retry_payload/);
  assert.doesNotMatch(calls[1]?.prompt ?? "", /task_understanding/);
  assert.doesNotMatch(calls[1]?.prompt ?? "", /why_uncertain/);
  assert.doesNotMatch(calls[1]?.prompt ?? "", /bootstrap_payload:/);
  assert.doesNotMatch(calls[1]?.prompt ?? "", /original_prompt_summary/);
  assert.doesNotMatch(calls[1]?.prompt ?? "", /rubric_summary/);
});

test("runOpencodeRuleAssessment succeeds on the second retry after repeated protocol errors", async () => {
  const calls: string[] = [];
  const result = await runOpencodeRuleAssessment({
    sandboxRoot: "/runs/20260427T031830_full_generation_8a3c0a1a/opencode-sandbox",
    bootstrapPayload: payload(),
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
    "rule-assessment-case-1-20260427T031830_full_generation_8a3c0a1a",
    "rule-assessment-case-1-20260427T031830_full_generation_8a3c0a1a-retry-1",
    "rule-assessment-case-1-20260427T031830_full_generation_8a3c0a1a-retry-2",
  ]);
});

test("runOpencodeRuleAssessment retries once with strict format guidance after request failure", async () => {
  const calls: Array<{ requestTag: string; title?: string; prompt: string }> = [];
  const result = await runOpencodeRuleAssessment({
    sandboxRoot: "/runs/20260427T031830_full_generation_8a3c0a1a/opencode-sandbox",
    bootstrapPayload: payload(),
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
  assert.equal(calls[1]?.requestTag, "rule-assessment-case-1-20260427T031830_full_generation_8a3c0a1a-retry-1");
  assert.equal(calls[1]?.title, calls[1]?.requestTag);
  assert.match(calls[1]?.prompt ?? "", /规则判定 agent。本次是重试/);
  assert.match(calls[1]?.prompt ?? "", /本次是重试。仍必须使用 hmos-rule-assessment skill/);
  assert.match(calls[1]?.prompt ?? "", /只修复 listed protocol errors/);
  assert.match(calls[1]?.prompt ?? "", /缺少 assistant 最终文本/);
  assert.match(calls[1]?.prompt ?? "", /严格遵守 system prompt 中的正确输出格式/);
  assert.match(calls[1]?.prompt ?? "", /candidate_rule_ids/);
  assert.doesNotMatch(calls[1]?.prompt ?? "", /正确输出格式:/);
  assert.doesNotMatch(calls[1]?.prompt ?? "", /rule_retry_payload/);
  assert.doesNotMatch(calls[1]?.prompt ?? "", /bootstrap_payload:/);
});

test("runOpencodeRuleAssessment retries once after initial opencode timeout", async () => {
  const calls: string[] = [];
  const result = await runOpencodeRuleAssessment({
    sandboxRoot: "/runs/20260427T031830_full_generation_8a3c0a1a/opencode-sandbox",
    bootstrapPayload: payload(),
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
    "rule-assessment-case-1-20260427T031830_full_generation_8a3c0a1a",
    "rule-assessment-case-1-20260427T031830_full_generation_8a3c0a1a-retry-1",
  ]);
});

test("runOpencodeRuleAssessment succeeds on the second retry after an initial timeout", async () => {
  const calls: string[] = [];
  const result = await runOpencodeRuleAssessment({
    sandboxRoot: "/runs/20260427T031830_full_generation_8a3c0a1a/opencode-sandbox",
    bootstrapPayload: payload(),
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
    "rule-assessment-case-1-20260427T031830_full_generation_8a3c0a1a",
    "rule-assessment-case-1-20260427T031830_full_generation_8a3c0a1a-retry-1",
    "rule-assessment-case-1-20260427T031830_full_generation_8a3c0a1a-retry-2",
  ]);
});

test("runOpencodeRuleAssessment fails when both retries also time out", async () => {
  const calls: string[] = [];
  const result = await runOpencodeRuleAssessment({
    sandboxRoot: "/runs/20260427T031830_full_generation_8a3c0a1a/opencode-sandbox",
    bootstrapPayload: payload(),
    runPrompt: async (request) => {
      calls.push(request.requestTag);
      throw new Error(`opencode 调用超时 request=${request.requestTag}`);
    },
  });

  assert.equal(result.outcome, "request_failed");
  assert.match(result.failure_reason ?? "", /opencode 调用超时/);
  assert.deepEqual(calls, [
    "rule-assessment-case-1-20260427T031830_full_generation_8a3c0a1a",
    "rule-assessment-case-1-20260427T031830_full_generation_8a3c0a1a-retry-1",
    "rule-assessment-case-1-20260427T031830_full_generation_8a3c0a1a-retry-2",
  ]);
});

test("runOpencodeRuleAssessment retries missing rules by repairing the first output file", async () => {
  const calls: Array<{ requestTag: string; prompt: string; preserveOutputFileOnStart?: boolean }> = [];
  const result = await runOpencodeRuleAssessment({
    sandboxRoot: "/sandbox/case",
    bootstrapPayload: payloadWithTwoRules(),
    runPrompt: async (request) => {
      calls.push({
        requestTag: request.requestTag,
        prompt: request.prompt,
        preserveOutputFileOnStart: request.preserveOutputFileOnStart,
      });
      return {
        requestTag: request.requestTag,
        rawEvents: "",
        rawText: JSON.stringify(calls.length === 1 ? finalAnswer() : finalAnswerWithTwoRules()),
        elapsedMs: 1,
      };
    },
  });

  assert.equal(result.outcome, "success");
  assert.equal(calls.length, 2);
  assert.equal(calls[0]?.preserveOutputFileOnStart, undefined);
  assert.equal(calls[1]?.preserveOutputFileOnStart, true);
  assert.match(calls[1]?.prompt ?? "", /missing=R2/);
  assert.match(calls[1]?.prompt ?? "", /读取并修改已有 output_file/);
  assert.match(calls[1]?.prompt ?? "", /只补齐列出的候选 rule_id/);
  assert.deepEqual(
    result.final_answer?.rule_assessments.map((assessment) => assessment.rule_id),
    ["R1", "R2"],
  );
});

test("runOpencodeRuleAssessment filters unexpected rule ids and deduplicates through the local skeleton", async () => {
  let calls = 0;
  const result = await runOpencodeRuleAssessment({
    sandboxRoot: "/sandbox/case",
    bootstrapPayload: payload(),
    runPrompt: async (request) => {
      calls += 1;
      return {
        requestTag: request.requestTag,
        rawEvents: "",
        rawText: JSON.stringify({
          summary: { assistant_scope: "读取 sandbox 后完成判定。", overall_confidence: "medium" },
          rule_assessments: [
            {
              rule_id: "UNKNOWN",
              decision: "violation",
              confidence: "high",
              reason: "未知规则应被过滤。",
              evidence_used: ["generated/entry/src/main.ets"],
              needs_human_review: false,
            },
            finalAnswer().rule_assessments[0],
            {
              ...finalAnswer().rule_assessments[0],
              decision: "violation",
              reason: "重复规则应被本地骨架去重。",
            },
          ],
        }),
        elapsedMs: 1,
      };
    },
  });

  assert.equal(result.outcome, "success");
  assert.equal(calls, 1);
  assert.equal(result.final_answer?.rule_assessments.length, 1);
  assert.deepEqual(result.final_answer?.rule_assessments[0], finalAnswer().rule_assessments[0]);
});

test("runOpencodeRuleAssessment ignores extra fields and coerces review boolean strings", async () => {
  const answer = finalAnswer() as unknown as Record<string, unknown>;
  answer["extra_top_level"] = "ignored";
  answer.summary = {
    ...(answer.summary as Record<string, unknown>),
    extra_summary: "ignored",
  };
  answer.rule_assessments = [
    {
      ...finalAnswer().rule_assessments[0],
      needs_human_review: "false",
      extra_assessment_note: "ignored",
    },
  ];

  const result = await runOpencodeRuleAssessment({
    sandboxRoot: "/sandbox/case",
    bootstrapPayload: payload(),
    runPrompt: async (request) => ({
      requestTag: request.requestTag,
      rawEvents: "",
      rawText: JSON.stringify(answer),
      elapsedMs: 1,
    }),
  });

  assert.equal(result.outcome, "success");
  assert.equal(result.final_answer?.rule_assessments[0]?.needs_human_review, false);
  assert.equal("extra_top_level" in (result.final_answer as unknown as Record<string, unknown>), false);
  assert.equal(
    "extra_assessment_note" in
      (result.final_answer?.rule_assessments[0] as unknown as Record<string, unknown>),
    false,
  );
});

test("runOpencodeRuleAssessment rejects replacement reason fields without required names", async () => {
  const answer = finalAnswer() as unknown as Record<string, unknown>;
  answer.rule_assessments = [
    {
      rule_id: "R1",
      decision: "pass",
      confidence: "high",
      message: "替代字段不应生效。",
      evidence_used: [],
      needs_human_review: false,
    },
  ];

  const result = await runOpencodeRuleAssessment({
    sandboxRoot: "/sandbox/case",
    bootstrapPayload: payload(),
    runPrompt: async (request) => ({
      requestTag: request.requestTag,
      rawEvents: "",
      rawText: JSON.stringify(answer),
      elapsedMs: 1,
    }),
  });

  assert.equal(result.outcome, "protocol_error");
  assert.match(result.failure_reason ?? "", /rule_assessments\.0\.reason|rule_assessments\[0\]\.reason/);
});

test("runOpencodeRuleAssessment retry prompt targets concrete protocol failures", async () => {
  const calls: Array<{ requestTag: string; prompt: string }> = [];
  const result = await runOpencodeRuleAssessment({
    sandboxRoot: "/runs/20260427T031830_full_generation_8a3c0a1a/opencode-sandbox",
    bootstrapPayload: payload(),
    runPrompt: async (request) => {
      calls.push({ requestTag: request.requestTag, prompt: request.prompt });
      return {
        requestTag: request.requestTag,
        rawEvents: "{}\n",
        rawText:
          calls.length === 1
            ? JSON.stringify({
                summary: { assistant_scope: "bad", overall_confidence: "medium" },
                rule_assessments: [
                  {
                    rule_id: "R1",
                    decision: "pass",
                    confidence: "high",
                    message: "replacement reason field is invalid",
                    evidence_used: [],
                    needs_human_review: false,
                    extra: "not allowed",
                  },
                ],
              })
            : JSON.stringify(finalAnswer()),
        elapsedMs: 1,
      };
    },
  });

  assert.equal(result.outcome, "success");
  assert.equal(calls.length, 2);
  assert.match(calls[1]?.prompt ?? "", /schema_error/);
  assert.match(calls[1]?.prompt ?? "", /只修复 listed protocol errors/);
  assert.match(calls[1]?.prompt ?? "", /删除未声明字段/);
});
