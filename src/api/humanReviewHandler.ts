import fs from "node:fs/promises";
import path from "node:path";
import type { Request, Response } from "express";
import { runHumanReviewIngestionNode } from "../humanReview/humanReviewIngestionNode.js";
import type { HumanReviewEvidenceStore } from "../humanReview/humanReviewEvidenceStore.js";
import type { HumanReviewSubmissionPayload } from "../humanReview/humanReviewTypes.js";
import type { RemoteTaskRegistry } from "./remoteTaskRegistry.js";

export type SubmitHumanReviewDeps = {
  registry: RemoteTaskRegistry;
  store: HumanReviewEvidenceStore;
  runIngestion?: typeof runHumanReviewIngestionNode;
};

const OVERALL_DECISIONS = new Set(["accepted", "rejected", "adjust_required", "uncertain"]);
const HUMAN_VERDICTS = new Set([
  "confirmed_correct",
  "confirmed_issue",
  "auto_false_positive",
  "auto_false_negative",
  "partially_correct",
  "uncertain",
]);

export function createSubmitHumanReviewHandler(deps: SubmitHumanReviewDeps) {
  const runIngestion = deps.runIngestion ?? runHumanReviewIngestionNode;
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

    const receivedAt = new Date().toISOString();
    const reviewId = buildReviewId(taskId, receivedAt, payload);
    const rawPath = await deps.store.writeRawRecord({
      schemaVersion: 1,
      reviewId,
      taskId,
      testCaseId: record.testCaseId,
      receivedAt,
      reviewer: payload.reviewer,
      resultSummary: buildResultSummary(resultJson),
      payload,
    });
    await deps.store.writeStatus({
      schemaVersion: 1,
      reviewId,
      taskId,
      status: "queued",
      updatedAt: receivedAt,
    });

    void runIngestion(
      {
        taskId,
        reviewId,
        submittedAt: receivedAt,
        reviewer: payload.reviewer,
        resultJson,
        caseContext: {
          caseDir: record.caseDir,
          testCaseId: record.testCaseId,
          caseId: readCaseId(resultJson),
          taskType: readTaskType(resultJson),
        },
        reviewPayload: payload,
      },
      { store: deps.store },
    ).catch((error) => {
      console.error(
        `human_review_ingestion_failed taskId=${String(taskId)} reviewId=${reviewId} error=${formatError(error)}`,
      );
    });

    res.json({
      success: true,
      taskId,
      reviewId,
      status: "accepted",
      rawPath,
      classificationStatus: "queued",
      message: "人工复核结果已接收，分类入库将在后台异步完成。",
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
  if (!OVERALL_DECISIONS.has(String(candidate.overallDecision))) {
    return "overallDecision is required or invalid";
  }
  if (!Array.isArray(candidate.itemReviews) || candidate.itemReviews.length === 0) {
    return "itemReviews must contain at least one item";
  }
  for (const item of candidate.itemReviews) {
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
  return candidate as HumanReviewSubmissionPayload;
}

function buildReviewId(taskId: number, receivedAt: string, payload: HumanReviewSubmissionPayload): string {
  const suffix = Buffer.from(`${String(taskId)}:${receivedAt}:${JSON.stringify(payload)}`)
    .toString("base64url")
    .slice(0, 10);
  return `hr_${receivedAt.slice(0, 10).replaceAll("-", "")}_${String(taskId)}_${suffix}`;
}

function buildResultSummary(resultJson: Record<string, unknown>) {
  const overallConclusion =
    typeof resultJson.overall_conclusion === "object" && resultJson.overall_conclusion !== null
      ? (resultJson.overall_conclusion as Record<string, unknown>)
      : {};
  return {
    caseId: readCaseId(resultJson),
    taskType: readTaskType(resultJson),
    totalScore:
      typeof overallConclusion.total_score === "number" ? overallConclusion.total_score : undefined,
    humanReviewItemCount: Array.isArray(resultJson.human_review_items)
      ? resultJson.human_review_items.length
      : 0,
    riskCount: Array.isArray(resultJson.risks) ? resultJson.risks.length : 0,
  };
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

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
