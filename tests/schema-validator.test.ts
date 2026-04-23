import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { validateReportResult } from "../src/report/schemaValidator.js";

// 保持一个最小但完整的合法结果对象，作为 schema gate 的基线样本。
function makeValidResultJson(): Record<string, unknown> {
  return {
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
      hard_gate_triggered: false,
      summary: "ok",
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
                reason: "状态组织存在轻微风险。",
                evidence: "patch 命中目标函数。",
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
    rule_violations: [],
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
