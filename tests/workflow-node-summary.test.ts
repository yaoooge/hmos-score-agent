import assert from "node:assert/strict";
import test from "node:test";
import { getNodeLabel } from "../src/workflow/observability/nodeLabels.js";
import { summarizeNodeUpdate } from "../src/workflow/observability/nodeSummaries.js";

test("getNodeLabel returns Chinese labels for workflow nodes", () => {
  assert.equal(getNodeLabel("remoteTaskPreparationNode"), "远端任务预处理");
  assert.equal(getNodeLabel("taskUnderstandingNode"), "任务理解");
  assert.equal(getNodeLabel("opencodeSandboxPreparationNode"), "opencode 沙箱准备");
  assert.equal(getNodeLabel("rubricScoringAgentNode"), "Rubric Agent 评分");
  assert.equal(getNodeLabel("ruleAssessmentAgentNode"), "规则 Agent 判定");
  assert.equal(getNodeLabel("scoreFusionOrchestrationNode"), "评分融合");
  assert.equal(getNodeLabel("artifactPostProcessNode"), "产物后处理");
  assert.equal(getNodeLabel("persistAndUploadNode"), "结果落盘");
});

test("summarizeNodeUpdate returns concise summaries for key node updates", () => {
  assert.equal(
    summarizeNodeUpdate("remoteTaskPreparationNode", {
      mode: "remote",
      originalFileCount: 1,
      workspaceFileCount: 1,
      hasPatch: true,
    }),
    "mode=remote originalFiles=1 workspaceFiles=1 hasPatch=true",
  );

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
    summarizeNodeUpdate("opencodeSandboxPreparationNode", {
      opencodeSandboxRoot: "/tmp/sandbox",
    }),
    "sandboxReady=true",
  );

  assert.equal(
    summarizeNodeUpdate("inputClassificationNode", {
      taskType: "bug_fix",
    }),
    "taskType=bug_fix",
  );

  assert.equal(
    summarizeNodeUpdate("ruleAssessmentAgentNode", {
      ruleAgentRunStatus: "success",
      ruleAgentRunnerResult: {
        outcome: "success",
        final_answer_raw_text: '{"ok":true}',
      },
    }),
    "status=success outputLength=11",
  );

  assert.equal(
    summarizeNodeUpdate("ruleAuditNode", {
      staticRuleAuditResults: [
        { rule_id: "R1", result: "满足" },
        { rule_id: "R2", result: "未接入判定器" },
        { rule_id: "R3", result: "未接入判定器" },
      ],
      ruleViolations: [{ rule_id: "R3" }],
    }),
    "rules=3 violations=1 uncertain=2",
  );

  assert.equal(
    summarizeNodeUpdate("ruleAuditNode", {
      ruleViolations: [{ rule_id: "R2" }],
    }),
    "rules=0 violations=1 uncertain=0",
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
    summarizeNodeUpdate("rubricScoringPromptBuilderNode", {
      rubricScoringPromptText: "逐项输出 rubric item",
    }),
    "promptLength=16",
  );

  assert.equal(
    summarizeNodeUpdate("rubricScoringAgentNode", {
      rubricAgentRunStatus: "success",
      rubricScoringResult: {
        item_scores: [{ item_name: "A" }, { item_name: "B" }],
      },
    }),
    "status=success items=2",
  );

  assert.equal(
    summarizeNodeUpdate("ruleAgentPromptBuilderNode", {
      deterministicRuleResults: [{ rule_id: "R1" }],
      assistedRuleCandidates: [{ rule_id: "R2" }, { rule_id: "R3" }],
      ruleAgentPromptText: "请输出 JSON",
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
    summarizeNodeUpdate("scoreFusionOrchestrationNode", {
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
    }),
    "resultReady=true htmlLength=0",
  );

  assert.equal(
    summarizeNodeUpdate("artifactPostProcessNode", {
      htmlReport: "<html></html>",
    }),
    "htmlLength=13 reportReady=true",
  );

  assert.equal(
    summarizeNodeUpdate("persistAndUploadNode", {
      resultJson: { ok: true },
      htmlReport: "<html></html>",
    }),
    "outputsWritten=true htmlLength=13",
  );
});
