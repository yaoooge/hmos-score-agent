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
  const olderFailedCaseDir = path.join(localCaseRoot, "case-older-failed");
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

  await writeJson(path.join(olderFailedCaseDir, "outputs", "result.json"), {
    basic_info: {
      case_name: "更早负向用例",
      task_type: "full_generation",
    },
    overall_conclusion: {
      total_score: 41,
      hard_gate_triggered: true,
      summary: "较早失败任务。",
    },
    risks: [],
  });

  const dateNow = t.mock.method(Date, "now");
  dateNow.mock.mockImplementation(() => Date.parse("2026-05-13T08:00:00.000Z"));
  await registry.upsert({
    taskId: 88,
    status: "completed",
    caseDir: completedCaseDir,
    testCaseId: 188,
    testCaseName: "远端名称会被结果名称覆盖",
    testCaseType: "remote_bug_fix",
  });
  dateNow.mock.mockImplementation(() => Date.parse("2026-05-13T11:00:00.000Z"));
  await registry.upsert({
    taskId: 89,
    status: "failed",
    caseDir: failedCaseDir,
    testCaseId: 189,
    testCaseName: "失败任务",
    testCaseType: "full_generation",
    error: "workflow failed",
  });
  dateNow.mock.mockImplementation(() => Date.parse("2026-05-13T07:00:00.000Z"));
  await registry.upsert({
    taskId: 87,
    status: "failed",
    caseDir: olderFailedCaseDir,
    testCaseId: 187,
    testCaseName: "更早失败任务",
    testCaseType: "full_generation",
    error: "older workflow failed",
  });
  dateNow.mock.mockImplementation(() => Date.parse("2026-05-13T12:00:00.000Z"));
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
      JSON.stringify({
        type: "risk_review_calibration",
        taskId: 89,
        testCaseId: 189,
        riskId: 2,
        taskSummary: "remote-task-89 | full_generation",
        resultRisk: {
          level: "medium",
          title: "低分风险",
          description: "失败任务风险。",
          evidence: "outputs/result.json",
        },
        humanReview: {
          agreeWithResultLevel: true,
          reason: "风险判断合理。",
        },
      }),
      "{bad-json",
      "",
    ].join("\n"),
    "utf-8",
  );

  return { localCaseRoot, evidenceRoot, registry, ruleStatsStore };
}

async function addCrossDeviceFixture(fixture: Awaited<ReturnType<typeof createFixture>>) {
  const crossDeviceCaseDir = path.join(fixture.localCaseRoot, "case-cross-device");
  const notInvolvedCaseDir = path.join(fixture.localCaseRoot, "case-not-involved");
  const missingSummaryCaseDir = path.join(fixture.localCaseRoot, "case-missing-cross-device-summary");

  await writeJson(path.join(crossDeviceCaseDir, "intermediate", "constraint-summary.json"), {
    explicitConstraints: ["目标: 手机和平板一多适配"],
    contextualConstraints: ["技术栈: ArkTS/ETS 页面与组件实现"],
    implicitConstraints: ["修改范围: 涉及页面布局"],
    classificationHints: ["full_generation", "multi_device_adaptation"],
    crossDeviceAdaptation: {
      applicability: "involved",
      confidence: "high",
      reasons: ["需求明确要求手机和平板布局适配"],
    },
  });
  await writeJson(path.join(crossDeviceCaseDir, "opencode-sandbox", "metadata", "metadata.json"), {
    case_id: "remote-task-101",
    constraint_summary: {
      explicitConstraints: ["目标: 手机和平板一多适配"],
      contextualConstraints: ["技术栈: ArkTS/ETS 页面与组件实现"],
      implicitConstraints: ["修改范围: 涉及页面布局"],
      classificationHints: ["full_generation", "multi_device_adaptation"],
      crossDeviceAdaptation: {
        applicability: "involved",
        confidence: "high",
        reasons: ["metadata 判定当前任务涉及手机和平板布局适配"],
      },
    },
  });
  await writeJson(path.join(crossDeviceCaseDir, "outputs", "result.json"), {
    basic_info: {
      case_name: "手机平板一多适配用例",
      task_type: "full_generation",
    },
    overall_conclusion: {
      total_score: 72,
      hard_gate_triggered: false,
      summary: "一多适配评分完成。",
    },
    risks: [
      {
        id: 31,
        level: "high",
        title: "布局风险",
        description: "一多适配布局存在风险。",
        evidence: "outputs/result.json",
      },
    ],
    bound_rule_packs: [
      {
        pack_id: "arkts-language",
        display_name: "从 TypeScript 到 ArkTS 的适配规则与 ArkTS 编程规范",
      },
      {
        pack_id: "cross-device-adaptation",
        display_name: "HarmonyOS 一多适配通用规则",
      },
    ],
    official_linter_summary: {
      configuredRuleSets: ["plugin:@cross-device-app-dev/recommended"],
      effectiveFindingCount: 2,
      runStatus: "success",
      durationMs: 12,
    },
    official_linter_results: [
      {
        rule_id: "@cross-device-app-dev/font-size",
        rule_result_id: "OFFICIAL-LINTER:@cross-device-app-dev/font-size",
        source_rule_set: "plugin:@cross-device-app-dev/recommended",
        severity: "warn",
        result: "不满足",
        finding_count: 2,
        findings: [],
        conclusion: "字号未适配多设备。",
        score_delta: -1.2,
        affected_items: [],
      },
    ],
    rule_audit_results: [
      {
        rule_id: "RSP-MUST-01",
        rule_summary: "横向断点划分范围必须符合系统推荐值",
        rule_source: "must_rule",
        result: "不满足",
        conclusion: "一多适配断点定义不符合系统推荐值。",
      },
      {
        rule_id: "ARKTS-MUST-001",
        rule_summary: "必须遵循 ArkTS 语言约束",
        rule_source: "must_rule",
        result: "不满足",
        conclusion: "存在 ArkTS 规则违背。",
      },
      {
        rule_id: "OFFICIAL-LINTER:@cross-device-app-dev/font-size",
        rule_summary: "官方 Code Linter：@cross-device-app-dev/font-size",
        rule_source: "should_rule",
        result: "不满足",
        conclusion: "官方 linter 镜像规则不应和 official_linter_results 重复展示。",
      },
    ],
  });

  await writeJson(path.join(notInvolvedCaseDir, "intermediate", "constraint-summary.json"), {
    explicitConstraints: ["目标: 普通业务修复"],
    contextualConstraints: ["技术栈: ArkTS/ETS 页面与组件实现"],
    implicitConstraints: ["修改范围: 普通页面逻辑"],
    classificationHints: ["bug_fix"],
    crossDeviceAdaptation: {
      applicability: "not_involved",
      confidence: "high",
      reasons: ["需求未出现多设备、多屏或设备形态适配要求"],
    },
  });
  await writeJson(path.join(notInvolvedCaseDir, "opencode-sandbox", "metadata", "metadata.json"), {
    case_id: "remote-task-102",
    constraint_summary: {
      explicitConstraints: ["目标: 普通业务修复"],
      contextualConstraints: ["技术栈: ArkTS/ETS 页面与组件实现"],
      implicitConstraints: ["修改范围: 普通页面逻辑"],
      classificationHints: ["bug_fix"],
      crossDeviceAdaptation: {
        applicability: "not_involved",
        confidence: "high",
        reasons: ["metadata 判定未涉及一多适配"],
      },
    },
  });
  await writeJson(path.join(notInvolvedCaseDir, "outputs", "result.json"), {
    basic_info: {
      case_name: "普通业务修复用例",
      task_type: "bug_fix",
    },
    overall_conclusion: {
      total_score: 91,
      hard_gate_triggered: false,
    },
    risks: [],
    official_linter_results: [
      {
        rule_id: "@cross-device-app-dev/size-unit",
        rule_result_id: "OFFICIAL-LINTER:@cross-device-app-dev/size-unit",
        source_rule_set: "plugin:@cross-device-app-dev/recommended",
        severity: "warn",
        result: "不满足",
        finding_count: 5,
        findings: [],
        conclusion: "非一多任务中的规则命中不应进入一多分析。",
        score_delta: -1,
        affected_items: [],
      },
    ],
  });

  await writeJson(path.join(missingSummaryCaseDir, "outputs", "result.json"), {
    basic_info: {
      case_name: "历史缺少一多摘要用例",
      task_type: "full_generation",
      task_type_basis: "continuation; has_patch; multi_device_adaptation; responsive_layout",
    },
    overall_conclusion: {
      total_score: 63,
      hard_gate_triggered: false,
    },
    risks: [],
    bound_rule_packs: [
      {
        pack_id: "cross-device-adaptation",
        display_name: "HarmonyOS 一多适配通用规则",
      },
    ],
    official_linter_summary: {
      configuredRuleSets: ["plugin:@cross-device-app-dev/recommended"],
      effectiveFindingCount: 1,
      runStatus: "success",
      durationMs: 8,
    },
    rule_audit_results: [
      {
        rule_id: "RSP-MUST-01",
        rule_summary: "横向断点划分范围必须符合系统推荐值",
        rule_source: "must_rule",
        result: "不满足",
        conclusion: "历史结果已有一多内置规则违背，但不能作为菜单入口。",
      },
    ],
  });

  await fixture.registry.upsert({
    taskId: 101,
    status: "completed",
    caseDir: crossDeviceCaseDir,
    testCaseId: 201,
    testCaseName: "远端一多名称",
    testCaseType: "full_generation",
  });
  await fixture.registry.upsert({
    taskId: 102,
    status: "completed",
    caseDir: notInvolvedCaseDir,
    testCaseId: 202,
    testCaseName: "远端普通名称",
    testCaseType: "bug_fix",
  });
  await fixture.registry.upsert({
    taskId: 103,
    status: "completed",
    caseDir: missingSummaryCaseDir,
    testCaseId: 203,
    testCaseName: "历史缺少摘要",
    testCaseType: "full_generation",
  });

  await fs.appendFile(
    path.join(fixture.evidenceRoot, "datasets", "risk_review_calibrations.jsonl"),
    [
      JSON.stringify({
        type: "risk_review_calibration",
        taskId: 101,
        testCaseId: 201,
        riskId: 31,
        taskSummary: "remote-task-101 | full_generation",
        resultRisk: {
          level: "high",
          title: "布局风险",
          description: "一多适配布局存在风险。",
          evidence: "outputs/result.json",
        },
        humanReview: {
          agreeWithResultLevel: false,
          correctedLevel: "medium",
          reason: "风险应降级。",
        },
      }),
      JSON.stringify({
        type: "risk_review_calibration",
        taskId: 102,
        testCaseId: 202,
        riskId: 32,
        taskSummary: "remote-task-102 | bug_fix",
        resultRisk: {
          level: "high",
          title: "非一多风险",
          description: "非一多风险不应进入一多分析。",
          evidence: "outputs/result.json",
        },
        humanReview: {
          agreeWithResultLevel: true,
          reason: "风险判断合理。",
        },
      }),
      "",
    ].join("\n"),
    "utf-8",
  );
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
  return await invokeExpressRequest(app, "GET", pathName);
}

async function invokeExpressPost(
  app: Express,
  pathName: string,
  body: unknown,
): Promise<{ statusCode: number; body: string }> {
  return await invokeExpressRequest(app, "POST", pathName, body);
}

async function invokeExpressRequest(
  app: Express,
  method: "GET" | "POST",
  pathName: string,
  body?: unknown,
): Promise<{ statusCode: number; body: string }> {
  return await new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const headers = new Map<string, number | string | readonly string[]>();
    const bodyBuffer =
      body === undefined ? Buffer.alloc(0) : Buffer.from(JSON.stringify(body), "utf-8");
    const req = {
      method,
      url: pathName,
      originalUrl: pathName,
      headers:
        body === undefined
          ? { host: "127.0.0.1" }
          : {
              host: "127.0.0.1",
              "content-type": "application/json",
              "content-length": String(bodyBuffer.length),
            },
      socket: { encrypted: false },
      connection: { encrypted: false },
      readable: body !== undefined,
      complete: body === undefined,
      body,
      get(name: string) {
        return this.headers[name.toLowerCase() as keyof typeof this.headers];
      },
      on(event: string, listener: (...args: unknown[]) => void) {
        if (body === undefined) {
          return this;
        }
        if (event === "data") {
          queueMicrotask(() => listener(bodyBuffer));
        }
        if (event === "end") {
          queueMicrotask(() => {
            this.complete = true;
            listener();
          });
        }
        return this;
      },
      once(event: string, listener: (...args: unknown[]) => void) {
        return this.on(event, listener);
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
  assert.equal(statusCounts.failed, 2);
  assert.equal(statusCounts.running, 1);
  assert.deepEqual(
    taskTypeCounts.map((item) => [item.taskType, item.count]),
    [
      ["bug_fix", 1],
      ["continuation", 1],
      ["full_generation", 2],
    ],
  );

  const tasks = await getJson(app, "/dashboard/tasks?sortBy=taskId&sortOrder=asc&pageSize=2");
  assert.equal(tasks.total, 4);
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
        taskId: 87,
        name: "更早负向用例",
        taskType: "full_generation",
        score: 41,
        statusCategory: "failed",
      },
      {
        taskId: 88,
        name: "电视台云服务新增全屏播放",
        taskType: "bug_fix",
        score: 88,
        statusCategory: "completed",
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

test("dashboard reports endpoints are not exposed", async (t) => {
  const fixture = await createFixture(t);
  const app = createDashboardTestApp(fixture);

  await assert.rejects(
    () => invokeExpressGet(app, "/dashboard/reports/daily"),
    /Unhandled request path: \/dashboard\/reports\/daily/,
  );
  await assert.rejects(
    () => invokeExpressGet(app, "/dashboard/reports/score-distribution"),
    /Unhandled request path: \/dashboard\/reports\/score-distribution/,
  );
});

test("dashboard analysis exposes human rating gaps and negative results", async (t) => {
  const fixture = await createFixture(t);
  const app = createDashboardTestApp(fixture);

  const gaps = await getJson(app, "/dashboard/analysis/human-rating-gaps");
  assert.equal(gaps.total, 2);
  assert.equal(gaps.skippedRows, 1);
  assert.deepEqual(
    (gaps.items as Array<Record<string, unknown>>).map((item) => item.taskId),
    [89, 88],
  );
  assert.equal((gaps.items as Array<Record<string, unknown>>)[0]?.caseName, "低分中文用例");

  const negative = await getJson(app, "/dashboard/analysis/negative-results");
  const negativeSummary = negative.summary as Record<string, unknown>;
  assert.equal(negativeSummary.totalCaseCount, 4);
  assert.equal(negativeSummary.failedTaskCount, 2);
  assert.equal(negativeSummary.lowScoreTaskCount, 2);
  assert.equal(negativeSummary.hardGateTaskCount, 2);
  assert.equal(negativeSummary.highRiskTaskCount, 1);
  assert.equal(negativeSummary.violatedRuleCount, 1);
  assert.deepEqual(
    (negative.failedTasks as Array<Record<string, unknown>>).map((item) => item.taskId),
    [89, 87],
  );
  assert.deepEqual(
    (negative.lowScoreTasks as Array<Record<string, unknown>>).map((item) => item.taskId),
    [89, 87],
  );
  assert.deepEqual(
    (negative.hardGateTasks as Array<Record<string, unknown>>).map((item) => item.taskId),
    [89, 87],
  );
  assert.equal(
    (negative.topRuleViolations as Array<Record<string, unknown>>)[0]?.rule_id,
    "ARKTS-MUST-001",
  );

  const outOfRangeNegative = await getJson(
    app,
    "/dashboard/analysis/negative-results?from=2026-05-14T00:00:00.000Z&to=2026-05-14T23:59:59.999Z",
  );
  const outOfRangeSummary = outOfRangeNegative.summary as Record<string, unknown>;
  assert.equal(outOfRangeSummary.totalCaseCount, 0);
  assert.equal(outOfRangeSummary.failedTaskCount, 0);
  assert.equal(outOfRangeSummary.violatedRuleCount, 0);
  assert.deepEqual(outOfRangeNegative.topRuleViolations, []);
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

test("dashboard human rating gaps expose default manual analysis status and filter by status", async (t) => {
  const fixture = await createFixture(t);
  const app = createDashboardTestApp(fixture);

  const all = await getJson(app, "/dashboard/analysis/human-rating-gaps");
  assert.equal((all.items as Array<Record<string, unknown>>)[0]?.manualAnalysisStatus, "pending");
  assert.equal((all.items as Array<Record<string, unknown>>)[1]?.manualAnalysisStatus, "pending");

  const analyzedBefore = await getJson(
    app,
    "/dashboard/analysis/human-rating-gaps?manualAnalysisStatus=analyzed",
  );
  assert.equal(analyzedBefore.total, 0);

  const invalid = await invokeExpressGet(
    app,
    "/dashboard/analysis/human-rating-gaps?manualAnalysisStatus=unknown",
  );
  assert.equal(invalid.statusCode, 400);
  assert.match(invalid.body, /manualAnalysisStatus must be one of pending, analyzed/);
});

test("dashboard human rating gaps batch update persists manual analysis status", async (t) => {
  const fixture = await createFixture(t);
  const app = createDashboardTestApp(fixture);

  const update = await invokeExpressPost(
    app,
    "/dashboard/analysis/human-rating-gaps/manual-analysis-status",
    { taskIds: [88], status: "analyzed" },
  );
  assert.equal(update.statusCode, 200);
  const updateBody = JSON.parse(update.body) as Record<string, unknown>;
  assert.equal(updateBody.updated, 1);
  assert.deepEqual(updateBody.missing, []);

  const analyzed = await getJson(
    app,
    "/dashboard/analysis/human-rating-gaps?manualAnalysisStatus=analyzed",
  );
  assert.equal(analyzed.total, 1);
  const item = (analyzed.items as Array<Record<string, unknown>>)[0];
  assert.equal(item?.taskId, 88);
  assert.equal(item?.manualAnalysisStatus, "analyzed");
  assert.equal(typeof item?.manualAnalyzedAt, "string");

  const reset = await invokeExpressPost(
    app,
    "/dashboard/analysis/human-rating-gaps/manual-analysis-status",
    { taskIds: [88, 999], status: "pending" },
  );
  assert.equal(reset.statusCode, 200);
  const resetBody = JSON.parse(reset.body) as Record<string, unknown>;
  assert.equal(resetBody.updated, 1);
  assert.deepEqual(resetBody.missing, [{ taskId: 999 }]);

  const pending = await getJson(
    app,
    "/dashboard/analysis/human-rating-gaps?manualAnalysisStatus=pending",
  );
  const resetItem = (pending.items as Array<Record<string, unknown>>).find(
    (row) => row.taskId === 88,
  );
  assert.equal(resetItem?.manualAnalysisStatus, "pending");
  assert.equal(Object.hasOwn(resetItem ?? {}, "manualAnalyzedAt"), false);
});

test("dashboard risk review calibrations expose case names and review details", async (t) => {
  const fixture = await createFixture(t);
  const app = createDashboardTestApp(fixture);

  const response = await getJson(app, "/dashboard/analysis/risk-review-calibrations");
  assert.equal(response.total, 2);
  assert.equal(response.skippedRows, 1);
  const items = response.items as Array<Record<string, unknown>>;
  assert.deepEqual(
    items.map((item) => item.taskId),
    [89, 88],
  );
  assert.equal(items[0]?.caseName, "低分中文用例");
  assert.equal(items[1]?.caseName, "电视台云服务新增全屏播放");
  assert.equal(items[1]?.taskSummary, "remote-task-88 | bug_fix");
  assert.equal((items[1]?.resultRisk as Record<string, unknown>).title, "构建风险");
  assert.equal((items[1]?.humanReview as Record<string, unknown>).correctedLevel, "medium");
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

  const byRiskTitle = await getJson(
    app,
    "/dashboard/analysis/risk-review-calibrations?keyword=%E6%9E%84%E5%BB%BA%E9%A3%8E%E9%99%A9",
  );
  assert.equal(byRiskTitle.total, 1);
  assert.equal((byRiskTitle.items as Array<Record<string, unknown>>)[0]?.taskId, 88);

  const disagreed = await getJson(
    app,
    "/dashboard/analysis/risk-review-calibrations?agreement=disagreed",
  );
  assert.equal(disagreed.total, 1);

  const agreed = await getJson(
    app,
    "/dashboard/analysis/risk-review-calibrations?agreement=agreed",
  );
  assert.equal(agreed.total, 1);
  assert.equal((agreed.items as Array<Record<string, unknown>>)[0]?.taskId, 89);

  const invalid = await invokeExpressGet(
    app,
    "/dashboard/analysis/risk-review-calibrations?agreement=unknown",
  );
  assert.equal(invalid.statusCode, 400);
  assert.match(invalid.body, /agreement must be one of agreed, disagreed/);
});

test("dashboard risk review manual status updates only disagreed rows", async (t) => {
  const fixture = await createFixture(t);
  const app = createDashboardTestApp(fixture);

  const disagreed = await getJson(
    app,
    "/dashboard/analysis/risk-review-calibrations?agreement=disagreed",
  );
  assert.equal(disagreed.total, 1);
  assert.equal(
    (disagreed.items as Array<Record<string, unknown>>)[0]?.manualAnalysisStatus,
    "pending",
  );

  const update = await invokeExpressPost(
    app,
    "/dashboard/analysis/risk-review-calibrations/manual-analysis-status",
    {
      items: [
        { taskId: 88, riskId: 1 },
        { taskId: 89, riskId: 2 },
        { taskId: 999, riskId: 1 },
      ],
      status: "analyzed",
    },
  );
  assert.equal(update.statusCode, 200);
  const updateBody = JSON.parse(update.body) as Record<string, unknown>;
  assert.equal(updateBody.updated, 1);
  assert.deepEqual(updateBody.missing, [{ taskId: 999, riskId: 1 }]);
  assert.deepEqual(updateBody.skipped, [{ taskId: 89, riskId: 2, reason: "not_disagreed" }]);

  const analyzed = await getJson(
    app,
    "/dashboard/analysis/risk-review-calibrations?agreement=disagreed&manualAnalysisStatus=analyzed",
  );
  assert.equal(analyzed.total, 1);
  const analyzedItem = (analyzed.items as Array<Record<string, unknown>>)[0];
  assert.equal(analyzedItem?.taskId, 88);
  assert.equal(analyzedItem?.manualAnalysisStatus, "analyzed");
  assert.equal(typeof analyzedItem?.manualAnalyzedAt, "string");

  const agreed = await getJson(
    app,
    "/dashboard/analysis/risk-review-calibrations?agreement=agreed",
  );
  const agreedItem = (agreed.items as Array<Record<string, unknown>>)[0];
  assert.equal(agreedItem?.manualAnalysisStatus, "pending");
});

test("dashboard manual status batch endpoints validate payloads", async (t) => {
  const fixture = await createFixture(t);
  const app = createDashboardTestApp(fixture);

  const emptyGap = await invokeExpressPost(
    app,
    "/dashboard/analysis/human-rating-gaps/manual-analysis-status",
    { taskIds: [], status: "analyzed" },
  );
  assert.equal(emptyGap.statusCode, 400);
  assert.match(emptyGap.body, /taskIds must be a non-empty array of positive integers/);

  const invalidGapStatus = await invokeExpressPost(
    app,
    "/dashboard/analysis/human-rating-gaps/manual-analysis-status",
    { taskIds: [88], status: "done" },
  );
  assert.equal(invalidGapStatus.statusCode, 400);
  assert.match(invalidGapStatus.body, /status must be one of pending, analyzed/);

  const emptyRisk = await invokeExpressPost(
    app,
    "/dashboard/analysis/risk-review-calibrations/manual-analysis-status",
    { items: [], status: "pending" },
  );
  assert.equal(emptyRisk.statusCode, 400);
  assert.match(emptyRisk.body, /items must be a non-empty array/);
});

test("dashboard cross-device cases list only involved tasks and support keyword filters", async (t) => {
  const fixture = await createFixture(t);
  await addCrossDeviceFixture(fixture);
  const app = createDashboardTestApp(fixture);

  const response = await getJson(
    app,
    "/dashboard/cross-device/cases?keyword=%E6%89%8B%E6%9C%BA%E5%B9%B3%E6%9D%BF",
  );
  assert.equal(response.success, true);
  assert.equal(response.total, 1);
  const items = response.items as Array<Record<string, unknown>>;
  assert.equal(items[0]?.name, "手机平板一多适配用例");
  assert.equal(items[0]?.taskId, 101);
  assert.equal(items[0]?.testCaseId, 201);
  assert.equal(items[0]?.crossDeviceRuleSetApplied, true);
  assert.equal(items[0]?.crossDeviceFindingCount, 2);
  assert.deepEqual(items[0]?.reasons, ["metadata 判定当前任务涉及手机和平板布局适配"]);
  assert.deepEqual(items[0]?.boundRulePacks, [
    {
      packId: "arkts-language",
      displayName: "从 TypeScript 到 ArkTS 的适配规则与 ArkTS 编程规范",
    },
    {
      packId: "cross-device-adaptation",
      displayName: "HarmonyOS 一多适配通用规则",
    },
  ]);
  assert.deepEqual(items[0]?.crossDeviceRuleAuditCounts, {
    violated: 1,
    review: 0,
    satisfied: 0,
    notInvolved: 0,
    total: 1,
  });
  assert.deepEqual(items[0]?.crossDeviceRuleAuditResults, [
    {
      packId: "cross-device-adaptation",
      packDisplayName: "HarmonyOS 一多适配通用规则",
      ruleId: "RSP-MUST-01",
      ruleSummary: "横向断点划分范围必须符合系统推荐值",
      ruleSource: "must_rule",
      result: "不满足",
      conclusion: "一多适配断点定义不符合系统推荐值。",
    },
  ]);
  assert.deepEqual(items[0]?.crossDeviceOfficialLinterResults, [
    {
      ruleId: "@cross-device-app-dev/font-size",
      ruleResultId: "OFFICIAL-LINTER:@cross-device-app-dev/font-size",
      sourceRuleSet: "plugin:@cross-device-app-dev/recommended",
      severity: "warn",
      findingCount: 2,
      conclusion: "字号未适配多设备。",
    },
  ]);
});

test("dashboard cross-device cases require involved constraint summary without fallback", async (t) => {
  const fixture = await createFixture(t);
  await addCrossDeviceFixture(fixture);
  const app = createDashboardTestApp(fixture);

  const response = await getJson(app, "/dashboard/cross-device/cases?keyword=%E5%8E%86%E5%8F%B2");
  assert.equal(response.success, true);
  assert.equal(response.total, 0);

  const allResponse = await getJson(app, "/dashboard/cross-device/cases");
  assert.equal(allResponse.success, true);
  const taskIds = (allResponse.items as Array<Record<string, unknown>>).map((item) => item.taskId);
  assert.deepEqual(taskIds, [101]);
});

test("dashboard cross-device rule violations only show cross-device built-in pack rules", async (t) => {
  const fixture = await createFixture(t);
  await addCrossDeviceFixture(fixture);
  const app = createDashboardTestApp(fixture);

  const response = await getJson(app, "/dashboard/cross-device/rule-violations");
  assert.equal(response.success, true);
  const items = response.items as Array<Record<string, unknown>>;
  assert.equal(items.length, 1);
  assert.equal(items[0]?.ruleId, "RSP-MUST-01");
  assert.equal(items[0]?.violationCount, 1);
  assert.equal(items[0]?.affectedTaskCount, 1);

  const withOtherRules = await getJson(
    app,
    "/dashboard/cross-device/rule-violations?includeOtherRules=true",
  );
  const allItems = withOtherRules.items as Array<Record<string, unknown>>;
  assert.ok(allItems.some((item) => item.ruleId === "ARKTS-MUST-001"));
  assert.ok(allItems.some((item) => item.ruleId === "RSP-MUST-01"));
  assert.equal(allItems.some((item) => item.ruleId === "@cross-device-app-dev/size-unit"), false);
  assert.equal(
    allItems.some((item) => item.ruleId === "OFFICIAL-LINTER:@cross-device-app-dev/font-size"),
    false,
  );
});

test("dashboard cross-device risk reviews filter to involved tasks", async (t) => {
  const fixture = await createFixture(t);
  await addCrossDeviceFixture(fixture);
  const app = createDashboardTestApp(fixture);

  const response = await getJson(
    app,
    "/dashboard/cross-device/risk-review-calibrations?riskLevel=high",
  );
  assert.equal(response.success, true);
  assert.equal(response.total, 1);
  const items = response.items as Array<Record<string, unknown>>;
  assert.equal(items[0]?.taskId, 101);
  assert.equal(items[0]?.caseName, "手机平板一多适配用例");

  const disagreed = await getJson(
    app,
    "/dashboard/cross-device/risk-review-calibrations?agreement=disagreed",
  );
  assert.equal(disagreed.total, 1);

  const agreed = await getJson(
    app,
    "/dashboard/cross-device/risk-review-calibrations?agreement=agreed",
  );
  assert.equal(agreed.total, 0);
});

test("api paths expose dashboard endpoints", () => {
  assert.equal(API_PATHS.dashboardSummary, "/dashboard/summary");
  assert.equal(API_PATHS.dashboardTasks, "/dashboard/tasks");
  assert.equal(API_PATHS.dashboardTaskLogs, "/dashboard/tasks/:taskId/logs");
  assert.equal(
    API_PATHS.dashboardAnalysisRiskReviewCalibrations,
    "/dashboard/analysis/risk-review-calibrations",
  );
  assert.equal(API_PATHS.dashboardCrossDeviceCases, "/dashboard/cross-device/cases");
  assert.equal(
    API_PATHS.dashboardCrossDeviceRuleViolations,
    "/dashboard/cross-device/rule-violations",
  );
  assert.equal(
    API_PATHS.dashboardCrossDeviceRiskReviewCalibrations,
    "/dashboard/cross-device/risk-review-calibrations",
  );
});
