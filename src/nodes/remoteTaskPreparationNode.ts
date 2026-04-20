import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadCaseFromPath } from "../io/caseLoader.js";
import { downloadManifestToDirectory, downloadToFile } from "../io/downloader.js";
import type { RemoteEvaluationTask } from "../types.js";
import { emitNodeFailed, emitNodeStarted } from "../workflow/observability/nodeCustomEvents.js";
import type { ScoreGraphState } from "../workflow/state.js";

function buildRemotePrompt(task: RemoteEvaluationTask): string {
  return [
    task.testCase.description ? `任务描述：${task.testCase.description}` : "",
    task.testCase.input ? `输入要求：${task.testCase.input}` : "",
    task.testCase.expectedOutput ? `期望输出：${task.testCase.expectedOutput}` : "",
  ]
    .filter((section) => section.length > 0)
    .join("\n\n");
}

export async function remoteTaskPreparationNode(
  state: ScoreGraphState,
): Promise<Partial<ScoreGraphState>> {
  emitNodeStarted("remoteTaskPreparationNode");
  try {
    if (state.caseInput) {
      return {
        caseInput: state.caseInput,
        sourceCasePath: state.sourceCasePath,
        inputMode: "local",
        passthrough: true,
      };
    }

    if (!state.remoteTask) {
      throw new Error("Workflow requires either caseInput or remoteTask.");
    }

    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "hmos-remote-task-"));
    const casePath = path.join(rootDir, `remote-task-${state.remoteTask.taskId}`);
    await fs.mkdir(casePath, { recursive: true });
    await fs.writeFile(path.join(casePath, "input.txt"), buildRemotePrompt(state.remoteTask), "utf-8");

    const originalFiles = await downloadManifestToDirectory(
      state.remoteTask.testCase.fileUrl,
      path.join(casePath, "original"),
    );
    const workspaceFiles = await downloadManifestToDirectory(
      state.remoteTask.executionResult.outputCodeUrl,
      path.join(casePath, "workspace"),
    );
    const hasPatch = Boolean(state.remoteTask.executionResult.diffFileUrl);

    if (state.remoteTask.executionResult.diffFileUrl) {
      await downloadToFile(
        state.remoteTask.executionResult.diffFileUrl,
        path.join(casePath, "diff", "changes.patch"),
      );
    }

    return {
      caseInput: await loadCaseFromPath(casePath),
      sourceCasePath: casePath,
      remoteTaskRootDir: rootDir,
      inputMode: "remote",
      originalFileCount: originalFiles.length,
      workspaceFileCount: workspaceFiles.length,
      hasPatch,
    };
  } catch (error) {
    emitNodeFailed("remoteTaskPreparationNode", error);
    throw error;
  }
}
