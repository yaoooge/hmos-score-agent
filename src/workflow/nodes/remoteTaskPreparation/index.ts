import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { load } from "js-yaml";
import { loadCaseFromPath } from "../../../commons/io/caseLoader.js";
import {
  downloadManifestToDirectory,
  downloadToFile,
  type RemoteDownloadLogger,
} from "../../../commons/io/downloader.js";
import { resolveRemoteTaskType } from "../../../service/runCaseId.js";
import type { RemoteEvaluationTask } from "../../../types.js";
import { emitNodeFailed, emitNodeStarted } from "../../observability/nodeCustomEvents.js";
import type { ScoreGraphState } from "../../graph/state.js";

function buildRemotePrompt(task: RemoteEvaluationTask): string {
  return [
    task.testCase.description ? `任务描述：${task.testCase.description}` : "",
    task.testCase.input ? `输入要求：${task.testCase.input}` : "",
    task.testCase.expectedOutput ? `期望输出：${task.testCase.expectedOutput}` : "",
  ]
    .filter((section) => section.length > 0)
    .join("\n\n");
}

function shouldMaterializeExpectedConstraints(expectedOutput: string): boolean {
  const trimmed = expectedOutput.trim();
  if (!trimmed) {
    return false;
  }

  try {
    const parsed = load(trimmed);
    if (Array.isArray(parsed)) {
      return true;
    }
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return Array.isArray((parsed as { constraints?: unknown }).constraints);
    }
  } catch {
    return false;
  }

  return false;
}

export async function remoteTaskPreparationNode(
  state: ScoreGraphState,
  deps: { logger?: RemoteDownloadLogger } = {},
): Promise<Partial<ScoreGraphState>> {
  emitNodeStarted("remoteTaskPreparationNode");
  let rootDir: string | undefined;
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

    rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "hmos-remote-task-"));
    const casePath = path.join(rootDir, `remote-task-${state.remoteTask.taskId}`);
    await fs.mkdir(casePath, { recursive: true });
    await fs.writeFile(
      path.join(casePath, "input.txt"),
      buildRemotePrompt(state.remoteTask),
      "utf-8",
    );
    if (shouldMaterializeExpectedConstraints(state.remoteTask.testCase.expectedOutput)) {
      await fs.writeFile(
        path.join(casePath, "expected_constraints.yaml"),
        state.remoteTask.testCase.expectedOutput,
        "utf-8",
      );
    }

    const originalDir = path.join(casePath, "original");
    const originalFiles = state.remoteTask.testCase.fileUrl.trim()
      ? await downloadManifestToDirectory(state.remoteTask.testCase.fileUrl, originalDir, {
          label: "original_project",
          logger: deps.logger,
        })
      : [];
    if (originalFiles.length === 0) {
      await fs.mkdir(originalDir, { recursive: true });
    }
    const workspaceFiles = await downloadManifestToDirectory(
      state.remoteTask.executionResult.outputCodeUrl,
      path.join(casePath, "workspace"),
      {
        label: "workspace_project",
        logger: deps.logger,
      },
    );
    const hasPatch = Boolean(state.remoteTask.executionResult.diffFileUrl);

    if (state.remoteTask.executionResult.diffFileUrl) {
      await downloadToFile(
        state.remoteTask.executionResult.diffFileUrl,
        path.join(casePath, "diff", "changes.patch"),
        {
          label: "diff_patch",
          logger: deps.logger,
        },
      );
    }

    const caseInput = await loadCaseFromPath(casePath);
    const taskType = resolveRemoteTaskType(state.remoteTask.testCase.type);

    return {
      caseInput,
      sourceCasePath: casePath,
      remoteTaskRootDir: rootDir,
      inputMode: "remote",
      originalFileCount: originalFiles.length,
      workspaceFileCount: workspaceFiles.length,
      hasPatch,
      remoteBuildSuccess: state.remoteTask.executionResult.isBuildSuccess,
      taskType,
    };
  } catch (error) {
    if (rootDir && error instanceof Error) {
      Object.assign(error, { remoteTaskRootDir: rootDir });
    }
    emitNodeFailed("remoteTaskPreparationNode", error);
    throw error;
  }
}
