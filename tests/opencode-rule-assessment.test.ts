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
        evidence_snippets: [],
      },
    ],
    initial_target_files: ["generated/entry/src/main.ets"],
  };
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

test("runOpencodeRuleAssessment prompts opencode to inspect sandbox and returns existing rule result shape", async () => {
  let prompt = "";
  let requestTag = "";
  let title = "";
  let agent = "";
  const sandboxRoot = "/runs/20260427T031830_full_generation_8a3c0a1a/opencode-sandbox";
  const result = await runOpencodeRuleAssessment({
    sandboxRoot,
    bootstrapPayload: payload(),
    runPrompt: async (request) => {
      prompt = request.prompt;
      requestTag = request.requestTag;
      title = request.title ?? "";
      agent = request.agent ?? "";
      return {
        requestTag: request.requestTag,
        rawEvents: "{}\n",
        rawText: JSON.stringify(finalAnswer()),
        elapsedMs: 12,
      };
    },
  });

  assert.equal(prompt.includes("tool" + "_call"), false);
  assert.match(prompt, /generated\//);
  assert.match(prompt, /original\//);
  assert.match(prompt, /patch\//);
  assert.equal(requestTag, "rule-assessment-case-1-20260427T031830_full_generation_8a3c0a1a");
  assert.equal(title, requestTag);
  assert.equal(agent, "hmos-rule-assessment");
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
  assert.match(calls[1]?.prompt ?? "", /最终输出不是唯一 JSON object/);
  assert.match(calls[1]?.prompt ?? "", /正确输出格式/);
  assert.match(calls[1]?.prompt ?? "", /rule_retry_payload/);
  assert.doesNotMatch(calls[1]?.prompt ?? "", /bootstrap_payload:/);
  assert.doesNotMatch(calls[1]?.prompt ?? "", /original_prompt_summary/);
  assert.doesNotMatch(calls[1]?.prompt ?? "", /rubric_summary/);
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
  assert.match(calls[1]?.prompt ?? "", /缺少 assistant 最终文本/);
  assert.match(calls[1]?.prompt ?? "", /正确输出格式/);
  assert.match(calls[1]?.prompt ?? "", /rule_retry_payload/);
  assert.doesNotMatch(calls[1]?.prompt ?? "", /bootstrap_payload:/);
});

test("runOpencodeRuleAssessment fills incomplete rule coverage from the local skeleton", async () => {
  const result = await runOpencodeRuleAssessment({
    sandboxRoot: "/sandbox/case",
    bootstrapPayload: payload(),
    runPrompt: async (request) => ({
      requestTag: request.requestTag,
      rawEvents: "",
      rawText: JSON.stringify({
        summary: { assistant_scope: "empty", overall_confidence: "low" },
        rule_assessments: [],
      }),
      elapsedMs: 1,
    }),
  });

  assert.equal(result.outcome, "success");
  assert.equal(result.final_answer?.rule_assessments[0]?.rule_id, "R1");
  assert.equal(result.final_answer?.rule_assessments[0]?.decision, "uncertain");
  assert.equal(result.final_answer?.rule_assessments[0]?.needs_human_review, true);
});

test("runOpencodeRuleAssessment normalizes assessments through the local rule skeleton", async () => {
  const result = await runOpencodeRuleAssessment({
    sandboxRoot: "/sandbox/case",
    bootstrapPayload: payload(),
    runPrompt: async (request) => ({
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
    }),
  });

  assert.equal(result.outcome, "success");
  assert.equal(result.final_answer?.rule_assessments.length, 1);
  assert.deepEqual(result.final_answer?.rule_assessments[0], finalAnswer().rule_assessments[0]);
});

test("runOpencodeRuleAssessment fills omitted candidates as uncertain review items", async () => {
  const result = await runOpencodeRuleAssessment({
    sandboxRoot: "/sandbox/case",
    bootstrapPayload: payload(),
    runPrompt: async (request) => ({
      requestTag: request.requestTag,
      rawEvents: "",
      rawText: JSON.stringify({
        summary: { assistant_scope: "未覆盖所有候选。", overall_confidence: "low" },
        rule_assessments: [],
      }),
      elapsedMs: 1,
    }),
  });

  assert.equal(result.outcome, "success");
  assert.deepEqual(result.final_answer?.rule_assessments[0], {
    rule_id: "R1",
    decision: "uncertain",
    confidence: "low",
    reason: "agent 输出遗漏该候选规则，本地骨架补为 uncertain，需人工复核。",
    evidence_used: [],
    needs_human_review: true,
  });
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
                    reason: "ok",
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
