import type { HumanReviewEvidenceStore } from "./humanReviewEvidenceStore.js";
import type {
  ClassifiedHumanReviewEvidence,
  HumanReviewCategory,
  HumanReviewDatasetSample,
} from "./humanReviewTypes.js";

export type ResultRiskIngestionInput = {
  taskId: number;
  testCaseId?: number;
  reviewId: string;
  receivedAt: string;
  resultJson: Record<string, unknown>;
  caseContext: {
    caseId?: string;
    taskType?: string;
    prompt?: string;
  };
  datasetEvidenceIdsToSkip?: ReadonlySet<string>;
};

export type ResultRiskIngestionOutput = {
  reviewId: string;
  status: "completed" | "failed";
  summary: {
    riskCount: number;
    eligibleRiskCount: number;
    datasetItemCount: number;
    skippedRiskCount: number;
  };
  evidenceIds: string[];
  error?: string;
};

export type ResultRiskIngestionDeps = {
  store: HumanReviewEvidenceStore;
};

type NormalizedRiskItem = {
  index: number;
  level: string;
  title: string;
  description: string;
  evidence: string;
};

export async function runResultRiskIngestionNode(
  input: ResultRiskIngestionInput,
  deps: ResultRiskIngestionDeps,
): Promise<ResultRiskIngestionOutput> {
  const risks = readRisks(input.resultJson);
  const eligibleRisks = risks.filter(hasTrainingEvidence);
  const summary: ResultRiskIngestionOutput["summary"] = {
    riskCount: risks.length,
    eligibleRiskCount: eligibleRisks.length,
    datasetItemCount: 0,
    skippedRiskCount: risks.length - eligibleRisks.length,
  };
  const evidenceIds: string[] = [];

  await deps.store.writeStatus({
    schemaVersion: 1,
    reviewId: input.reviewId,
    taskId: input.taskId,
    status: "running",
    updatedAt: new Date().toISOString(),
  });

  try {
    for (const risk of eligibleRisks) {
      const evidence = buildRiskEvidence(input, risk);
      await deps.store.writeClassifiedEvidence(evidence);
      evidenceIds.push(evidence.evidenceId);
      if (!input.datasetEvidenceIdsToSkip?.has(evidence.evidenceId)) {
        await deps.store.appendDatasetSample("negative_diagnostic", buildDatasetSample(evidence));
        summary.datasetItemCount += 1;
      }
    }

    await deps.store.writeStatus({
      schemaVersion: 1,
      reviewId: input.reviewId,
      taskId: input.taskId,
      status: "completed",
      updatedAt: new Date().toISOString(),
      classificationSummary: {
        rawItemCount: risks.length,
        eligibleItemCount: eligibleRisks.length,
        filteredItemCount: summary.skippedRiskCount,
        datasetItemCount: summary.datasetItemCount,
        positive: 0,
        negative: evidenceIds.length,
        neutral: summary.skippedRiskCount,
      },
    });

    return { reviewId: input.reviewId, status: "completed", summary, evidenceIds };
  } catch (error) {
    await deps.store.writeStatus({
      schemaVersion: 1,
      reviewId: input.reviewId,
      taskId: input.taskId,
      status: "dataset_append_failed",
      updatedAt: new Date().toISOString(),
      classificationSummary: {
        rawItemCount: risks.length,
        eligibleItemCount: eligibleRisks.length,
        filteredItemCount: summary.skippedRiskCount,
        datasetItemCount: summary.datasetItemCount,
        positive: 0,
        negative: evidenceIds.length,
        neutral: summary.skippedRiskCount,
      },
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      reviewId: input.reviewId,
      status: "failed",
      summary,
      evidenceIds,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function buildResultRiskReviewId(taskId: number, completedAt: string): string {
  return `risk_${completedAt.slice(0, 10).replaceAll("-", "")}_${String(taskId)}`;
}

function readRisks(resultJson: Record<string, unknown>): NormalizedRiskItem[] {
  if (!Array.isArray(resultJson.risks)) {
    return [];
  }

  return resultJson.risks.flatMap((item, index) => {
    if (typeof item !== "object" || item === null) {
      return [];
    }
    const risk = item as Record<string, unknown>;
    const title = readString(risk.title);
    const description = readString(risk.description);
    const evidence = readString(risk.evidence);
    if (!title || !description) {
      return [];
    }
    return [
      {
        index,
        level: readString(risk.level) ?? "major",
        title,
        description,
        evidence: evidence ?? "",
      },
    ];
  });
}

function hasTrainingEvidence(risk: NormalizedRiskItem): boolean {
  return risk.evidence.trim().length > 0;
}

function buildRiskEvidence(
  input: ResultRiskIngestionInput,
  risk: NormalizedRiskItem,
): ClassifiedHumanReviewEvidence {
  const category = inferCategory(`${risk.title}\n${risk.description}\n${risk.evidence}`);
  return {
    evidenceId: `${input.reviewId}-risk-${String(risk.index + 1)}`,
    reviewId: input.reviewId,
    taskId: input.taskId,
    polarity: "negative",
    datasetTypes: ["negative_diagnostic"],
    category,
    severity: mapRiskLevelToSeverity(risk.level),
    confidence: "medium",
    taskSummary: buildTaskSummary(input),
    humanJudgement: `${risk.title}：${risk.description}`,
    keyEvidence: [risk.evidence],
    codeGenerationLesson: `风险项指出：${risk.description}`,
    recommendedTrainingUse: "negative_diagnostic",
    shouldIncludeInTraining: true,
  };
}

function buildTaskSummary(input: ResultRiskIngestionInput): string {
  return [input.caseContext.caseId, input.caseContext.taskType, input.caseContext.prompt]
    .filter((item): item is string => typeof item === "string" && item.length > 0)
    .join(" | ");
}

function buildDatasetSample(evidence: ClassifiedHumanReviewEvidence): HumanReviewDatasetSample {
  return {
    type: "negative_diagnostic",
    reviewId: evidence.reviewId,
    evidenceId: evidence.evidenceId,
    category: evidence.category,
    taskSummary: evidence.taskSummary,
    humanSummary: evidence.humanJudgement,
    codeGenerationLesson: evidence.codeGenerationLesson,
    keyEvidence: evidence.keyEvidence,
  };
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function inferCategory(text: string): HumanReviewCategory {
  const lowerText = text.toLowerCase();
  if (/接口|api|request|fetch|http|mock/.test(lowerText)) {
    return "api_integration";
  }
  if (/状态|state|刷新|更新|@state|observed|watch/.test(lowerText)) {
    return "arkui_state_management";
  }
  if (/布局|组件|component|layout|ui/.test(lowerText)) {
    return "component_layout";
  }
  if (/生命周期|路由|router|navigation|page/.test(lowerText)) {
    return "lifecycle_routing";
  }
  if (/目录|结构|module|project|文件/.test(lowerText)) {
    return "project_structure";
  }
  if (/性能|卡顿|稳定|异常|崩溃|内存/.test(lowerText)) {
    return "performance_stability";
  }
  if (/编译|运行|build|runtime|语法|arkts/.test(lowerText)) {
    return "arkts_language";
  }
  if (/需求|prompt|未实现|缺失/.test(lowerText)) {
    return "requirement_following";
  }
  return "other";
}

function mapRiskLevelToSeverity(level: string): ClassifiedHumanReviewEvidence["severity"] {
  const normalized = level.toLowerCase();
  if (["critical", "high", "严重", "致命"].includes(normalized)) {
    return "critical";
  }
  if (["minor", "low", "轻微"].includes(normalized)) {
    return "minor";
  }
  if (["info", "提示"].includes(normalized)) {
    return "info";
  }
  return "major";
}
