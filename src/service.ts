import { randomUUID } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getConfig } from "./config.js";
import { ArtifactStore } from "./io/artifactStore.js";
import {
  downloadManifestToDirectory,
  downloadRemoteTask as fetchRemoteTask,
  downloadToFile,
} from "./io/downloader.js";
import { loadCaseFromPath } from "./io/caseLoader.js";
import { CaseLogger } from "./io/caseLogger.js";
import { uploadTaskCallback } from "./io/uploader.js";
import { buildRunCaseId, inferTaskTypeFromCaseInput } from "./service/runCaseId.js";
import { CaseInput, RemoteCallbackPayload, RemoteEvaluationTask } from "./types.js";
import { runScoreWorkflow } from "./workflow/scoreWorkflow.js";

async function runCaseInput(input: {
  caseInput: CaseInput;
  sourceCasePath: string;
}): Promise<{ caseDir: string; uploadMessage?: string; resultJson?: Record<string, unknown> }> {
  const config = getConfig();
  const artifactStore = new ArtifactStore(config.localCaseRoot);
  const caseInput = input.caseInput;
  const taskType = inferTaskTypeFromCaseInput(caseInput);
  const sourceCasePath = path.resolve(input.sourceCasePath);
  const caseDir = await artifactStore.ensureCaseDir(
    buildRunCaseId({
      taskType,
      uniqueId: randomUUID().replace(/-/g, "").slice(0, 8),
    }),
  );
  const logger = new CaseLogger(artifactStore, caseDir);
  const caseInfoBase = {
    case_id: path.basename(caseDir),
    source_case_path: sourceCasePath,
    task_type: taskType,
    original_project_path: caseInput.originalProjectPath,
    generated_project_path: caseInput.generatedProjectPath,
    patch_path: caseInput.patchPath ?? null,
    started_at: new Date().toISOString(),
    agent_prompt_file: "inputs/agent-prompt.txt",
    agent_assistance_enabled: Boolean(config.modelProviderBaseUrl && config.modelProviderApiKey),
    agent_model: config.modelProviderModel ?? "gpt-5.4",
  };

  await logger.info(`启动评分流程 sourceCasePath=${sourceCasePath}`);
  await logger.info(`用例加载完成 caseId=${caseInput.caseId}`);
  await logger.info(`任务类型判定完成 taskType=${taskType}`);
  await artifactStore.writeJson(caseDir, "inputs/case-info.json", {
    ...caseInfoBase,
    agent_run_status: "not_enabled",
  });
  await logger.info("输入元数据写入完成");

  try {
    await logger.info("工作流开始执行");
    const result = await runScoreWorkflow({
      caseInput,
      caseDir,
      referenceRoot: config.referenceRoot,
      artifactStore,
      uploadEndpoint: config.uploadEndpoint,
      uploadToken: config.uploadToken,
    });
    const uploadMessage =
      typeof result.uploadMessage === "string" ? result.uploadMessage : undefined;
    await artifactStore.writeJson(caseDir, "inputs/case-info.json", {
      ...caseInfoBase,
      agent_run_status:
        typeof result.agentRunStatus === "string" ? result.agentRunStatus : "not_enabled",
    });
    await logger.info("工作流执行完成");
    await logger.info("结果已落盘");
    if (uploadMessage) {
      if (uploadMessage.includes("跳过上传")) {
        await logger.info(`上传跳过 message=${uploadMessage}`);
      } else {
        await logger.info(`上传结果 message=${uploadMessage}`);
      }
    }

    return {
      caseDir,
      uploadMessage,
      resultJson:
        typeof result.resultJson === "object" && result.resultJson !== null
          ? (result.resultJson as Record<string, unknown>)
          : undefined,
    };
  } catch (error) {
    const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
    await logger.error(`执行失败 error=${message}`);
    throw error;
  }
}

function buildRemotePrompt(task: RemoteEvaluationTask): string {
  const sections = [
    task.testCase.description ? `任务描述：${task.testCase.description}` : "",
    task.testCase.input ? `输入要求：${task.testCase.input}` : "",
    task.testCase.expectedOutput ? `期望输出：${task.testCase.expectedOutput}` : "",
  ].filter((section) => section.length > 0);

  return sections.join("\n\n");
}

async function materializeRemoteCase(task: RemoteEvaluationTask): Promise<{
  casePath: string;
  cleanup: () => Promise<void>;
}> {
  const rootDir = await fsp.mkdtemp(path.join(os.tmpdir(), "hmos-remote-task-"));
  const casePath = path.join(rootDir, `remote-task-${task.taskId}`);
  await fsp.mkdir(casePath, { recursive: true });
  await fsp.writeFile(path.join(casePath, "input.txt"), buildRemotePrompt(task), "utf-8");
  await downloadManifestToDirectory(task.testCase.fileUrl, path.join(casePath, "original"));
  await downloadManifestToDirectory(
    task.executionResult.outputCodeUrl,
    path.join(casePath, "workspace"),
  );

  if (task.executionResult.diffFileUrl) {
    await downloadToFile(
      task.executionResult.diffFileUrl,
      path.join(casePath, "diff", "changes.patch"),
    );
  }

  return {
    casePath,
    cleanup: async () => {
      await fsp.rm(rootDir, { recursive: true, force: true });
    },
  };
}

function buildRemoteCallbackPayload(input: {
  taskId: number;
  status: "completed" | "failed";
  resultData: Record<string, unknown>;
}): RemoteCallbackPayload {
  const totalScore =
    input.status === "completed"
      ? Number(
          (input.resultData.overall_conclusion as { total_score?: number } | undefined)
            ?.total_score ?? 0,
        )
      : 0;

  return {
    taskId: input.taskId,
    status: input.status,
    totalScore,
    maxScore: 100,
    resultData: input.resultData,
  };
}

export async function runSingleCase(
  casePath: string,
): Promise<{ caseDir: string; uploadMessage?: string }> {
  const caseInput = await loadCaseFromPath(casePath);
  const result = await runCaseInput({
    caseInput,
    sourceCasePath: casePath,
  });

  return {
    caseDir: result.caseDir,
    uploadMessage: result.uploadMessage,
  };
}

export async function runRemoteTask(
  downloadUrl: string,
): Promise<{ caseDir: string; taskId: number; uploadMessage?: string }> {
  const remoteTask = await fetchRemoteTask(downloadUrl);
  const { casePath, cleanup } = await materializeRemoteCase(remoteTask);

  try {
    const caseInput = await loadCaseFromPath(casePath);
    const runResult = await runCaseInput({
      caseInput,
      sourceCasePath: casePath,
    });
    const callbackPayload = buildRemoteCallbackPayload({
      taskId: remoteTask.taskId,
      status: "completed",
      resultData: runResult.resultJson ?? {},
    });
    const upload = await uploadTaskCallback(remoteTask.callback, remoteTask.token, callbackPayload);

    return {
      caseDir: runResult.caseDir,
      taskId: remoteTask.taskId,
      uploadMessage: upload.message,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await uploadTaskCallback(
      remoteTask.callback,
      remoteTask.token,
      buildRemoteCallbackPayload({
        taskId: remoteTask.taskId,
        status: "failed",
        resultData: { error: message },
      }),
    );
    throw error;
  } finally {
    await cleanup();
  }
}

export function resolveDefaultCasePath(): string {
  const caseRoot = path.resolve(process.cwd(), "cases");
  if (!fs.existsSync(caseRoot) || !fs.statSync(caseRoot).isDirectory()) {
    throw new Error(`Default case root does not exist: ${caseRoot}`);
  }

  const firstCaseEntry = fs
    .readdirSync(caseRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name, "en"))
    .find((entry) => fs.existsSync(path.join(caseRoot, entry.name, "input.txt")));

  if (!firstCaseEntry) {
    throw new Error(`No valid cases found under default case root: ${caseRoot}`);
  }

  return path.join(caseRoot, firstCaseEntry.name);
}
