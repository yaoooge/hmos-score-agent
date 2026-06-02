import assert from "node:assert/strict";
import test from "node:test";
import { ruleAgentPromptBuilderNode } from "../src/workflow/nodes/ruleAgentPromptBuilder/index.js";

test("rule agent prompt builder excludes official linter results from bootstrap payload", async () => {
  const output = await ruleAgentPromptBuilderNode(
    {
      caseInput: {
        caseId: "case-1",
        promptText: "测试规则 agent 边界",
        originalProjectPath: "/tmp/original",
        generatedProjectPath: "/tmp/generated",
      },
      sourceCasePath: "/tmp/case",
      effectivePatchPath: "/tmp/case/diff.patch",
      taskType: "full_generation",
      constraintSummary: {
        explicitConstraints: [],
        contextualConstraints: [],
        implicitConstraints: [],
        classificationHints: [],
        crossDeviceAdaptation: { applicability: "not_involved", confidence: "high", reasons: [] },
      },
      rubricSnapshot: {
        task_type: "full_generation",
        evaluation_mode: "auto",
        scenario: "",
        scoring_method: "",
        scoring_note: "",
        common_risks: [],
        report_emphasis: [],
        dimension_summaries: [],
        hard_gates: [],
        review_rule_summary: [],
      },
      deterministicRuleResults: [],
      assistedRuleCandidates: [],
      officialLinterRuleResults: [
        {
          rule_id: "OFFICIAL-LINTER:@performance/no-use-any-import",
          rule_result_id: "OFFICIAL-LINTER:@performance/no-use-any-import",
          source_rule_set: "@performance",
          severity: "warn",
          result: "不满足",
          finding_count: 1,
          findings: [],
          conclusion: "官方 Code Linter 命中。",
          score_delta: 0,
          affected_items: [],
        },
      ],
    } as never,
    { logger: { info: async () => undefined } },
  );

  const text = JSON.stringify(output);
  assert.doesNotMatch(text, /OFFICIAL-LINTER/);
  assert.doesNotMatch(text, /officialLinterRuleResults/);
  assert.doesNotMatch(text, /官方 Code Linter/);
});
