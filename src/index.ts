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

function readTaskId(body: unknown): number | undefined {
  if (typeof body !== "object" || body === null) {
    return undefined;
  }
  const taskId = (body as { taskId?: unknown }).taskId;
  return typeof taskId === "number" && Number.isFinite(taskId) ? taskId : undefined;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function logRemoteApiTriggered(taskId: number | undefined): void {
  console.info(
    `api_request_triggered route=POST /score/run-remote-task taskId=${String(taskId ?? "unknown")}`,
  );
}

function logRemoteApiFailed(taskId: number | undefined, error: unknown): void {
  console.error(
    `api_request_failed route=POST /score/run-remote-task taskId=${String(taskId ?? "unknown")} error=${formatError(error)}`,
  );
}

function sendRemoteApiResponse(
  res: Response,
  status: number,
  taskId: number | undefined,
  body: Record<string, unknown>,
): void {
  console.info(
    `api_response_sent route=POST /score/run-remote-task taskId=${String(taskId ?? "unknown")} status=${String(status)} success=${String(body.success)}`,
  );
  if (status === 200) {
    res.json(body);
    return;
  }
  res.status(status).json(body);
}

export function createRunRemoteTaskHandler(deps: AppDeps) {
  let remoteTaskExecutionQueue: Promise<void> | undefined;
  let runningTaskId: number | undefined;
  const queuedTaskIds = new Set<number>();
  const remoteTaskRecords = new Map<number, RemoteTaskRecord>();

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
      runningTaskId === taskId ||
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
    runningTaskId = acceptedTask.taskId;
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
      if (runningTaskId === acceptedTask.taskId) {
        runningTaskId = undefined;
      }
    }
  }

  function enqueueRemoteTaskExecution(acceptedTask: AcceptedRemoteEvaluationTask): Promise<void> {
    queuedTaskIds.add(acceptedTask.taskId);
    upsertTaskRecord(acceptedTask.taskId, "queued", { caseDir: acceptedTask.caseDir });
    const queuedExecution = remoteTaskExecutionQueue
      ? remoteTaskExecutionQueue.then(() => executeRemoteTask(acceptedTask))
      : executeRemoteTask(acceptedTask);
    const trackedExecution = queuedExecution
      .catch(() => undefined)
      .finally(() => {
        if (remoteTaskExecutionQueue === trackedExecution) {
          remoteTaskExecutionQueue = undefined;
        }
      });
    remoteTaskExecutionQueue = trackedExecution;
    return queuedExecution;
  }

  return async (req: Request, res: Response) => {
    const taskId = readTaskId(req.body);
    logRemoteApiTriggered(taskId);
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
        sendRemoteApiResponse(res, 504, taskId, {
          success: false,
          taskId,
          message: `任务等待进入执行队列超时，timeoutMs=${String(timeoutMs)}`,
        });
        return;
      }
      void enqueueRemoteTaskExecution(acceptedTask).catch((error) => {
        console.error("run-remote-task background execution failed", error);
      });
      sendRemoteApiResponse(res, 200, acceptedTask.taskId, {
        success: true,
        taskId: acceptedTask.taskId,
        caseDir: acceptedTask.caseDir,
        message: acceptedTask.message,
      });
    } catch (error) {
      if (taskId !== undefined) {
        upsertTaskRecord(taskId, "failed", { error: formatError(error) });
      }
      logRemoteApiFailed(taskId, error);
      sendRemoteApiResponse(res, 500, taskId, {
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
