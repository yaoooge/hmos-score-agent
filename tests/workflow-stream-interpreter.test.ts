import assert from "node:assert/strict";
import test from "node:test";
import { interpretStreamChunk } from "../src/workflow/observability/workflowStreamInterpreter.js";

test("interpretStreamChunk maps custom and updates chunks into workflow events", () => {
  const started = interpretStreamChunk(["custom", { event: "node_started", nodeId: "taskUnderstandingNode" }]);
  const completed = interpretStreamChunk([
    "updates",
    {
      taskUnderstandingNode: {
        constraintSummary: {
          explicitConstraints: ["A"],
          contextualConstraints: [],
          implicitConstraints: [],
          classificationHints: [],
        },
      },
    },
  ]);

  assert.deepEqual(started, {
    level: "info",
    type: "node_started",
    nodeId: "taskUnderstandingNode",
    label: "任务理解",
  });
  assert.deepEqual(completed, {
    level: "info",
    type: "node_completed",
    nodeId: "taskUnderstandingNode",
    label: "任务理解",
    summary: "explicit=1 contextual=0 implicit=0 classificationHints=0",
  });
});
