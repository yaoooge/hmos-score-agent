import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildRuleViolationStatsResponse,
  createRuleViolationStatsStore,
  extractRuleViolationRunSnapshot,
  type RuleViolationRunSnapshot,
} from "../src/api/ruleViolationStatsStore.js";
import { rebuildRuleViolationStatsIndex } from "../src/api/ruleViolationStatsRebuild.js";
import { createGetRuleViolationStatsHandler, createRunRemoteTaskHandler } from "../src/api/app.js";

async function makeTempDir(t: test.TestContext): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rule-violation-stats-"));
  t.after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });
  return dir;
}

function createSnapshot(patch: Partial<RuleViolationRunSnapshot> = {}): RuleViolationRunSnapshot {
  return {
    taskId: 101,
    caseId: "004",
    testCaseId: 4,
    caseName: "位置能力用例",
    completedAt: "2026-04-28T10:20:30.000Z",
    boundRulePacks: [
      {
        pack_id: "arkts-language",
        display_name: "从 TypeScript 到 ArkTS 的适配规则与 ArkTS 编程规范",
      },
    ],
    rules: [
      {
        pack_id: "arkts-language",
        rule_id: "ARKTS-MUST-001",
        rule_summary: "必须遵循 ArkTS 语言约束",
        rule_source: "must_rule",
        result: "不满足",
        conclusion: "发现不符合 ArkTS 语言约束的实现。",
      },
      {
        pack_id: "arkts-language",
        rule_id: "ARKTS-SHOULD-001",
        rule_summary: "建议遵循 ArkTS 写法",
        rule_source: "should_rule",
        result: "满足",
        conclusion: "已满足。",
      },
    ],
    ...patch,
  };
}

function createResponse() {
  const state: { statusCode: number; body?: Record<string, unknown> } = { statusCode: 200 };
  const response = {
    status(code: number) {
      state.statusCode = code;
      return response;
    },
    json(body: Record<string, unknown>) {
      state.body = body;
      return response;
    },
  };
  return { response, state };
}

async function waitForAssertion(assertion: () => Promise<void>, attempts = 20): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
    }
  }
  throw lastError;
}

test("rule violation stats store upserts snapshots by task id", async (t) => {
  const localCaseRoot = await makeTempDir(t);
  const store = createRuleViolationStatsStore(localCaseRoot);

  await store.upsertRun(createSnapshot({ taskId: 101, completedAt: "2026-04-28T10:00:00.000Z" }));
  await store.upsertRun(createSnapshot({ taskId: 101, completedAt: "2026-04-28T11:00:00.000Z" }));

  const runs = await store.listRuns();
  assert.equal(runs.length, 1);
  assert.equal(runs[0]?.taskId, 101);
  assert.equal(runs[0]?.completedAt, "2026-04-28T11:00:00.000Z");
});

test("rule violation stats store returns empty runs when index is missing", async (t) => {
  const localCaseRoot = await makeTempDir(t);
  const store = createRuleViolationStatsStore(localCaseRoot);

  assert.deepEqual(await store.listRuns(), []);
});

test("extractRuleViolationRunSnapshot keeps only static rule-pack results", () => {
  const snapshot = extractRuleViolationRunSnapshot({
    taskId: 120,
    caseId: "case-120",
    testCaseId: 120,
    caseName: "静态规则过滤用例",
    completedAt: "2026-04-28T12:00:00.000Z",
    boundRulePacks: [
      {
        pack_id: "arkts-language",
        display_name: "从 TypeScript 到 ArkTS 的适配规则与 ArkTS 编程规范",
      },
      { pack_id: "case-requirement_120", display_name: "用例 120 约束规则" },
    ],
    ruleAuditResults: [
      {
        rule_id: "ARKTS-MUST-001",
        rule_summary: "静态规则摘要",
        rule_source: "must_rule",
        result: "不满足",
        conclusion: "静态规则不满足。",
      },
      {
        rule_id: "HM-REQ-120-01",
        rule_summary: "用例规则摘要",
        rule_source: "must_rule",
        result: "不满足",
        conclusion: "用例规则不满足。",
      },
    ],
  });

  assert.deepEqual(
    snapshot.boundRulePacks.map((pack) => pack.pack_id),
    ["arkts-language"],
  );
  assert.deepEqual(
    snapshot.rules.map((rule) => rule.rule_id),
    ["ARKTS-MUST-001"],
  );
  assert.equal(snapshot.rules[0]?.pack_id, "arkts-language");
});

test("buildRuleViolationStatsResponse aggregates rules only and omits cases", () => {
  const response = buildRuleViolationStatsResponse(
    [
      createSnapshot({ taskId: 101, caseId: "004", testCaseId: 4 }),
      createSnapshot({ taskId: 102, caseId: "004", testCaseId: 4 }),
      createSnapshot({
        taskId: 103,
        caseId: "005",
        testCaseId: 5,
        rules: [
          {
            pack_id: "arkts-language",
            rule_id: "ARKTS-MUST-001",
            rule_summary: "必须遵循 ArkTS 语言约束",
            rule_source: "must_rule",
            result: "满足",
            conclusion: "已满足。",
          },
        ],
      }),
    ],
    {},
  );

  assert.equal(response.success, true);
  assert.deepEqual(response.summary, {
    totalRuns: 3,
    caseCount: 2,
    violatedRuleCount: 1,
    totalViolationEvents: 2,
  });
  assert.equal("cases" in response, false);
  assert.deepEqual(response.rules, [
    {
      pack_id: "arkts-language",
      rule_id: "ARKTS-MUST-001",
      rule_summary: "必须遵循 ArkTS 语言约束",
      rule_source: "must_rule",
      violationCount: 2,
      affectedCaseCount: 1,
      affectedRunCount: 2,
      affectedCaseIds: ["004"],
      affectedTaskIds: [101, 102],
      lastViolatedAt: "2026-04-28T10:20:30.000Z",
    },
  ]);
});

test("buildRuleViolationStatsResponse filters by case, test case, pack and time", () => {
  const response = buildRuleViolationStatsResponse(
    [
      createSnapshot({
        taskId: 101,
        caseId: "004",
        testCaseId: 4,
        completedAt: "2026-04-01T00:00:00.000Z",
      }),
      createSnapshot({
        taskId: 102,
        caseId: "005",
        testCaseId: 5,
        completedAt: "2026-04-28T10:00:00.000Z",
      }),
    ],
    {
      caseId: "005",
      testCaseId: 5,
      packId: "arkts-language",
      from: "2026-04-28T00:00:00.000Z",
      to: "2026-04-28T23:59:59.999Z",
    },
  );

  assert.equal(response.summary.totalRuns, 1);
  assert.deepEqual(response.rules[0]?.affectedTaskIds, [102]);
  assert.deepEqual(response.filters, {
    caseId: "005",
    testCaseId: 5,
    packId: "arkts-language",
    from: "2026-04-28T00:00:00.000Z",
    to: "2026-04-28T23:59:59.999Z",
  });
});

test("buildRuleViolationStatsResponse returns empty stats for case rule pack filter", () => {
  const response = buildRuleViolationStatsResponse([createSnapshot()], {
    packId: "case-requirement_004",
  });

  assert.deepEqual(response.summary, {
    totalRuns: 0,
    caseCount: 0,
    violatedRuleCount: 0,
    totalViolationEvents: 0,
  });
  assert.deepEqual(response.rules, []);
});

test("rule violation stats handler returns 400 for invalid timestamp", async (t) => {
  const localCaseRoot = await makeTempDir(t);
  const store = createRuleViolationStatsStore(localCaseRoot);
  const handler = createGetRuleViolationStatsHandler(store);
  const { response, state } = createResponse();

  await handler({ query: { from: "not-a-date" } } as never, response as never);

  assert.equal(state.statusCode, 400);
  assert.deepEqual(state.body, {
    success: false,
    message: "Invalid query parameter: from must be an ISO timestamp",
  });
});

test("rule violation stats handler returns rules-only response", async (t) => {
  const localCaseRoot = await makeTempDir(t);
  const store = createRuleViolationStatsStore(localCaseRoot);
  await store.upsertRun(createSnapshot());
  const handler = createGetRuleViolationStatsHandler(store);
  const { response, state } = createResponse();

  await handler({ query: {} } as never, response as never);

  assert.equal(state.statusCode, 200);
  assert.equal(state.body?.success, true);
  assert.equal("cases" in (state.body ?? {}), false);
  assert.equal((state.body?.rules as unknown[] | undefined)?.length, 1);
});

test("createRunRemoteTaskHandler writes static rule stats after completed execution", async (t) => {
  const localCaseRoot = await makeTempDir(t);
  const store = createRuleViolationStatsStore(localCaseRoot);
  const deps = {
    acceptRemoteEvaluationTask: async (remoteTask: Record<string, unknown>) => ({
      taskId: Number(remoteTask.taskId),
      caseDir: path.join(localCaseRoot, "remote-case-201"),
      message: "任务接收成功，结果将通过 callback 返回",
      remoteTask: {
        ...remoteTask,
        token: "remote-token",
        testCase: { id: 201, name: "远端静态规则统计用例" },
      },
      workflowState: { stage: "accepted", caseDir: path.join(localCaseRoot, "remote-case-201") },
    }),
    prepareRemoteEvaluationTask: async () => {
      throw new Error("prepareRemoteEvaluationTask should not be used by the HTTP handler");
    },
    executeAcceptedRemoteEvaluationTask: async (acceptedTask: never, executionDeps: never) => {
      const task = acceptedTask as {
        taskId: number;
        remoteTask: { testCase: { id: number; name: string } };
      };
      const depsWithHook = executionDeps as {
        onCompleted?: (input: {
          acceptedTask: typeof task;
          workflowResult: Record<string, unknown>;
          resultJson: Record<string, unknown>;
        }) => Promise<void>;
      };
      const resultJson = {
        bound_rule_packs: [
          {
            pack_id: "arkts-language",
            display_name: "从 TypeScript 到 ArkTS 的适配规则与 ArkTS 编程规范",
          },
          { pack_id: "case-requirement_201", display_name: "用例 201 约束规则" },
        ],
        rule_audit_results: [
          {
            rule_id: "ARKTS-MUST-001",
            rule_summary: "必须遵循 ArkTS 语言约束",
            rule_source: "must_rule",
            result: "不满足",
            conclusion: "静态规则不满足。",
          },
          {
            rule_id: "HM-REQ-201-01",
            rule_summary: "用例约束规则",
            rule_source: "must_rule",
            result: "不满足",
            conclusion: "用例规则不满足。",
          },
        ],
      };

      await depsWithHook.onCompleted?.({
        acceptedTask: task,
        workflowResult: { caseInput: { caseId: "201" }, resultJson },
        resultJson,
      });
      return "callback 上传成功。";
    },
  };
  const handler = createRunRemoteTaskHandler(deps as never, undefined, store);
  const { response, state } = createResponse();

  await handler(
    {
      body: {
        taskId: 201,
        token: "remote-token",
        testCase: { id: 201, name: "远端静态规则统计用例" },
      },
    } as never,
    response as never,
  );

  assert.equal(state.statusCode, 200);
  await waitForAssertion(async () => {
    const stats = buildRuleViolationStatsResponse(await store.listRuns(), {});
    assert.equal(stats.summary.totalRuns, 1);
    assert.deepEqual(
      stats.rules.map((rule) => rule.rule_id),
      ["ARKTS-MUST-001"],
    );
  });
});

test("rebuildRuleViolationStatsIndex rebuilds stats from historical result files", async (t) => {
  const localCaseRoot = await makeTempDir(t);
  const staleStore = createRuleViolationStatsStore(localCaseRoot);
  await staleStore.upsertRun(createSnapshot({ taskId: 999, caseId: "stale" }));

  const caseDir = path.join(localCaseRoot, "20260428T010203_full_generation_abcd1234");
  await fs.mkdir(path.join(caseDir, "inputs"), { recursive: true });
  await fs.mkdir(path.join(caseDir, "outputs"), { recursive: true });
  await fs.writeFile(
    path.join(caseDir, "inputs", "case-info.json"),
    JSON.stringify({
      remote_task_id: 154,
      remote_test_case_id: 65,
      started_at: "2026-04-28T01:02:03.000Z",
    }),
  );
  await fs.writeFile(
    path.join(caseDir, "outputs", "result.json"),
    JSON.stringify({
      report_meta: {
        unit_name: "remote-task-154",
        generated_at: "2026-04-28T01:10:00.000Z",
      },
      bound_rule_packs: [
        {
          pack_id: "arkts-language",
          display_name: "从 TypeScript 到 ArkTS 的适配规则与 ArkTS 编程规范",
        },
        { pack_id: "case-remote-task-154", display_name: "用例 remote-task-154 约束规则" },
      ],
      rule_audit_results: [
        {
          rule_id: "ARKTS-MUST-001",
          rule_summary: "静态规则摘要",
          rule_source: "must_rule",
          result: "不满足",
          conclusion: "静态规则不满足。",
        },
        {
          rule_id: "HM-REQ-154-01",
          rule_summary: "用例规则摘要",
          rule_source: "must_rule",
          result: "不满足",
          conclusion: "用例规则不满足。",
        },
      ],
    }),
  );

  const summary = await rebuildRuleViolationStatsIndex(localCaseRoot);

  assert.deepEqual(summary, { scannedResultFiles: 1, rebuiltRuns: 1, skippedFiles: 0 });
  const rebuiltRuns = await createRuleViolationStatsStore(localCaseRoot).listRuns();
  assert.equal(rebuiltRuns.length, 1);
  assert.equal(rebuiltRuns[0]?.taskId, 154);
  assert.equal(rebuiltRuns[0]?.testCaseId, 65);
  assert.equal(rebuiltRuns[0]?.caseId, "remote-task-154");
  assert.deepEqual(
    rebuiltRuns[0]?.boundRulePacks.map((pack) => pack.pack_id),
    ["arkts-language"],
  );
  assert.deepEqual(
    rebuiltRuns[0]?.rules.map((rule) => rule.rule_id),
    ["ARKTS-MUST-001"],
  );
});
