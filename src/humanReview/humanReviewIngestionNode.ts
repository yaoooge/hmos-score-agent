import { classifyHumanReviewEvidence, type HumanReviewEvidenceClassifier } from "../agent/humanReviewEvidenceClassifier.js";
import { filterHumanReviewTrainingCandidates } from "./humanReviewFiltering.js";
import type { HumanReviewEvidenceStore } from "./humanReviewEvidenceStore.js";
import type {
  ClassifiedHumanReviewEvidence,
  HumanReviewDatasetSample,
  HumanReviewDatasetType,
  HumanReviewFilterReason,
  HumanReviewPolarity,
  HumanReviewSubmissionPayload,
} from "./humanReviewTypes.js";

export type HumanReviewIngestionInput = {
  taskId: number;
  reviewId: string;
  submittedAt: string;
  reviewer?: {
    id?: string;
    role?: string;
  };
  resultJson: Record<string, unknown>;
  caseContext: {
    caseDir?: string;
    testCaseId?: number;
    caseId?: string;
    prompt?: string;
    taskType?: string;
  };
  reviewPayload: HumanReviewSubmissionPayload;
};

export type HumanReviewIngestionOutput = {
  reviewId: string;
  status: "completed" | "failed";
  summary: {
    rawItemCount: number;
    eligibleItemCount: number;
    filteredItemCount: number;
    datasetItemCount: number;
    positive: number;
    negative: number;
    neutral: number;
  };
  filteredItems: Array<{
    reviewItemKey: string;
    reason: HumanReviewFilterReason;
  }>;
  evidenceIds: string[];
  error?: string;
};

export type HumanReviewIngestionDeps = {
  store: HumanReviewEvidenceStore;
  classifier?: HumanReviewEvidenceClassifier;
};

export async function runHumanReviewIngestionNode(
  input: HumanReviewIngestionInput,
  deps: HumanReviewIngestionDeps,
): Promise<HumanReviewIngestionOutput> {
  const classifier = deps.classifier ?? classifyHumanReviewEvidence;
  const filtered = filterHumanReviewTrainingCandidates(input.reviewPayload.itemReviews);
  await deps.store.writeStatus({
    schemaVersion: 1,
    reviewId: input.reviewId,
    taskId: input.taskId,
    status: "running",
    updatedAt: new Date().toISOString(),
  });

  const summary = createEmptySummary(input.reviewPayload.itemReviews.length);
  summary.eligibleItemCount = filtered.eligible.length;
  summary.filteredItemCount = filtered.filtered.length;
  const evidenceIds: string[] = [];

  try {
    for (const item of filtered.eligible) {
      const evidence = await classifier({
        ...item,
        reviewId: input.reviewId,
        taskId: input.taskId,
        taskSummary: buildTaskSummary(input),
        promptText: input.caseContext.prompt,
        taskType: input.caseContext.taskType,
        humanReview: item.review,
        evidence: {
          files: item.review.evidence?.files ?? [],
          snippets: item.review.evidence?.snippets ?? [],
          humanComment: item.review.evidence?.comment,
        },
      });
      validateClassifierOutput(evidence, item.polarity);
      await deps.store.writeClassifiedEvidence(evidence);
      evidenceIds.push(evidence.evidenceId);
      countPolarity(summary, evidence.polarity);
      if (evidence.shouldIncludeInTraining) {
        for (const datasetType of evidence.datasetTypes) {
          await deps.store.appendDatasetSample(datasetType, buildDatasetSample(datasetType, evidence));
          summary.datasetItemCount += 1;
        }
      }
    }

    for (const item of filtered.filtered) {
      summary.neutral += 1;
      await deps.store.writeClassifiedEvidence({
        evidenceId: `${input.reviewId}-${item.reviewItemKey}`,
        reviewId: input.reviewId,
        taskId: input.taskId,
        polarity: "neutral",
        datasetTypes: [],
        category: "uncertain",
        severity: "info",
        confidence: "low",
        taskSummary: buildTaskSummary(input),
        humanJudgement: item.review.correctedAssessment,
        keyEvidence: [],
        codeGenerationLesson: "该复核项与代码生成训练无直接关系，默认不进入训练数据集。",
        recommendedTrainingUse: "excluded",
        shouldIncludeInTraining: false,
        exclusionReason: item.reason,
      });
    }

    await deps.store.writeStatus({
      schemaVersion: 1,
      reviewId: input.reviewId,
      taskId: input.taskId,
      status: "completed",
      updatedAt: new Date().toISOString(),
      classificationSummary: summary,
      filteredReasons: filtered.filtered.map((item) => ({
        reviewItemKey: item.reviewItemKey,
        reason: item.reason,
      })),
    });
    return {
      reviewId: input.reviewId,
      status: "completed",
      summary,
      filteredItems: filtered.filtered.map((item) => ({
        reviewItemKey: item.reviewItemKey,
        reason: item.reason,
      })),
      evidenceIds,
    };
  } catch (error) {
    await deps.store.writeStatus({
      schemaVersion: 1,
      reviewId: input.reviewId,
      taskId: input.taskId,
      status: "classification_failed",
      updatedAt: new Date().toISOString(),
      classificationSummary: summary,
      filteredReasons: filtered.filtered.map((item) => ({
        reviewItemKey: item.reviewItemKey,
        reason: item.reason,
      })),
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      reviewId: input.reviewId,
      status: "failed",
      summary,
      filteredItems: filtered.filtered.map((item) => ({
        reviewItemKey: item.reviewItemKey,
        reason: item.reason,
      })),
      evidenceIds,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function createEmptySummary(rawItemCount: number): HumanReviewIngestionOutput["summary"] {
  return {
    rawItemCount,
    eligibleItemCount: 0,
    filteredItemCount: 0,
    datasetItemCount: 0,
    positive: 0,
    negative: 0,
    neutral: 0,
  };
}

function buildTaskSummary(input: HumanReviewIngestionInput): string {
  return [input.caseContext.caseId, input.caseContext.taskType, input.caseContext.prompt]
    .filter((item): item is string => typeof item === "string" && item.length > 0)
    .join(" | ");
}

function validateClassifierOutput(
  evidence: ClassifiedHumanReviewEvidence,
  expectedPolarity: HumanReviewPolarity,
): void {
  if (expectedPolarity !== "neutral" && evidence.polarity !== expectedPolarity) {
    throw new Error("human review classifier cannot invert confirmed human polarity");
  }
  if (evidence.shouldIncludeInTraining && evidence.keyEvidence.length === 0) {
    throw new Error("human review classifier output lacks key evidence");
  }
}

function countPolarity(
  summary: HumanReviewIngestionOutput["summary"],
  polarity: HumanReviewPolarity,
): void {
  if (polarity === "positive") {
    summary.positive += 1;
    return;
  }
  if (polarity === "negative") {
    summary.negative += 1;
    return;
  }
  summary.neutral += 1;
}

function buildDatasetSample(
  datasetType: HumanReviewDatasetType,
  evidence: ClassifiedHumanReviewEvidence,
): HumanReviewDatasetSample {
  return {
    type: datasetType,
    reviewId: evidence.reviewId,
    evidenceId: evidence.evidenceId,
    category: evidence.category,
    taskSummary: evidence.taskSummary,
    humanSummary: evidence.humanJudgement,
    codeGenerationLesson: evidence.codeGenerationLesson,
    keyEvidence: evidence.keyEvidence,
  };
}
