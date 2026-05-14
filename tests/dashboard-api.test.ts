import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import express, { type Express } from "express";
import test from "node:test";
import { API_PATHS } from "../src/api/apiDefinitions.js";
import { createRemoteTaskRegistry } from "../src/api/remoteTaskRegistry.js";
import { createRuleViolationStatsStore } from "../src/api/ruleViolationStatsStore.js";
import { createDashboardRouter } from "../src/dashboard/dashboardHandlers.js";

async function makeTempDir(t: test.TestContext): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "dashboard-api-"));
  t.after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });
  return dir;
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

async function createFixture(t: test.TestContext) {
  const localCaseRoot = await makeTempDir(t);
  const evidenceRoot = await makeTempDir(t);
  const registry = createRemoteTaskRegistry(localCaseRoot);
  const ruleStatsStore = createRuleViolationStatsStore(localCaseRoot);
  const completedCaseDir = path.join(localCaseRoot, "case-completed");
  const failedCaseDir = path.join(localCaseRoot, "case-failed");
  const runningCaseDir = path.join(localCaseRoot, "case-running");

  await writeJson(path.join(completedCaseDir, "outputs", "result.json"), {
    basic_info: {
      case_name: "电视台云服务新增全屏播放",
      task_type: "bug_fix",
    },
    overall_conclusion: {
      total_score: 88,
      hard_gate_triggered: false,
      summary: "评分完成。",
    },
    risks: [
      {
        id: 1,
        level: "high",
        title: "构建风险",
        description: "存在高风险问题。",
        evidence: "logs/run.log",
      },
    ],
  });
  await fs.mkdir(path.join(completedCaseDir, "logs"), { recursive: true });
  await fs.writeFile(
    path.join(completedCaseDir, "logs", "run.log"),
    "line-1\nline-2\nline-3\n",
    "utf-8",
  );

  await writeJson(path.join(failedCaseDir, "outputs", "result.json"), {
    basic_info: {
      task_type: "full_generation",
    },
    overall_conclusion: {
      total_score: 52,
      hard_gate_triggered: true,
      summary: "触发硬门槛。",
    },
    risks: [],
  });
  await writeJson(path.join(failedCaseDir, "inputs", "case-info.json"), {
    remote_test_case_name: "低分中文用例",
  });

  await registry.upsert({
    taskId: 88,
    status: "completed",
    caseDir: completedCaseDir,
    testCaseId: 188,
    testCaseName: "远端名称会被结果名称覆盖",
    testCaseType: "remote_bug_fix",
  });
  await registry.upsert({
    taskId: 89,
    status: "failed",
    caseDir: failedCaseDir,
    testCaseId: 189,
    testCaseName: "失败任务",
    testCaseType: "full_generation",
    error: "workflow failed",
  });
  await registry.upsert({
    taskId: 90,
    status: "running",
    caseDir: runningCaseDir,
    testCaseId: 190,
    testCaseName: "运行中任务",
    testCaseType: "continuation",
  });

  await ruleStatsStore.upsertRun({
    taskId: 88,
    caseId: "case-88",
    testCaseId: 188,
    caseName: "电视台云服务新增全屏播放",
    completedAt: "2026-05-13T08:42:00.000Z",
    boundRulePacks: [{ pack_id: "arkts-language", display_name: "ArkTS 语言规则" }],
    rules: [
      {
        pack_id: "arkts-language",
        rule_id: "ARKTS-MUST-001",
        rule_summary: "必须遵循 ArkTS 语言约束",
        rule_source: "must_rule",
        result: "不满足",
        conclusion: "发现违反 ArkTS 语言约束。",
      },
    ],
  });

  const datasetDir = path.join(evidenceRoot, "datasets");
  await fs.mkdir(datasetDir, { recursive: true });
  await fs.writeFile(
    path.join(datasetDir, "human_rating_gap_analyses.jsonl"),
    [
      JSON.stringify({
        type: "human_rating_gap_analysis",
        taskId: 88,
        testCaseId: 188,
        caseName: "电视台云服务新增全屏播放",
        reviewedAt: "2026-05-13T09:00:00.000Z",
        reviewer: "alice",
        manualRating: "L1",
        manualBasis: "无法编译运行。",
        autoScore: 92,
        autoRating: "L5",
        primaryConclusion: "scoring_system_needs_improvement",
        confidence: "medium",
        reasonSummary: "自动评分漏判编译失败。",
        humanNeedsImprovement: false,
        scoringNeedsImprovement: true,
        recommendedActions: ["补充构建失败 hard gate。"],
      }),
      JSON.stringify({
        type: "human_rating_gap_analysis",
        taskId: 89,
        testCaseId: 189,
        reviewedAt: "2026-05-13T10:00:00.000Z",
        manualRating: "L2",
        autoScore: 52,
        autoRating: "L2",
        primaryConclusion: "aligned",
        reasonSummary: "数据集缺少名称时应从任务元数据补齐。",
      }),
      "{bad-json",
      "",
    ].join("\n"),
    "utf-8",
  );
  await fs.writeFile(
    path.join(datasetDir, "risk_review_calibrations.jsonl"),
    [
      JSON.stringify({
        type: "risk_review_calibration",
        taskId: 88,
        testCaseId: 188,
        riskId: 1,
        taskSummary: "remote-task-88 | bug_fix",
        resultRisk: {
          level: "high",
          title: "构建风险",
          description: "存在高风险问题。",
          evidence: "logs/run.log",
        },
        humanReview: {
          agreeWithResultLevel: false,
          correctedLevel: "medium",
          reason: "应该降到中风险。",
        },
      }),
      "{bad-json",
      "",
    ].join("\n"),
    "utf-8",
  );

  return { localCaseRoot, evidenceRoot, registry, ruleStatsStore };
}

function createDashboardTestApp(fixture: Awaited<ReturnType<typeof createFixture>>): Express {
  const app = express();
  app.use(
    createDashboardRouter({
      registry: fixture.registry,
      ruleViolationStatsStore: fixture.ruleStatsStore,
      humanReviewEvidenceRoot: fixture.evidenceRoot,
    }),
  );
  return app;
}

async function getJson(app: Express, pathName: string): Promise<Record<string, unknown>> {
  const response = await invokeExpressGet(app, pathName);
  if (response.statusCode < 200 || response.statusCode >= 300) {
    assert.fail(response.body);
  }
  return JSON.parse(response.body) as Record<string, unknown>;
}

async function invokeExpressGet(
  app: Express,
  pathName: string,
): Promise<{ statusCode: number; body: string }> {
  return await new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const headers = new Map<string, number | string | readonly string[]>();
    const req = {
      method: "GET",
      url: pathName,
      originalUrl: pathName,
      headers: { host: "127.0.0.1" },
      socket: { encrypted: false },
      connection: { encrypted: false },
      get(name: string) {
        return this.headers[name.toLowerCase() as "host"];
      },
    };
    const res = {
      statusCode: 200,
      statusMessage: "OK",
      locals: {},
      headersSent: false,
      req,
      setHeader(name: string, value: number | string | readonly string[]) {
        headers.set(name.toLowerCase(), value);
        return this;
      },
      getHeader(name: string) {
        return headers.get(name.toLowerCase());
      },
      getHeaders() {
        return Object.fromEntries(headers);
      },
      removeHeader(name: string) {
        headers.delete(name.toLowerCase());
      },
      write(chunk: string | Buffer) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        return true;
      },
      end(chunk?: string | Buffer) {
        if (chunk !== undefined) {
          this.write(chunk);
        }
        this.headersSent = true;
        resolve({ statusCode: this.statusCode, body: Buffer.concat(chunks).toString("utf-8") });
        return this;
      },
      writeHead(statusCode: number) {
        this.statusCode = statusCode;
        return this;
      },
    };
    app.handle(req as never, res as never, (error) => {
      if (error) {
        reject(error);
        return;
      }
      reject(new Error(`Unhandled request path: ${pathName}`));
    });
  });
}

test("remote task registry lists records with test case metadata", async (t) => {
  const localCaseRoot = await makeTempDir(t);
  const registry = createRemoteTaskRegistry(localCaseRoot);

  await registry.upsert({
    taskId: 2,
    status: "queued",
    testCaseId: 102,
    testCaseName: "排队任务",
    testCaseType: "continuation",
  });
  await registry.upsert({
    taskId: 1,
    status: "completed",
    testCaseId: 101,
    testCaseName: "已完成任务",
    testCaseType: "bug_fix",
  });

  const records = await registry.list();

  assert.deepEqual(
    records.map((record) => ({
      taskId: record.taskId,
      testCaseName: record.testCaseName,
      testCaseType: record.testCaseType,
    })),
    [
      { taskId: 1, testCaseName: "已完成任务", testCaseType: "bug_fix" },
      { taskId: 2, testCaseName: "排队任务", testCaseType: "continuation" },
    ],
  );
});

test("dashboard summary and task list aggregate registry and result data", async (t) => {
  const fixture = await createFixture(t);
  const app = createDashboardTestApp(fixture);

  const summary = await getJson(app, "/dashboard/summary");
  const statusCounts = summary.statusCounts as Record<string, unknown>;
  const taskTypeCounts = summary.taskTypeCounts as Array<Record<string, unknown>>;

  assert.equal(statusCounts.completed, 1);
  assert.equal(statusCounts.failed, 1);
  assert.equal(statusCounts.running, 1);
  assert.deepEqual(
    taskTypeCounts.map((item) => [item.taskType, item.count]),
    [
      ["bug_fix", 1],
      ["continuation", 1],
      ["full_generation", 1],
    ],
  );

  const tasks = await getJson(app, "/dashboard/tasks?sortBy=taskId&sortOrder=asc&pageSize=2");
  assert.equal(tasks.total, 3);
  const items = tasks.items as Array<Record<string, unknown>>;
  assert.deepEqual(
    items.map((item) => ({
      taskId: item.taskId,
      name: item.name,
      taskType: item.taskType,
      score: item.score,
      statusCategory: item.statusCategory,
    })),
    [
      {
        taskId: 88,
        name: "电视台云服务新增全屏播放",
        taskType: "bug_fix",
        score: 88,
        statusCategory: "completed",
      },
      {
        taskId: 89,
        name: "低分中文用例",
        taskType: "full_generation",
        score: 52,
        statusCategory: "failed",
      },
    ],
  );
});

test("dashboard task logs return tail content without exposing case dir", async (t) => {
  const fixture = await createFixture(t);
  const app = createDashboardTestApp(fixture);

  const log = await getJson(app, "/dashboard/tasks/88/logs?tailBytes=12");

  assert.equal(log.taskId, 88);
  assert.equal(log.available, true);
  assert.equal(log.truncated, true);
  assert.equal(log.logPath, "logs/run.log");
  assert.equal(log.content, "ne-2\nline-3\n");
  assert.equal("caseDir" in log, false);

  const missingLog = await getJson(app, "/dashboard/tasks/90/logs");
  assert.equal(missingLog.available, false);
  assert.equal(missingLog.content, "");
});

test("dashboard reports expose daily counts and score distribution", async (t) => {
  const fixture = await createFixture(t);
  const app = createDashboardTestApp(fixture);

  const daily = await getJson(app, "/dashboard/reports/daily");
  const dailyItems = daily.items as Array<Record<string, unknown>>;
  assert.equal(dailyItems.length, 1);
  assert.equal(dailyItems[0]?.received, 3);
  assert.equal(dailyItems[0]?.completed, 1);
  assert.equal(dailyItems[0]?.failed, 1);
  assert.equal(dailyItems[0]?.averageScore, 88);

  const distribution = await getJson(app, "/dashboard/reports/score-distribution");
  const buckets = distribution.buckets as Array<Record<string, unknown>>;
  assert.deepEqual(
    buckets.map((bucket) => [bucket.label, bucket.count]),
    [
      ["0-59", 1],
      ["60-69", 0],
      ["70-79", 0],
      ["80-89", 1],
      ["90-100", 0],
    ],
  );
});

test("dashboard analysis exposes human rating gaps and negative results", async (t) => {
  const fixture = await createFixture(t);
  const app = createDashboardTestApp(fixture);

  const gaps = await getJson(app, "/dashboard/analysis/human-rating-gaps");
  assert.equal(gaps.total, 2);
  assert.equal(gaps.skippedRows, 1);
  assert.equal(
    (gaps.items as Array<Record<string, unknown>>)[0]?.primaryConclusion,
    "scoring_system_needs_improvement",
  );
  assert.equal((gaps.items as Array<Record<string, unknown>>)[1]?.caseName, "低分中文用例");

  const negative = await getJson(app, "/dashboard/analysis/negative-results");
  const negativeSummary = negative.summary as Record<string, unknown>;
  assert.equal(negativeSummary.failedTaskCount, 1);
  assert.equal(negativeSummary.lowScoreTaskCount, 1);
  assert.equal(negativeSummary.hardGateTaskCount, 1);
  assert.equal(negativeSummary.highRiskTaskCount, 1);
  assert.equal(negativeSummary.violatedRuleCount, 1);
  assert.equal(
    (negative.topRuleViolations as Array<Record<string, unknown>>)[0]?.rule_id,
    "ARKTS-MUST-001",
  );
});

test("dashboard human rating gaps support keyword and conclusion filters", async (t) => {
  const fixture = await createFixture(t);
  const app = createDashboardTestApp(fixture);

  const byName = await getJson(
    app,
    "/dashboard/analysis/human-rating-gaps?keyword=%E4%BD%8E%E5%88%86",
  );
  assert.equal(byName.total, 1);
  assert.equal((byName.items as Array<Record<string, unknown>>)[0]?.taskId, 89);

  const byTaskId = await getJson(app, "/dashboard/analysis/human-rating-gaps?keyword=88");
  assert.equal(byTaskId.total, 1);
  assert.equal(
    (byTaskId.items as Array<Record<string, unknown>>)[0]?.caseName,
    "电视台云服务新增全屏播放",
  );

  const byConclusion = await getJson(
    app,
    "/dashboard/analysis/human-rating-gaps?primaryConclusion=aligned",
  );
  assert.equal(byConclusion.total, 1);
  assert.equal((byConclusion.items as Array<Record<string, unknown>>)[0]?.taskId, 89);
});

test("dashboard risk review calibrations expose case names and review details", async (t) => {
  const fixture = await createFixture(t);
  const app = createDashboardTestApp(fixture);

  const response = await getJson(app, "/dashboard/analysis/risk-review-calibrations");
  assert.equal(response.total, 1);
  assert.equal(response.skippedRows, 1);
  const item = (response.items as Array<Record<string, unknown>>)[0];
  assert.equal(item?.caseName, "电视台云服务新增全屏播放");
  assert.equal(item?.taskSummary, "remote-task-88 | bug_fix");
  assert.equal((item?.resultRisk as Record<string, unknown>).title, "构建风险");
  assert.equal((item?.humanReview as Record<string, unknown>).correctedLevel, "medium");
});

test("dashboard risk review calibrations support keyword and agreement filters", async (t) => {
  const fixture = await createFixture(t);
  const app = createDashboardTestApp(fixture);

  const byName = await getJson(
    app,
    "/dashboard/analysis/risk-review-calibrations?keyword=%E7%94%B5%E8%A7%86%E5%8F%B0",
  );
  assert.equal(byName.total, 1);
  assert.equal((byName.items as Array<Record<string, unknown>>)[0]?.taskId, 88);

  const disagreed = await getJson(
    app,
    "/dashboard/analysis/risk-review-calibrations?agreement=disagreed",
  );
  assert.equal(disagreed.total, 1);

  const agreed = await getJson(
    app,
    "/dashboard/analysis/risk-review-calibrations?agreement=agreed",
  );
  assert.equal(agreed.total, 0);

  const invalid = await invokeExpressGet(
    app,
    "/dashboard/analysis/risk-review-calibrations?agreement=unknown",
  );
  assert.equal(invalid.statusCode, 400);
  assert.match(invalid.body, /agreement must be one of agreed, disagreed/);
});

test("api paths expose dashboard endpoints", () => {
  assert.equal(API_PATHS.dashboardSummary, "/dashboard/summary");
  assert.equal(API_PATHS.dashboardTasks, "/dashboard/tasks");
  assert.equal(API_PATHS.dashboardTaskLogs, "/dashboard/tasks/:taskId/logs");
  assert.equal(
    API_PATHS.dashboardAnalysisRiskReviewCalibrations,
    "/dashboard/analysis/risk-review-calibrations",
  );
});
