import { randomUUID } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { getConfig } from "./config.js";
import { ArtifactStore } from "./io/artifactStore.js";
import { loadCaseFromPath } from "./io/caseLoader.js";
import { CaseLogger } from "./io/caseLogger.js";
import { uploadTaskCallback } from "./io/uploader.js";
import { inputClassificationNode } from "./nodes/inputClassificationNode.js";
import { remoteTaskPreparationNode } from "./nodes/remoteTaskPreparationNode.js";
import { taskUnderstandingNode } from "./nodes/taskUnderstandingNode.js";
import { buildRunCaseId, inferTaskTypeFromCaseInput } from "./service/runCaseId.js";
import {
  CaseInput,
  CaseRuleDefinition,
  ConstraintSummary,
  RemoteCallbackPayload,
  RemoteEvaluationTask,
  TaskType,
} from "./types.js";
import { runPreparedScoreWorkflow, runScoreWorkflow } from "./workflow/scoreWorkflow.js";
import type { ScoreGraphState } from "./workflow/state.js";

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

type AcceptedRemoteWorkflowState = {
  caseDir: string;
  caseInput: CaseInput;
  sourceCasePath: string;
  remoteTaskRootDir: string;
  effectivePatchPath: string;
  caseRuleDefinitions: CaseRuleDefinition[];
  constraintSummary: ConstraintSummary;
  taskType: TaskType;
  inputMode: string;
  originalFileCount: number;
  workspaceFileCount: number;
  hasPatch: boolean;
};

export type AcceptedRemoteEvaluationTask = {
  taskId: number;
  caseDir: string;
  message: string;
  remoteTask: RemoteEvaluationTask;
  workflowState: AcceptedRemoteWorkflowState;
};

const REMOTE_TASK_ACCEPTED_MESSAGE = "任务接收成功，结果将通过 callback 返回";

function buildRemoteCaseInfoBase(
  remoteTask: RemoteEvaluationTask,
  caseDir: string,
  config: ReturnType<typeof getConfig>,
) {
  return {
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
}

function buildRemoteCaseInfoPayload(
  caseInfoBase: ReturnType<typeof buildRemoteCaseInfoBase>,
  state: Partial<AcceptedRemoteWorkflowState> | Record<string, unknown>,
  statuses?: {
    rubricAgentRunStatus?: string;
    ruleAgentRunStatus?: string;
  },
) {
  const caseInput =
    typeof state.caseInput === "object" && state.caseInput !== null
      ? (state.caseInput as CaseInput)
      : undefined;
  const sourceCasePath = typeof state.sourceCasePath === "string" ? state.sourceCasePath : null;
  const taskType = typeof state.taskType === "string" ? state.taskType : null;

  return {
    ...caseInfoBase,
    source_case_path: sourceCasePath,
    task_type: taskType,
    original_project_path: caseInput?.originalProjectPath ?? null,
    generated_project_path: caseInput?.generatedProjectPath ?? null,
    patch_path: caseInput?.patchPath ?? null,
    rubric_agent_run_status: statuses?.rubricAgentRunStatus ?? "not_enabled",
    rule_agent_run_status: statuses?.ruleAgentRunStatus ?? "not_enabled",
  };
}

function readRemoteTaskRootDirFromError(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }

  const rootDir = (error as { remoteTaskRootDir?: unknown }).remoteTaskRootDir;
  return typeof rootDir === "string" ? rootDir : undefined;
}

function toAcceptedRemoteWorkflowState(state: Partial<ScoreGraphState>): AcceptedRemoteWorkflowState {
  if (!state.caseDir) {
    throw new Error("Accepted remote task is missing caseDir.");
  }
  if (!state.caseInput) {
    throw new Error("Accepted remote task is missing caseInput.");
  }
  if (!state.sourceCasePath) {
    throw new Error("Accepted remote task is missing sourceCasePath.");
  }
  if (!state.remoteTaskRootDir) {
    throw new Error("Accepted remote task is missing remoteTaskRootDir.");
  }
  if (!state.constraintSummary) {
    throw new Error("Accepted remote task is missing constraintSummary.");
  }
  if (!state.effectivePatchPath) {
    throw new Error("Accepted remote task is missing effectivePatchPath.");
  }
  if (!state.taskType) {
    throw new Error("Accepted remote task is missing taskType.");
  }
  if (typeof state.originalFileCount !== "number") {
    throw new Error("Accepted remote task is missing originalFileCount.");
  }
  if (typeof state.workspaceFileCount !== "number") {
    throw new Error("Accepted remote task is missing workspaceFileCount.");
  }
  if (typeof state.hasPatch !== "boolean") {
    throw new Error("Accepted remote task is missing hasPatch.");
  }

  return {
    caseDir: state.caseDir,
    caseInput: state.caseInput,
    sourceCasePath: state.sourceCasePath,
    remoteTaskRootDir: state.remoteTaskRootDir,
    effectivePatchPath: state.effectivePatchPath,
    caseRuleDefinitions: state.caseRuleDefinitions ?? [],
    constraintSummary: state.constraintSummary,
    taskType: state.taskType,
    inputMode: state.inputMode ?? "remote",
    originalFileCount: state.originalFileCount,
    workspaceFileCount: state.workspaceFileCount,
    hasPatch: state.hasPatch,
  };
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

export async function prepareRemoteEvaluationTask(
  remoteTask: RemoteEvaluationTask,
): Promise<AcceptedRemoteEvaluationTask> {
  const config = getConfig();
  const artifactStore = new ArtifactStore(config.localCaseRoot);
  const caseDir = await artifactStore.ensureCaseDir(
    buildRunCaseId({
      taskType: "full_generation",
      uniqueId: randomUUID().replace(/-/g, "").slice(0, 8),
    }),
  );
  const logger = new CaseLogger(artifactStore, caseDir);
  const caseInfoBase = buildRemoteCaseInfoBase(remoteTask, caseDir, config);
  const preparedState: Partial<ScoreGraphState> = {
    remoteTask,
    caseDir,
  };

  try {
    await logger.info(`启动远端评分流程 taskId=${remoteTask.taskId}`);
    await artifactStore.writeJson(
      caseDir,
      "inputs/case-info.json",
      buildRemoteCaseInfoPayload(caseInfoBase, preparedState),
    );
    await logger.info("输入元数据写入完成");
    await logger.info("远端任务预处理开始");
    Object.assign(
      preparedState,
      await remoteTaskPreparationNode(preparedState as ScoreGraphState),
    );
    await logger.info("远端任务预处理完成");
    Object.assign(
      preparedState,
      await taskUnderstandingNode(preparedState as ScoreGraphState, { artifactStore, logger }),
    );
    await logger.info("初始任务分析完成");
    Object.assign(
      preparedState,
      await inputClassificationNode(preparedState as ScoreGraphState),
    );
    await logger.info(`任务类型判定完成 taskType=${String(preparedState.taskType ?? "")}`);
    await artifactStore.writeJson(
      caseDir,
      "inputs/case-info.json",
      buildRemoteCaseInfoPayload(caseInfoBase, preparedState),
    );
    await logger.info("任务接收完成，已转入异步执行");

    return {
      taskId: remoteTask.taskId,
      caseDir,
      message: REMOTE_TASK_ACCEPTED_MESSAGE,
      remoteTask,
      workflowState: toAcceptedRemoteWorkflowState(preparedState),
    };
  } catch (error) {
    const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
    await logger.error(`预处理失败 error=${message}`);
    const remoteTaskRootDir =
      typeof preparedState.remoteTaskRootDir === "string"
        ? preparedState.remoteTaskRootDir
        : readRemoteTaskRootDirFromError(error);
    if (remoteTaskRootDir) {
      await fsp.rm(remoteTaskRootDir, { recursive: true, force: true });
    }
    throw error;
  }
}

export async function executeAcceptedRemoteEvaluationTask(
  acceptedTask: AcceptedRemoteEvaluationTask,
): Promise<string> {
  const config = getConfig();
  const artifactStore = new ArtifactStore(config.localCaseRoot);
  const logger = new CaseLogger(artifactStore, acceptedTask.caseDir);
  const caseInfoBase = buildRemoteCaseInfoBase(acceptedTask.remoteTask, acceptedTask.caseDir, config);
  let workflowResult: Record<string, unknown> = { ...acceptedTask.workflowState };

  try {
    await logger.info("异步评分执行开始");
    workflowResult = await runPreparedScoreWorkflow({
      preparedState: acceptedTask.workflowState,
      caseDir: acceptedTask.caseDir,
      referenceRoot: config.referenceRoot,
      artifactStore,
    });
    await artifactStore.writeJson(
      acceptedTask.caseDir,
      "inputs/case-info.json",
      buildRemoteCaseInfoPayload(caseInfoBase, workflowResult, {
        rubricAgentRunStatus:
          typeof workflowResult.rubricAgentRunStatus === "string"
            ? workflowResult.rubricAgentRunStatus
            : "not_enabled",
        ruleAgentRunStatus:
          typeof workflowResult.ruleAgentRunStatus === "string"
            ? workflowResult.ruleAgentRunStatus
            : "not_enabled",
      }),
    );
    await logger.info("工作流执行完成");
    await logger.info("结果已落盘");

    const upload = await uploadTaskCallback(
      acceptedTask.remoteTask.callback,
      acceptedTask.remoteTask.token,
      buildRemoteCallbackPayload({
        taskId: acceptedTask.taskId,
        status: "completed",
        resultData:
          typeof workflowResult.resultJson === "object" && workflowResult.resultJson !== null
            ? (workflowResult.resultJson as Record<string, unknown>)
            : {},
      }),
    );
    await logger.info(`回调结果 message=${upload.message}`);
    return upload.message;
  } catch (error) {
    workflowResult = readWorkflowStateFromError(error) ?? workflowResult;
    const message = error instanceof Error ? error.message : String(error);
    await logger.error(`执行失败 error=${message}`);
    await uploadTaskCallback(
      acceptedTask.remoteTask.callback,
      acceptedTask.remoteTask.token,
      buildRemoteCallbackPayload({
        taskId: acceptedTask.taskId,
        status: "failed",
        resultData: { error: message },
      }),
    );
    throw error;
  } finally {
    const remoteTaskRootDir =
      typeof workflowResult.remoteTaskRootDir === "string"
        ? workflowResult.remoteTaskRootDir
        : acceptedTask.workflowState.remoteTaskRootDir;
    await fsp.rm(remoteTaskRootDir, { recursive: true, force: true });
  }
}

export async function runRemoteEvaluationTask(
  remoteTask: RemoteEvaluationTask,
): Promise<{ caseDir: string; taskId: number; uploadMessage?: string }> {
  const acceptedTask = await prepareRemoteEvaluationTask(remoteTask);
  const uploadMessage = await executeAcceptedRemoteEvaluationTask(acceptedTask);

  return {
    caseDir: acceptedTask.caseDir,
    taskId: acceptedTask.taskId,
    uploadMessage,
  };
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
