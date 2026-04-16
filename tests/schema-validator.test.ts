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
    dimension_scores: [],
    submetric_details: [],
    rule_violations: [],
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

test("validateReportResult rejects invalid output with a useful error", () => {
  const schemaPath = path.resolve(process.cwd(), "references/scoring/report_result_schema.json");
  assert.throws(
    () => validateReportResult({ basic_info: {} }, schemaPath),
    /schema validation failed/i,
  );
});
