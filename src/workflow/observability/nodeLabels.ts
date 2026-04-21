import type { WorkflowNodeId } from "./types.js";

const NODE_LABELS: Record<WorkflowNodeId, string> = {
  remoteTaskPreparationNode: "远端任务预处理",
  taskUnderstandingNode: "任务理解",
  inputClassificationNode: "任务分类",
  featureExtractionNode: "特征提取",
  ruleAuditNode: "规则审计",
  rubricPreparationNode: "评分基线准备",
  agentPromptBuilderNode: "Agent 提示组装",
  agentAssistedRuleNode: "Agent 辅助判定",
  ruleMergeNode: "规则结果合并",
  scoringOrchestrationNode: "评分编排",
  reportGenerationNode: "报告生成",
  artifactPostProcessNode: "产物后处理",
  persistAndUploadNode: "结果落盘",
};

export function getNodeLabel(nodeId: WorkflowNodeId): string {
  return NODE_LABELS[nodeId];
}
