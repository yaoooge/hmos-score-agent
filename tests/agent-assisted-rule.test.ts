import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAgentBootstrapPayload,
  buildRubricSnapshot,
  mergeRuleAuditResults,
  renderAgentBootstrapPrompt,
  selectAssistedRuleCandidates,
} from "../src/agent/ruleAssistance.js";
import type {
  AssistedRuleCandidate,
  ConstraintSummary,
  LoadedRubricSnapshot,
  RuleAuditResult,
} from "../src/types.js";

const constraintSummary: ConstraintSummary = {
  explicitConstraints: ["修复列表页渲染异常"],
  contextualConstraints: ["保持现有模块结构"],
  implicitConstraints: ["优先最小改动"],
  classificationHints: ["bug_fix"],
};

const rubricSnapshot: LoadedRubricSnapshot = {
  task_type: "bug_fix",
  evaluation_mode: "auto_precheck_with_human_review",
  scenario:
    "用户提供 Bug 修复 diff、修复前后代码、问题描述与修复结果，目标是评价修复是否命中问题且控制侵入范围。",
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
    {
      rule_id: "ARKTS-MUST-001",
      rule_source: "must_rule",
      result: "满足",
      conclusion: "未发现违规证据。",
    },
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
  assert.equal(
    result.assistedRuleCandidates[0]?.why_uncertain,
    "当前规则需要 Agent 结合上下文做辅助判定。",
  );
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

  assert.deepEqual(result.assistedRuleCandidates[0]?.evidence_files, [
    "entry/src/main/ets/pages/Index.ets",
  ]);
  assert.deepEqual(result.assistedRuleCandidates[0]?.evidence_snippets, [
    "@Entry\n@Component\nstruct Index {",
  ]);
});

test("mergeRuleAuditResults maps not_applicable assessments to 不涉及", () => {
  const merged = mergeRuleAuditResults({
    deterministicRuleResults: [],
    assistedRuleCandidates: [
      {
        rule_id: "ARKTS-SHOULD-003",
        rule_source: "should_rule",
        why_uncertain: "需要语义判断",
        local_preliminary_signal: "unknown",
        evidence_files: ["entry/src/main/ets/pages/Index.ets"],
        evidence_snippets: ["let ready = false;"],
      },
    ],
    agentOutputText:
      '{"action":"final_answer","summary":{"assistant_scope":"本次仅辅助弱规则判定","overall_confidence":"high"},"rule_assessments":[{"rule_id":"ARKTS-SHOULD-003","decision":"not_applicable","confidence":"high","reason":"未看到相关实现证据，当前不涉及。","evidence_used":[],"needs_human_review":false}]}',
  });

  assert.equal(merged.agentRunStatus, "success");
  assert.equal(merged.mergedRuleAuditResults[0]?.result, "不涉及");
  assert.equal(merged.mergedRuleAuditResults[0]?.conclusion, "未看到相关实现证据，当前不涉及。");
});

test("buildAgentBootstrapPayload emits tool contract instead of inline evidence-only prompt", () => {
  const payload = buildAgentBootstrapPayload({
    caseInput: {
      caseId: "case-1",
      promptText: "实现首页本地资讯定位能力",
      originalProjectPath: "/tmp/original",
      generatedProjectPath: "/tmp/workspace",
      patchPath: "/tmp/effective.patch",
    },
    caseRoot: "/tmp/case-root",
    effectivePatchPath: "/tmp/case-root/intermediate/effective.patch",
    taskType: "continuation",
    constraintSummary,
    rubricSnapshot,
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
    initialTargetFiles: ["entry/src/main/ets/home/viewmodels/HomePageVM.ets"],
  });

  assert.equal(payload.case_context.case_root, "/tmp/case-root");
  assert.equal(
    payload.case_context.effective_patch_path,
    "/tmp/case-root/intermediate/effective.patch",
  );
  assert.equal(payload.initial_target_files[0], "entry/src/main/ets/home/viewmodels/HomePageVM.ets");
  assert.equal(payload.tool_contract.allowed_tools.includes("read_file"), true);
  assert.equal(payload.tool_contract.allowed_tools.includes("read_patch"), true);
  assert.deepEqual(payload.response_contract.action_enum, ["tool_call", "final_answer"]);
});

test("renderAgentBootstrapPrompt instructs the model to choose tool_call or final_answer only", () => {
  const payload = buildAgentBootstrapPayload({
    caseInput: {
      caseId: "case-1",
      promptText: "修复列表页渲染异常",
      originalProjectPath: "/tmp/original",
      generatedProjectPath: "/tmp/workspace",
      patchPath: "/tmp/effective.patch",
    },
    caseRoot: "/tmp/case-root",
    effectivePatchPath: "/tmp/case-root/intermediate/effective.patch",
    taskType: "continuation",
    constraintSummary,
    rubricSnapshot,
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
    initialTargetFiles: ["entry/src/main/ets/home/viewmodels/HomePageVM.ets"],
  });

  const prompt = renderAgentBootstrapPrompt(payload);
  assert.match(prompt, /你只能返回 tool_call 或 final_answer/);
  assert.match(prompt, /case 目录只读工具/);
  assert.match(prompt, /禁止输出 markdown/);
  assert.match(prompt, /read_patch/);
  assert.match(prompt, /read_file/);
  assert.match(prompt, /final_answer/);
  assert.match(prompt, /tool_call/);
  assert.equal(payload.response_contract.output_language, "zh-CN");
  assert.equal(payload.response_contract.json_only, true);
  assert.deepEqual(payload.tool_contract.allowed_tools, [
    "read_patch",
    "list_dir",
    "read_file",
    "read_file_chunk",
    "grep_in_files",
    "read_json",
  ]);
});

test("buildAgentBootstrapPayload keeps case rule metadata on assisted candidates", () => {
  const assistedRuleCandidates: AssistedRuleCandidate[] = [
    {
      rule_id: "HM-REQ-008-06",
      rule_source: "should_rule",
      why_uncertain: "需要结合上下文判断 metadata 是否为 Client ID",
      local_preliminary_signal: "unknown",
      evidence_files: ["entry/src/main/module.json5"],
      evidence_snippets: ['{ "module": { "name": "entry" } }'],
      rule_name: "module.json5 需配置 Client ID",
      priority: "P1",
      llm_prompt: "检查 module.json5 是否配置 Client ID 相关 metadata",
      ast_signals: [{ type: "json_key", name: "metadata" }],
      static_precheck: {
        target_matched: true,
        target_files: ["entry/src/main/module.json5"],
        signal_status: "all_matched",
        matched_tokens: ["metadata"],
        summary: "静态预判在目标文件中发现了 metadata 信号，但最终结论需由 Agent 判定。",
      },
      is_case_rule: true,
    },
  ];

  const payload = buildAgentBootstrapPayload({
    caseInput: {
      caseId: "case-1",
      promptText: "实现登录流程",
      originalProjectPath: "/tmp/original",
      generatedProjectPath: "/tmp/workspace",
      patchPath: "/tmp/changes.patch",
    },
    caseRoot: "/tmp/case-root",
    effectivePatchPath: "/tmp/case-root/intermediate/effective.patch",
    taskType: "full_generation",
    constraintSummary,
    rubricSnapshot,
    assistedRuleCandidates,
    initialTargetFiles: ["entry/src/main/module.json5"],
  });

  assert.equal(payload.assisted_rule_candidates[0]?.rule_name, "module.json5 需配置 Client ID");
  assert.equal(payload.assisted_rule_candidates[0]?.priority, "P1");
  assert.deepEqual(payload.assisted_rule_candidates[0]?.ast_signals, [
    { type: "json_key", name: "metadata" },
  ]);
  assert.equal(
    payload.assisted_rule_candidates[0]?.static_precheck?.signal_status,
    "all_matched",
  );
});

test("buildRubricSnapshot keeps only evaluation summary required by prompt building", () => {
  const snapshot = buildRubricSnapshot({
    taskType: "bug_fix",
    evaluationMode: "auto_precheck_with_human_review",
    scenario:
      "用户提供 Bug 修复 diff、修复前后代码、问题描述与修复结果，目标是评价修复是否命中问题且控制侵入范围。",
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
      {
        rule_id: "ARKTS-MUST-001",
        rule_source: "must_rule",
        result: "满足",
        conclusion: "本地已确定",
      },
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
      '{"action":"final_answer","summary":{"assistant_scope":"本次仅辅助弱规则判定","overall_confidence":"medium"},"rule_assessments":[{"rule_id":"ARKTS-SHOULD-001","decision":"uncertain","confidence":"low","reason":"证据不足","evidence_used":["entry/src/main/ets/pages/Index.ets"],"needs_human_review":true}]}',
  });

  assert.equal(merged.agentRunStatus, "success");
  assert.equal(
    merged.mergedRuleAuditResults.find((item) => item.rule_id === "ARKTS-MUST-001")?.result,
    "满足",
  );
  assert.equal(
    merged.mergedRuleAuditResults.find((item) => item.rule_id === "ARKTS-SHOULD-001")?.result,
    "待人工复核",
  );
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

test("mergeRuleAuditResults preserves agent summary when structured rule assessments are empty", () => {
  const merged = mergeRuleAuditResults({
    deterministicRuleResults: [],
    assistedRuleCandidates: [
      {
        rule_id: "HM-REQ-010-01",
        rule_source: "must_rule",
        why_uncertain: "需要结合上下文判断定位能力是否完成",
        local_preliminary_signal: "unknown",
        evidence_files: ["features/home/src/main/ets/pages/HomePage.ets"],
        evidence_snippets: ["Text('本地')"],
        rule_name: "首页必须新增当前位置或本地频道展示区",
        is_case_rule: true,
      },
    ],
    agentOutputText: JSON.stringify({
      action: "final_answer",
      summary: {
        assistant_scope:
          "未发现 Location Kit、geoLocationManager、getCurrentLocation 或定位权限接入，无法证明本地资讯定位闭环完成。",
        overall_confidence: "high",
      },
      rule_assessments: [],
    }),
  });

  assert.equal(merged.agentRunStatus, "success");
  assert.equal(merged.mergedRuleAuditResults[0]?.result, "待人工复核");
  assert.match(merged.mergedRuleAuditResults[0]?.conclusion ?? "", /未发现 Location Kit/);
  assert.match(merged.mergedRuleAuditResults[0]?.conclusion ?? "", /整体置信度：high/);
  assert.match(merged.mergedRuleAuditResults[0]?.conclusion ?? "", /缺少针对 HM-REQ-010-01 的结构化判定/);
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
