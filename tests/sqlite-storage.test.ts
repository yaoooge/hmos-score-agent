import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildRuleViolationStatsResponse,
  type RuleViolationRunSnapshot,
} from "../src/api/ruleViolationStatsStore.js";
import { createScoreDatabase } from "../src/storage/sqliteDatabase.js";
import {
  buildSqliteRuleViolationStatsResponse,
  createSqliteConsistencyTaskStore,
  createSqliteRemoteTaskRegistry,
  createSqliteRuleViolationStatsStore,
  listSqliteRemoteTaskPage,
  listSqliteRemoteTaskSummaries,
  updateSqliteRemoteTaskSummary,
} from "../src/storage/sqliteStores.js";
import { backfillSqliteIndexes } from "../src/storage/sqliteBackfill.js";

async function makeTempDir(t: test.TestContext): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sqlite-storage-"));
  t.after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });
  return dir;
}

test("createScoreDatabase initializes schema and enables WAL", async (t) => {
  const root = await makeTempDir(t);
  const db = createScoreDatabase(path.join(root, "score-index.sqlite3"));
  t.after(() => db.close());

  const journalMode = db.get<{ journal_mode: string }>("PRAGMA journal_mode");
  assert.equal(journalMode?.journal_mode, "wal");

  const tables = db.all<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
  );
  assert.deepEqual(
    tables.map((table) => table.name),
    [
      "analysis_event",
      "consistency_task",
      "remote_task",
      "rule_violation_item",
      "rule_violation_run",
      "schema_migrations",
    ],
  );

  const migrations = db.all<{ version: number }>(
    "SELECT version FROM schema_migrations ORDER BY version",
  );
  assert.deepEqual(
    migrations.map((migration) => migration.version),
    [1],
  );
});

test("score database transaction rolls back failed writes", async (t) => {
  const root = await makeTempDir(t);
  const db = createScoreDatabase(path.join(root, "score-index.sqlite3"));
  t.after(() => db.close());

  assert.throws(() => {
    db.transaction(() => {
      db.run(
        "INSERT INTO remote_task (task_id, status, created_at_ms, updated_at_ms, result_available) VALUES (?, ?, ?, ?, ?)",
        [101, "running", 1, 1, 0],
      );
      throw new Error("stop");
    });
  }, /stop/);

  const count = db.get<{ count: number }>("SELECT COUNT(*) AS count FROM remote_task");
  assert.equal(count?.count, 0);
});

test("sqlite remote task registry preserves upsert and list behavior", async (t) => {
  const root = await makeTempDir(t);
  const db = createScoreDatabase(path.join(root, "score-index.sqlite3"));
  t.after(() => db.close());
  const registry = createSqliteRemoteTaskRegistry(db);

  await registry.upsert({
    taskId: 202,
    status: "running",
    caseDir: path.join(root, "case-202"),
    testCaseId: 502,
    testCaseName: "远端用例",
    testCaseType: "bug_fix",
  });
  const updated = await registry.upsert({
    taskId: 202,
    status: "completed",
    error: "old error should not appear",
  });

  assert.equal(updated.taskId, 202);
  assert.equal(updated.status, "completed");
  assert.equal(updated.testCaseName, "远端用例");
  assert.equal(updated.error, "old error should not appear");
  assert.deepEqual(await registry.get(202), updated);
  assert.deepEqual(
    (await registry.list()).map((record) => record.taskId),
    [202],
  );
});

function createRuleSnapshot(
  overrides: Partial<RuleViolationRunSnapshot> = {},
): RuleViolationRunSnapshot {
  return {
    taskId: 301,
    caseId: "case-301",
    testCaseId: 901,
    caseName: "规则统计用例",
    completedAt: "2026-05-20T01:00:00.000Z",
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
    ...overrides,
  };
}

test("sqlite rule violation store upserts snapshots and supports existing aggregation", async (t) => {
  const root = await makeTempDir(t);
  const db = createScoreDatabase(path.join(root, "score-index.sqlite3"));
  t.after(() => db.close());
  const store = createSqliteRuleViolationStatsStore(db);

  await store.upsertRun(createRuleSnapshot());
  await store.upsertRun(
    createRuleSnapshot({
      taskId: 302,
      caseId: "case-302",
      testCaseId: 902,
      completedAt: "2026-05-20T02:00:00.000Z",
    }),
  );

  const runs = await store.listRuns();
  assert.deepEqual(
    runs.map((run) => run.taskId),
    [301, 302],
  );
  assert.equal(runs[0]?.boundRulePacks[0]?.pack_id, "arkts-language");

  const stats = buildRuleViolationStatsResponse(runs, { packId: "arkts-language" });
  assert.equal(stats.summary.totalRuns, 2);
  assert.equal(stats.rules[0]?.violationCount, 2);
  assert.deepEqual(stats.rules[0]?.affectedTaskIds, [301, 302]);
});

test("sqlite rule violation store sanitizes snapshots like the JSON store", async (t) => {
  const root = await makeTempDir(t);
  const db = createScoreDatabase(path.join(root, "score-index.sqlite3"));
  t.after(() => db.close());
  const store = createSqliteRuleViolationStatsStore(db);

  await store.upsertRun(
    createRuleSnapshot({
      rules: [
        {
          pack_id: "custom-pack",
          rule_id: "CUSTOM-001",
          rule_summary: "非注册规则不应进入静态统计",
          rule_source: "must_rule",
          result: "不满足",
          conclusion: "custom violation",
        },
        ...createRuleSnapshot().rules,
      ],
    }),
  );

  const runs = await store.listRuns();
  assert.deepEqual(
    runs[0]?.rules.map((rule) => rule.rule_id),
    ["ARKTS-MUST-001"],
  );
  assert.deepEqual(
    db
      .all<{ pack_id: string }>("SELECT DISTINCT pack_id FROM rule_violation_item")
      .map((row) => row.pack_id),
    ["arkts-language"],
  );
});

test("sqlite rule violation store preserves duplicate rule events within one run", async (t) => {
  const root = await makeTempDir(t);
  const db = createScoreDatabase(path.join(root, "score-index.sqlite3"));
  t.after(() => db.close());
  const store = createSqliteRuleViolationStatsStore(db);

  await store.upsertRun(
    createRuleSnapshot({
      rules: [...createRuleSnapshot().rules, ...createRuleSnapshot().rules],
    }),
  );

  const response = buildSqliteRuleViolationStatsResponse(db, { packId: "arkts-language" });

  assert.equal(response.summary.totalRuns, 1);
  assert.equal(response.summary.totalViolationEvents, 2);
  assert.equal(response.rules[0]?.violationCount, 2);
  assert.deepEqual(response.rules[0]?.affectedTaskIds, [301]);
});

test("sqlite consistency task store replaces and upserts normalized records", async (t) => {
  const root = await makeTempDir(t);
  const db = createScoreDatabase(path.join(root, "score-index.sqlite3"));
  t.after(() => db.close());
  const store = createSqliteConsistencyTaskStore(db);

  await store.replace([
    {
      id: "C-001",
      sequence: 1,
      runs: [{ status: "obsolete" }],
      analysis: { dropped: true },
    },
    { id: "", sequence: 2 },
  ]);
  await store.upsert({ id: "C-002", sequence: 2, sourceTaskId: 1002 });

  assert.deepEqual(await store.list(), [
    {
      id: "C-001",
      sequence: 1,
      runs: [{ status: "pending_submit" }],
    },
    {
      id: "C-002",
      sequence: 2,
      sourceTaskId: 1002,
    },
  ]);
});

test("sqlite remote task summaries support dashboard task queries without result files", async (t) => {
  const root = await makeTempDir(t);
  const db = createScoreDatabase(path.join(root, "score-index.sqlite3"));
  t.after(() => db.close());
  const registry = createSqliteRemoteTaskRegistry(db);

  await registry.upsert({
    taskId: 401,
    status: "completed",
    testCaseId: 1401,
    testCaseName: "远端名称",
    testCaseType: "bug_fix",
  });
  updateSqliteRemoteTaskSummary(db, {
    taskId: 401,
    caseName: "结果名称",
    taskType: "bug_fix",
    score: 88,
    hardGateTriggered: false,
    resultAvailable: true,
    risks: [{ level: "high", title: "构建风险" }],
  });

  const summaries = listSqliteRemoteTaskSummaries(db);
  assert.equal(summaries.length, 1);
  assert.deepEqual(
    {
      taskId: summaries[0]?.taskId,
      testCaseId: summaries[0]?.testCaseId,
      name: summaries[0]?.name,
      status: summaries[0]?.status,
      statusCategory: summaries[0]?.statusCategory,
      taskType: summaries[0]?.taskType,
      score: summaries[0]?.score,
      hardGateTriggered: summaries[0]?.hardGateTriggered,
      resultAvailable: summaries[0]?.resultAvailable,
      risks: summaries[0]?.risks,
    },
    {
      taskId: 401,
      testCaseId: 1401,
      name: "结果名称",
      status: "completed",
      statusCategory: "completed",
      taskType: "bug_fix",
      score: 88,
      hardGateTriggered: false,
      resultAvailable: true,
      risks: [{ level: "high", title: "构建风险" }],
    },
  );
  assert.equal(typeof summaries[0]?.createdAt, "string");
  assert.equal(typeof summaries[0]?.updatedAt, "string");
});

test("sqlite remote task page applies dashboard filters, sorting and pagination in SQL", async (t) => {
  const root = await makeTempDir(t);
  const db = createScoreDatabase(path.join(root, "score-index.sqlite3"));
  t.after(() => db.close());
  const registry = createSqliteRemoteTaskRegistry(db);

  const dateNow = t.mock.method(Date, "now");
  dateNow.mock.mockImplementation(() => Date.parse("2026-05-20T01:00:00.000Z"));
  await registry.upsert({
    taskId: 410,
    status: "completed",
    testCaseId: 1410,
    testCaseName: "Alpha task",
    testCaseType: "bug_fix",
  });
  updateSqliteRemoteTaskSummary(db, {
    taskId: 410,
    caseName: "Alpha result",
    taskType: "bug_fix",
    score: 70,
    hardGateTriggered: false,
    resultAvailable: true,
  });

  dateNow.mock.mockImplementation(() => Date.parse("2026-05-20T02:00:00.000Z"));
  await registry.upsert({
    taskId: 411,
    status: "completed",
    testCaseId: 1411,
    testCaseName: "Beta task",
    testCaseType: "bug_fix",
  });
  updateSqliteRemoteTaskSummary(db, {
    taskId: 411,
    caseName: "Beta result",
    taskType: "bug_fix",
    score: 91,
    hardGateTriggered: false,
    resultAvailable: true,
  });

  dateNow.mock.mockImplementation(() => Date.parse("2026-05-20T03:00:00.000Z"));
  await registry.upsert({
    taskId: 412,
    status: "running",
    testCaseId: 1412,
    testCaseName: "Beta running",
    testCaseType: "bug_fix",
  });

  const page = listSqliteRemoteTaskPage(db, {
    status: "completed",
    taskType: "bug_fix",
    keyword: "beta",
    scoreMin: 80,
    from: "2026-05-20T00:00:00.000Z",
    to: "2026-05-20T02:30:00.000Z",
    page: 1,
    pageSize: 10,
    sortBy: "score",
    sortOrder: "desc",
  });

  assert.equal(page.total, 1);
  assert.deepEqual(
    page.items.map((item) => item.taskId),
    [411],
  );
  assert.equal(page.items[0]?.name, "Beta result");
  assert.equal(page.items[0]?.score, 91);
});

test("sqlite rule violation stats response aggregates directly from sqlite", async (t) => {
  const root = await makeTempDir(t);
  const db = createScoreDatabase(path.join(root, "score-index.sqlite3"));
  t.after(() => db.close());
  const store = createSqliteRuleViolationStatsStore(db);

  await store.replaceRuns([
    createRuleSnapshot({
      taskId: 601,
      caseId: "case-a",
      testCaseId: 1601,
      completedAt: "2026-05-20T01:00:00.000Z",
    }),
    createRuleSnapshot({
      taskId: 602,
      caseId: "case-b",
      testCaseId: 1602,
      completedAt: "2026-05-20T02:00:00.000Z",
    }),
  ]);

  const response = buildSqliteRuleViolationStatsResponse(db, {
    packId: "arkts-language",
    from: "2026-05-20T01:30:00.000Z",
  });

  assert.equal(response.summary.totalRuns, 1);
  assert.equal(response.summary.caseCount, 1);
  assert.equal(response.summary.violatedRuleCount, 1);
  assert.equal(response.summary.totalViolationEvents, 1);
  assert.equal(response.rules[0]?.rule_id, "ARKTS-MUST-001");
  assert.deepEqual(response.rules[0]?.affectedCaseIds, ["case-b"]);
  assert.deepEqual(response.rules[0]?.affectedTaskIds, [602]);
  assert.equal(response.rules[0]?.lastViolatedAt, "2026-05-20T02:00:00.000Z");
});

test("sqlite rule violation stats counts filtered runs even when they have no violations", async (t) => {
  const root = await makeTempDir(t);
  const db = createScoreDatabase(path.join(root, "score-index.sqlite3"));
  t.after(() => db.close());
  const store = createSqliteRuleViolationStatsStore(db);

  await store.replaceRuns([
    createRuleSnapshot({
      taskId: 611,
      caseId: "case-empty",
      testCaseId: 1611,
      completedAt: "2026-05-20T01:00:00.000Z",
      boundRulePacks: [],
      rules: [],
    }),
  ]);

  const response = buildSqliteRuleViolationStatsResponse(db, { caseId: "case-empty" });

  assert.equal(response.summary.totalRuns, 1);
  assert.equal(response.summary.caseCount, 1);
  assert.equal(response.summary.violatedRuleCount, 0);
  assert.equal(response.summary.totalViolationEvents, 0);
  assert.deepEqual(response.rules, []);
});

test("backfillSqliteIndexes imports existing json indexes into sqlite", async (t) => {
  const root = await makeTempDir(t);
  const db = createScoreDatabase(path.join(root, "score-index.sqlite3"));
  t.after(() => db.close());
  const caseDir = path.join(root, "case-501");
  await fs.mkdir(path.join(caseDir, "outputs"), { recursive: true });
  await fs.writeFile(
    path.join(caseDir, "outputs", "result.json"),
    JSON.stringify({
      basic_info: { case_name: "历史结果名称", task_type: "bug_fix" },
      overall_conclusion: { total_score: 86, hard_gate_triggered: false },
      risks: [{ level: "medium", title: "历史风险" }],
    }),
    "utf-8",
  );

  await fs.writeFile(
    path.join(root, "remote-task-index.json"),
    JSON.stringify({
      records: [
        {
          taskId: 501,
          status: "completed",
          createdAt: 1000,
          updatedAt: 2000,
          caseDir,
          testCaseId: 1501,
          testCaseName: "历史任务",
          testCaseType: "bug_fix",
        },
      ],
    }),
    "utf-8",
  );
  await fs.writeFile(
    path.join(root, "rule-violation-stats.json"),
    JSON.stringify({
      schemaVersion: 1,
      runs: [createRuleSnapshot({ taskId: 501, testCaseId: 1501 })],
    }),
    "utf-8",
  );
  await fs.writeFile(
    path.join(root, "consistency-task-index.json"),
    JSON.stringify({
      records: [{ id: "C-501", sequence: 501, sourceTaskId: 501 }],
    }),
    "utf-8",
  );

  await backfillSqliteIndexes({ localCaseRoot: root, db });

  assert.equal((await createSqliteRemoteTaskRegistry(db).get(501))?.testCaseName, "历史任务");
  assert.equal(listSqliteRemoteTaskSummaries(db)[0]?.name, "历史结果名称");
  assert.equal(listSqliteRemoteTaskSummaries(db)[0]?.score, 86);
  assert.equal((await createSqliteRuleViolationStatsStore(db).listRuns())[0]?.taskId, 501);
  assert.equal((await createSqliteConsistencyTaskStore(db).list())[0]?.id, "C-501");
});
