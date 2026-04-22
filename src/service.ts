import { randomUUID } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { getConfig } from "./config.js";
import { ArtifactStore } from "./io/artifactStore.js";
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
    rubric_scoring_prompt_file: "inputs/rubric-scoring-prompt.txt",
    rubric_scoring_payload_file: "inputs/rubric-scoring-payload.json",
    rule_agent_prompt_file: "inputs/rule-agent-prompt.txt",
    rule_agent_bootstrap_payload_file: "inputs/rule-agent-bootstrap-payload.json",
    agent_assistance_enabled: Boolean(config.modelProviderBaseUrl && config.modelProviderApiKey),
    agent_model: config.modelProviderModel ?? "gpt-5.4",
  };

  await logger.info(`启动评分流程 sourceCasePath=${sourceCasePath}`);
  await logger.info(`用例加载完成 caseId=${caseInput.caseId}`);
  await logger.info(`任务类型判定完成 taskType=${taskType}`);
  await artifactStore.writeJson(caseDir, "inputs/case-info.json", {
    ...caseInfoBase,
    rubric_agent_run_status: "not_enabled",
    rule_agent_run_status: "not_enabled",
  });
  await logger.info("输入元数据写入完成");

  try {
    await logger.info("工作流开始执行");
    const result = await runScoreWorkflow({
      caseInput,
      sourceCasePath,
      caseDir,
      referenceRoot: config.referenceRoot,
      artifactStore,
    });
    await artifactStore.writeJson(caseDir, "inputs/case-info.json", {
      ...caseInfoBase,
      rubric_agent_run_status:
        typeof result.rubricAgentRunStatus === "string"
          ? result.rubricAgentRunStatus
          : "not_enabled",
      rule_agent_run_status:
        typeof result.ruleAgentRunStatus === "string" ? result.ruleAgentRunStatus : "not_enabled",
    });
    await logger.info("工作流执行完成");
    await logger.info("结果已落盘");

    return {
      caseDir,
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

function readWorkflowStateFromError(error: unknown): Record<string, unknown> | undefined {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }

  const workflowState = (error as { workflowState?: unknown }).workflowState;
  return typeof workflowState === "object" && workflowState !== null
    ? (workflowState as Record<string, unknown>)
    : undefined;
}

export async function runSingleCase(
  casePath: string,
): Promise<{ caseDir: string }> {
  const caseInput = await loadCaseFromPath(casePath);
  const result = await runCaseInput({
    caseInput,
    sourceCasePath: casePath,
  });

  return {
    caseDir: result.caseDir,
  };
}

export async function runRemoteEvaluationTask(
  remoteTask: RemoteEvaluationTask,
): Promise<{ caseDir: string; taskId: number; uploadMessage?: string }> {
  const config = getConfig();
  const artifactStore = new ArtifactStore(config.localCaseRoot);
  const caseDir = await artifactStore.ensureCaseDir(
    buildRunCaseId({
      taskType: "full_generation",
      uniqueId: randomUUID().replace(/-/g, "").slice(0, 8),
    }),
  );
  const logger = new CaseLogger(artifactStore, caseDir);
  const caseInfoBase = {
    case_id: path.basename(caseDir),
    source_case_path: null,
    task_type: null,
    original_project_path: null,
    generated_project_path: null,
    patch_path: null,
    started_at: new Date().toISOString(),
    rubric_scoring_prompt_file: "inputs/rubric-scoring-prompt.txt",
    rubric_scoring_payload_file: "inputs/rubric-scoring-payload.json",
    rule_agent_prompt_file: "inputs/rule-agent-prompt.txt",
    rule_agent_bootstrap_payload_file: "inputs/rule-agent-bootstrap-payload.json",
    agent_assistance_enabled: Boolean(config.modelProviderBaseUrl && config.modelProviderApiKey),
    agent_model: config.modelProviderModel ?? "gpt-5.4",
    input_mode: "remote_task",
    remote_task_id: remoteTask.taskId,
    remote_test_case_id: remoteTask.testCase.id,
  };
  let workflowResult: Record<string, unknown> | undefined;

  try {
    await logger.info(`启动远端评分流程 taskId=${remoteTask.taskId}`);
    await artifactStore.writeJson(caseDir, "inputs/case-info.json", {
      ...caseInfoBase,
      rubric_agent_run_status: "not_enabled",
      rule_agent_run_status: "not_enabled",
    });
    await logger.info("输入元数据写入完成");
    await logger.info("工作流开始执行");

    workflowResult = await runScoreWorkflow({
      remoteTask,
      caseDir,
      referenceRoot: config.referenceRoot,
      artifactStore,
    });

    const caseInput =
      typeof workflowResult.caseInput === "object" && workflowResult.caseInput !== null
        ? (workflowResult.caseInput as CaseInput)
        : undefined;
    const sourceCasePath =
      typeof workflowResult.sourceCasePath === "string" ? workflowResult.sourceCasePath : null;
    const taskType = typeof workflowResult.taskType === "string" ? workflowResult.taskType : null;
    await artifactStore.writeJson(caseDir, "inputs/case-info.json", {
      ...caseInfoBase,
      source_case_path: sourceCasePath,
      task_type: taskType,
      original_project_path: caseInput?.originalProjectPath ?? null,
      generated_project_path: caseInput?.generatedProjectPath ?? null,
      patch_path: caseInput?.patchPath ?? null,
      rubric_agent_run_status:
        typeof workflowResult.rubricAgentRunStatus === "string"
          ? workflowResult.rubricAgentRunStatus
          : "not_enabled",
      rule_agent_run_status:
        typeof workflowResult.ruleAgentRunStatus === "string"
          ? workflowResult.ruleAgentRunStatus
          : "not_enabled",
    });
    await logger.info("工作流执行完成");
    await logger.info("结果已落盘");

    const callbackPayload = buildRemoteCallbackPayload({
      taskId: remoteTask.taskId,
      status: "completed",
      resultData:
        typeof workflowResult.resultJson === "object" && workflowResult.resultJson !== null
          ? (workflowResult.resultJson as Record<string, unknown>)
          : {},
    });
    const upload = await uploadTaskCallback(remoteTask.callback, remoteTask.token, callbackPayload);
    await logger.info(`回调结果 message=${upload.message}`);

    return {
      caseDir,
      taskId: remoteTask.taskId,
      uploadMessage: upload.message,
    };
  } catch (error) {
    workflowResult ??= readWorkflowStateFromError(error);
    const message = error instanceof Error ? error.message : String(error);
    await logger.error(`执行失败 error=${message}`);
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
    const remoteTaskRootDir =
      typeof workflowResult?.remoteTaskRootDir === "string"
        ? workflowResult.remoteTaskRootDir
        : undefined;
    if (remoteTaskRootDir) {
      await fsp.rm(remoteTaskRootDir, { recursive: true, force: true });
    }
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
