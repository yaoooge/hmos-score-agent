import assert from "node:assert/strict";
import test from "node:test";
import { buildAgentBootstrapPayload } from "../src/agents/normalization/ruleAssistance.js";

test("rule agent bootstrap payload excludes official linter results", () => {
  const payload = buildAgentBootstrapPayload({
      caseInput: {
        caseId: "case-1",
        promptText: "测试规则 agent 边界",
        originalProjectPath: "/tmp/original",
        generatedProjectPath: "/tmp/generated",
      },
      sourceCasePath: "/tmp/case",
      caseRoot: "/tmp/case",
      effectivePatchPath: "/tmp/case/diff.patch",
      taskType: "full_generation",
      taskUnderstanding: {
        explicitConstraints: [],
        contextualConstraints: [],
        implicitConstraints: [],
        classificationHints: [],
        crossDeviceAdaptation: { applicability: "not_involved", confidence: "high", reasons: [] },
      },
      assistedRuleCandidates: [
        {
          rule_id: "ARKTS-MUST-001",
          rule_source: "must_rule",
          why_uncertain: "需要人工复核",
          evidence_files: ["entry/src/main/ets/pages/Index.ets"],
        },
      ],
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
    } as never);

  const text = JSON.stringify(payload);
  assert.doesNotMatch(text, /OFFICIAL-LINTER/);
  assert.doesNotMatch(text, /officialLinterRuleResults/);
  assert.doesNotMatch(text, /官方 Code Linter/);
});
