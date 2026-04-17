import assert from "node:assert/strict";
import test from "node:test";
import { taskUnderstandingNode } from "../src/nodes/taskUnderstandingNode.js";

test("taskUnderstandingNode emits custom start events through LangGraph writer", async () => {
  const events: Array<Record<string, unknown>> = [];
  const originalPrompt = "修复页面 bug";

  const result = await taskUnderstandingNode(
    {
      caseInput: {
        caseId: "case-1",
        promptText: originalPrompt,
        originalProjectPath: "/tmp/original",
        generatedProjectPath: "/tmp/workspace",
      },
    } as never,
    {
      writer: (chunk: Record<string, unknown>) => events.push(chunk),
    } as never,
  );

  assert.equal(events[0]?.event, "node_started");
  assert.equal(events[0]?.nodeId, "taskUnderstandingNode");
  assert.ok(result.constraintSummary);
});
