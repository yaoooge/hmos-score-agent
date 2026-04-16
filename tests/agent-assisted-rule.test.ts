import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAgentPromptPayload,
  buildRubricSnapshot,
  mergeRuleAuditResults,
  renderAgentPrompt,
  selectAssistedRuleCandidates,
} from "../src/agent/ruleAssistance.js";
import type { ConstraintSummary, LoadedRubricSnapshot, RuleAuditResult } from "../src/types.js";

const constraintSummary: ConstraintSummary = {
  explicitConstraints: ["修复列表页渲染异常"],
  contextualConstraints: ["保持现有模块结构"],
  implicitConstraints: ["优先最小改动"],
  classificationHints: ["bug_fix"],
};

const rubricSnapshot: LoadedRubricSnapshot = {
  task_type: "bug_fix",
  evaluation_mode: "auto_precheck_with_human_review",
  dimension_summaries: [
    {
      name: "功能正确性",
      weight: 45,
      item_names: ["需求满足度", "边界场景处理"],
    },
  ],
  hard_gates: [{ id: "G4", score_cap: 69 }],
  review_rule_summary: ["关键分段分数需要人工复核"],
};

test("selectAssistedRuleCandidates keeps deterministic results and extracts should-rule candidates", () => {
  const ruleAuditResults: RuleAuditResult[] = [
    { rule_id: "ARKTS-MUST-001", rule_source: "must_rule", result: "满足", conclusion: "未发现违规证据。" },
    {
      rule_id: "ARKTS-SHOULD-001",
      rule_source: "should_rule",
      result: "不涉及",
      conclusion: "当前版本未接入对应判定器。",
    },
    {
      rule_id: "ARKTS-SHOULD-002",
      rule_source: "should_rule",
      result: "不满足",
      conclusion: "检测到规则命中，文件：entry/src/main/ets/pages/Index.ets",
    },
  ];

  const result = selectAssistedRuleCandidates(ruleAuditResults, {
    evidenceByRuleId: {
      "ARKTS-SHOULD-001": {
        evidenceFiles: ["entry/src/main/ets/pages/Index.ets"],
        evidenceSnippets: ["Text(this.message)"],
      },
      "ARKTS-SHOULD-002": {
        evidenceFiles: ["entry/src/main/ets/pages/Index.ets"],
        evidenceSnippets: ["List()"],
      },
    },
  });

  assert.equal(result.deterministicRuleResults.length, 1);
  assert.equal(result.assistedRuleCandidates.length, 2);
  assert.equal(result.assistedRuleCandidates[0]?.rule_id, "ARKTS-SHOULD-001");
  assert.equal(result.assistedRuleCandidates[0]?.why_uncertain, "当前规则需要 Agent 结合上下文做辅助判定。");
});

test("selectAssistedRuleCandidates falls back to shared evidence when rule-level evidence is empty", () => {
  const ruleAuditResults: RuleAuditResult[] = [
    {
      rule_id: "ARKTS-SHOULD-001",
      rule_source: "should_rule",
      result: "不涉及",
      conclusion: "当前版本未接入对应判定器。",
    },
  ];

  const result = selectAssistedRuleCandidates(ruleAuditResults, {
    evidenceByRuleId: {},
    fallbackEvidence: {
      evidenceFiles: ["entry/src/main/ets/pages/Index.ets"],
      evidenceSnippets: ["@Entry\n@Component\nstruct Index {"],
    },
  });

  assert.deepEqual(result.assistedRuleCandidates[0]?.evidence_files, ["entry/src/main/ets/pages/Index.ets"]);
  assert.deepEqual(result.assistedRuleCandidates[0]?.evidence_snippets, ["@Entry\n@Component\nstruct Index {"]);
});

test("buildAgentPromptPayload keeps original prompt as fact and renderAgentPrompt outputs Chinese-only contract", () => {
  const payload = buildAgentPromptPayload({
    caseInput: {
      caseId: "case-1",
      promptText: "修复列表页渲染异常",
      originalProjectPath: "/tmp/original",
      generatedProjectPath: "/tmp/workspace",
      patchPath: "/tmp/changes.patch",
    },
    taskType: "bug_fix",
    constraintSummary,
    rubricSnapshot,
    deterministicRuleResults: [
      { rule_id: "ARKTS-MUST-001", rule_source: "must_rule", result: "满足", conclusion: "ok" },
    ],
    assistedRuleCandidates: [
      {
        rule_id: "ARKTS-SHOULD-001",
        rule_source: "should_rule",
        why_uncertain: "需要结合上下文判断",
        local_preliminary_signal: "possible_violation",
        evidence_files: ["entry/src/main/ets/pages/Index.ets"],
        evidence_snippets: ["Text(this.message)"],
      },
    ],
  });

  assert.equal(payload.case_context.original_prompt_summary.includes("修复列表页渲染异常"), true);
  assert.equal(payload.deterministic_rule_results.length, 1);
  assert.equal(payload.assisted_rule_candidates.length, 1);

  const prompt = renderAgentPrompt(payload);
  assert.match(prompt, /你不是最终评分器/);
  assert.match(prompt, /所有描述型文案必须使用中文/);
  assert.match(prompt, /只能输出 JSON/);
});

test("buildRubricSnapshot keeps only evaluation summary required by prompt building", () => {
  const snapshot = buildRubricSnapshot({
    taskType: "bug_fix",
    evaluationMode: "auto_precheck_with_human_review",
    dimensions: [
      {
        name: "功能正确性",
        weight: 45,
        items: [
          { name: "需求满足度", weight: 25 },
          { name: "边界场景处理", weight: 20 },
        ],
      },
    ],
    hardGates: [{ id: "G4", scoreCap: 69 }],
    reviewRules: {
      scoreBands: [{ min: 60, max: 69 }],
    },
  });

  assert.deepEqual(snapshot, rubricSnapshot);
});

test("mergeRuleAuditResults keeps deterministic results authoritative and maps uncertain agent output to review", () => {
  const merged = mergeRuleAuditResults({
    deterministicRuleResults: [
      { rule_id: "ARKTS-MUST-001", rule_source: "must_rule", result: "满足", conclusion: "本地已确定" },
    ],
    assistedRuleCandidates: [
      {
        rule_id: "ARKTS-SHOULD-001",
        rule_source: "should_rule",
        why_uncertain: "需要语义判断",
        local_preliminary_signal: "unknown",
        evidence_files: ["entry/src/main/ets/pages/Index.ets"],
        evidence_snippets: ["List()"],
      },
    ],
    agentOutputText:
      '{"summary":{"assistant_scope":"本次仅辅助弱规则判定","overall_confidence":"medium"},"rule_assessments":[{"rule_id":"ARKTS-SHOULD-001","decision":"uncertain","confidence":"low","reason":"证据不足","evidence_used":["entry/src/main/ets/pages/Index.ets"],"needs_human_review":true}]}',
  });

  assert.equal(merged.agentRunStatus, "success");
  assert.equal(merged.mergedRuleAuditResults.find((item) => item.rule_id === "ARKTS-MUST-001")?.result, "满足");
  assert.equal(merged.mergedRuleAuditResults.find((item) => item.rule_id === "ARKTS-SHOULD-001")?.result, "待人工复核");
});

test("mergeRuleAuditResults falls back to local review result when agent output is invalid", () => {
  const merged = mergeRuleAuditResults({
    deterministicRuleResults: [],
    assistedRuleCandidates: [
      {
        rule_id: "ARKTS-SHOULD-001",
        rule_source: "should_rule",
        why_uncertain: "需要语义判断",
        local_preliminary_signal: "unknown",
        evidence_files: ["entry/src/main/ets/pages/Index.ets"],
        evidence_snippets: ["List()"],
      },
    ],
    agentOutputText: "not-json",
  });

  assert.equal(merged.agentRunStatus, "invalid_output");
  assert.equal(merged.mergedRuleAuditResults[0]?.rule_id, "ARKTS-SHOULD-001");
  assert.equal(merged.mergedRuleAuditResults[0]?.result, "待人工复核");
});

test("mergeRuleAuditResults normalizes compatible Chinese agent output into local audit results", () => {
  const merged = mergeRuleAuditResults({
    deterministicRuleResults: [],
    assistedRuleCandidates: [
      {
        rule_id: "ARKTS-SHOULD-001",
        rule_source: "should_rule",
        why_uncertain: "需要语义判断",
        local_preliminary_signal: "unknown",
        evidence_files: ["entry/src/main/ets/pages/Index.ets"],
        evidence_snippets: ["List()"],
      },
    ],
    agentOutputText: JSON.stringify({
      case_id: "case-1",
      assisted_rule_judgments: [
        {
          rule_id: "ARKTS-SHOULD-001",
          result: "无法判断",
          confidence: "低",
          needs_human_review: true,
          reason: "证据不足，需要人工复核。",
        },
      ],
      summary: {
        needs_human_review: true,
        reason: "存在不确定候选规则。",
      },
    }),
  });

  assert.equal(merged.agentRunStatus, "success");
  assert.equal(merged.mergedRuleAuditResults[0]?.result, "待人工复核");
  assert.equal(merged.mergedRuleAuditResults[0]?.conclusion, "证据不足，需要人工复核。");
});

test("mergeRuleAuditResults accepts compatible Chinese output that uses judgment and global_assessment fields", () => {
  const merged = mergeRuleAuditResults({
    deterministicRuleResults: [],
    assistedRuleCandidates: [
      {
        rule_id: "ARKTS-SHOULD-001",
        rule_source: "should_rule",
        why_uncertain: "需要语义判断",
        local_preliminary_signal: "unknown",
        evidence_files: ["entry/src/main/ets/pages/Index.ets"],
        evidence_snippets: ["List()"],
      },
    ],
    agentOutputText: JSON.stringify({
      case_id: "case-1",
      assisted_rule_judgments: [
        {
          rule_id: "ARKTS-SHOULD-001",
          judgment: "无法判断",
          confidence: "低",
          needs_human_review: true,
          reason: "当前信息不足，建议人工复核。",
        },
      ],
      global_assessment: {
        needs_human_review: true,
        summary: "候选弱规则均需人工复核。",
      },
    }),
  });

  assert.equal(merged.agentRunStatus, "success");
  assert.equal(merged.mergedRuleAuditResults[0]?.result, "待人工复核");
  assert.equal(merged.mergedRuleAuditResults[0]?.conclusion, "当前信息不足，建议人工复核。");
});
