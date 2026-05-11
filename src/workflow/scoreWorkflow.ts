import { END, START, StateGraph } from "@langchain/langgraph";
import { ArtifactStore } from "../io/artifactStore.js";
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

function createCompiledScoreGraph(input: WorkflowCommonInput, resumeFromPreparedState: boolean) {
  const logger = new CaseLogger(input.artifactStore, input.caseDir);
  const runtime = input.opencodeRuntime;
  const opencode =
    input.opencodeRunner ??
    (runtime
      ? {
          runPrompt: (request: OpencodeRunRequest) => runOpencodePrompt({ runtime, request }),
        }
      : undefined);
  const opencodeForState = (state: ScoreGraphState) =>
    opencode && state.opencodeSandboxRoot
      ? { sandboxRoot: state.opencodeSandboxRoot, runPrompt: opencode.runPrompt }
      : undefined;

  if (resumeFromPreparedState) {
    return {
      logger,
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
    graph: new StateGraph(ScoreState)
      .addNode("remoteTaskPreparationNode", (s) => remoteTaskPreparationNode(s))
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
  const shared = await sharedOpencodeRuntime;
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
    const { logger, graph } = createCompiledScoreGraph(preparedInput, false);
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

    return runCompiledScoreGraph(logger, graph as never, initialState);
  });

  if ("caseInput" in input) {
    await logger.info(`本次用例评分耗时=${formatElapsedDuration(Date.now() - startedAt)}`);
  }
  await pruneCompletedCaseArtifacts(input.caseDir);

  return result;
}

export async function runPreparedScoreWorkflow(
  input: PreparedWorkflowInput,
): Promise<Record<string, unknown>> {
  const result = await runWithOpencodeRuntimeLifecycle(input, async (preparedInput) => {
    const { logger, graph } = createCompiledScoreGraph(preparedInput, true);
    return runCompiledScoreGraph(logger, graph as never, {
      ...input.preparedState,
      caseDir: input.caseDir,
    });
  });
  await pruneCompletedCaseArtifacts(input.caseDir);
  return result;
}
