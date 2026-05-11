import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

test("score workflow runs official linter and rubric preparation in parallel after rule audit", async () => {
  const source = await fs.readFile(
    path.resolve(process.cwd(), "src/workflow/scoreWorkflow.ts"),
    "utf-8",
  );

  const directRuleAuditToRubricPreparation = source.match(
    /\.addEdge\("ruleAuditNode", "rubricPreparationNode"\)/g,
  );
  const directRuleAuditToOfficialLinter = source.match(
    /\.addEdge\("ruleAuditNode", "officialCodeLinterNode"\)/g,
  );
  const officialLinterToRubricPreparation = source.match(
    /\.addEdge\("officialCodeLinterNode", "rubricPreparationNode"\)/g,
  );
  const officialLinterAndRuleAssessmentJoin = source.match(
    /\.addEdge\(\["ruleAssessmentAgentNode", "officialCodeLinterNode"\], "ruleMergeNode"\)/g,
  );

  assert.equal(directRuleAuditToRubricPreparation?.length, 2);
  assert.equal(directRuleAuditToOfficialLinter?.length, 2);
  assert.equal(officialLinterToRubricPreparation, null);
  assert.equal(officialLinterAndRuleAssessmentJoin?.length, 2);
});
