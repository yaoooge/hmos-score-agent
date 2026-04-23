import { END, START, StateGraph } from "@langchain/langgraph";
import { AgentClient, createDefaultAgentClient } from "../agent/agentClient.js";
import { getConfig } from "../config.js";
import { ArtifactStore } from "../io/artifactStore.js";
import { CaseLogger } from "../io/caseLogger.js";
import { artifactPostProcessNode } from "../nodes/artifactPostProcessNode.js";
import { inputClassificationNode } from "../nodes/inputClassificationNode.js";
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
import { taskUnderstandingNode } from "../nodes/taskUnderstandingNode.js";
import { CaseInput, RemoteEvaluationTask } from "../types.js";
import { ScoreState } from "./state.js";
import { WorkflowEventLogger } from "./observability/workflowEventLogger.js";
import { interpretStreamChunk } from "./observability/workflowStreamInterpreter.js";
import type { ScoreGraphState } from "./state.js";

type LocalWorkflowInput = {
  caseInput: CaseInput;
  caseDir: string;
  sourceCasePath?: string;
  referenceRoot: string;
  artifactStore: ArtifactStore;
  agentClient?: AgentClient;
};

type RemoteWorkflowInput = {
  remoteTask: RemoteEvaluationTask;
  caseDir: string;
  referenceRoot: string;
  artifactStore: ArtifactStore;
  agentClient?: AgentClient;
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
  agentClient?: AgentClient;
};

type WorkflowCommonInput = {
  caseDir: string;
  referenceRoot: string;
  artifactStore: ArtifactStore;
  agentClient?: AgentClient;
};

type CompiledScoreGraph = {
  stream(
    initialState: Record<string, unknown>,
    config: { streamMode: string[] },
  ): Promise<AsyncIterable<[string, unknown]>>;
};

function createCompiledScoreGraph(input: WorkflowCommonInput, resumeFromPreparedState: boolean) {
  const config = getConfig();
  const logger = new CaseLogger(input.artifactStore, input.caseDir);
  const agentClient = Object.prototype.hasOwnProperty.call(input, "agentClient")
    ? input.agentClient
    : createDefaultAgentClient(config);

  if (resumeFromPreparedState) {
    return {
      logger,
      graph: new StateGraph(ScoreState)
        .addNode("ruleAuditNode", (s) => ruleAuditNode(s, { referenceRoot: input.referenceRoot }))
        .addNode("rubricPreparationNode", (s) =>
          rubricPreparationNode(s, { referenceRoot: input.referenceRoot, logger }),
        )
        .addNode("rubricScoringPromptBuilderNode", (s) =>
          rubricScoringPromptBuilderNode(s, { logger }),
        )
        .addNode("rubricScoringAgentNode", (s) =>
          rubricScoringAgentNode(s, { agentClient, logger }),
        )
        .addNode("ruleAgentPromptBuilderNode", (s) => ruleAgentPromptBuilderNode(s, { logger }))
        .addNode("ruleAssessmentAgentNode", (s) =>
          ruleAssessmentAgentNode(s, { agentClient, logger }),
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
        .addEdge(START, "ruleAuditNode")
        .addEdge("ruleAuditNode", "rubricPreparationNode")
        .addEdge("rubricPreparationNode", "rubricScoringPromptBuilderNode")
        .addEdge("rubricPreparationNode", "ruleAgentPromptBuilderNode")
        .addEdge("rubricScoringPromptBuilderNode", "rubricScoringAgentNode")
        .addEdge("ruleAgentPromptBuilderNode", "ruleAssessmentAgentNode")
        .addEdge("ruleAssessmentAgentNode", "ruleMergeNode")
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
          { agentClient, artifactStore: input.artifactStore, logger },
          nodeConfig,
        ),
      )
      .addNode("inputClassificationNode", (s) => inputClassificationNode(s))
      .addNode("ruleAuditNode", (s) => ruleAuditNode(s, { referenceRoot: input.referenceRoot }))
      .addNode("rubricPreparationNode", (s) =>
        rubricPreparationNode(s, { referenceRoot: input.referenceRoot, logger }),
      )
      .addNode("rubricScoringPromptBuilderNode", (s) =>
        rubricScoringPromptBuilderNode(s, { logger }),
      )
      .addNode("rubricScoringAgentNode", (s) =>
        rubricScoringAgentNode(s, { agentClient, logger }),
      )
      .addNode("ruleAgentPromptBuilderNode", (s) => ruleAgentPromptBuilderNode(s, { logger }))
      .addNode("ruleAssessmentAgentNode", (s) =>
        ruleAssessmentAgentNode(s, { agentClient, logger }),
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
      .addEdge("ruleAuditNode", "rubricPreparationNode")
      .addEdge("rubricPreparationNode", "rubricScoringPromptBuilderNode")
      .addEdge("rubricPreparationNode", "ruleAgentPromptBuilderNode")
      .addEdge("rubricScoringPromptBuilderNode", "rubricScoringAgentNode")
      .addEdge("ruleAgentPromptBuilderNode", "ruleAssessmentAgentNode")
      .addEdge("ruleAssessmentAgentNode", "ruleMergeNode")
      .addEdge(["rubricScoringAgentNode", "ruleMergeNode"], "scoreFusionOrchestrationNode")
      .addEdge("scoreFusionOrchestrationNode", "reportGenerationNode")
      .addEdge("reportGenerationNode", "artifactPostProcessNode")
      .addEdge("artifactPostProcessNode", "persistAndUploadNode")
      .addEdge("persistAndUploadNode", END)
      .compile(),
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

export async function runScoreWorkflow(
  input: LocalWorkflowInput | RemoteWorkflowInput,
): Promise<Record<string, unknown>> {
  const { logger, graph } = createCompiledScoreGraph(input, false);
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
}

export async function runPreparedScoreWorkflow(
  input: PreparedWorkflowInput,
): Promise<Record<string, unknown>> {
  const { logger, graph } = createCompiledScoreGraph(input, true);
  return runCompiledScoreGraph(logger, graph as never, {
    ...input.preparedState,
    caseDir: input.caseDir,
  });
}
