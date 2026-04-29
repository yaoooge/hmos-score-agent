export type HumanVerdict =
  | "confirmed_correct"
  | "confirmed_issue"
  | "auto_false_positive"
  | "auto_false_negative"
  | "partially_correct"
  | "uncertain";

export type HumanRiskLevel = "high" | "medium" | "low" | "none";

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

export type HumanRiskReview = {
  riskIndex: number;
  agreeWithResultLevel: boolean;
  resultLevel: HumanRiskLevel;
  correctedLevel?: HumanRiskLevel;
  reason?: string;
  comment?: string;
};

export type HumanReviewSubmissionPayload = {
  reviewer?: {
    id?: string;
    role?: string;
  };
  itemReviews?: HumanReviewItemReview[];
  riskReviews?: HumanRiskReview[];
};

export type HumanReviewStatus = {
  schemaVersion: 1;
  reviewId: string;
  taskId: number;
  status: "completed";
  updatedAt: string;
  summary: {
    itemReviewCount: number;
    riskReviewCount: number;
    riskAgreementCount: number;
    riskDisagreementCount: number;
    datasetItemCount: number;
  };
};

export type HumanReviewDatasetType = "item_review_calibration" | "risk_review_calibration";

export type HumanReviewDatasetSample = Record<string, unknown> & {
  type: HumanReviewDatasetType;
  reviewId: string;
  evidenceId: string;
};
