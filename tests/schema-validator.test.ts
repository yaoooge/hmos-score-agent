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
            rationale: "存在部分证据但闭环不完整。",
            evidence: "patch 命中目标函数。",
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

test("validateReportResult rejects invalid output with a useful error", () => {
  const schemaPath = path.resolve(process.cwd(), "references/scoring/report_result_schema.json");
  assert.throws(
    () => validateReportResult({ basic_info: {} }, schemaPath),
    /schema validation failed/i,
  );
});
