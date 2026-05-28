import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { validateReportResult } from "../src/report/schemaValidator.js";

// 保持一个最小但完整的合法结果对象，作为 schema gate 的基线样本。
function makeValidResultJson(): Record<string, unknown> {
  return {
    schema_version: "result.v2",
    basic_info: {
      rubric_version: "v1",
      task_type: "bug_fix",
      evaluation_mode: "auto_precheck_with_human_review",
      rules_enabled: true,
      build_check_enabled: false,
      target_description: "HarmonyOS 生成工程评分",
      target_scope: "/tmp/workspace",
      task_type_basis: "patch present",
    },
    overall_conclusion: {
      total_score: 80,
      pre_cap_score: 80,
      hard_gate_triggered: false,
      hard_gates: [],
      summary: "ok",
    },
    score_policy: {
      risk_level_weights: {
        high: 1,
        medium: 0.6,
        low: 0.3,
        none: 0,
      },
    },
    dimension_results: [
      {
        dimension_name: "改动精准度与最小侵入性",
        dimension_intent: "评价是否精准修复问题且控制改动范围",
        score: 18,
        max_score: 25,
        comment: "包含需要人工复核的扣分项。",
        agent_evaluation_summary: {
          base_score: 20,
          logic: "rubric agent 认为问题点基本命中，但闭环证据不足。",
          key_evidence: ["workspace/entry/src/main/ets/pages/Index.ets"],
          confidence: "medium",
        },
        rule_violation_summary: {
          violated_rule_count: 1,
          affected_item_count: 1,
          total_rule_delta: -2,
          summary: "一个 should_rule 影响该维度得分。",
        },
        item_results: [
          {
            item_name: "问题点命中程度",
            item_weight: 10,
            score: 8,
            matched_band: {
              score: 8,
              criteria: "明确命中主要问题点，根因判断基本成立。",
            },
            confidence: "medium",
            review_required: true,
            agent_evaluation: {
              base_score: 10,
              matched_band_score: 10,
              matched_criteria: "直接命中根因，修复路径闭环。",
              logic: "patch 命中目标函数，但闭环证据不足。",
              evidence_used: ["workspace/entry/src/main/ets/pages/Index.ets"],
              confidence: "medium",
              deduction_trace: null,
            },
            rule_impacts: [
              {
                rule_id: "ARKTS-SHOULD-001",
                rule_source: "should_rule",
                result: "不满足",
                severity: "light",
                score_delta: -2,
                agent_assisted: false,
                needs_human_review: false,
              },
            ],
            score_fusion: {
              base_score: 10,
              rule_delta: -2,
              final_score: 8,
              fusion_logic: "rubric 基础分 10，规则轻扣 2 分，最终 8 分。",
            },
          },
        ],
      },
    ],
    bound_rule_packs: [
      {
        pack_id: "arkts-language",
        display_name: "从 TypeScript 到 ArkTS 的适配规则与 ArkTS 编程规范",
      },
      {
        pack_id: "arkts-performance",
        display_name: "ArkTS 高性能编程实践",
      },
    ],
    case_rule_results: [],
    risks: [],
    strengths: [],
    main_issues: [],
    human_review_items: [],
    final_recommendation: [],
    rule_audit_results: [],
    official_linter_summary: {
      configuredRuleSets: [
        "plugin:@typescript-eslint/recommended",
        "plugin:@security/recommended",
        "plugin:@performance/recommended",
        "plugin:@hw-stylistic/recommended",
      ],
      effectiveFindingCount: 0,
      runStatus: "not_installed",
      durationMs: 0,
    },
    report_meta: {
      report_file_name: "report.html",
      result_json_file_name: "result.json",
      unit_name: "case-1",
      generated_at: new Date().toISOString(),
    },
  };
}

test("validateReportResult accepts schema-valid output", () => {
  const schemaPath = path.resolve(process.cwd(), "references/scoring/report_result_schema.json");
  assert.doesNotThrow(() => validateReportResult(makeValidResultJson(), schemaPath));
});

test("validateReportResult accepts result with case_rule_results", () => {
  const schemaPath = path.resolve(process.cwd(), "references/scoring/report_result_schema.json");
  const valid = makeValidResultJson();
  valid.case_rule_results = [
    {
      rule_id: "HM-REQ-008-01",
      rule_name: "必须使用 LoginWithHuaweiIDButton",
      priority: "P0",
      rule_source: "must_rule",
      result: "满足",
      conclusion: "ok",
      hard_gate_triggered: false,
    },
  ];

  assert.doesNotThrow(() => validateReportResult(valid, schemaPath));
});

test("validateReportResult accepts result with bound_rule_packs", () => {
  const schemaPath = path.resolve(process.cwd(), "references/scoring/report_result_schema.json");
  const valid = makeValidResultJson();
  valid.bound_rule_packs = [
    {
      pack_id: "arkts-language",
      display_name: "从 TypeScript 到 ArkTS 的适配规则与 ArkTS 编程规范",
    },
    {
      pack_id: "case-requirement_004",
      display_name: "用例 requirement_004 约束规则",
    },
  ];

  assert.doesNotThrow(() => validateReportResult(valid, schemaPath));
});

test("validateReportResult accepts normalized risk identity fields", () => {
  const schemaPath = path.resolve(process.cwd(), "references/scoring/report_result_schema.json");
  const valid = makeValidResultJson();
  valid.risks = [
    {
      id: 1,
      level: "high",
      title: "需求未实现",
      risk_code: "REQUIREMENT_NOT_IMPLEMENTED",
      risk_category: "high",
      source_rule_id: "ARKTS-MUST-001",
      evidence: "触发 ARKTS-MUST-001。",
    },
  ];

  assert.doesNotThrow(() => validateReportResult(valid, schemaPath));
});

test("validateReportResult accepts v2 hard gates and rule risks with evidence", () => {
  const schemaPath = path.resolve(process.cwd(), "references/scoring/report_result_schema.json");
  const valid = makeValidResultJson();
  valid.overall_conclusion = {
    total_score: 69,
    pre_cap_score: 85,
    hard_gate_triggered: true,
    hard_gates: [
      {
        id: "G1",
        name: "高密度静态错误",
        score_cap: 69,
        description: "大量未定义引用、类型错误、import/export 错位或明显不可运行代码片段密集出现。",
        trigger_reason: "must_rule 不满足数量达到硬门槛阈值",
        trigger_policy: {
          type: "must_violation_count",
          threshold: 2,
          actual: 3,
        },
        triggered_rule_ids: ["ARKTS-MUST-001", "ARKTS-MUST-003", "CASE-P0-001"],
      },
    ],
    summary: "已完成 rubric 基础评分与规则修正融合，并触发硬门槛：G1。",
  };
  valid.risks = [
    {
      id: 1,
      level: "medium",
      title: "规则违规：ARKTS-MUST-001",
      risk_code: "RULE_VIOLATION:ARKTS-MUST-001",
      risk_category: "medium",
      source_rule_id: "ARKTS-MUST-001",
      evidence: "完整规则结论只保存在这里。",
      score_effect: {
        type: "risk_level_rule_impact",
        rule_id: "ARKTS-MUST-001",
        original_level: "medium",
        hard_gate_ids: ["G1"],
        hard_gate_active_levels: ["medium"],
        gate_caps: { G1: 69 },
        impacts: [
          {
            dimension_name: "改动精准度与最小侵入性",
            item_name: "问题点命中程度",
            original_score_delta: -2,
          },
        ],
      },
    },
  ];
  valid.human_review_items = [
    {
      id: 1,
      item: "硬门槛复核",
      current_assessment: "G1",
      uncertainty_reason: "G1 高密度静态错误：must_rule 不满足数量为 3，达到触发阈值 2。",
      suggested_focus: "请确认 G1（高密度静态错误，总分上限 69）是否应因 must_rule 不满足数量达到阈值而保留。",
      score_effect: {
        type: "hard_gate",
        gate_ids: ["G1"],
        gate_caps: { G1: 69 },
        trigger_reason: "must_rule 不满足数量达到硬门槛阈值",
        trigger_policy: {
          type: "must_violation_count",
          threshold: 2,
          actual: 3,
        },
        triggered_rule_ids: ["ARKTS-MUST-001", "ARKTS-MUST-003", "CASE-P0-001"],
      },
    },
  ];
  valid.rule_audit_results = [
    {
      rule_id: "ARKTS-MUST-001",
      rule_summary: "必须避免类型错误。",
      rule_source: "must_rule",
      result: "不满足",
      conclusion: "完整规则结论只保存在这里。",
    },
  ];

  assert.doesNotThrow(() => validateReportResult(valid, schemaPath));
});

test("validateReportResult rejects rule violation risks without evidence", () => {
  const schemaPath = path.resolve(process.cwd(), "references/scoring/report_result_schema.json");
  const valid = makeValidResultJson();
  valid.risks = [
    {
      id: 1,
      level: "medium",
      title: "规则违规：ARKTS-MUST-001",
      risk_code: "RULE_VIOLATION:ARKTS-MUST-001",
      risk_category: "medium",
      source_rule_id: "ARKTS-MUST-001",
      score_effect: {
        type: "risk_level_rule_impact",
        rule_id: "ARKTS-MUST-001",
        original_level: "medium",
        hard_gate_ids: [],
        hard_gate_active_levels: [],
        gate_caps: {},
        impacts: [],
      },
    },
  ];

  assert.throws(() => validateReportResult(valid, schemaPath), /Schema validation failed/);
});

test("validateReportResult rejects removed v2 duplicate fields", () => {
  const schemaPath = path.resolve(process.cwd(), "references/scoring/report_result_schema.json");
  const valid = makeValidResultJson();
  valid.rule_violations = [];
  valid.official_linter_results = [];
  const firstDimension = (valid.dimension_results as Array<Record<string, unknown>>)[0];
  const firstItem = (firstDimension.item_results as Array<Record<string, unknown>>)[0];
  firstItem.score_recalculation = { scoring_bands: [{ score: 8, criteria: "旧档位复制。" }] };
  const firstImpact = (firstItem.rule_impacts as Array<Record<string, unknown>>)[0];
  firstImpact.reason = "旧重复原因";
  firstImpact.evidence = "旧重复证据";
  valid.risks = [
    {
      id: 1,
      level: "medium",
      title: "规则违规：ARKTS-SHOULD-001",
      description: "旧重复描述",
      evidence: "旧重复证据",
      risk_code: "RULE_VIOLATION:ARKTS-SHOULD-001",
      risk_category: "medium",
      source_rule_id: "ARKTS-SHOULD-001",
      score_effect: {
        type: "risk_level_rule_impact",
        rule_id: "ARKTS-SHOULD-001",
        original_level: "medium",
        level_weights: { high: 1, medium: 0.6, low: 0.3, none: 0 },
        hard_gate_ids: [],
        hard_gate_active_levels: [],
        gate_caps: {},
        impacts: [],
      },
    },
  ];

  assert.throws(() => validateReportResult(valid, schemaPath), /schema validation failed/i);
});

test("validateReportResult accepts result with hvigor build_check_summary", () => {
  const schemaPath = path.resolve(process.cwd(), "references/scoring/report_result_schema.json");
  const valid = makeValidResultJson();
  valid.basic_info = {
    ...(valid.basic_info as Record<string, unknown>),
    build_check_enabled: true,
  };
  valid.build_check_summary = {
    enabled: true,
    status: "failed",
    checked_modules: ["features/feature1"],
    hard_gate_triggered: true,
    score_cap: 59,
    diagnostics: "hvigor build check failed",
    duration_ms: 1000,
    module_results: [
      {
        module_path: "features/feature1",
        module_name: "feature1",
        command: "assembleHar",
        status: "failed",
        exit_code: 7,
        duration_ms: 1000,
      },
    ],
  };

  assert.doesNotThrow(() => validateReportResult(valid, schemaPath));
});

test("validateReportResult accepts deduction_trace for deducted items", () => {
  const schemaPath = path.resolve(process.cwd(), "references/scoring/report_result_schema.json");
  const valid = makeValidResultJson();
  const firstDimension = (valid.dimension_results as Array<Record<string, unknown>>)[0];
  const firstItem = (firstDimension.item_results as Array<Record<string, unknown>>)[0];

  firstItem.agent_evaluation = {
    base_score: 8,
    matched_band_score: 8,
    matched_criteria: "8分：基本满足。",
    logic: "存在明确负面证据。",
    evidence_used: ["workspace/entry/src/main/ets/pages/Index.ets:12"],
    confidence: "medium",
    deduction_trace: {
      code_locations: ["workspace/entry/src/main/ets/pages/Index.ets:12"],
      impact_scope: "影响页面初始化稳定性",
      rubric_comparison: "未命中高分档；命中当前档。",
      deduction_reason: "存在空值未防御。",
      improvement_suggestion: "在访问前增加空值校验并补充异常路径处理。",
    },
  };

  assert.doesNotThrow(() => validateReportResult(valid, schemaPath));
});

test("validateReportResult rejects invalid output with a useful error", () => {
  const schemaPath = path.resolve(process.cwd(), "references/scoring/report_result_schema.json");
  assert.throws(
    () => validateReportResult({ basic_info: {} }, schemaPath),
    /schema validation failed/i,
  );
});

test("validateReportResult rejects legacy item rationale and evidence fields", () => {
  const schemaPath = path.resolve(process.cwd(), "references/scoring/report_result_schema.json");
  const valid = makeValidResultJson();
  valid.dimension_results = [
    {
      dimension_name: "代码正确性与静态质量",
      dimension_intent: "语法与静态质量",
      score: 8,
      max_score: 10,
      comment: "存在规则扣分。",
      agent_evaluation_summary: {
        base_score: 10,
        logic: "rubric agent 给出高分。",
        key_evidence: ["workspace/entry/src/main/ets/pages/Index.ets"],
        confidence: "medium",
      },
      rule_violation_summary: {
        violated_rule_count: 1,
        affected_item_count: 1,
        total_rule_delta: -2,
        summary: "一个规则影响该维度。",
      },
      item_results: [
        {
          item_name: "ArkTS/ArkUI语法与类型安全",
          item_weight: 10,
          score: 8,
          matched_band: { score: 8, criteria: "基本满足。" },
          confidence: "medium",
          review_required: false,
          rationale: "旧字段",
          evidence: "旧字段",
        },
      ],
    },
  ];

  assert.throws(() => validateReportResult(valid, schemaPath), /schema validation failed/i);
});
