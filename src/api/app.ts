import fs from "node:fs/promises";
import path from "node:path";
import express, { NextFunction, Request, Response } from "express";
import { API_PATHS } from "./apiDefinitions.js";
import { getConfig } from "../config.js";
import { createRemoteTaskRegistry, type RemoteTaskRegistry } from "./remoteTaskRegistry.js";
import {
  acceptRemoteEvaluationTask,
  executeAcceptedRemoteEvaluationTask,
  prepareRemoteEvaluationTask,
} from "../service.js";
import type { RemoteEvaluationTask } from "../types.js";

type AppDeps = {
  acceptRemoteEvaluationTask: typeof acceptRemoteEvaluationTask;
  prepareRemoteEvaluationTask: typeof prepareRemoteEvaluationTask;
  executeAcceptedRemoteEvaluationTask: typeof executeAcceptedRemoteEvaluationTask;
};

type AcceptedRemoteEvaluationTask = Parameters<AppDeps["executeAcceptedRemoteEvaluationTask"]>[0];

type RemoteTaskRecordStatus =
  | "preparing"
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "timed_out";

type RemoteTaskRecord = {
  taskId: number;
  status: RemoteTaskRecordStatus;
  createdAt: number;
  updatedAt: number;
  caseDir?: string;
  token?: string;
  testCaseId?: number;
  error?: string;
};

type RemoteTaskLogContext = {
  taskId?: number;
  testCaseId?: number;
};

const MAX_REMOTE_TASK_CONCURRENCY = 3;

function readTaskId(body: unknown): number | undefined {
  if (typeof body !== "object" || body === null) {
    return undefined;
  }
  const taskId = (body as { taskId?: unknown }).taskId;
  return typeof taskId === "number" && Number.isFinite(taskId) ? taskId : undefined;
}

function readRemoteTestCaseId(body: unknown): number | undefined {
  if (typeof body !== "object" || body === null) {
    return undefined;
  }
  const testCase = (body as { testCase?: unknown }).testCase;
  if (typeof testCase !== "object" || testCase === null) {
    return undefined;
  }
  const testCaseId = (testCase as { id?: unknown }).id;
  return typeof testCaseId === "number" && Number.isFinite(testCaseId) ? testCaseId : undefined;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatRemoteLogContext(context: RemoteTaskLogContext): string {
  return `taskId=${String(context.taskId ?? "unknown")} testCaseId=${String(context.testCaseId ?? "unknown")}`;
}

function logRemoteApiTriggered(context: RemoteTaskLogContext): void {
  console.info(
    `api_request_triggered route=POST /score/run-remote-task ${formatRemoteLogContext(context)}`,
  );
}

function logRemoteApiFailed(context: RemoteTaskLogContext, error: unknown): void {
  console.error(
    `api_request_failed route=POST /score/run-remote-task ${formatRemoteLogContext(context)} error=${formatError(error)}`,
  );
}

function sendRemoteApiResponse(
  res: Response,
  status: number,
  context: RemoteTaskLogContext,
  body: Record<string, unknown>,
): void {
  console.info(
    `api_response_sent route=POST /score/run-remote-task ${formatRemoteLogContext(context)} status=${String(status)} success=${String(body.success)}`,
  );
  if (status === 200) {
    res.json(body);
    return;
  }
  res.status(status).json(body);
}

export function createRunRemoteTaskHandler(deps: AppDeps, registry?: RemoteTaskRegistry) {
  const runningTaskIds = new Set<number>();
  const queuedTaskIds = new Set<number>();
  const remoteTaskRecords = new Map<number, RemoteTaskRecord>();
  const pendingRemoteTaskExecutions: Array<{
    acceptedTask: AcceptedRemoteEvaluationTask;
    resolve: () => void;
    reject: (error: unknown) => void;
  }> = [];

  function upsertTaskRecord(
    taskId: number,
    status: RemoteTaskRecordStatus,
    patch: Partial<Omit<RemoteTaskRecord, "taskId" | "createdAt" | "updatedAt" | "status">> = {},
  ): RemoteTaskRecord {
    const existing = remoteTaskRecords.get(taskId);
    const now = Date.now();
    const record: RemoteTaskRecord = {
      taskId,
      status,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      caseDir: patch.caseDir ?? existing?.caseDir,
      token: patch.token ?? existing?.token,
      testCaseId: patch.testCaseId ?? existing?.testCaseId,
      error: patch.error ?? existing?.error,
    };
    remoteTaskRecords.set(taskId, record);
    if (registry) {
      void registry
        .upsert({
          taskId: record.taskId,
          status: record.status,
          caseDir: record.caseDir,
          token: record.token,
          testCaseId: record.testCaseId,
          error: record.error,
        })
        .catch((error) => {
          console.error(
            `remote_task_registry_update_failed ${formatRemoteLogContext({ taskId: record.taskId, testCaseId: record.testCaseId })} error=${formatError(error)}`,
          );
        });
    }
    return record;
  }

  function isExecutingOrQueued(taskId: number): boolean {
    const status = remoteTaskRecords.get(taskId)?.status;
    return (
      runningTaskIds.has(taskId) ||
      queuedTaskIds.has(taskId) ||
      status === "running" ||
      status === "queued"
    );
  }

  async function executeRemoteTask(acceptedTask: AcceptedRemoteEvaluationTask): Promise<void> {
    queuedTaskIds.delete(acceptedTask.taskId);
    runningTaskIds.add(acceptedTask.taskId);
    upsertTaskRecord(acceptedTask.taskId, "running", {
      caseDir: acceptedTask.caseDir,
      token: acceptedTask.remoteTask.token,
      testCaseId: acceptedTask.remoteTask.testCase.id,
    });
    try {
      await deps.executeAcceptedRemoteEvaluationTask(acceptedTask);
      upsertTaskRecord(acceptedTask.taskId, "completed", {
        caseDir: acceptedTask.caseDir,
        token: acceptedTask.remoteTask.token,
        testCaseId: acceptedTask.remoteTask.testCase.id,
      });
    } catch (error) {
      upsertTaskRecord(acceptedTask.taskId, "failed", {
        caseDir: acceptedTask.caseDir,
        token: acceptedTask.remoteTask.token,
        testCaseId: acceptedTask.remoteTask.testCase.id,
        error: formatError(error),
      });
      throw error;
    } finally {
      runningTaskIds.delete(acceptedTask.taskId);
      scheduleRemoteTaskExecutions();
    }
  }

  function scheduleRemoteTaskExecutions(): void {
    while (
      runningTaskIds.size < MAX_REMOTE_TASK_CONCURRENCY &&
      pendingRemoteTaskExecutions.length > 0
    ) {
      const pending = pendingRemoteTaskExecutions.shift();
      if (!pending) {
        return;
      }
      void executeRemoteTask(pending.acceptedTask).then(pending.resolve, pending.reject);
    }
  }

  function enqueueRemoteTaskExecution(acceptedTask: AcceptedRemoteEvaluationTask): Promise<void> {
    queuedTaskIds.add(acceptedTask.taskId);
    upsertTaskRecord(acceptedTask.taskId, "queued", {
      caseDir: acceptedTask.caseDir,
      token: acceptedTask.remoteTask.token,
      testCaseId: acceptedTask.remoteTask.testCase.id,
    });
    return new Promise<void>((resolve, reject) => {
      pendingRemoteTaskExecutions.push({ acceptedTask, resolve, reject });
      scheduleRemoteTaskExecutions();
    });
  }

  function buildAcceptedTaskLogContext(
    acceptedTask: AcceptedRemoteEvaluationTask,
  ): RemoteTaskLogContext {
    return {
      taskId: acceptedTask.taskId,
      testCaseId: acceptedTask.remoteTask.testCase.id,
    };
  }

  return async (req: Request, res: Response) => {
    const taskId = readTaskId(req.body);
    const requestLogContext: RemoteTaskLogContext = {
      taskId,
      testCaseId: readRemoteTestCaseId(req.body),
    };
    logRemoteApiTriggered(requestLogContext);
    try {
      if (taskId !== undefined) {
        upsertTaskRecord(taskId, "preparing", {
          token: typeof req.body?.token === "string" ? req.body.token : undefined,
          testCaseId: readRemoteTestCaseId(req.body),
        });
      }
      const acceptedTask = await deps.acceptRemoteEvaluationTask(req.body as RemoteEvaluationTask);
      const acceptedTaskLogContext = buildAcceptedTaskLogContext(acceptedTask);
      upsertTaskRecord(acceptedTask.taskId, "preparing", {
        caseDir: acceptedTask.caseDir,
        token: acceptedTask.remoteTask.token,
        testCaseId: acceptedTask.remoteTask.testCase.id,
      });
      void enqueueRemoteTaskExecution(acceptedTask).catch((error) => {
        console.error(
          `run-remote-task background execution failed ${formatRemoteLogContext(acceptedTaskLogContext)} error=${formatError(error)}`,
        );
      });
      sendRemoteApiResponse(res, 200, acceptedTaskLogContext, {
        success: true,
        taskId: acceptedTask.taskId,
        message: acceptedTask.message,
      });
    } catch (error) {
      if (taskId !== undefined) {
        upsertTaskRecord(taskId, "failed", { error: formatError(error) });
      }
      logRemoteApiFailed(requestLogContext, error);
      sendRemoteApiResponse(res, 500, requestLogContext, {
        success: false,
        message: error instanceof Error ? error.message : "未知错误",
      });
    }
  };
}

function readRouteTaskId(req: Request): number | undefined {
  const value = req.params.taskId;
  if (typeof value !== "string" || value.length === 0) {
    return undefined;
  }
  const taskId = Number(value);
  return Number.isFinite(taskId) ? taskId : undefined;
}

export function createGetRemoteTaskResultHandler(registry: RemoteTaskRegistry) {
  return async (req: Request, res: Response) => {
    const taskId = readRouteTaskId(req);
    if (taskId === undefined) {
      res.status(404).json({ success: false, message: "Remote task not found" });
      return;
    }

    const record = await registry.get(taskId);
    if (!record) {
      res.status(404).json({ success: false, taskId, message: "Remote task not found" });
      return;
    }

    if (req.header("token") !== record.token) {
      res.status(401).json({ success: false, message: "Unauthorized" });
      return;
    }

    if (record.status !== "completed") {
      res.status(409).json({
        success: false,
        taskId,
        status: record.status,
        message: "Result is not available yet",
      });
      return;
    }

    if (!record.caseDir) {
      res.status(404).json({
        success: false,
        taskId,
        status: record.status,
        message: "Result file not found",
      });
      return;
    }

    try {
      const resultText = await fs.readFile(
        path.join(record.caseDir, "outputs", "result.json"),
        "utf-8",
      );
      res.json({
        success: true,
        taskId,
        status: record.status,
        resultData: JSON.parse(resultText) as Record<string, unknown>,
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        res.status(404).json({
          success: false,
          taskId,
          status: record.status,
          message: "Result file not found",
        });
        return;
      }
      throw error;
    }
  };
}

export function createCorsMiddleware() {
  return (req: Request, res: Response, next: NextFunction) => {
    const origin = req.header("Origin") ?? "*";
    const requestedHeaders = req.header("Access-Control-Request-Headers");

    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin, Access-Control-Request-Headers");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader(
      "Access-Control-Allow-Headers",
      requestedHeaders && requestedHeaders.length > 0
        ? requestedHeaders
        : "Content-Type, Authorization, token",
    );
    res.setHeader("Access-Control-Max-Age", "600");

    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }

    next();
  };
}

export function createApp(
  deps: AppDeps = {
    acceptRemoteEvaluationTask,
    prepareRemoteEvaluationTask,
    executeAcceptedRemoteEvaluationTask,
  },
) {
  const app = express();
  const registry = createRemoteTaskRegistry(getConfig().localCaseRoot);
  app.use(createCorsMiddleware());
  app.use(express.json());

  app.get(API_PATHS.health, (_req, res) => {
    res.json({ ok: true });
  });

  app.post(API_PATHS.runRemoteTask, createRunRemoteTaskHandler(deps, registry));
  app.get(API_PATHS.remoteTaskResult, createGetRemoteTaskResultHandler(registry));

  return app;
}
