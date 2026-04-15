import { END, START, StateGraph } from "@langchain/langgraph";
import { ArtifactStore } from "../io/artifactStore.js";
import { inputClassificationNode } from "../nodes/inputClassificationNode.js";
import { featureExtractionNode } from "../nodes/featureExtractionNode.js";
import { persistAndUploadNode } from "../nodes/persistAndUploadNode.js";
import { reportGenerationNode } from "../nodes/reportGenerationNode.js";
import { ruleAuditNode } from "../nodes/ruleAuditNode.js";
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
}): Promise<Record<string, unknown>> {
  const graph = new StateGraph(ScoreState)
    .addNode("taskUnderstandingNode", (s) => taskUnderstandingNode(s))
    .addNode("inputClassificationNode", (s) => inputClassificationNode(s))
    .addNode("featureExtractionNode", (s) => featureExtractionNode(s))
    .addNode("ruleAuditNode", (s) => ruleAuditNode(s, { referenceRoot: input.referenceRoot }))
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
    .addEdge("ruleAuditNode", "scoringOrchestrationNode")
    .addEdge("scoringOrchestrationNode", "reportGenerationNode")
    .addEdge("reportGenerationNode", "persistAndUploadNode")
    .addEdge("persistAndUploadNode", END)
    .compile();

  const result = await graph.invoke({
    caseInput: input.caseInput,
    caseDir: input.caseDir,
  });
  return result as Record<string, unknown>;
}
