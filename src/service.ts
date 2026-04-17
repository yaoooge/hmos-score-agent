import { randomUUID } from "node:crypto";
import path from "node:path";
import { getConfig } from "./config.js";
import { ArtifactStore } from "./io/artifactStore.js";
import { loadCaseFromPath } from "./io/caseLoader.js";
import { CaseLogger } from "./io/caseLogger.js";
import { buildRunCaseId, inferTaskTypeFromCaseInput } from "./service/runCaseId.js";
import { runScoreWorkflow } from "./workflow/scoreWorkflow.js";

export async function runSingleCase(casePath: string): Promise<{ caseDir: string; uploadMessage?: string }> {
  const config = getConfig();
  const artifactStore = new ArtifactStore(config.localCaseRoot);
  const caseInput = await loadCaseFromPath(casePath);
  const taskType = inferTaskTypeFromCaseInput(caseInput);
  const sourceCasePath = path.resolve(casePath);
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
    const uploadMessage = typeof result.uploadMessage === "string" ? result.uploadMessage : undefined;
    await artifactStore.writeJson(caseDir, "inputs/case-info.json", {
      ...caseInfoBase,
      agent_run_status: typeof result.agentRunStatus === "string" ? result.agentRunStatus : "not_enabled",
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
    };
  } catch (error) {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    await logger.error(`执行失败 error=${message}`);
    throw error;
  }
}

export function resolveDefaultCasePath(): string {
  return path.resolve(process.cwd(), "init-input");
}
