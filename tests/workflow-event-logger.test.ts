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
    level: "error",
    type: "node_failed",
    nodeId: "ruleAssessmentAgentNode",
    label: "规则 Agent 判定",
    errorMessage: "Agent 调用失败",
  });

  assert.deepEqual(lines, [
    "ERROR 节点失败 node=ruleAssessmentAgentNode label=规则 Agent 判定 error=Agent 调用失败",
  ]);
});
