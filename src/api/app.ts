import fs from "node:fs/promises";
import path from "node:path";
import express, { NextFunction, Request, Response } from "express";
import { API_PATHS } from "./apiDefinitions.js";
import { getConfig } from "../config.js";
import { createSubmitHumanReviewHandler } from "./humanReviewHandler.js";
import { createRemoteTaskRegistry, type RemoteTaskRegistry } from "./remoteTaskRegistry.js";
import { uploadTaskCallback } from "../io/uploader.js";
import {
  createHumanReviewEvidenceStore,
  type HumanReviewEvidenceStore,
} from "../humanReview/humanReviewEvidenceStore.js";
import {
  buildRuleViolationStatsResponse,
  createRuleViolationStatsStore,
  extractRuleViolationRunSnapshot,
  validateRuleViolationStatsQuery,
  type RuleViolationStatsQuery,
  type RuleViolationStatsStore,
} from "./ruleViolationStatsStore.js";
import {
  REMOTE_TASK_PAYLOAD_FILE,
  acceptRemoteEvaluationTask,
  executeAcceptedRemoteEvaluationTask,
  prepareRemoteEvaluationTask,
  replayCompletedRemoteTaskCallback,
  restoreAcceptedRemoteEvaluationTask,
} from "../service.js";
import type { RemoteEvaluationTask } from "../types.js";
import { createDashboardRouter } from "../dashboard/dashboardHandlers.js";

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
  testCaseName?: string;
  testCaseType?: string;
  error?: string;
  remoteTaskFile?: string;
  recoveryAttemptCount?: number;
  lastRecoveryAt?: number;
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

function readRemoteTestCaseString(body: unknown, key: "name" | "type"): string | undefined {
  if (typeof body !== "object" || body === null) {
    return undefined;
  }
  const testCase = (body as { testCase?: unknown }).testCase;
  if (typeof testCase !== "object" || testCase === null) {
    return undefined;
  }
  const value = (testCase as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatRemoteLogContext(context: RemoteTaskLogContext): string {
  return `taskId=${String(context.taskId ?? "unknown")} testCaseId=${String(context.testCaseId ?? "unknown")}`;
}

function formatAcceptedTaskLogContext(acceptedTask: AcceptedRemoteEvaluationTask): string {
  return formatRemoteLogContext({
    taskId: acceptedTask.taskId,
    testCaseId: acceptedTask.remoteTask.testCase.id,
  });
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

async function uploadQueuedPendingCallback(
  acceptedTask: AcceptedRemoteEvaluationTask,
): Promise<void> {
  const upload = await uploadTaskCallback(
    acceptedTask.remoteTask.callback,
    acceptedTask.remoteTask.token,
    {
      taskId: acceptedTask.taskId,
      status: "pending",
    },
  );
  console.info(
    `queued_remote_task_callback_sent ${formatAcceptedTaskLogContext(acceptedTask)} status=pending uploaded=${String(upload.uploaded)} message=${upload.message}`,
  );
}

export function createRunRemoteTaskHandler(
  deps: AppDeps,
  registry?: RemoteTaskRegistry,
  ruleViolationStatsStore?: RuleViolationStatsStore,
  humanReviewEvidenceStore?: HumanReviewEvidenceStore,
) {
  const queue = createRemoteTaskExecutionQueue(
    deps,
    registry,
    ruleViolationStatsStore,
    humanReviewEvidenceStore,
  );

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
        queue.upsertTaskRecord(taskId, "preparing", {
          token: typeof req.body?.token === "string" ? req.body.token : undefined,
          testCaseId: readRemoteTestCaseId(req.body),
          testCaseName: readRemoteTestCaseString(req.body, "name"),
          testCaseType: readRemoteTestCaseString(req.body, "type"),
        });
      }
      const acceptedTask = await deps.acceptRemoteEvaluationTask(req.body as RemoteEvaluationTask);
      const acceptedTaskLogContext = buildAcceptedTaskLogContext(acceptedTask);
      queue.upsertTaskRecord(acceptedTask.taskId, "preparing", {
        caseDir: acceptedTask.caseDir,
        token: acceptedTask.remoteTask.token,
        testCaseId: acceptedTask.remoteTask.testCase.id,
        testCaseName: acceptedTask.remoteTask.testCase.name,
        testCaseType: acceptedTask.remoteTask.testCase.type,
      });
      const executionPromise = queue.enqueueRemoteTaskExecution(acceptedTask);
      const shouldUploadQueuedPendingCallback = queue.isQueued(acceptedTask.taskId);
      void executionPromise.catch((error) => {
        console.error(
          `run-remote-task background execution failed ${formatRemoteLogContext(acceptedTaskLogContext)} error=${formatError(error)}`,
        );
      });
      sendRemoteApiResponse(res, 200, acceptedTaskLogContext, {
        success: true,
        taskId: acceptedTask.taskId,
        message: acceptedTask.message,
      });
      if (shouldUploadQueuedPendingCallback) {
        void uploadQueuedPendingCallback(acceptedTask).catch((error) => {
          console.error(
            `queued_remote_task_callback_failed ${formatAcceptedTaskLogContext(acceptedTask)} error=${formatError(error)}`,
          );
        });
      }
    } catch (error) {
      if (taskId !== undefined) {
        queue.upsertTaskRecord(taskId, "failed", { error: formatError(error) });
      }
      logRemoteApiFailed(requestLogContext, error);
      sendRemoteApiResponse(res, 500, requestLogContext, {
        success: false,
        message: error instanceof Error ? error.message : "未知错误",
      });
    }
  };
}

export function createRemoteTaskExecutionQueue(
  deps: AppDeps,
  registry?: RemoteTaskRegistry,
  ruleViolationStatsStore?: RuleViolationStatsStore,
  _humanReviewEvidenceStore?: HumanReviewEvidenceStore,
) {
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
      testCaseName: patch.testCaseName ?? existing?.testCaseName,
      testCaseType: patch.testCaseType ?? existing?.testCaseType,
      error: patch.error ?? existing?.error,
      remoteTaskFile: patch.remoteTaskFile ?? existing?.remoteTaskFile,
      recoveryAttemptCount: patch.recoveryAttemptCount ?? existing?.recoveryAttemptCount,
      lastRecoveryAt: patch.lastRecoveryAt ?? existing?.lastRecoveryAt,
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
          testCaseName: record.testCaseName,
          testCaseType: record.testCaseType,
          error: record.error,
          remoteTaskFile: record.remoteTaskFile,
          recoveryAttemptCount: record.recoveryAttemptCount,
          lastRecoveryAt: record.lastRecoveryAt,
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
      testCaseName: acceptedTask.remoteTask.testCase.name,
      testCaseType: acceptedTask.remoteTask.testCase.type,
    });
    try {
      await deps.executeAcceptedRemoteEvaluationTask(acceptedTask, {
        onCompleted: ruleViolationStatsStore
          ? async ({ acceptedTask: completedTask, workflowResult, resultJson }) => {
              await ruleViolationStatsStore.upsertRun(
                extractRuleViolationRunSnapshot({
                  taskId: completedTask.taskId,
                  caseId:
                    typeof workflowResult.caseInput === "object" &&
                    workflowResult.caseInput !== null
                      ? String((workflowResult.caseInput as { caseId?: unknown }).caseId ?? "")
                      : String(completedTask.remoteTask.testCase.id),
                  testCaseId: completedTask.remoteTask.testCase.id,
                  caseName: completedTask.remoteTask.testCase.name,
                  boundRulePacks: Array.isArray(resultJson.bound_rule_packs)
                    ? (resultJson.bound_rule_packs as Array<{
                        pack_id?: unknown;
                        display_name?: unknown;
                      }>)
                    : [],
                  ruleAuditResults: Array.isArray(resultJson.rule_audit_results)
                    ? (resultJson.rule_audit_results as never)
                    : [],
                }),
              );
            }
          : undefined,
      });
      upsertTaskRecord(acceptedTask.taskId, "completed", {
        caseDir: acceptedTask.caseDir,
        token: acceptedTask.remoteTask.token,
        testCaseId: acceptedTask.remoteTask.testCase.id,
        testCaseName: acceptedTask.remoteTask.testCase.name,
        testCaseType: acceptedTask.remoteTask.testCase.type,
      });
    } catch (error) {
      upsertTaskRecord(acceptedTask.taskId, "failed", {
        caseDir: acceptedTask.caseDir,
        token: acceptedTask.remoteTask.token,
        testCaseId: acceptedTask.remoteTask.testCase.id,
        testCaseName: acceptedTask.remoteTask.testCase.name,
        testCaseType: acceptedTask.remoteTask.testCase.type,
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
      testCaseName: acceptedTask.remoteTask.testCase.name,
      testCaseType: acceptedTask.remoteTask.testCase.type,
    });
    return new Promise<void>((resolve, reject) => {
      pendingRemoteTaskExecutions.push({ acceptedTask, resolve, reject });
      scheduleRemoteTaskExecutions();
    });
  }

  async function recoverPendingRemoteTasks(): Promise<void> {
    if (!registry) {
      return;
    }
    const records = await registry.list();
    for (const record of records) {
      if (!["preparing", "queued", "running"].includes(record.status)) {
        continue;
      }
      if (!record.caseDir) {
        await registry.upsert({
          taskId: record.taskId,
          status: "failed",
          error: "missing persisted caseDir",
        });
        continue;
      }
      const remoteTaskFile = record.remoteTaskFile ?? REMOTE_TASK_PAYLOAD_FILE;
      const recoveryAttemptCount = (record.recoveryAttemptCount ?? 0) + 1;
      const lastRecoveryAt = Date.now();
      await registry.upsert({
        taskId: record.taskId,
        status: record.status,
        caseDir: record.caseDir,
        remoteTaskFile,
        recoveryAttemptCount,
        lastRecoveryAt,
      });

      try {
        await fs.access(path.join(record.caseDir, "outputs", "result.json"));
        await replayCompletedRemoteTaskCallback({
          taskId: record.taskId,
          caseDir: record.caseDir,
          remoteTaskFile,
        });
        await registry.upsert({
          taskId: record.taskId,
          status: "completed",
          caseDir: record.caseDir,
          testCaseId: record.testCaseId,
          testCaseName: record.testCaseName,
          testCaseType: record.testCaseType,
          token: record.token,
          remoteTaskFile,
          recoveryAttemptCount,
          lastRecoveryAt,
        });
        continue;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          await registry.upsert({
            taskId: record.taskId,
            status: "failed",
            caseDir: record.caseDir,
            testCaseId: record.testCaseId,
            testCaseName: record.testCaseName,
            testCaseType: record.testCaseType,
            token: record.token,
            remoteTaskFile,
            error: formatError(error),
            recoveryAttemptCount,
            lastRecoveryAt,
          });
          continue;
        }
      }

      try {
        const acceptedTask = await restoreAcceptedRemoteEvaluationTask({
          taskId: record.taskId,
          caseDir: record.caseDir,
          remoteTaskFile,
        });
        void enqueueRemoteTaskExecution(acceptedTask).catch((error) => {
          console.error(
            `remote_task_recovery_execution_failed ${formatRemoteLogContext({ taskId: record.taskId, testCaseId: record.testCaseId })} error=${formatError(error)}`,
          );
        });
      } catch (error) {
        await registry.upsert({
          taskId: record.taskId,
          status: "failed",
          caseDir: record.caseDir,
          testCaseId: record.testCaseId,
          testCaseName: record.testCaseName,
          testCaseType: record.testCaseType,
          token: record.token,
          remoteTaskFile,
          error: `missing persisted remote task file: ${formatError(error)}`,
          recoveryAttemptCount,
          lastRecoveryAt,
        });
      }
    }
  }

  return {
    enqueueRemoteTaskExecution,
    recoverPendingRemoteTasks,
    upsertTaskRecord,
    isExecutingOrQueued,
    isQueued(taskId: number): boolean {
      return queuedTaskIds.has(taskId);
    },
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

function readOptionalQueryString(value: unknown): string | undefined {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  return undefined;
}

function readRuleViolationStatsQuery(req: Request): RuleViolationStatsQuery | string {
  const testCaseIdText = readOptionalQueryString(req.query.testCaseId);
  const testCaseId = testCaseIdText === undefined ? undefined : Number(testCaseIdText);
  if (testCaseIdText !== undefined && !Number.isFinite(testCaseId)) {
    return "Invalid query parameter: testCaseId must be a number";
  }

  const query: RuleViolationStatsQuery = {
    caseId: readOptionalQueryString(req.query.caseId),
    testCaseId,
    packId: readOptionalQueryString(req.query.packId),
    from: readOptionalQueryString(req.query.from),
    to: readOptionalQueryString(req.query.to),
  };
  const validationError = validateRuleViolationStatsQuery(query);
  return validationError ?? query;
}

function sanitizeRemoteTaskResultData(resultData: unknown): unknown {
  if (typeof resultData !== "object" || resultData === null || Array.isArray(resultData)) {
    return resultData;
  }

  const { testExecution: _testExecution, ...publicResultData } = resultData as Record<
    string,
    unknown
  >;
  return publicResultData;
}

export function createGetRuleViolationStatsHandler(store: RuleViolationStatsStore) {
  return async (req: Request, res: Response) => {
    const query = readRuleViolationStatsQuery(req);
    if (typeof query === "string") {
      res.status(400).json({ success: false, message: query });
      return;
    }

    try {
      const runs = await store.listRuns();
      res.json(buildRuleViolationStatsResponse(runs, query));
    } catch (error) {
      console.error(`rule_violation_stats_read_failed error=${formatError(error)}`);
      res.status(500).json({ success: false, message: "Rule violation stats are unavailable" });
    }
  };
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
      const resultData = sanitizeRemoteTaskResultData(JSON.parse(resultText) as unknown);
      res.json({
        success: true,
        taskId,
        status: record.status,
        resultData,
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
        : "Content-Type, Authorization",
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
  const config = getConfig();
  const registry = createRemoteTaskRegistry(config.localCaseRoot);
  const ruleViolationStatsStore = createRuleViolationStatsStore(config.localCaseRoot);
  const humanReviewEvidenceStore = createHumanReviewEvidenceStore(config.humanReviewEvidenceRoot);
  app.use(createCorsMiddleware());
  app.use(express.json());

  app.get(API_PATHS.health, (_req, res) => {
    res.json({ ok: true });
  });

  app.post(
    API_PATHS.runRemoteTask,
    createRunRemoteTaskHandler(deps, registry, ruleViolationStatsStore, humanReviewEvidenceStore),
  );
  app.get(
    API_PATHS.ruleViolationStats,
    createGetRuleViolationStatsHandler(ruleViolationStatsStore),
  );
  app.get(API_PATHS.remoteTaskResult, createGetRemoteTaskResultHandler(registry));
  app.use(
    createDashboardRouter({
      registry,
      ruleViolationStatsStore,
      humanReviewEvidenceRoot: config.humanReviewEvidenceRoot,
    }),
  );
  app.post(
    API_PATHS.humanReview,
    createSubmitHumanReviewHandler({ registry, store: humanReviewEvidenceStore }),
  );
  app.use("/dashboard", express.static(path.resolve(process.cwd(), "web", "dist")));
  return app;
}
