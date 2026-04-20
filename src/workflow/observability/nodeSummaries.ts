import type { WorkflowNodeId, WorkflowNodeUpdate } from "./types.js";

function lengthOf(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

// summarizeNodeUpdate 负责把节点 update 收敛成稳定的摘要字符串。
export function summarizeNodeUpdate(nodeId: WorkflowNodeId, update: WorkflowNodeUpdate): string {
  switch (nodeId) {
    case "remoteTaskPreparationNode":
      return `mode=${String(update.inputMode ?? update.mode ?? "")} originalFiles=${String(update.originalFileCount ?? 0)} workspaceFiles=${String(update.workspaceFileCount ?? 0)} hasPatch=${String(Boolean(update.hasPatch))}`;
    case "taskUnderstandingNode": {
      const summary = update.constraintSummary as
        | {
            explicitConstraints?: string[];
            contextualConstraints?: string[];
            implicitConstraints?: string[];
            classificationHints?: string[];
          }
        | undefined;
      return `explicit=${lengthOf(summary?.explicitConstraints)} contextual=${lengthOf(summary?.contextualConstraints)} implicit=${lengthOf(summary?.implicitConstraints)} classificationHints=${lengthOf(summary?.classificationHints)}`;
    }
    case "inputClassificationNode":
      return `taskType=${String(update.taskType ?? "")}`;
    case "featureExtractionNode": {
      const featureExtraction = update.featureExtraction as
        | {
            basicFeatures?: unknown[];
            structuralFeatures?: unknown[];
            semanticFeatures?: unknown[];
            changeFeatures?: unknown[];
          }
        | undefined;
      return `basic=${lengthOf(featureExtraction?.basicFeatures)} structural=${lengthOf(featureExtraction?.structuralFeatures)} semantic=${lengthOf(featureExtraction?.semanticFeatures)} change=${lengthOf(featureExtraction?.changeFeatures)}`;
    }
    case "ruleAuditNode": {
      const staticRuleAuditResults =
        (update.staticRuleAuditResults as Array<{ result?: string }> | undefined) ?? [];
      const ruleViolations = (update.ruleViolations as unknown[] | undefined) ?? [];
      const rulesCount = staticRuleAuditResults.length;
      const uncertainCount = staticRuleAuditResults.filter(
        (item) => item.result === "未接入判定器",
      ).length;
      return `rules=${rulesCount} violations=${ruleViolations.length} uncertain=${uncertainCount}`;
    }
    case "rubricPreparationNode": {
      const rubricSnapshot = update.rubricSnapshot as
        | {
            dimension_summaries?: unknown[];
            hard_gates?: unknown[];
            review_rule_summary?: unknown[];
          }
        | undefined;
      return `dimensions=${lengthOf(rubricSnapshot?.dimension_summaries)} hardGates=${lengthOf(rubricSnapshot?.hard_gates)} reviewRules=${lengthOf(rubricSnapshot?.review_rule_summary)}`;
    }
    case "agentPromptBuilderNode":
      return `deterministic=${lengthOf(update.deterministicRuleResults)} candidates=${lengthOf(update.assistedRuleCandidates)} promptLength=${String(String(update.agentPromptText ?? "").length)}`;
    case "agentAssistedRuleNode":
      return `status=${String(update.agentRunStatus ?? "")} outputLength=${String(String(update.agentRawOutputText ?? "").length)}`;
    case "ruleMergeNode": {
      const mergedRuleAuditResults =
        (update.mergedRuleAuditResults as Array<{ result?: string }> | undefined) ?? [];
      return `merged=${mergedRuleAuditResults.length} reviewRequired=${mergedRuleAuditResults.filter((item) => item.result === "待人工复核").length}`;
    }
    case "scoringOrchestrationNode": {
      const score = update.scoreComputation as
        | {
            totalScore?: number;
            hardGateTriggered?: boolean;
            risks?: unknown[];
            humanReviewItems?: unknown[];
          }
        | undefined;
      return `totalScore=${String(score?.totalScore ?? 0)} hardGate=${String(Boolean(score?.hardGateTriggered))} risks=${lengthOf(score?.risks)} reviewItems=${lengthOf(score?.humanReviewItems)}`;
    }
    case "reportGenerationNode":
      return `resultReady=${String(Boolean(update.resultJson))} htmlLength=${String(String(update.htmlReport ?? "").length)}`;
    case "artifactPostProcessNode":
      return `htmlLength=${String(String(update.htmlReport ?? "").length)} reportReady=${String(Boolean(update.htmlReport))}`;
    case "persistAndUploadNode": {
      const uploadMessage = String(update.uploadMessage ?? "");
      const uploadStatus = uploadMessage.includes("跳过")
        ? "skipped"
        : uploadMessage.includes("失败")
          ? "failed"
          : uploadMessage
            ? "success"
            : "failed";
      return `upload=${uploadStatus}`;
    }
    default:
      return "summary=unavailable";
  }
}
