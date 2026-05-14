import assert from "node:assert/strict";
import test from "node:test";
import { inputClassificationNode } from "../src/nodes/inputClassificationNode.js";

test("inputClassificationNode preserves fixed taskType from upstream remote task", async () => {
  const result = await inputClassificationNode({
    taskType: "full_generation",
    caseInput: {
      caseId: "remote-task-44",
      promptText: "修复登录按钮无响应问题",
      originalProjectPath: "/case/original",
      generatedProjectPath: "/case/workspace",
      originalProjectProvided: true,
      patchPath: "/case/diff/changes.patch",
    },
  } as never);

  assert.equal(result.taskType, "full_generation");
});
