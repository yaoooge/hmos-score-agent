import express, { Request, Response } from "express";
import type { RemoteTaskRegistry } from "../api/remoteTaskRegistry.js";
import type { RuleViolationStatsStore } from "../api/ruleViolationStatsStore.js";
import {
  buildDailyReport,
  buildNegativeResults,
  buildScoreDistribution,
  buildScoreSummary,
  buildStatusCounts,
  buildTaskTypeCounts,
  filterHumanRatingGaps,
  filterRiskReviewCalibrations,
  filterTasks,
  paginate,
  sortHumanRatingGapsByReviewedAtDesc,
  sortRiskReviewCalibrationsByTaskTimeDesc,
} from "./dashboardAggregates.js";
import {
  listDashboardTasks,
  readHumanRatingGapDataset,
  readRiskReviewCalibrationDataset,
  readTaskLog,
} from "./dashboardDataStore.js";
import type { DashboardStatusCategory } from "./dashboardTypes.js";

export type DashboardRouterDeps = {
  registry: RemoteTaskRegistry;
  ruleViolationStatsStore: RuleViolationStatsStore;
  humanReviewEvidenceRoot: string;
};

const STATUS_CATEGORIES = new Set(["received", "queued", "running", "completed", "failed"]);
const SORT_FIELDS = new Set(["createdAt", "updatedAt", "score", "taskId"]);
const RISK_REVIEW_AGREEMENTS = new Set(["agreed", "disagreed"]);

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  if (typeof value !== "string" || value.length === 0) {
    return undefined;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function readPositiveInteger(value: unknown, fallback: number, max: number): number | string {
  if (value === undefined) {
    return fallback;
  }
  const number = readNumber(value);
  if (number === undefined || number < 1 || !Number.isInteger(number)) {
    return "must be a positive integer";
  }
  return Math.min(number, max);
}

function sendError(res: Response, status: number, message: string): void {
  res.status(status).json({ success: false, message });
}

async function getTaskSummaries(deps: DashboardRouterDeps) {
  return (await listDashboardTasks(deps.registry)).map((item) => item.summary);
}

function matchesCreatedRange(task: { createdAt: string }, from?: string, to?: string): boolean {
  const createdAt = Date.parse(task.createdAt);
  if (from && createdAt < Date.parse(from)) {
    return false;
  }
  if (to && createdAt > Date.parse(to)) {
    return false;
  }
  return true;
}

function parseTaskQuery(req: Request) {
  const page = readPositiveInteger(req.query.page, 1, Number.MAX_SAFE_INTEGER);
  if (typeof page === "string") {
    return "page must be a positive integer";
  }
  const pageSize = readPositiveInteger(req.query.pageSize, 20, 100);
  if (typeof pageSize === "string") {
    return "pageSize must be a positive integer";
  }
  const status = readString(req.query.status);
  if (status !== undefined && !STATUS_CATEGORIES.has(status)) {
    return "status must be one of received, queued, running, completed, failed";
  }
  const sortBy = readString(req.query.sortBy) ?? "updatedAt";
  if (!SORT_FIELDS.has(sortBy)) {
    return "sortBy must be one of createdAt, updatedAt, score, taskId";
  }
  const sortOrder = readString(req.query.sortOrder) ?? "desc";
  if (sortOrder !== "asc" && sortOrder !== "desc") {
    return "sortOrder must be asc or desc";
  }

  return {
    status: status as DashboardStatusCategory | undefined,
    taskType: readString(req.query.taskType),
    keyword: readString(req.query.keyword),
    scoreMin: readNumber(req.query.scoreMin),
    scoreMax: readNumber(req.query.scoreMax),
    from: readString(req.query.from),
    to: readString(req.query.to),
    page,
    pageSize,
    sortBy: sortBy as "createdAt" | "updatedAt" | "score" | "taskId",
    sortOrder: sortOrder as "asc" | "desc",
  };
}

export function createDashboardRouter(deps: DashboardRouterDeps) {
  const router = express.Router();

  router.get("/dashboard/summary", async (req, res) => {
    try {
      const tasks = (await getTaskSummaries(deps)).filter((task) => {
        const from = readString(req.query.from);
        const to = readString(req.query.to);
        return matchesCreatedRange(task, from, to);
      });
      res.json({
        success: true,
        generatedAt: new Date().toISOString(),
        statusCounts: buildStatusCounts(tasks),
        taskTypeCounts: buildTaskTypeCounts(tasks),
        scoreSummary: buildScoreSummary(tasks),
      });
    } catch (error) {
      sendError(res, 500, error instanceof Error ? error.message : "Dashboard summary unavailable");
    }
  });

  router.get("/dashboard/tasks", async (req, res) => {
    const query = parseTaskQuery(req);
    if (typeof query === "string") {
      sendError(res, 400, query);
      return;
    }
    try {
      const filtered = filterTasks(await getTaskSummaries(deps), query);
      const page = paginate(filtered, query.page, query.pageSize);
      res.json({
        success: true,
        page: query.page,
        pageSize: query.pageSize,
        total: page.total,
        items: page.items,
      });
    } catch (error) {
      sendError(res, 500, error instanceof Error ? error.message : "Dashboard tasks unavailable");
    }
  });

  router.get("/dashboard/tasks/status-counts", async (_req, res) => {
    try {
      res.json({ success: true, statusCounts: buildStatusCounts(await getTaskSummaries(deps)) });
    } catch (error) {
      sendError(res, 500, error instanceof Error ? error.message : "Dashboard status unavailable");
    }
  });

  router.get("/dashboard/tasks/:taskId/logs", async (req, res) => {
    const taskId = Number(req.params.taskId);
    if (!Number.isFinite(taskId)) {
      sendError(res, 404, "Task not found");
      return;
    }
    const tailBytes = readPositiveInteger(req.query.tailBytes, 65536, 1048576);
    if (typeof tailBytes === "string") {
      sendError(res, 400, "tailBytes must be a positive integer");
      return;
    }
    try {
      const log = await readTaskLog({ registry: deps.registry, taskId, tailBytes });
      if (!log.found) {
        sendError(res, 404, "Task not found");
        return;
      }
      res.json({
        success: true,
        taskId,
        status: log.status,
        logPath: "logs/run.log",
        available: log.available,
        truncated: log.truncated,
        tailBytes: log.tailBytes,
        content: log.content,
      });
    } catch (error) {
      sendError(res, 500, error instanceof Error ? error.message : "Dashboard log unavailable");
    }
  });

  router.get("/dashboard/reports/daily", async (req, res) => {
    try {
      const taskType = readString(req.query.taskType);
      const from = readString(req.query.from);
      const to = readString(req.query.to);
      const tasks = (await getTaskSummaries(deps)).filter(
        (task) =>
          (taskType ? task.taskType === taskType : true) && matchesCreatedRange(task, from, to),
      );
      res.json({ success: true, items: buildDailyReport(tasks) });
    } catch (error) {
      sendError(res, 500, error instanceof Error ? error.message : "Dashboard report unavailable");
    }
  });

  router.get("/dashboard/reports/score-distribution", async (req, res) => {
    try {
      const taskType = readString(req.query.taskType);
      const from = readString(req.query.from);
      const to = readString(req.query.to);
      const tasks = (await getTaskSummaries(deps)).filter(
        (task) =>
          (taskType ? task.taskType === taskType : true) && matchesCreatedRange(task, from, to),
      );
      res.json({ success: true, buckets: buildScoreDistribution(tasks) });
    } catch (error) {
      sendError(res, 500, error instanceof Error ? error.message : "Dashboard report unavailable");
    }
  });

  router.get("/dashboard/analysis/human-rating-gaps", async (req, res) => {
    const page = readPositiveInteger(req.query.page, 1, Number.MAX_SAFE_INTEGER);
    const pageSize = readPositiveInteger(req.query.pageSize, 20, 100);
    if (typeof page === "string" || typeof pageSize === "string") {
      sendError(res, 400, "page and pageSize must be positive integers");
      return;
    }
    try {
      const taskSummaries = await getTaskSummaries(deps);
      const taskNameIndex = new Map(taskSummaries.map((task) => [task.taskId, task.name]));
      const dataset = await readHumanRatingGapDataset(deps.humanReviewEvidenceRoot, taskNameIndex);
      const filtered = sortHumanRatingGapsByReviewedAtDesc(
        filterHumanRatingGaps(dataset.items, {
          from: readString(req.query.from),
          to: readString(req.query.to),
          manualRating: readString(req.query.manualRating),
          primaryConclusion: readString(req.query.primaryConclusion),
          keyword: readString(req.query.keyword),
        }),
      );
      const paged = paginate(filtered, page, pageSize);
      res.json({
        success: true,
        page,
        pageSize,
        total: paged.total,
        skippedRows: dataset.skippedRows,
        items: paged.items,
      });
    } catch (error) {
      sendError(
        res,
        500,
        error instanceof Error ? error.message : "Dashboard analysis unavailable",
      );
    }
  });

  router.get("/dashboard/analysis/risk-review-calibrations", async (req, res) => {
    const page = readPositiveInteger(req.query.page, 1, Number.MAX_SAFE_INTEGER);
    const pageSize = readPositiveInteger(req.query.pageSize, 100, 500);
    if (typeof page === "string" || typeof pageSize === "string") {
      sendError(res, 400, "page and pageSize must be positive integers");
      return;
    }
    const agreement = readString(req.query.agreement);
    if (agreement !== undefined && !RISK_REVIEW_AGREEMENTS.has(agreement)) {
      sendError(res, 400, "agreement must be one of agreed, disagreed");
      return;
    }
    try {
      const taskSummaries = await getTaskSummaries(deps);
      const taskNameIndex = new Map(taskSummaries.map((task) => [task.taskId, task.name]));
      const taskCreatedAtById = new Map(
        taskSummaries.map((task) => [task.taskId, task.createdAt]),
      );
      const dataset = await readRiskReviewCalibrationDataset(
        deps.humanReviewEvidenceRoot,
        taskNameIndex,
      );
      const filtered = sortRiskReviewCalibrationsByTaskTimeDesc(
        filterRiskReviewCalibrations(dataset.items, {
          keyword: readString(req.query.keyword),
          agreement: agreement as "agreed" | "disagreed" | undefined,
        }),
        taskCreatedAtById,
      );
      const paged = paginate(filtered, page, pageSize);
      res.json({
        success: true,
        page,
        pageSize,
        total: paged.total,
        skippedRows: dataset.skippedRows,
        items: paged.items,
      });
    } catch (error) {
      sendError(
        res,
        500,
        error instanceof Error ? error.message : "Dashboard analysis unavailable",
      );
    }
  });

  router.get("/dashboard/analysis/negative-results", async (req, res) => {
    try {
      const scoreThreshold = readNumber(req.query.scoreThreshold) ?? 70;
      const taskType = readString(req.query.taskType);
      const from = readString(req.query.from);
      const to = readString(req.query.to);
      const tasks = (await getTaskSummaries(deps)).filter(
        (task) =>
          (taskType ? task.taskType === taskType : true) && matchesCreatedRange(task, from, to),
      );
      const ruleRuns = await deps.ruleViolationStatsStore.listRuns();
      res.json({ success: true, ...buildNegativeResults(tasks, ruleRuns, scoreThreshold) });
    } catch (error) {
      sendError(
        res,
        500,
        error instanceof Error ? error.message : "Dashboard analysis unavailable",
      );
    }
  });

  return router;
}
