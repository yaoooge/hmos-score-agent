import { END, START, StateGraph } from "@langchain/langgraph";
import { AgentClient, createDefaultAgentClient } from "../agent/agentClient.js";
import { getConfig } from "../config.js";
import { ArtifactStore } from "../io/artifactStore.js";
import { CaseLogger } from "../io/caseLogger.js";
import { agentAssistedRuleNode } from "../nodes/agentAssistedRuleNode.js";
import { agentPromptBuilderNode } from "../nodes/agentPromptBuilderNode.js";
import { inputClassificationNode } from "../nodes/inputClassificationNode.js";
import { featureExtractionNode } from "../nodes/featureExtractionNode.js";
import { persistAndUploadNode } from "../nodes/persistAndUploadNode.js";
import { reportGenerationNode } from "../nodes/reportGenerationNode.js";
import { rubricPreparationNode } from "../nodes/rubricPreparationNode.js";
import { ruleAuditNode } from "../nodes/ruleAuditNode.js";
import { ruleMergeNode } from "../nodes/ruleMergeNode.js";
import { scoringOrchestrationNode } from "../nodes/scoringOrchestrationNode.js";
import { taskUnderstandingNode } from "../nodes/taskUnderstandingNode.js";
import { CaseInput } from "../types.js";
import { ScoreState } from "./state.js";

export async function runScoreWorkflow(input: {
  caseInput: CaseInput;
  caseDir: string;
  referenceRoot: string;
  artifactStore: ArtifactStore;
  uploadEndpoint?: string;
  uploadToken?: string;
  agentClient?: AgentClient;
}): Promise<Record<string, unknown>> {
  const config = getConfig();
  const logger = new CaseLogger(input.artifactStore, input.caseDir);
  const agentClient = input.agentClient ?? createDefaultAgentClient(config);
  const graph = new StateGraph(ScoreState)
    .addNode("taskUnderstandingNode", (s) => taskUnderstandingNode(s))
    .addNode("inputClassificationNode", (s) => inputClassificationNode(s))
    .addNode("featureExtractionNode", (s) => featureExtractionNode(s))
    .addNode("ruleAuditNode", (s) => ruleAuditNode(s, { referenceRoot: input.referenceRoot }))
    .addNode("rubricPreparationNode", (s) =>
      rubricPreparationNode(s, { referenceRoot: input.referenceRoot, logger }),
    )
    .addNode("agentPromptBuilderNode", (s) => agentPromptBuilderNode(s, { logger }))
    .addNode("agentAssistedRuleNode", (s) => agentAssistedRuleNode(s, { agentClient, logger }))
    .addNode("ruleMergeNode", (s) => ruleMergeNode(s, { logger }))
    .addNode("scoringOrchestrationNode", (s) => scoringOrchestrationNode(s))
    .addNode("reportGenerationNode", (s) => reportGenerationNode(s, { referenceRoot: input.referenceRoot }))
    .addNode("persistAndUploadNode", (s) =>
      persistAndUploadNode(s, {
        artifactStore: input.artifactStore,
        uploadEndpoint: input.uploadEndpoint,
        uploadToken: input.uploadToken,
      }),
    )
    .addEdge(START, "taskUnderstandingNode")
    .addEdge("taskUnderstandingNode", "inputClassificationNode")
    .addEdge("inputClassificationNode", "featureExtractionNode")
    .addEdge("featureExtractionNode", "ruleAuditNode")
    .addEdge("ruleAuditNode", "rubricPreparationNode")
    .addEdge("rubricPreparationNode", "agentPromptBuilderNode")
    .addEdge("agentPromptBuilderNode", "agentAssistedRuleNode")
    .addEdge("agentAssistedRuleNode", "ruleMergeNode")
    .addEdge("ruleMergeNode", "scoringOrchestrationNode")
    .addEdge("scoringOrchestrationNode", "reportGenerationNode")
    .addEdge("reportGenerationNode", "persistAndUploadNode")
    .addEdge("persistAndUploadNode", END)
    .compile();

  const result = await graph.invoke({
    caseInput: input.caseInput,
    caseDir: input.caseDir,
    originalPromptText: input.caseInput.promptText,
  });
  return result as Record<string, unknown>;
}
