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
    rubric_summary: {
      task_type: "bug_fix",
      evaluation_mode: "auto_precheck_with_human_review",
      scenario:
        "用户提供 Bug 修复 diff、修复前后代码、问题描述与修复结果，目标是评价修复是否命中问题且控制侵入范围。",
      scoring_method: "discrete_band",
      scoring_note: "二级指标按离散档位给分。",
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
                {
                  score: 10,
                  criteria: "修改直接命中根因或完整故障链路。",
                },
              ],
            },
          ],
        },
      ],
      hard_gates: [{ id: "G4", score_cap: 59 }],
      review_rule_summary: ["关键分段分数需要人工复核"],
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

test("validateReportResult rejects invalid output with a useful error", () => {
  const schemaPath = path.resolve(process.cwd(), "references/scoring/report_result_schema.json");
  assert.throws(
    () => validateReportResult({ basic_info: {} }, schemaPath),
    /schema validation failed/i,
  );
});
