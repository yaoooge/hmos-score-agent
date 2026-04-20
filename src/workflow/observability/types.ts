export type WorkflowNodeId =
  | "remoteTaskPreparationNode"
  | "taskUnderstandingNode"
  | "inputClassificationNode"
  | "featureExtractionNode"
  | "ruleAuditNode"
  | "rubricPreparationNode"
  | "agentPromptBuilderNode"
  | "agentAssistedRuleNode"
  | "ruleMergeNode"
  | "scoringOrchestrationNode"
  | "reportGenerationNode"
  | "artifactPostProcessNode"
  | "persistAndUploadNode";

export type WorkflowNodeUpdate = Record<string, unknown>;

export type WorkflowLifecycleEvent =
  | {
      level: "info";
      type: "node_started";
      nodeId: WorkflowNodeId;
      label: string;
    }
  | {
      level: "info";
      type: "node_completed";
      nodeId: WorkflowNodeId;
      label: string;
      summary: string;
    }
  | {
      level: "error";
      type: "node_failed";
      nodeId: WorkflowNodeId;
      label: string;
      errorMessage?: string;
    };
