import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import type { HumanReviewEvidenceStore } from "../humanReview/humanReviewEvidenceStore.js";
import type {
  HumanReviewSubmissionPayload,
  HumanRiskLevel,
} from "../humanReview/humanReviewTypes.js";
import type { RemoteTaskRegistry } from "./remoteTaskRegistry.js";

export type SubmitHumanReviewDeps = {
  registry: RemoteTaskRegistry;
  store: HumanReviewEvidenceStore;
};

type NormalizedResultRisk = {
  level: string;
  title: string;
  description: string;
  evidence: string;
};

const HUMAN_VERDICTS = new Set([
  "confirmed_correct",
  "confirmed_issue",
  "auto_false_positive",
  "auto_false_negative",
  "partially_correct",
  "uncertain",
]);
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

    const riskValidation = validateRiskReviewsWithResult(payload, resultJson);
    if (riskValidation) {
      res.status(riskValidation.status).json({
        success: false,
        taskId,
        message: riskValidation.message,
      });
      return;
    }

    const receivedAt = new Date().toISOString();
    const reviewId = buildReviewId(taskId, receivedAt);
    const itemDatasetCount = await appendItemReviewCalibrationSamples({
      store: deps.store,
      reviewId,
      taskId,
      testCaseId: record.testCaseId,
      resultJson,
      payload,
    });
    const riskDatasetCount = await appendRiskReviewCalibrationSamples({
      store: deps.store,
      reviewId,
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
    await deps.store.writeStatus({
      schemaVersion: 1,
      reviewId,
      taskId,
      status: "completed",
      updatedAt: receivedAt,
      summary,
    });

    res.json({
      success: true,
      taskId,
      reviewId,
      status: "completed",
      summary,
      message: "人工复核结果已接收。",
    });
  };
}

export function createGetHumanReviewStatusHandler(store: HumanReviewEvidenceStore) {
  return async (req: Request, res: Response) => {
    const reviewId = req.params.reviewId;
    if (typeof reviewId !== "string" || reviewId.length === 0) {
      res.status(404).json({ success: false, message: "Human review not found" });
      return;
    }
    const status = await store.readStatus(reviewId);
    if (!status) {
      res.status(404).json({ success: false, reviewId, message: "Human review not found" });
      return;
    }
    res.json({ success: true, ...status });
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
  for (const item of itemReviews) {
    if (typeof item !== "object" || item === null) {
      return "itemReviews entries must be objects";
    }
    if (!HUMAN_VERDICTS.has(String((item as { humanVerdict?: unknown }).humanVerdict))) {
      return "humanVerdict is required or invalid";
    }
    if (typeof (item as { correctedAssessment?: unknown }).correctedAssessment !== "string") {
      return "correctedAssessment is required";
    }
  }
  for (const [index, item] of riskReviews.entries()) {
    if (typeof item !== "object" || item === null) {
      return "riskReviews entries must be objects";
    }
    const riskReview = item as Record<string, unknown>;
    if (!Number.isInteger(riskReview.riskIndex) || Number(riskReview.riskIndex) < 0) {
      return `riskReviews[${String(index)}].riskIndex is required or invalid`;
    }
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
    itemReviews,
    riskReviews,
  };
}

function buildReviewId(taskId: number, receivedAt: string): string {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  return `hr_${receivedAt.slice(0, 10).replaceAll("-", "")}_${String(taskId)}_${suffix}`;
}

function validateRiskReviewsWithResult(
  payload: HumanReviewSubmissionPayload,
  resultJson: Record<string, unknown>,
): { status: 400 | 409; message: string } | undefined {
  const risks = readResultRisks(resultJson);
  for (const [index, review] of (payload.riskReviews ?? []).entries()) {
    const risk = risks[review.riskIndex];
    if (!risk) {
      return {
        status: 400,
        message: `riskReviews[${String(index)}].riskIndex does not match result risks`,
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
  reviewId: string;
  taskId: number;
  testCaseId?: number;
  resultJson: Record<string, unknown>;
  payload: HumanReviewSubmissionPayload;
}): Promise<number> {
  const resultItems = readResultReviewItems(input.resultJson);
  let count = 0;
  for (const [index, review] of (input.payload.itemReviews ?? []).entries()) {
    await input.store.appendDatasetSample("item_review_calibration", {
      type: "item_review_calibration",
      reviewId: input.reviewId,
      evidenceId: `${input.reviewId}-item-${String(index + 1)}`,
      taskId: input.taskId,
      testCaseId: input.testCaseId,
      itemIndex: index,
      taskSummary: buildTaskSummary(input.resultJson),
      resultReviewItem: findResultReviewItem(resultItems, review.sourceItem, review.reviewItemKey, index),
      humanReview: {
        reviewItemKey: review.reviewItemKey,
        sourceItem: review.sourceItem,
        humanVerdict: review.humanVerdict,
        correctedAssessment: review.correctedAssessment,
        evidence: review.evidence,
        scoreAdjustment: review.scoreAdjustment,
        preferredFix: review.preferredFix,
        tags: review.tags,
      },
    });
    count += 1;
  }
  return count;
}

async function appendRiskReviewCalibrationSamples(input: {
  store: HumanReviewEvidenceStore;
  reviewId: string;
  taskId: number;
  testCaseId?: number;
  resultJson: Record<string, unknown>;
  payload: HumanReviewSubmissionPayload;
}): Promise<number> {
  const risks = readResultRisks(input.resultJson);
  let count = 0;
  for (const review of input.payload.riskReviews ?? []) {
    const risk = risks[review.riskIndex];
    if (!risk) {
      continue;
    }
    await input.store.appendDatasetSample("risk_review_calibration", {
      type: "risk_review_calibration",
      reviewId: input.reviewId,
      evidenceId: `${input.reviewId}-risk-${String(review.riskIndex + 1)}`,
      taskId: input.taskId,
      testCaseId: input.testCaseId,
      riskIndex: review.riskIndex,
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

function readResultReviewItems(resultJson: Record<string, unknown>): Array<Record<string, unknown>> {
  return Array.isArray(resultJson.human_review_items)
    ? resultJson.human_review_items.map((item) =>
        typeof item === "object" && item !== null ? (item as Record<string, unknown>) : {},
      )
    : [];
}

function findResultReviewItem(
  resultItems: Array<Record<string, unknown>>,
  sourceItem: string | undefined,
  reviewItemKey: string | undefined,
  index: number,
): Record<string, unknown> | undefined {
  const key = reviewItemKey ?? sourceItem;
  if (key) {
    const matched = resultItems.find((item) => item.item === key);
    if (matched) {
      return matched;
    }
  }
  return resultItems[index];
}

function buildTaskSummary(resultJson: Record<string, unknown>): string {
  return [readCaseId(resultJson), readTaskType(resultJson)]
    .filter((item): item is string => typeof item === "string" && item.length > 0)
    .join(" | ");
}

function readResultRisks(resultJson: Record<string, unknown>): NormalizedResultRisk[] {
  if (!Array.isArray(resultJson.risks)) {
    return [];
  }
  return resultJson.risks.map((item) => {
    const risk = typeof item === "object" && item !== null ? (item as Record<string, unknown>) : {};
    return {
      level: readString(risk.level) ?? "",
      title: readString(risk.title) ?? "",
      description: readString(risk.description) ?? "",
      evidence: readString(risk.evidence) ?? "",
    };
  });
}

function isRiskLevel(value: unknown): value is HumanRiskLevel {
  return typeof value === "string" && RISK_LEVELS.has(value);
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
