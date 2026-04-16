import fs from "node:fs/promises";
import path from "node:path";
import { validateReportResult } from "../report/schemaValidator.js";
import { ScoreGraphState } from "../workflow/state.js";

export async function reportGenerationNode(
  state: ScoreGraphState,
  config: { referenceRoot: string },
): Promise<Partial<ScoreGraphState>> {
  const schemaPath = path.join(config.referenceRoot, "report_result_schema.json");
  const schemaText = await fs.readFile(schemaPath, "utf-8");
  const schema = JSON.parse(schemaText) as object;

  const resultJson: Record<string, unknown> = {
    basic_info: {
      rubric_version: "v1",
      task_type: state.taskType,
      evaluation_mode: "auto_precheck_with_human_review",
      rules_enabled: true,
      build_check_enabled: false,
      target_description: "HarmonyOS 生成工程评分",
      target_scope: state.caseInput.generatedProjectPath,
      task_type_basis: state.constraintSummary.classificationHints.join("; "),
    },
    overall_conclusion: state.scoreComputation.overallConclusion,
    dimension_scores: state.scoreComputation.dimensionScores,
    submetric_details: state.scoreComputation.submetricDetails,
    rule_violations: state.ruleViolations,
    risks: state.scoreComputation.risks,
    strengths: state.scoreComputation.strengths,
    main_issues: state.scoreComputation.mainIssues,
    human_review_items: state.scoreComputation.humanReviewItems,
    final_recommendation: state.scoreComputation.finalRecommendation,
    rule_audit_results: state.ruleAuditResults,
    report_meta: {
      report_file_name: "report.html",
      result_json_file_name: "result.json",
      unit_name: state.caseInput.caseId,
      generated_at: new Date().toISOString(),
    },
  };

  if (typeof schema !== "object" || schema === null) {
    throw new Error("report_result_schema.json 内容不合法。");
  }

  validateReportResult(resultJson, schemaPath);

  const htmlReport = `<!doctype html><html><head><meta charset="utf-8"><title>评分报告</title></head><body><h1>评分报告</h1><p>用例：${state.caseInput.caseId}</p><p>总分：${state.scoreComputation.totalScore}</p><pre>${JSON.stringify(resultJson, null, 2)}</pre></body></html>`;

  return { resultJson, htmlReport };
}
