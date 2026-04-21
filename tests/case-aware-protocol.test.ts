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

test("parseCaseAwarePlannerOutputStrict accepts tool_call without optional reason", () => {
  const parsed = parseCaseAwarePlannerOutputStrict(
    JSON.stringify({
      action: "tool_call",
      tool: "read_file",
      args: { path: "workspace/entry/src/main/ets/home/HomePage.ets" },
    }),
  );

  assert.equal(parsed.action, "tool_call");
  assert.equal(parsed.reason, undefined);
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
          rule_assessments: [
            {
              rule_id: "HM-REQ-010-01",
              decision: "uncertain",
              confidence: "low",
              reason: "证据不足。",
              evidence_used: [],
              needs_human_review: true,
            },
          ],
          extra_payload: {
            note: "not part of the canonical schema",
          },
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
