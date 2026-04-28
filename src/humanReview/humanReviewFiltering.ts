import type {
  EligibleHumanReviewItem,
  FilteredHumanReviewItem,
  HumanReviewFilterReason,
  HumanReviewFilterResult,
  HumanReviewItemReview,
  HumanReviewPolarity,
  HumanVerdict,
} from "./humanReviewTypes.js";

const PROCESS_REVIEW_KEYWORDS = [
  "硬门槛复核",
  "Patch 上下文缺失",
  "Rubric Agent 降级",
  "置信度复核",
  "评分 cap",
  "score cap",
];

const CODE_RELATED_TAGS = new Set([
  "api_integration",
  "requirement_following",
  "arkts_language",
  "arkui_state_management",
  "component_layout",
  "lifecycle_routing",
  "project_structure",
  "platform_capability",
  "performance_stability",
  "build_runtime",
]);

export function mapHumanVerdictToPolarity(verdict: HumanVerdict): HumanReviewPolarity {
  switch (verdict) {
    case "confirmed_correct":
    case "auto_false_positive":
      return "positive";
    case "confirmed_issue":
    case "auto_false_negative":
    case "partially_correct":
      return "negative";
    case "uncertain":
      return "neutral";
  }
}

export function filterHumanReviewTrainingCandidates(
  reviews: HumanReviewItemReview[],
): HumanReviewFilterResult {
  const seenKeys = new Set<string>();
  const eligible: EligibleHumanReviewItem[] = [];
  const filtered: FilteredHumanReviewItem[] = [];

  reviews.forEach((review, index) => {
    const reviewItemKey = makeReviewItemKey(review, index);
    const duplicate = seenKeys.has(reviewItemKey);
    seenKeys.add(reviewItemKey);
    const reason = duplicate ? "duplicate_item" : selectFilterReason(review);
    if (reason) {
      filtered.push({ reviewItemKey, reason, review });
      return;
    }

    eligible.push({
      reviewItemKey,
      polarity: mapHumanVerdictToPolarity(review.humanVerdict),
      review,
    });
  });

  return { eligible, filtered };
}

function makeReviewItemKey(review: HumanReviewItemReview, index: number): string {
  return review.reviewItemKey ?? review.sourceItem ?? `item-${String(index + 1)}`;
}

function selectFilterReason(review: HumanReviewItemReview): HumanReviewFilterReason | undefined {
  if (isProcessReviewPoint(review)) {
    return "process_or_scoring_review_point";
  }
  if (review.humanVerdict === "uncertain") {
    return "uncertain_human_verdict";
  }
  if (isScoreOnlyAdjustment(review)) {
    return "score_only_adjustment";
  }
  if (!hasCodeEvidence(review)) {
    return "missing_code_evidence";
  }
  if (!isGenerationRelated(review)) {
    return "non_generation_related";
  }
  return undefined;
}

function isProcessReviewPoint(review: HumanReviewItemReview): boolean {
  const text = [review.reviewItemKey, review.sourceItem, review.correctedAssessment, ...(review.tags ?? [])]
    .filter((item): item is string => typeof item === "string")
    .join(" ");
  return PROCESS_REVIEW_KEYWORDS.some((keyword) => text.includes(keyword));
}

function isScoreOnlyAdjustment(review: HumanReviewItemReview): boolean {
  return review.scoreAdjustment !== undefined && !hasCodeEvidence(review);
}

function hasCodeEvidence(review: HumanReviewItemReview): boolean {
  return (
    (review.evidence?.files?.length ?? 0) > 0 ||
    (review.evidence?.snippets?.length ?? 0) > 0 ||
    typeof review.preferredFix?.patch === "string"
  );
}

function isGenerationRelated(review: HumanReviewItemReview): boolean {
  if ((review.tags ?? []).some((tag) => CODE_RELATED_TAGS.has(tag))) {
    return true;
  }
  const text = [review.sourceItem, review.correctedAssessment, review.evidence?.comment]
    .filter((item): item is string => typeof item === "string")
    .join(" ");
  return /代码|实现|接口|ArkTS|ArkUI|组件|路由|状态|构建|运行|需求|API|mock/i.test(text);
}
