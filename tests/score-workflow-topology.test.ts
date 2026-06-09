import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

test("score workflow uses task understanding as shared prerequisite for three parallel branches", async () => {
  const source = await fs.readFile(
    path.resolve(process.cwd(), "src/workflow/graph/compiledGraph.ts"),
    "utf-8",
  );

  assert.equal(source.includes('addNode("inputClassificationNode"'), false);
  assert.equal(source.includes('addNode("ruleAuditNode"'), false);
  assert.equal(source.includes('addNode("rubricScoringPromptBuilderNode"'), false);
  assert.equal(source.includes('addNode("ruleAgentPromptBuilderNode"'), false);
  assert.equal(source.includes('addNode("artifactPostProcessNode"'), false);
  assert.equal(
    source.includes('addEdge("taskUnderstandingNode", "inputClassificationNode"'),
    false,
  );
  assert.equal(source.includes('addEdge("reportGenerationNode", "artifactPostProcessNode"'), false);

  assert.match(source, /\.addEdge\("remoteTaskPreparationNode", "taskUnderstandingNode"\)/);
  assert.match(source, /\.addEdge\("taskUnderstandingNode", "officialCodeLinterNode"\)/);
  assert.match(source, /\.addEdge\("taskUnderstandingNode", "rulePreparationNode"\)/);
  assert.match(source, /\.addEdge\("taskUnderstandingNode", "rubricPreparationNode"\)/);
  assert.match(source, /\.addEdge\("opencodeSandboxPreparationNode", "officialCodeLinterNode"\)/);
  assert.match(source, /\.addEdge\("opencodeSandboxPreparationNode", "rulePreparationNode"\)/);
  assert.match(source, /\.addEdge\("opencodeSandboxPreparationNode", "rubricPreparationNode"\)/);
  assert.match(source, /\.addEdge\("rulePreparationNode", "ruleAssessmentAgentNode"\)/);
  assert.match(source, /\.addEdge\("rubricPreparationNode", "rubricScoringAgentNode"\)/);
  assert.match(
    source,
    /\.addEdge\(\["ruleAssessmentAgentNode", "officialCodeLinterNode"\], "ruleMergeNode"\)/,
  );
  assert.match(
    source,
    /\.addEdge\(\["rubricScoringAgentNode", "ruleMergeNode"\], "scoreFusionOrchestrationNode"\)/,
  );
  assert.match(source, /\.addEdge\("reportGenerationNode", "persistAndUploadNode"\)/);
});
