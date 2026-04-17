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
  scenario: "用户提供 Bug 修复 diff、修复前后代码、问题描述与修复结果，目标是评价修复是否命中问题且控制侵入范围。",
  scoring_method: "discrete_band",
  scoring_note: "二级指标按离散档位给分，优先看是否命中问题。",
  common_risks: ["因顺手优化造成 diff 噪音和误修。"],
  report_emphasis: ["是否命中问题点。"],
  dimension_summaries: [
    {
      name: "改动精准度与最小侵入性",
      weight: 25,
      intent: "评价是否精准修复问题且控制改动范围",
      item_summaries: [
        {
          name: "问题点命中程度",
          weight: 10,
          scoring_bands: [
            { score: 10, criteria: "修改直接命中根因或完整故障链路。" },
            { score: 8, criteria: "明确命中主要问题点，根因判断基本成立。" },
          ],
        },
      ],
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
  assert.deepEqual(payload.response_contract.required_top_level_fields, ["summary", "rule_assessments"]);
  assert.deepEqual(payload.response_contract.rule_assessment_schema.required_fields, [
    "rule_id",
    "decision",
    "confidence",
    "reason",
    "evidence_used",
    "needs_human_review",
  ]);

  const prompt = renderAgentPrompt(payload);
  assert.match(prompt, /你不是最终评分器/);
  assert.match(prompt, /所有描述型文案必须使用中文/);
  assert.match(prompt, /只能输出 JSON/);
  assert.match(prompt, /summary/);
  assert.match(prompt, /rule_assessments/);
  assert.match(prompt, /assistant_scope/);
  assert.match(prompt, /overall_confidence/);
  assert.match(prompt, /decision/);
  assert.match(prompt, /reason/);
  assert.match(prompt, /evidence_used/);
  assert.match(prompt, /needs_human_review/);
  assert.match(prompt, /decision 只能是 violation、pass、not_applicable、uncertain/);
  assert.match(prompt, /confidence 只能是 high、medium、low/);
  assert.match(prompt, /不得补充额外字段/);
  assert.match(prompt, /合法输出示例/);
  assert.match(prompt, /问题点命中程度/);
  assert.match(prompt, /修改直接命中根因/);
  assert.match(prompt, /二级维度/);
});

test("buildRubricSnapshot keeps only evaluation summary required by prompt building", () => {
  const snapshot = buildRubricSnapshot({
    taskType: "bug_fix",
    evaluationMode: "auto_precheck_with_human_review",
    scenario: "用户提供 Bug 修复 diff、修复前后代码、问题描述与修复结果，目标是评价修复是否命中问题且控制侵入范围。",
    scoringMethod: "discrete_band",
    scoringNote: "二级指标按离散档位给分，优先看是否命中问题。",
    commonRisks: ["因顺手优化造成 diff 噪音和误修。"],
    reportEmphasis: ["是否命中问题点。"],
    dimensions: [
      {
        name: "改动精准度与最小侵入性",
        weight: 25,
        intent: "评价是否精准修复问题且控制改动范围",
        items: [
          {
            name: "问题点命中程度",
            weight: 10,
            scoringBands: [
              { score: 10, criteria: "修改直接命中根因或完整故障链路。" },
              { score: 8, criteria: "明确命中主要问题点，根因判断基本成立。" },
            ],
          },
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

test("mergeRuleAuditResults rejects outputs that add unexpected fields beyond the new schema", () => {
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
      summary: {
        assistant_scope: "本次仅辅助候选规则判定",
        overall_confidence: "medium",
      },
      rule_assessments: [
        {
          rule_id: "ARKTS-SHOULD-001",
          decision: "uncertain",
          confidence: "low",
          needs_human_review: true,
          reason: "证据不足，需要人工复核。",
          evidence_used: ["entry/src/main/ets/pages/Index.ets"],
          extra_note: "unexpected",
        },
      ],
      extra_summary: "unexpected",
    }),
  });

  assert.equal(merged.agentRunStatus, "invalid_output");
  assert.equal(merged.agentAssistedRuleResults, null);
  assert.equal(merged.mergedRuleAuditResults[0]?.result, "待人工复核");
  assert.match(merged.mergedRuleAuditResults[0]?.conclusion ?? "", /Agent 未能提供有效判定/);
});
