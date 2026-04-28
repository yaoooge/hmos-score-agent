export type HumanVerdict =
  | "confirmed_correct"
  | "confirmed_issue"
  | "auto_false_positive"
  | "auto_false_negative"
  | "partially_correct"
  | "uncertain";

export type HumanReviewPolarity = "positive" | "negative" | "neutral";

export type HumanReviewFilterReason =
  | "process_or_scoring_review_point"
  | "missing_code_evidence"
  | "uncertain_human_verdict"
  | "score_only_adjustment"
  | "non_generation_related"
  | "duplicate_item"
  | "unsupported_payload";

export type HumanReviewItemReview = {
  reviewItemKey?: string;
  sourceItem?: string;
  humanVerdict: HumanVerdict;
  correctedAssessment: string;
  evidence?: {
    files?: string[];
    snippets?: string[];
    comment?: string;
  };
  scoreAdjustment?: {
    finalScore?: number;
    reason?: string;
  };
  preferredFix?: {
    summary?: string;
    patch?: string;
  };
  tags?: string[];
};

export type EligibleHumanReviewItem = {
  reviewItemKey: string;
  polarity: HumanReviewPolarity;
  review: HumanReviewItemReview;
};

export type FilteredHumanReviewItem = {
  reviewItemKey: string;
  reason: HumanReviewFilterReason;
  review: HumanReviewItemReview;
};

export type HumanReviewFilterResult = {
  eligible: EligibleHumanReviewItem[];
  filtered: FilteredHumanReviewItem[];
};

export type HumanReviewSubmissionPayload = {
  reviewer?: {
    id?: string;
    role?: string;
  };
  overallDecision: "accepted" | "rejected" | "adjust_required" | "uncertain";
  overallComment?: string;
  itemReviews: HumanReviewItemReview[];
};

export type HumanReviewRawRecord = {
  schemaVersion: 1;
  reviewId: string;
  taskId: number;
  testCaseId?: number;
  receivedAt: string;
  reviewer?: {
    id?: string;
    role?: string;
  };
  resultSummary: {
    caseId?: string;
    taskType?: string;
    totalScore?: number;
    humanReviewItemCount: number;
    riskCount: number;
  };
  payload: HumanReviewSubmissionPayload | Record<string, unknown>;
};

export type HumanReviewStatus = {
  schemaVersion: 1;
  reviewId: string;
  taskId: number;
  status: "queued" | "running" | "completed" | "failed" | "classification_failed" | "dataset_append_failed";
  updatedAt: string;
  classificationSummary?: {
    rawItemCount: number;
    eligibleItemCount: number;
    filteredItemCount: number;
    datasetItemCount: number;
    positive: number;
    negative: number;
    neutral: number;
  };
  filteredReasons?: Array<{
    reviewItemKey: string;
    reason: HumanReviewFilterReason;
  }>;
  error?: string;
};

export type HumanReviewDatasetType =
  | "sft_positive"
  | "preference_pair"
  | "negative_diagnostic";

export type HumanReviewCategory =
  | "arkts_language"
  | "arkui_state_management"
  | "component_layout"
  | "lifecycle_routing"
  | "api_integration"
  | "project_structure"
  | "platform_capability"
  | "performance_stability"
  | "requirement_following"
  | "build_runtime"
  | "other"
  | "uncertain";

export type ClassifiedHumanReviewEvidence = {
  evidenceId: string;
  reviewId: string;
  taskId: number;
  polarity: HumanReviewPolarity;
  datasetTypes: HumanReviewDatasetType[];
  category: HumanReviewCategory;
  severity: "critical" | "major" | "minor" | "info";
  confidence: "high" | "medium" | "low";
  taskSummary: string;
  humanJudgement: string;
  keyEvidence: string[];
  codeGenerationLesson: string;
  recommendedTrainingUse: string;
  shouldIncludeInTraining: boolean;
  exclusionReason?: string;
};

export type HumanReviewDatasetSample = Record<string, unknown> & {
  type: HumanReviewDatasetType;
  reviewId: string;
  evidenceId: string;
};
