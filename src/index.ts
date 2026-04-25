import { pathToFileURL } from "node:url";
import express, { NextFunction, Request, Response } from "express";
import { getConfig } from "./config.js";
import {
  executeAcceptedRemoteEvaluationTask,
  prepareRemoteEvaluationTask,
  resolveDefaultCasePath,
  runRemoteEvaluationTask,
  runSingleCase,
} from "./service.js";
import type { RemoteEvaluationTask } from "./types.js";

type AppDeps = {
  runSingleCase: typeof runSingleCase;
  runRemoteEvaluationTask: typeof runRemoteEvaluationTask;
  prepareRemoteEvaluationTask: typeof prepareRemoteEvaluationTask;
  executeAcceptedRemoteEvaluationTask: typeof executeAcceptedRemoteEvaluationTask;
};

export function createRunHandler(deps: AppDeps) {
  return async (req: Request, res: Response) => {
    try {
      const casePath = String(req.body?.casePath ?? resolveDefaultCasePath());
      const result = await deps.runSingleCase(casePath);
      res.json({ success: true, ...result });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error instanceof Error ? error.message : "未知错误",
      });
    }
  };
}

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

export function createRunRemoteTaskHandler(deps: AppDeps) {
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
      error: patch.error ?? existing?.error,
    };
    remoteTaskRecords.set(taskId, record);
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

  async function waitForTaskAcceptance(
    taskId: number,
    preparation: Promise<AcceptedRemoteEvaluationTask>,
  ): Promise<AcceptedRemoteEvaluationTask | undefined> {
    const timeoutMs = getConfig().remoteTaskAcceptTimeoutMs;
    let timeout: NodeJS.Timeout | undefined;
    const timeoutResult = new Promise<undefined>((resolve) => {
      timeout = setTimeout(() => {
        if (!isExecutingOrQueued(taskId)) {
          upsertTaskRecord(taskId, "timed_out", {
            error: `任务等待进入执行队列超时，timeoutMs=${String(timeoutMs)}`,
          });
          resolve(undefined);
        }
      }, timeoutMs);
    });

    try {
      return await Promise.race([preparation, timeoutResult]);
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
    }
  }

  function trackLatePreparation(
    taskId: number,
    preparation: Promise<AcceptedRemoteEvaluationTask>,
  ): void {
    preparation
      .then((acceptedTask) => {
        if (remoteTaskRecords.get(taskId)?.status !== "timed_out") {
          return;
        }
        console.error(
          `run-remote-task preparation resolved after timeout taskId=${String(taskId)} caseDir=${acceptedTask.caseDir}`,
        );
      })
      .catch((error) => {
        if (remoteTaskRecords.get(taskId)?.status !== "timed_out") {
          return;
        }
        console.error(
          `run-remote-task preparation failed after timeout taskId=${String(taskId)} error=${formatError(error)}`,
        );
      });
  }

  async function executeRemoteTask(acceptedTask: AcceptedRemoteEvaluationTask): Promise<void> {
    queuedTaskIds.delete(acceptedTask.taskId);
    runningTaskIds.add(acceptedTask.taskId);
    upsertTaskRecord(acceptedTask.taskId, "running", { caseDir: acceptedTask.caseDir });
    try {
      await deps.executeAcceptedRemoteEvaluationTask(acceptedTask);
      upsertTaskRecord(acceptedTask.taskId, "completed", { caseDir: acceptedTask.caseDir });
    } catch (error) {
      upsertTaskRecord(acceptedTask.taskId, "failed", {
        caseDir: acceptedTask.caseDir,
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
    upsertTaskRecord(acceptedTask.taskId, "queued", { caseDir: acceptedTask.caseDir });
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
        upsertTaskRecord(taskId, "preparing");
      }
      const preparation = deps.prepareRemoteEvaluationTask(req.body as RemoteEvaluationTask);
      const acceptedTask =
        taskId === undefined ? await preparation : await waitForTaskAcceptance(taskId, preparation);
      if (!acceptedTask) {
        if (taskId === undefined) {
          throw new Error("远端任务缺少 taskId，无法跟踪执行状态。");
        }
        trackLatePreparation(taskId, preparation);
        const timeoutMs = getConfig().remoteTaskAcceptTimeoutMs;
        sendRemoteApiResponse(res, 504, requestLogContext, {
          success: false,
          taskId,
          message: `任务等待进入执行队列超时，timeoutMs=${String(timeoutMs)}`,
        });
        return;
      }
      const acceptedTaskLogContext = buildAcceptedTaskLogContext(acceptedTask);
      void enqueueRemoteTaskExecution(acceptedTask).catch((error) => {
        console.error(
          `run-remote-task background execution failed ${formatRemoteLogContext(acceptedTaskLogContext)} error=${formatError(error)}`,
        );
      });
      sendRemoteApiResponse(res, 200, acceptedTaskLogContext, {
        success: true,
        taskId: acceptedTask.taskId,
        caseDir: acceptedTask.caseDir,
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
  deps: {
    runSingleCase: typeof runSingleCase;
    runRemoteEvaluationTask: typeof runRemoteEvaluationTask;
    prepareRemoteEvaluationTask: typeof prepareRemoteEvaluationTask;
    executeAcceptedRemoteEvaluationTask: typeof executeAcceptedRemoteEvaluationTask;
  } = {
    runSingleCase,
    runRemoteEvaluationTask,
    prepareRemoteEvaluationTask,
    executeAcceptedRemoteEvaluationTask,
  },
) {
  const app = express();
  app.use(createCorsMiddleware());
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.post("/score/run", createRunHandler(deps));
  app.post("/score/run-remote-task", createRunRemoteTaskHandler(deps));

  return app;
}

const isMainModule =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  const config = getConfig();
  const app = createApp();
  app.listen(config.port, () => {
    console.log(`hmos-score-agent API 已启动，监听端口：${config.port}`);
  });
}
