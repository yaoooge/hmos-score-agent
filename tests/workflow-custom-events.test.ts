import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ArtifactStore } from "../src/io/artifactStore.js";
import { taskUnderstandingNode } from "../src/nodes/taskUnderstandingNode.js";

const referenceRoot = path.resolve(process.cwd(), "references/scoring");

function createTaskUnderstandingOpencodeMock() {
  return {
    async runPrompt(request: { requestTag: string }) {
      return {
        requestTag: request.requestTag,
        rawEvents: "",
        rawText: JSON.stringify({
          explicitConstraints: ["任务类型: full_generation"],
          contextualConstraints: ["保持工程结构"],
          implicitConstraints: ["基于 patch 评估"],
          classificationHints: ["full_generation", "has_patch"],
        }),
        elapsedMs: 1,
      };
    },
  };
}

test("taskUnderstandingNode emits custom start events through LangGraph writer", async (t) => {
  const events: Array<Record<string, unknown>> = [];
  const originalPrompt = "修复页面 bug";
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "hmos-workflow-events-"));
  t.after(async () => {
    await fs.rm(rootDir, { recursive: true, force: true });
  });

  const originalProjectPath = path.join(rootDir, "original");
  const generatedProjectPath = path.join(rootDir, "workspace");
  await fs.mkdir(path.join(originalProjectPath, "entry", "src", "main", "ets", "pages"), {
    recursive: true,
  });
  await fs.mkdir(path.join(generatedProjectPath, "entry", "src", "main", "ets", "pages"), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(originalProjectPath, "entry", "src", "main", "ets", "pages", "Index.ets"),
    "Text('old')\n",
    "utf-8",
  );
  await fs.writeFile(
    path.join(generatedProjectPath, "entry", "src", "main", "ets", "pages", "Index.ets"),
    "Text('new')\n",
    "utf-8",
  );

  const artifactStore = new ArtifactStore(rootDir);
  const caseDir = await artifactStore.ensureCaseDir("case-1");

  const result = await taskUnderstandingNode(
    {
      caseDir,
      caseInput: {
        caseId: "case-1",
        promptText: originalPrompt,
        originalProjectPath,
        generatedProjectPath,
      },
    } as never,
    {
      artifactStore,
      opencode: createTaskUnderstandingOpencodeMock(),
      referenceRoot,
    },
    {
      writer: (chunk: Record<string, unknown>) => events.push(chunk),
    } as never,
  );

  assert.equal(events[0]?.event, "node_started");
  assert.equal(events[0]?.nodeId, "taskUnderstandingNode");
  assert.ok(result.constraintSummary);
});
