import type {
  ClassifiedHumanReviewEvidence,
  EligibleHumanReviewItem,
  HumanReviewCategory,
} from "../humanReview/humanReviewTypes.js";

export type HumanReviewClassifierInput = EligibleHumanReviewItem & {
  reviewId: string;
  taskId: number;
  taskSummary: string;
  promptText?: string;
  taskType?: string;
  humanReview: EligibleHumanReviewItem["review"];
  evidence: {
    files: string[];
    snippets: string[];
    humanComment?: string;
  };
};

export type HumanReviewEvidenceClassifier = (
  input: HumanReviewClassifierInput,
) => Promise<ClassifiedHumanReviewEvidence>;

export const classifyHumanReviewEvidence: HumanReviewEvidenceClassifier = async (input) => ({
  evidenceId: input.reviewItemKey,
  reviewId: input.reviewId,
  taskId: input.taskId,
  polarity: input.polarity,
  datasetTypes: input.polarity === "positive" ? ["sft_positive"] : ["negative_diagnostic"],
  category: inferCategory(input.humanReview.tags ?? []),
  severity: input.polarity === "positive" ? "info" : "major",
  confidence: input.evidence.files.length > 0 || input.evidence.snippets.length > 0 ? "high" : "low",
  taskSummary: input.taskSummary,
  humanJudgement: input.humanReview.correctedAssessment,
  keyEvidence: [...input.evidence.files, ...input.evidence.snippets],
  codeGenerationLesson: input.humanReview.preferredFix?.summary ?? input.humanReview.correctedAssessment,
  recommendedTrainingUse: input.polarity === "positive" ? "sft_positive" : "negative_diagnostic",
  shouldIncludeInTraining: input.polarity !== "neutral",
});

function inferCategory(tags: string[]): HumanReviewCategory {
  const supported: HumanReviewCategory[] = [
    "arkts_language",
    "arkui_state_management",
    "component_layout",
    "lifecycle_routing",
    "api_integration",
    "project_structure",
    "platform_capability",
    "performance_stability",
    "requirement_following",
    "build_runtime",
  ];
  return supported.find((category) => tags.includes(category)) ?? "other";
}
