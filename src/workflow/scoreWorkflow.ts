import { END, START, StateGraph } from "@langchain/langgraph";
import { ArtifactStore } from "../io/artifactStore.js";
import { buildAgentTraceReport, writeAgentTraceArtifacts } from "../agentTrace/agentTraceArtifactStore.js";
import { createAgentTraceRecorder, type AgentTraceRecorder } from "../agentTrace/agentTraceRecorder.js";
import { fetchOpencodeSessionSnapshot } from "../agentTrace/opencodeSessionClient.js";
import { parseOpencodeSessionEvents } from "../agentTrace/opencodePartParser.js";
import type { AgentTraceRun } from "../agentTrace/types.js";
import { pruneCompletedCaseArtifacts } from "../io/caseArtifactCleanup.js";
import { CaseLogger } from "../io/caseLogger.js";
import { formatElapsedDuration } from "../io/duration.js";
import { artifactPostProcessNode } from "../nodes/artifactPostProcessNode.js";
import { inputClassificationNode } from "../nodes/inputClassificationNode.js";
import { opencodeSandboxPreparationNode } from "../nodes/opencodeSandboxPreparationNode.js";
import { persistAndUploadNode } from "../nodes/persistAndUploadNode.js";
import { reportGenerationNode } from "../nodes/reportGenerationNode.js";
import { remoteTaskPreparationNode } from "../nodes/remoteTaskPreparationNode.js";
import { rubricPreparationNode } from "../nodes/rubricPreparationNode.js";
import { rubricScoringAgentNode } from "../nodes/rubricScoringAgentNode.js";
import { rubricScoringPromptBuilderNode } from "../nodes/rubricScoringPromptBuilderNode.js";
import { ruleAgentPromptBuilderNode } from "../nodes/ruleAgentPromptBuilderNode.js";
import { ruleAssessmentAgentNode } from "../nodes/ruleAssessmentAgentNode.js";
import { ruleAuditNode } from "../nodes/ruleAuditNode.js";
import { ruleMergeNode } from "../nodes/ruleMergeNode.js";
import { scoreFusionOrchestrationNode } from "../nodes/scoreFusionOrchestrationNode.js";
import { officialCodeLinterNode } from "../nodes/officialCodeLinterNode.js";
import { taskUnderstandingNode } from "../nodes/taskUnderstandingNode.js";
import { createOpencodeRuntimeConfig, type OpencodeRuntimeConfig } from "../opencode/opencodeConfig.js";
import {
  runOpencodePrompt,
  type OpencodeRunRequest,
  type OpencodeRunResult,
} from "../opencode/opencodeCliRunner.js";
import { createManagedOpencodeRunner } from "../opencode/managedOpencodeRunner.js";
import {
  createOpencodeServeManager,
  ensureOpencodeCliAvailable,
  type OpencodeServeManager,
} from "../opencode/opencodeServeManager.js";
import { CaseInput, RemoteEvaluationTask } from "../types.js";
import { ScoreState } from "./state.js";
import { WorkflowEventLogger } from "./observability/workflowEventLogger.js";
import { interpretStreamChunk } from "./observability/workflowStreamInterpreter.js";
import type { ScoreGraphState } from "./state.js";

type OpencodeWorkflowRuntime = {
  runtime: OpencodeRuntimeConfig;
  serveManager: OpencodeServeManager;
};

export type OpencodeRuntimeLifecycle = "shared" | "ephemeral";

export type OpencodeRunner = {
  runPrompt(request: OpencodeRunRequest): Promise<OpencodeRunResult>;
};

let sharedOpencodeRuntime: Promise<OpencodeWorkflowRuntime> | undefined;

type LocalWorkflowInput = {
  caseInput: CaseInput;
  caseDir: string;
  sourceCasePath?: string;
  referenceRoot: string;
  artifactStore: ArtifactStore;
  opencodeRuntime?: OpencodeRuntimeConfig;
  opencodeServeManager?: OpencodeServeManager;
  opencodeRuntimeLifecycle?: OpencodeRuntimeLifecycle;
  opencodeRunner?: OpencodeRunner;
};

type RemoteWorkflowInput = {
  remoteTask: RemoteEvaluationTask;
  caseDir: string;
  referenceRoot: string;
  artifactStore: ArtifactStore;
  opencodeRuntime?: OpencodeRuntimeConfig;
  opencodeServeManager?: OpencodeServeManager;
  opencodeRuntimeLifecycle?: OpencodeRuntimeLifecycle;
  opencodeRunner?: OpencodeRunner;
};

type PreparedWorkflowInput = {
  preparedState: Pick<
    ScoreGraphState,
    | "caseInput"
    | "sourceCasePath"
    | "remoteTaskRootDir"
    | "inputMode"
    | "originalFileCount"
    | "workspaceFileCount"
    | "hasPatch"
    | "remoteBuildSuccess"
    | "caseDir"
    | "effectivePatchPath"
    | "caseRuleDefinitions"
    | "constraintSummary"
    | "taskType"
  >;
  caseDir: string;
  referenceRoot: string;
  artifactStore: ArtifactStore;
  opencodeRuntime?: OpencodeRuntimeConfig;
  opencodeServeManager?: OpencodeServeManager;
  opencodeRuntimeLifecycle?: OpencodeRuntimeLifecycle;
  opencodeRunner?: OpencodeRunner;
};

type WorkflowCommonInput = {
  caseDir: string;
  referenceRoot: string;
  artifactStore: ArtifactStore;
  opencodeRuntime?: OpencodeRuntimeConfig;
  opencodeServeManager?: OpencodeServeManager;
  opencodeRuntimeLifecycle?: OpencodeRuntimeLifecycle;
  opencodeRunner?: OpencodeRunner;
};

type CompiledScoreGraph = {
  stream(
    initialState: Record<string, unknown>,
    config: { streamMode: string[] },
  ): Promise<AsyncIterable<[string, unknown]>>;
};

function readTaskIdFromInput(input: WorkflowCommonInput): number | undefined {
  const remoteTask = "remoteTask" in input ? (input as RemoteWorkflowInput).remoteTask : undefined;
  return typeof remoteTask?.taskId === "number" ? remoteTask.taskId : undefined;
}

function createCompiledScoreGraph(input: WorkflowCommonInput, resumeFromPreparedState: boolean) {
  const logger = new CaseLogger(input.artifactStore, input.caseDir);
  const runtime = input.opencodeRuntime;
  const traceRecorder = createAgentTraceRecorder({
    taskId: readTaskIdFromInput(input),
    caseDir: input.caseDir,
    runtime: runtime
      ? {
          serverUrl: runtime.serverUrl,
          runtimeDir: runtime.runtimeDir,
        }
      : undefined,
  });
  const baseOpencode =
    input.opencodeRunner ??
    (runtime && input.opencodeServeManager
      ? createManagedOpencodeRunner({ runtime, serveManager: input.opencodeServeManager })
      : runtime
        ? {
            runPrompt: (request: OpencodeRunRequest) => runOpencodePrompt({ runtime, request }),
          }
        : undefined);
  const opencode = baseOpencode
    ? {
        runPrompt: (request: OpencodeRunRequest) =>
          traceRecorder.runPrompt(request, baseOpencode.runPrompt),
      }
    : undefined;
  const opencodeForState = (state: ScoreGraphState) =>
    opencode && state.opencodeSandboxRoot
      ? { sandboxRoot: state.opencodeSandboxRoot, runPrompt: opencode.runPrompt }
      : undefined;

  if (resumeFromPreparedState) {
    return {
      logger,
      traceRecorder,
      graph: new StateGraph(ScoreState)
        .addNode("opencodeSandboxPreparationNode", (s) => opencodeSandboxPreparationNode(s))
        .addNode("ruleAuditNode", (s) => ruleAuditNode(s, { referenceRoot: input.referenceRoot }))
        .addNode("officialCodeLinterNode", (s) => officialCodeLinterNode(s))
        .addNode("rubricPreparationNode", (s) =>
          rubricPreparationNode(s, { referenceRoot: input.referenceRoot, logger }),
        )
        .addNode("rubricScoringPromptBuilderNode", (s) =>
          rubricScoringPromptBuilderNode(s, { logger }),
        )
        .addNode("rubricScoringAgentNode", (s) =>
          rubricScoringAgentNode(s, { opencode: opencodeForState(s), logger }),
        )
        .addNode("ruleAgentPromptBuilderNode", (s) => ruleAgentPromptBuilderNode(s, { logger }))
        .addNode("ruleAssessmentAgentNode", (s) =>
          ruleAssessmentAgentNode(s, { opencode: opencodeForState(s), logger }),
        )
        .addNode("ruleMergeNode", (s) => ruleMergeNode(s, { logger }))
        .addNode("scoreFusionOrchestrationNode", (s) => scoreFusionOrchestrationNode(s))
        .addNode("reportGenerationNode", (s) =>
          reportGenerationNode(s, { referenceRoot: input.referenceRoot }),
        )
        .addNode("artifactPostProcessNode", (s) => artifactPostProcessNode(s))
        .addNode("persistAndUploadNode", (s) =>
          persistAndUploadNode(s, {
            artifactStore: input.artifactStore,
          }),
        )
        .addEdge(START, "opencodeSandboxPreparationNode")
        .addEdge("opencodeSandboxPreparationNode", "ruleAuditNode")
        .addEdge("ruleAuditNode", "officialCodeLinterNode")
        .addEdge("ruleAuditNode", "rubricPreparationNode")
        .addEdge("rubricPreparationNode", "rubricScoringPromptBuilderNode")
        .addEdge("rubricPreparationNode", "ruleAgentPromptBuilderNode")
        .addEdge("rubricScoringPromptBuilderNode", "rubricScoringAgentNode")
        .addEdge("ruleAgentPromptBuilderNode", "ruleAssessmentAgentNode")
        .addEdge(["ruleAssessmentAgentNode", "officialCodeLinterNode"], "ruleMergeNode")
        .addEdge(["rubricScoringAgentNode", "ruleMergeNode"], "scoreFusionOrchestrationNode")
        .addEdge("scoreFusionOrchestrationNode", "reportGenerationNode")
        .addEdge("reportGenerationNode", "artifactPostProcessNode")
        .addEdge("artifactPostProcessNode", "persistAndUploadNode")
        .addEdge("persistAndUploadNode", END)
        .compile(),
    };
  }

  return {
    logger,
    traceRecorder,
    graph: new StateGraph(ScoreState)
      .addNode("remoteTaskPreparationNode", (s) => remoteTaskPreparationNode(s, { logger }))
      .addNode("taskUnderstandingNode", (s, nodeConfig) =>
        taskUnderstandingNode(
          s,
          {
            opencode,
            artifactStore: input.artifactStore,
            logger,
          },
          nodeConfig,
        ),
      )
      .addNode("inputClassificationNode", (s) => inputClassificationNode(s))
      .addNode("ruleAuditNode", (s) => ruleAuditNode(s, { referenceRoot: input.referenceRoot }))
      .addNode("officialCodeLinterNode", (s) => officialCodeLinterNode(s))
      .addNode("rubricPreparationNode", (s) =>
        rubricPreparationNode(s, { referenceRoot: input.referenceRoot, logger }),
      )
      .addNode("rubricScoringPromptBuilderNode", (s) =>
        rubricScoringPromptBuilderNode(s, { logger }),
      )
      .addNode("rubricScoringAgentNode", (s) =>
        rubricScoringAgentNode(s, { opencode: opencodeForState(s), logger }),
      )
      .addNode("ruleAgentPromptBuilderNode", (s) => ruleAgentPromptBuilderNode(s, { logger }))
      .addNode("ruleAssessmentAgentNode", (s) =>
        ruleAssessmentAgentNode(s, { opencode: opencodeForState(s), logger }),
      )
      .addNode("ruleMergeNode", (s) => ruleMergeNode(s, { logger }))
      .addNode("scoreFusionOrchestrationNode", (s) => scoreFusionOrchestrationNode(s))
      .addNode("reportGenerationNode", (s) =>
        reportGenerationNode(s, { referenceRoot: input.referenceRoot }),
      )
      .addNode("artifactPostProcessNode", (s) => artifactPostProcessNode(s))
      .addNode("persistAndUploadNode", (s) =>
        persistAndUploadNode(s, {
          artifactStore: input.artifactStore,
        }),
      )
      .addEdge(START, "remoteTaskPreparationNode")
      .addEdge("remoteTaskPreparationNode", "taskUnderstandingNode")
      .addEdge("taskUnderstandingNode", "inputClassificationNode")
      .addEdge("inputClassificationNode", "ruleAuditNode")
      .addEdge("ruleAuditNode", "officialCodeLinterNode")
      .addEdge("ruleAuditNode", "rubricPreparationNode")
      .addEdge("rubricPreparationNode", "rubricScoringPromptBuilderNode")
      .addEdge("rubricPreparationNode", "ruleAgentPromptBuilderNode")
      .addEdge("rubricScoringPromptBuilderNode", "rubricScoringAgentNode")
      .addEdge("ruleAgentPromptBuilderNode", "ruleAssessmentAgentNode")
      .addEdge(["ruleAssessmentAgentNode", "officialCodeLinterNode"], "ruleMergeNode")
      .addEdge(["rubricScoringAgentNode", "ruleMergeNode"], "scoreFusionOrchestrationNode")
      .addEdge("scoreFusionOrchestrationNode", "reportGenerationNode")
      .addEdge("reportGenerationNode", "artifactPostProcessNode")
      .addEdge("artifactPostProcessNode", "persistAndUploadNode")
      .addEdge("persistAndUploadNode", END)
      .compile(),
  };
}

async function writeWorkflowAgentTrace(input: {
  artifactStore: ArtifactStore;
  caseDir: string;
  traceRecorder?: AgentTraceRecorder;
  runtime?: OpencodeRuntimeConfig;
  logger: CaseLogger;
}): Promise<void> {
  const runs = input.traceRecorder?.drainRuns() ?? [];
  if (runs.length === 0) {
    return;
  }
  try {
    const enrichedRuns = await enrichAgentTraceRuns({
      runs,
      runtime: input.runtime,
      logger: input.logger,
    });
    await writeAgentTraceArtifacts({
      artifactStore: input.artifactStore,
      caseDir: input.caseDir,
      report: buildAgentTraceReport({ runs: enrichedRuns }),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await input.logger.warn(`agent trace 写入失败 warning=${message}`);
  }
}

export async function enrichAgentTraceRuns(input: {
  runs: AgentTraceRun[];
  runtime?: OpencodeRuntimeConfig;
  logger: CaseLogger;
}): Promise<AgentTraceRun[]> {
  if (!input.runtime) {
    return input.runs;
  }
  const enriched: AgentTraceRun[] = [];
  for (const run of input.runs) {
    const sessionId = run.opencodeSession?.id ?? run.attempts.find((attempt) => attempt.sessionId)?.sessionId;
    if (!sessionId) {
      enriched.push(run);
      continue;
    }
    try {
      const snapshot = await fetchOpencodeSessionSnapshot({
        serverUrl: input.runtime.serverUrl,
        runtimeDir: input.runtime.runtimeDir,
        sessionId,
      });
      if (!snapshot) {
        enriched.push({
          ...run,
          status: run.status === "success" ? "session_missing" : run.status,
          warnings: [...run.warnings, "opencode_session_not_found"],
        });
        continue;
      }
      const parsed = parseOpencodeSessionEvents(snapshot, run.attempts);
      if (parsed.events.length === 0 && run.events.length > 0) {
        enriched.push({
          ...run,
          opencodeSession: {
            id: snapshot.id,
            title: snapshot.title ?? run.baseRequestTag,
            directory: snapshot.directory ?? "",
            createdAtMs: snapshot.createdAtMs,
            updatedAtMs: snapshot.updatedAtMs,
            source: snapshot.source,
          },
          opencodeMessages: snapshot.messages,
          warnings: [...run.warnings, ...parsed.warnings, "opencode_session_messages_empty"],
        });
        continue;
      }
      enriched.push({
        ...run,
        opencodeSession: {
          id: snapshot.id,
          title: snapshot.title ?? run.baseRequestTag,
          directory: snapshot.directory ?? "",
          createdAtMs: snapshot.createdAtMs,
          updatedAtMs: snapshot.updatedAtMs,
          source: snapshot.source,
        },
        opencodeMessages: snapshot.messages,
        events: parsed.events.length > 0 ? parsed.events : run.events,
        warnings: [...run.warnings, ...parsed.warnings],
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await input.logger.warn(`agent trace session 读取失败 session=${sessionId} warning=${message}`);
      enriched.push({
        ...run,
        warnings: [...run.warnings, "opencode_session_read_failed"],
      });
    }
  }
  return enriched;
}

export function shouldKeepCodeLinterResults(result: Record<string, unknown>): boolean {
  const officialLinterRunStatus = result.officialLinterRunStatus;
  const hvigorBuildCheckStatus = result.hvigorBuildCheckStatus;
  return (
    (typeof officialLinterRunStatus === "string" && officialLinterRunStatus !== "not_enabled") ||
    (typeof hvigorBuildCheckStatus === "string" && hvigorBuildCheckStatus !== "not_enabled")
  );
}

async function createOpencodeWorkflowRuntime(): Promise<OpencodeWorkflowRuntime> {
  await ensureOpencodeCliAvailable();
  const runtime = await createOpencodeRuntimeConfig({ repoRoot: process.cwd() });
  const serveManager = createOpencodeServeManager(runtime);
  await serveManager.start();
  return { runtime, serveManager };
}

async function prepareOpencodeRuntime(input: WorkflowCommonInput): Promise<WorkflowCommonInput> {
  if (input.opencodeRuntime) {
    if (input.opencodeServeManager) {
      await input.opencodeServeManager.start();
    }
    return input;
  }

  if (input.opencodeRunner) {
    return input;
  }

  if (input.opencodeRuntimeLifecycle === "ephemeral") {
    const ephemeral = await createOpencodeWorkflowRuntime();
    return {
      ...input,
      opencodeRuntime: ephemeral.runtime,
      opencodeServeManager: ephemeral.serveManager,
    };
  }

  sharedOpencodeRuntime ??= createOpencodeWorkflowRuntime();
  let shared: OpencodeWorkflowRuntime;
  try {
    shared = await sharedOpencodeRuntime;
  } catch (error) {
    sharedOpencodeRuntime = undefined;
    throw error;
  }
  return {
    ...input,
    opencodeRuntime: shared.runtime,
    opencodeServeManager: shared.serveManager,
  };
}

async function runCompiledScoreGraph(
  logger: CaseLogger,
  graph: CompiledScoreGraph,
  initialState: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const workflowLogger = new WorkflowEventLogger(logger);
  const finalState: Record<string, unknown> = { ...initialState };
  try {
    const stream = await graph.stream(initialState, {
      streamMode: ["updates", "custom"],
    });

    for await (const chunk of stream) {
      const interpreted = interpretStreamChunk(chunk as [string, unknown]);
      if (interpreted) {
        await workflowLogger.log(interpreted);
      }

      if (Array.isArray(chunk) && chunk[0] === "updates") {
        const payload = chunk[1] as Record<string, Record<string, unknown>>;
        for (const update of Object.values(payload)) {
          Object.assign(finalState, update);
        }
      }
    }
  } catch (error) {
    if (error instanceof Error) {
      Object.assign(error, { workflowState: finalState });
    }
    throw error;
  }

  return finalState;
}

async function runWithOpencodeRuntimeLifecycle(
  input: WorkflowCommonInput,
  run: (preparedInput: WorkflowCommonInput) => Promise<Record<string, unknown>>,
): Promise<Record<string, unknown>> {
  const preparedInput = await prepareOpencodeRuntime(input);
  try {
    return await run(preparedInput);
  } finally {
    if (preparedInput.opencodeRuntimeLifecycle === "ephemeral") {
      await preparedInput.opencodeServeManager?.stop();
    }
  }
}

export async function runScoreWorkflow(
  input: LocalWorkflowInput | RemoteWorkflowInput,
): Promise<Record<string, unknown>> {
  const startedAt = Date.now();
  const logger = new CaseLogger(input.artifactStore, input.caseDir);
  const result = await runWithOpencodeRuntimeLifecycle(input, async (preparedInput) => {
    const { logger, graph, traceRecorder } = createCompiledScoreGraph(preparedInput, false);
    const initialState = (() => {
      if ("remoteTask" in input) {
        return {
          remoteTask: input.remoteTask,
          caseDir: input.caseDir,
        };
      }

      return {
        caseInput: input.caseInput,
        sourceCasePath: input.sourceCasePath,
        caseDir: input.caseDir,
      };
    })();

    const workflowResult = await runCompiledScoreGraph(logger, graph as never, initialState);
    await writeWorkflowAgentTrace({
      artifactStore: preparedInput.artifactStore,
      caseDir: preparedInput.caseDir,
      traceRecorder,
      runtime: preparedInput.opencodeRuntime,
      logger,
    });
    return workflowResult;
  });

  if ("caseInput" in input) {
    await logger.info(`本次用例评分耗时=${formatElapsedDuration(Date.now() - startedAt)}`);
  }
  await pruneCompletedCaseArtifacts(input.caseDir, {
    keepCodeLinterDiagnostics: shouldKeepCodeLinterResults(result),
  });

  return result;
}

export async function runPreparedScoreWorkflow(
  input: PreparedWorkflowInput,
): Promise<Record<string, unknown>> {
  const result = await runWithOpencodeRuntimeLifecycle(input, async (preparedInput) => {
    const { logger, graph, traceRecorder } = createCompiledScoreGraph(preparedInput, true);
    const workflowResult = await runCompiledScoreGraph(logger, graph as never, {
      ...input.preparedState,
      caseDir: input.caseDir,
    });
    await writeWorkflowAgentTrace({
      artifactStore: preparedInput.artifactStore,
      caseDir: preparedInput.caseDir,
      traceRecorder,
      runtime: preparedInput.opencodeRuntime,
      logger,
    });
    return workflowResult;
  });
  await pruneCompletedCaseArtifacts(input.caseDir, {
    keepCodeLinterDiagnostics: shouldKeepCodeLinterResults(result),
  });
  return result;
}
