import assert from "node:assert/strict";
import test from "node:test";
import { getNodeLabel } from "../src/workflow/observability/nodeLabels.js";
import { summarizeNodeUpdate } from "../src/workflow/observability/nodeSummaries.js";

test("getNodeLabel returns Chinese labels for workflow nodes", () => {
  assert.equal(getNodeLabel("taskUnderstandingNode"), "任务理解");
  assert.equal(getNodeLabel("persistAndUploadNode"), "结果落盘与上传");
});

test("summarizeNodeUpdate returns concise summaries for key node updates", () => {
  assert.equal(
    summarizeNodeUpdate("taskUnderstandingNode", {
      constraintSummary: {
        explicitConstraints: ["A", "B"],
        contextualConstraints: ["C"],
        implicitConstraints: ["D", "E", "F"],
        classificationHints: ["bug"],
      },
    }),
    "explicit=2 contextual=1 implicit=3 classificationHints=1",
  );

  assert.equal(
    summarizeNodeUpdate("inputClassificationNode", {
      taskType: "bug_fix",
    }),
    "taskType=bug_fix",
  );

  assert.equal(
    summarizeNodeUpdate("agentAssistedRuleNode", {
      agentRunStatus: "success",
      agentRawOutputText: '{"ok":true}',
    }),
    "status=success outputLength=11",
  );

  assert.equal(
    summarizeNodeUpdate("featureExtractionNode", {
      featureExtraction: {
        basicFeatures: ["A", "B"],
        structuralFeatures: ["C"],
        semanticFeatures: ["D"],
        changeFeatures: ["E", "F", "G"],
      },
    }),
    "basic=2 structural=1 semantic=1 change=3",
  );

  assert.equal(
    summarizeNodeUpdate("ruleAuditNode", {
      ruleAuditResults: [
        { rule_id: "R1", result: "满足" },
        { rule_id: "R2", result: "待人工复核" },
        { rule_id: "R3", result: "不满足" },
      ],
      ruleViolations: [{ rule_id: "R3" }],
    }),
    "rules=3 violations=1 uncertain=1",
  );

  assert.equal(
    summarizeNodeUpdate("rubricPreparationNode", {
      rubricSnapshot: {
        dimension_summaries: [{ name: "A" }, { name: "B" }],
        hard_gates: [{ id: "G1" }],
        review_rule_summary: ["人工复核"],
      },
    }),
    "dimensions=2 hardGates=1 reviewRules=1",
  );

  assert.equal(
    summarizeNodeUpdate("agentPromptBuilderNode", {
      deterministicRuleResults: [{ rule_id: "R1" }],
      assistedRuleCandidates: [{ rule_id: "R2" }, { rule_id: "R3" }],
      agentPromptText: "请输出 JSON",
    }),
    "deterministic=1 candidates=2 promptLength=8",
  );

  assert.equal(
    summarizeNodeUpdate("ruleMergeNode", {
      mergedRuleAuditResults: [
        { rule_id: "R1", result: "满足" },
        { rule_id: "R2", result: "待人工复核" },
      ],
    }),
    "merged=2 reviewRequired=1",
  );

  assert.equal(
    summarizeNodeUpdate("scoringOrchestrationNode", {
      scoreComputation: {
        totalScore: 78,
        hardGateTriggered: false,
        risks: [{ level: "medium" }],
        humanReviewItems: [{ item: "A" }],
      },
    }),
    "totalScore=78 hardGate=false risks=1 reviewItems=1",
  );

  assert.equal(
    summarizeNodeUpdate("reportGenerationNode", {
      resultJson: { ok: true },
      htmlReport: "<html></html>",
    }),
    "resultReady=true htmlLength=13",
  );

  assert.equal(
    summarizeNodeUpdate("persistAndUploadNode", {
      uploadMessage: "未配置 UPLOAD_ENDPOINT，已跳过上传。",
    }),
    "upload=skipped",
  );
});
