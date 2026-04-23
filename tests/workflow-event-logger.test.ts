import assert from "node:assert/strict";
import test from "node:test";
import { WorkflowEventLogger } from "../src/workflow/observability/workflowEventLogger.js";

test("WorkflowEventLogger writes Chinese workflow event lines", async () => {
  const lines: string[] = [];
  const logger = new WorkflowEventLogger({
    info: async (message: string) => void lines.push(`INFO ${message}`),
    error: async (message: string) => void lines.push(`ERROR ${message}`),
  });

  await logger.log({
    level: "info",
    type: "node_started",
    nodeId: "ruleMergeNode",
    label: "规则结果合并",
  });
  await logger.log({
    level: "info",
    type: "node_completed",
    nodeId: "inputClassificationNode",
    label: "任务分类",
    summary: "taskType=bug_fix",
  });
  await logger.log({
    level: "error",
    type: "node_failed",
    nodeId: "ruleAssessmentAgentNode",
    label: "规则 Agent 判定",
    errorMessage: "Agent 调用失败",
  });

  assert.deepEqual(lines, [
    "INFO [规则结果合并ruleMergeNode] 节点开始",
    "INFO [任务分类inputClassificationNode] 节点完成 summary=taskType=bug_fix",
    "ERROR [规则 Agent 判定ruleAssessmentAgentNode] 节点失败 error=Agent 调用失败",
  ]);
});
