import fs from "node:fs/promises";
import path from "node:path";
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
      target_description: "HarmonyOS generated project scoring",
      target_scope: state.caseInput.generatedProjectPath,
      task_type_basis: state.constraintSummary.classificationHints.join("; "),
    },
    overall_conclusion: {
      total_score: state.scoreComputation.totalScore,
      hard_gate_triggered: state.scoreComputation.hardGateTriggered,
      summary: "Scaffold run completed. Rule and rubric engines are in baseline mode.",
    },
    dimension_scores: [],
    submetric_details: [],
    rule_violations: state.ruleViolations,
    risks: [],
    strengths: ["Workflow scaffold created and runnable."],
    main_issues: ["Detailed evidence extraction not fully implemented yet."],
    human_review_items: [],
    final_recommendation: ["Use as baseline and iteratively enrich rule evidence."],
    rule_audit_results: state.ruleAuditResults,
    report_meta: {
      report_file_name: "report.html",
      result_json_file_name: "result.json",
      unit_name: state.caseInput.caseId,
      generated_at: new Date().toISOString(),
    },
  };

  if (typeof schema !== "object" || schema === null) {
    throw new Error("Invalid report_result_schema.json content.");
  }

  const htmlReport = `<!doctype html><html><head><meta charset="utf-8"><title>Score Report</title></head><body><h1>Case ${state.caseInput.caseId}</h1><p>Total score: ${state.scoreComputation.totalScore}</p><pre>${JSON.stringify(resultJson, null, 2)}</pre></body></html>`;

  return { resultJson, htmlReport };
}
