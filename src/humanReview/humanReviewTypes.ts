export type HumanRiskLevel = "high" | "medium" | "low" | "none";

export type HumanReviewItemReview = {
  itemId: number;
  agreeWithResultAssessment: boolean;
  resultAssessment: string;
  correctedAssessment?: string;
  reason?: string;
  comment?: string;
};

export type HumanRiskReview = {
  riskId: number;
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

export type HumanReviewDatasetType =
  | "item_review_calibration"
  | "risk_review_calibration"
  | "human_rating_gap_analysis";

export type HumanReviewDatasetSample = Record<string, unknown> & {
  type: HumanReviewDatasetType;
};
