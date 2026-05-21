import assert from "node:assert/strict";
import test from "node:test";
import { runOpencodeRubricScoring } from "../src/agent/opencodeRubricScoring.js";
import type { RubricScoringPayload } from "../src/types.js";

function payload(): RubricScoringPayload {
  return {
    case_context: {
      case_id: "case-1",
      case_root: "/case",
      task_type: "bug_fix",
      original_prompt_summary: "修复登录按钮无响应",
      original_project_path: "/case/original",
      generated_project_path: "/case/generated",
      effective_patch_path: "/case/patch/effective.patch",
    },
    task_understanding: {
      explicitConstraints: ["修复登录按钮点击"],
      contextualConstraints: [],
      implicitConstraints: [],
      classificationHints: ["bug_fix"],
    },
    rubric_summary: {
      task_type: "bug_fix",
      evaluation_mode: "test",
      scenario: "test",
      scoring_method: "test",
      scoring_note: "test",
      common_risks: [],
      report_emphasis: [],
      dimension_summaries: [],
      hard_gates: [],
      review_rule_summary: [],
      risk_taxonomy: [
        {
          code: "REQUIREMENT_NOT_IMPLEMENTED",
          level: "high",
          title: "需求未实现",
          description: "需求目标没有在生成代码中落地。",
        },
      ],
    } as never,
    response_contract: {
      output_language: "zh-CN",
      json_only: true,
      required_top_level_fields: [
        "summary",
        "item_scores",
        "hard_gate_candidates",
        "risks",
        "strengths",
        "main_issues",
      ],
    },
  };
}

test("runOpencodeRubricScoring asks agent to choose risks from taxonomy", async () => {
  let prompt = "";

  const result = await runOpencodeRubricScoring({
    sandboxRoot: "/sandbox/case",
    scoringPayload: payload(),
    runPrompt: async (request) => {
      prompt = request.prompt;
      return {
        requestTag: request.requestTag,
        rawEvents: "",
        rawText: JSON.stringify({
          summary: {
            overall_assessment: "未发现足够负面证据，按满分保留。",
            overall_confidence: "medium",
          },
          item_scores: [],
          hard_gate_candidates: [],
          risks: [],
          strengths: [],
          main_issues: [],
        }),
        elapsedMs: 1,
      };
    },
  });

  assert.equal(result.outcome, "success");
  assert.match(prompt, /risk_taxonomy/);
  assert.match(prompt, /REQUIREMENT_NOT_IMPLEMENTED/);
  assert.match(prompt, /不要创造新的风险名称/);
  assert.match(prompt, /risk_code/);
});
