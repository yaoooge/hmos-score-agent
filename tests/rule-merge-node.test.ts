import assert from "node:assert/strict";
import test from "node:test";
import { ruleMergeNode } from "../src/workflow/nodes/ruleMerge/index.js";

test("rule merge appends official linter results after deterministic results", async () => {
  const result = await ruleMergeNode(
    {
      deterministicRuleResults: [
        {
          rule_id: "ARKTS-MUST-001",
          rule_source: "must_rule",
          result: "不满足",
          conclusion: "存在命名冲突。",
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
      assistedRuleCandidates: [],
    } as never,
    { logger: { info: async () => undefined } },
  );

  assert.deepEqual(
    result.mergedRuleAuditResults?.map((item) => item.rule_id),
    ["ARKTS-MUST-001", "OFFICIAL-LINTER:@performance/no-use-any-import"],
  );
  assert.deepEqual(
    result.normalizedRuleImpacts?.map((item) => ({
      rule_id: item.rule_id,
      severity: item.severity,
      mode: item.score_effect.mode,
    })),
    [
      { rule_id: "ARKTS-MUST-001", severity: "major", mode: "cap" },
      {
        rule_id: "OFFICIAL-LINTER:@performance/no-use-any-import",
        severity: "minor",
        mode: "deduct",
      },
    ],
  );
});
