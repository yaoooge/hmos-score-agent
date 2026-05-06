import fs from "node:fs/promises";
import path from "node:path";
import type { Request, Response } from "express";
import type { HumanReviewEvidenceStore } from "../humanReview/humanReviewEvidenceStore.js";
import type {
  HumanReviewItemReview,
  HumanReviewSubmissionPayload,
  HumanRiskLevel,
  HumanRiskReview,
} from "../humanReview/humanReviewTypes.js";
import type { RemoteTaskRegistry } from "./remoteTaskRegistry.js";

export type SubmitHumanReviewDeps = {
  registry: RemoteTaskRegistry;
  store: HumanReviewEvidenceStore;
};

type NormalizedResultRisk = {
  id: number;
  level: string;
  title: string;
  description: string;
  evidence: string;
};

type NormalizedResultReviewItem = {
  id: number;
  item: string;
  current_assessment: string;
  uncertainty_reason: string;
  suggested_focus: string;
};

const RISK_LEVELS = new Set(["high", "medium", "low", "none"]);

export function createSubmitHumanReviewHandler(deps: SubmitHumanReviewDeps) {
  return async (req: Request, res: Response) => {
    const taskId = readRouteTaskId(req);
    if (taskId === undefined) {
      res.status(404).json({ success: false, message: "Remote task not found" });
      return;
    }

    const payload = parseSubmissionPayload(req.body);
    if (typeof payload === "string") {
      res.status(400).json({ success: false, message: payload });
      return;
    }

    const record = await deps.registry.get(taskId);
    if (!record) {
      res.status(404).json({ success: false, taskId, message: "Remote task not found" });
      return;
    }
    if (record.status !== "completed") {
      res.status(409).json({
        success: false,
        taskId,
        status: record.status,
        message: "Remote task is not completed yet",
      });
      return;
    }
    if (!record.caseDir) {
      res.status(404).json({ success: false, taskId, message: "Result file not found" });
      return;
    }

    let resultJson: Record<string, unknown>;
    try {
      resultJson = JSON.parse(
        await fs.readFile(path.join(record.caseDir, "outputs", "result.json"), "utf-8"),
      ) as Record<string, unknown>;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        res.status(404).json({ success: false, taskId, message: "Result file not found" });
        return;
      }
      throw error;
    }

    const reviewValidation = validateReviewsWithResult(payload, resultJson);
    if (reviewValidation) {
      res.status(reviewValidation.status).json({
        success: false,
        taskId,
        message: reviewValidation.message,
      });
      return;
    }

    const itemDatasetCount = await appendItemReviewCalibrationSamples({
      store: deps.store,
      taskId,
      testCaseId: record.testCaseId,
      resultJson,
      payload,
    });
    const riskDatasetCount = await appendRiskReviewCalibrationSamples({
      store: deps.store,
      taskId,
      testCaseId: record.testCaseId,
      resultJson,
      payload,
    });
    const itemReviewCount = payload.itemReviews?.length ?? 0;
    const riskReviewCount = payload.riskReviews?.length ?? 0;
    const riskAgreementCount = (payload.riskReviews ?? []).filter(
      (item) => item.agreeWithResultLevel,
    ).length;
    const riskDisagreementCount = riskReviewCount - riskAgreementCount;
    const summary = {
      itemReviewCount,
      riskReviewCount,
      riskAgreementCount,
      riskDisagreementCount,
      datasetItemCount: itemDatasetCount + riskDatasetCount,
    };

    res.json({
      success: true,
      taskId,
      status: "completed",
      summary,
      message: "人工复核结果已接收。",
    });
  };
}

function readRouteTaskId(req: Request): number | undefined {
  const taskId = Number(req.params.taskId);
  return Number.isFinite(taskId) ? taskId : undefined;
}

function parseSubmissionPayload(body: unknown): HumanReviewSubmissionPayload | string {
  if (typeof body !== "object" || body === null) {
    return "Request body must be an object";
  }
  const candidate = body as Partial<HumanReviewSubmissionPayload>;
  const itemReviews = candidate.itemReviews ?? [];
  const riskReviews = candidate.riskReviews ?? [];
  if (!Array.isArray(itemReviews)) {
    return "itemReviews must be an array";
  }
  if (!Array.isArray(riskReviews)) {
    return "riskReviews must be an array";
  }

  const itemIds = new Set<number>();
  for (const [index, item] of itemReviews.entries()) {
    if (typeof item !== "object" || item === null) {
      return "itemReviews entries must be objects";
    }
    const itemReview = item as Record<string, unknown>;
    if (!isPositiveInteger(itemReview.itemId)) {
      return `itemReviews[${String(index)}].itemId is required or invalid`;
    }
    if (itemIds.has(itemReview.itemId)) {
      return `itemReviews[${String(index)}].itemId is duplicated`;
    }
    itemIds.add(itemReview.itemId);
    if (typeof itemReview.agreeWithResultAssessment !== "boolean") {
      return `itemReviews[${String(index)}].agreeWithResultAssessment is required or invalid`;
    }
    if (typeof itemReview.resultAssessment !== "string") {
      return `itemReviews[${String(index)}].resultAssessment is required or invalid`;
    }
    if (itemReview.agreeWithResultAssessment === false) {
      if (typeof itemReview.correctedAssessment !== "string" || itemReview.correctedAssessment.trim().length === 0) {
        return `itemReviews[${String(index)}].correctedAssessment is required when agreeWithResultAssessment is false`;
      }
      if (typeof itemReview.reason !== "string" || itemReview.reason.trim().length === 0) {
        return `itemReviews[${String(index)}].reason is required when agreeWithResultAssessment is false`;
      }
    }
  }

  const riskIds = new Set<number>();
  for (const [index, item] of riskReviews.entries()) {
    if (typeof item !== "object" || item === null) {
      return "riskReviews entries must be objects";
    }
    const riskReview = item as Record<string, unknown>;
    if (!isPositiveInteger(riskReview.riskId)) {
      return `riskReviews[${String(index)}].riskId is required or invalid`;
    }
    if (riskIds.has(riskReview.riskId)) {
      return `riskReviews[${String(index)}].riskId is duplicated`;
    }
    riskIds.add(riskReview.riskId);
    if (typeof riskReview.agreeWithResultLevel !== "boolean") {
      return `riskReviews[${String(index)}].agreeWithResultLevel is required or invalid`;
    }
    if (!isRiskLevel(riskReview.resultLevel)) {
      return `riskReviews[${String(index)}].resultLevel is required or invalid`;
    }
    if (riskReview.agreeWithResultLevel === false) {
      if (!isRiskLevel(riskReview.correctedLevel)) {
        return `riskReviews[${String(index)}].correctedLevel is required when agreeWithResultLevel is false`;
      }
      if (typeof riskReview.reason !== "string" || riskReview.reason.trim().length === 0) {
        return `riskReviews[${String(index)}].reason is required when agreeWithResultLevel is false`;
      }
    }
  }

  return {
    reviewer: candidate.reviewer,
    itemReviews: itemReviews as HumanReviewItemReview[],
    riskReviews: riskReviews as HumanRiskReview[],
  };
}

function validateReviewsWithResult(
  payload: HumanReviewSubmissionPayload,
  resultJson: Record<string, unknown>,
): { status: 400 | 409; message: string } | undefined {
  const resultItemsById = new Map(readResultReviewItems(resultJson).map((item) => [item.id, item]));
  for (const [index, review] of (payload.itemReviews ?? []).entries()) {
    const resultItem = resultItemsById.get(review.itemId);
    if (!resultItem) {
      return {
        status: 400,
        message: `itemReviews[${String(index)}].itemId does not match result human_review_items`,
      };
    }
    if (review.resultAssessment !== resultItem.current_assessment) {
      return {
        status: 409,
        message: `itemReviews[${String(index)}].resultAssessment does not match result review item assessment`,
      };
    }
  }

  const risksById = new Map(readResultRisks(resultJson).map((risk) => [risk.id, risk]));
  for (const [index, review] of (payload.riskReviews ?? []).entries()) {
    const risk = risksById.get(review.riskId);
    if (!risk) {
      return {
        status: 400,
        message: `riskReviews[${String(index)}].riskId does not match result risks`,
      };
    }
    if (review.resultLevel !== risk.level) {
      return {
        status: 409,
        message: `riskReviews[${String(index)}].resultLevel does not match result risk level`,
      };
    }
  }
  return undefined;
}

async function appendItemReviewCalibrationSamples(input: {
  store: HumanReviewEvidenceStore;
  taskId: number;
  testCaseId?: number;
  resultJson: Record<string, unknown>;
  payload: HumanReviewSubmissionPayload;
}): Promise<number> {
  const resultItemsById = new Map(readResultReviewItems(input.resultJson).map((item) => [item.id, item]));
  let count = 0;
  for (const review of input.payload.itemReviews ?? []) {
    const resultReviewItem = resultItemsById.get(review.itemId);
    if (!resultReviewItem) {
      continue;
    }
    await input.store.appendDatasetSample("item_review_calibration", {
      type: "item_review_calibration",
      taskId: input.taskId,
      testCaseId: input.testCaseId,
      itemId: review.itemId,
      taskSummary: buildTaskSummary(input.resultJson),
      resultReviewItem,
      humanReview: {
        agreeWithResultAssessment: review.agreeWithResultAssessment,
        correctedAssessment: review.correctedAssessment,
        reason: review.reason,
        comment: review.comment,
      },
    });
    count += 1;
  }
  return count;
}

async function appendRiskReviewCalibrationSamples(input: {
  store: HumanReviewEvidenceStore;
  taskId: number;
  testCaseId?: number;
  resultJson: Record<string, unknown>;
  payload: HumanReviewSubmissionPayload;
}): Promise<number> {
  const risksById = new Map(readResultRisks(input.resultJson).map((risk) => [risk.id, risk]));
  let count = 0;
  for (const review of input.payload.riskReviews ?? []) {
    const risk = risksById.get(review.riskId);
    if (!risk) {
      continue;
    }
    await input.store.appendDatasetSample("risk_review_calibration", {
      type: "risk_review_calibration",
      taskId: input.taskId,
      testCaseId: input.testCaseId,
      riskId: review.riskId,
      taskSummary: buildTaskSummary(input.resultJson),
      resultRisk: risk,
      humanReview: {
        agreeWithResultLevel: review.agreeWithResultLevel,
        correctedLevel: review.correctedLevel,
        reason: review.reason,
        comment: review.comment,
      },
    });
    count += 1;
  }
  return count;
}

function readResultReviewItems(resultJson: Record<string, unknown>): NormalizedResultReviewItem[] {
  if (!Array.isArray(resultJson.human_review_items)) {
    return [];
  }
  return resultJson.human_review_items.flatMap((item, index) => {
    const reviewItem = typeof item === "object" && item !== null ? (item as Record<string, unknown>) : {};
    const id = readResultArrayId(reviewItem, index);
    if (!Number.isInteger(id) || id <= 0) {
      return [];
    }
    return [
      {
        id,
        item: readString(reviewItem.item) ?? "",
        current_assessment: readString(reviewItem.current_assessment) ?? "",
        uncertainty_reason: readString(reviewItem.uncertainty_reason) ?? "",
        suggested_focus: readString(reviewItem.suggested_focus) ?? "",
      },
    ];
  });
}

function readResultRisks(resultJson: Record<string, unknown>): NormalizedResultRisk[] {
  if (!Array.isArray(resultJson.risks)) {
    return [];
  }
  return resultJson.risks.flatMap((item, index) => {
    const risk = typeof item === "object" && item !== null ? (item as Record<string, unknown>) : {};
    const id = readResultArrayId(risk, index);
    if (!Number.isInteger(id) || id <= 0) {
      return [];
    }
    return [
      {
        id,
        level: readString(risk.level) ?? "",
        title: readString(risk.title) ?? "",
        description: readString(risk.description) ?? "",
        evidence: readString(risk.evidence) ?? "",
      },
    ];
  });
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) > 0;
}

function readResultArrayId(item: Record<string, unknown>, index: number): number {
  return Object.hasOwn(item, "id") ? Number(item.id) : index + 1;
}

function isRiskLevel(value: unknown): value is HumanRiskLevel {
  return typeof value === "string" && RISK_LEVELS.has(value);
}

function buildTaskSummary(resultJson: Record<string, unknown>): string {
  return [readCaseId(resultJson), readTaskType(resultJson)]
    .filter((item): item is string => typeof item === "string" && item.length > 0)
    .join(" | ");
}

function readCaseId(resultJson: Record<string, unknown>): string | undefined {
  const reportMeta =
    typeof resultJson.report_meta === "object" && resultJson.report_meta !== null
      ? (resultJson.report_meta as Record<string, unknown>)
      : {};
  return typeof reportMeta.unit_name === "string" ? reportMeta.unit_name : undefined;
}

function readTaskType(resultJson: Record<string, unknown>): string | undefined {
  const basicInfo =
    typeof resultJson.basic_info === "object" && resultJson.basic_info !== null
      ? (resultJson.basic_info as Record<string, unknown>)
      : {};
  return typeof basicInfo.task_type === "string" ? basicInfo.task_type : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}
