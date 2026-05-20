import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeConsistency,
  appendAnalysisHistorySnapshot,
  buildConsistencyTaskPersistRecord,
  buildConsistencyExportFiles,
  buildConsistencyExportPayload,
  buildConsistencyHistoryChartRows,
  createStoredZip,
  buildRiskReport,
  buildRuleReport,
  compactConsistencyTaskSnapshots,
  extractConsistencyRunSummary,
  generateSubmittedTaskIds,
  hydrateConsistencyTaskSnapshot,
  isConsistencyTaskTerminal,
  jaccardSimilarity,
  normalizeConsistencyRunStatus,
  validateRemoteTaskJson,
  type ConsistencyAnalysisHistoryItem,
  type ConsistencyRunSummary,
} from "../web/src/pages/scoreConsistencyAnalysis.js";

const remoteTaskJson = JSON.stringify({
  taskId: 1306,
  testCase: {
    id: 63,
    name: "点餐元服务模板新增安装预加载功能",
    type: "incremental",
    description: "点餐元服务模板新增安装预加载功能",
    input: "点餐元服务模板新增安装预加载功能。",
    expectedOutput: "constraints:\n  - id: REQ-MUST-01",
    fileUrl: "https://example.com/source.zip",
  },
  executionResult: {
    isBuildSuccess: true,
    outputCodeUrl: "https://example.com/output.zip",
    diffFileUrl: "https://example.com/changes.patch",
  },
});

function completedRun(
  runIndex: number,
  overrides: Partial<ConsistencyRunSummary> = {},
): ConsistencyRunSummary {
  return {
    runIndex,
    taskId: 130600101 + runIndex,
    status: "completed",
    totalScore: 82,
    hardGateTriggered: false,
    summary: "整体满足要求",
    unsatisfiedRules: [{ ruleId: "REQ-MUST-01", summary: "使用预加载获取数据" }],
    risks: [
      {
        key: "high|预加载失败后缺少兜底逻辑",
        level: "high",
        title: "预加载失败后缺少兜底逻辑",
        evidence: "EntryAbility.ets",
      },
    ],
    ...overrides,
  };
}

test("validateRemoteTaskJson parses a valid remote task and normalizes callback", () => {
  const result = validateRemoteTaskJson(remoteTaskJson);

  assert.equal(result.valid, true);
  assert.equal(result.task?.taskId, 1306);
  assert.equal(result.task?.callback, "");
  assert.deepEqual(result.errors, []);
});

test("validateRemoteTaskJson accepts an empty expectedOutput string", () => {
  const task = JSON.parse(remoteTaskJson) as {
    testCase: { expectedOutput: string };
  };
  task.testCase.expectedOutput = "";

  const result = validateRemoteTaskJson(JSON.stringify(task));

  assert.equal(result.valid, true);
  assert.equal(result.task?.testCase.expectedOutput, "");
});

test("validateRemoteTaskJson reports missing required fields", () => {
  const result = validateRemoteTaskJson(JSON.stringify({ taskId: 1, testCase: {} }));

  assert.equal(result.valid, false);
  assert.deepEqual(result.errors, [
    "testCase.id 必须是数字",
    "testCase.name 必须是非空字符串",
    "testCase.type 必须是非空字符串",
    "testCase.description 必须是非空字符串",
    "testCase.input 必须是非空字符串",
    "testCase.expectedOutput 必须是字符串",
    "testCase.fileUrl 必须是非空字符串",
    "executionResult 必须是对象",
  ]);
});

test("generateSubmittedTaskIds derives ten increasing safe ids", () => {
  assert.deepEqual(generateSubmittedTaskIds(1306, 1), [
    130600101, 130600102, 130600103, 130600104, 130600105, 130600106, 130600107,
    130600108, 130600109, 130600110,
  ]);
});

test("extractConsistencyRunSummary reads score, unsatisfied rules, and risks", () => {
  const summary = extractConsistencyRunSummary(0, 130600101, {
    overall_conclusion: {
      total_score: 82,
      hard_gate_triggered: false,
      summary: "基本满足",
    },
    rule_audit_results: [
      {
        rule_id: "REQ-MUST-01",
        rule_summary: "使用预加载获取数据",
        result: "不满足",
        conclusion: "未看到 cloudResPrefetch",
      },
      {
        rule_id: "RSP-MUST-02",
        rule_summary: "失败后使用云函数获取数据",
        result: "满足",
        conclusion: "存在 cloudFunction",
      },
      {
        rule_id: "RSP-MUST-03",
        result: "不涉及",
      },
    ],
    risks: [
      {
        id: 1,
        level: "high",
        title: "预加载失败后缺少兜底逻辑",
        description: "异常后未兜底",
        evidence: "EntryAbility.ets",
      },
    ],
  });

  assert.equal(summary.totalScore, 82);
  assert.equal(summary.hardGateTriggered, false);
  assert.equal(summary.ruleUnsatisfactionRatio, 0.5);
  assert.deepEqual(summary.unsatisfiedRules, [
    {
      ruleId: "REQ-MUST-01",
      summary: "使用预加载获取数据",
      conclusion: "未看到 cloudResPrefetch",
    },
  ]);
  assert.deepEqual(summary.risks.map((risk) => risk.key), [
    "high|预加载失败后缺少兜底逻辑",
  ]);
});

test("jaccardSimilarity treats two empty sets as identical", () => {
  assert.equal(jaccardSimilarity([], []), 1);
  assert.equal(jaccardSimilarity(["a", "b"], ["b", "c"]), 1 / 3);
});

test("analyzeConsistency uses majority result stability", () => {
  const analysis = analyzeConsistency([
    completedRun(0),
    completedRun(1, { totalScore: 83 }),
    completedRun(2, { totalScore: 81 }),
    completedRun(3, {
      totalScore: 70,
      unsatisfiedRules: [{ ruleId: "RSP-MUST-02", summary: "失败后使用云函数获取数据" }],
      risks: [],
    }),
    completedRun(4, { status: "failed", error: "timeout" }),
  ]);

  assert.equal(analysis.completedRuns, 4);
  assert.equal(analysis.failedRuns, 1);
  assert.equal(analysis.consistentCompletedRuns, 3);
  assert.equal(analysis.consistencyPercentage, 75);
  assert.equal(analysis.averageScore, 79);
  assert.equal(analysis.medianScore, 81.5);
  assert.match(analysis.conclusion, /一致性为 75%/);
});

test("analyzeConsistency does not count in-progress runs as failed", () => {
  const analysis = analyzeConsistency([
    completedRun(0),
    {
      runIndex: 1,
      taskId: 130600102,
      status: "running",
      unsatisfiedRules: [],
      risks: [],
    },
    {
      runIndex: 2,
      taskId: 130600103,
      status: "queued",
      unsatisfiedRules: [],
      risks: [],
    },
    {
      runIndex: 3,
      taskId: 130600104,
      status: "timed_out",
      unsatisfiedRules: [],
      risks: [],
    },
  ]);

  assert.equal(analysis.completedRuns, 1);
  assert.equal(analysis.failedRuns, 1);
});

test("isConsistencyTaskTerminal requires all runs to be completed or terminal failures", () => {
  assert.equal(isConsistencyTaskTerminal([completedRun(0), completedRun(1)]), true);
  assert.equal(
    isConsistencyTaskTerminal([
      completedRun(0),
      { runIndex: 1, taskId: 130600102, status: "failed", unsatisfiedRules: [], risks: [] },
    ]),
    true,
  );
  assert.equal(
    isConsistencyTaskTerminal([
      completedRun(0),
      { runIndex: 1, taskId: 130600102, status: "running", unsatisfiedRules: [], risks: [] },
    ]),
    false,
  );
});

test("appendAnalysisHistorySnapshot appends one terminal round and avoids duplicates", () => {
  const runs = [completedRun(0), completedRun(1, { totalScore: 86 })];
  const first = appendAnalysisHistorySnapshot([], runs, "2026-05-20T01:00:00.000Z");
  const duplicated = appendAnalysisHistorySnapshot(first, runs, "2026-05-20T01:05:00.000Z");
  const secondRuns = [completedRun(0, { totalScore: 70 }), completedRun(1, { totalScore: 74 })];
  const second = appendAnalysisHistorySnapshot(duplicated, secondRuns, "2026-05-20T02:00:00.000Z");

  assert.equal(first.length, 1);
  assert.equal(first[0]?.round, 1);
  assert.equal(first[0]?.capturedAt, "2026-05-20T01:00:00.000Z");
  assert.equal(first[0]?.summary.averageScore, 84);
  assert.deepEqual(first[0]?.runs.map((run) => run.taskId), [130600101, 130600102]);
  assert.equal(duplicated.length, 1);
  assert.equal(second.length, 2);
  assert.equal(second[1]?.round, 2);
});

test("appendAnalysisHistorySnapshot skips non-terminal runs", () => {
  const history = appendAnalysisHistorySnapshot(
    [],
    [
      completedRun(0),
      { runIndex: 1, taskId: 130600102, status: "queued", unsatisfiedRules: [], risks: [] },
    ],
    "2026-05-20T01:00:00.000Z",
  );

  assert.deepEqual(history, []);
});

test("buildConsistencyExportPayload includes current analysis, history, and per-run results", () => {
  const runs = [completedRun(0), completedRun(1, { taskId: 130600102, totalScore: 86 })];
  const history = appendAnalysisHistorySnapshot([], runs, "2026-05-20T01:00:00.000Z");
  const payload = buildConsistencyExportPayload(
    {
      id: "C-001",
      sequence: 1,
      serviceBaseUrl: "http://localhost:3000",
      originalTaskId: 1306,
      caseId: 63,
      caseName: "点餐元服务模板新增安装预加载功能",
      createdAt: "2026-05-20T00:00:00.000Z",
      status: "completed",
      sourceTask: JSON.parse(remoteTaskJson),
      runs,
      analysis: analyzeConsistency(runs),
      ruleReport: buildRuleReport(runs),
      riskReport: buildRiskReport(runs),
      analysisHistory: history,
    },
    new Map<number, unknown>([
      [130600101, { overall_conclusion: { total_score: 82 } }],
      [130600102, new Error("result unavailable")],
    ]),
  );

  assert.equal(payload.task.id, "C-001");
  assert.equal(payload.analysis.summary.averageScore, 84);
  assert.equal(payload.analysisHistory.length, 1);
  assert.deepEqual(payload.runs[0]?.resultData, { overall_conclusion: { total_score: 82 } });
  assert.equal(payload.runs[1]?.error, "result unavailable");
});

test("buildConsistencyExportFiles splits overview and round result files", () => {
  const runs = [completedRun(0), completedRun(1, { taskId: 130600102, totalScore: 86 })];
  const history = appendAnalysisHistorySnapshot([], runs, "2026-05-20T01:00:00.000Z");
  const payload = buildConsistencyExportPayload(
    {
      id: "C-001",
      sequence: 1,
      serviceBaseUrl: "http://localhost:3000",
      originalTaskId: 1306,
      caseId: 63,
      caseName: "点餐元服务模板新增安装预加载功能",
      createdAt: "2026-05-20T00:00:00.000Z",
      status: "completed",
      sourceTask: JSON.parse(remoteTaskJson),
      runs,
      analysis: analyzeConsistency(runs),
      ruleReport: buildRuleReport(runs),
      riskReport: buildRiskReport(runs),
      analysisHistory: history,
    },
    new Map<number, unknown>([
      [130600101, { overall_conclusion: { total_score: 82 } }],
      [130600102, new Error("result unavailable")],
    ]),
  );

  const files = buildConsistencyExportFiles(payload);
  const overview = JSON.parse(files.get("overview.json") ?? "{}") as {
    task?: { id?: string };
    runs?: unknown[];
    analysisHistory?: unknown[];
  };
  const firstRound = JSON.parse(files.get("rounds/round-001/summary.json") ?? "{}") as {
    summary?: { averageScore?: number };
  };

  assert.deepEqual([...files.keys()], [
    "overview.json",
    "rounds/round-001/summary.json",
    "rounds/round-001/run-01-task-130600101.json",
    "rounds/round-001/run-02-task-130600102.json",
  ]);
  assert.equal(overview.task?.id, "C-001");
  assert.equal(overview.runs?.length, 2);
  assert.equal(overview.analysisHistory?.length, 1);
  assert.equal(firstRound.summary?.averageScore, 84);
  assert.match(files.get("rounds/round-001/run-01-task-130600101.json") ?? "", /total_score/);
  assert.match(files.get("rounds/round-001/run-02-task-130600102.json") ?? "", /result unavailable/);
});

test("createStoredZip writes a zip archive containing provided files", () => {
  const archive = createStoredZip(
    new Map([
      ["overview.json", '{"ok":true}'],
      ["rounds/round-001/run-01.json", '{"score":82}'],
    ]),
  );
  const signature = new DataView(archive.buffer, archive.byteOffset, archive.byteLength).getUint32(
    0,
    true,
  );
  const text = new TextDecoder().decode(archive);

  assert.equal(signature, 0x04034b50);
  assert.match(text, /overview\.json/);
  assert.match(text, /rounds\/round-001\/run-01\.json/);
  assert.match(text, /PK\u0005\u0006/);
});

test("buildConsistencyHistoryChartRows derives percent values for charting", () => {
  const history: ConsistencyAnalysisHistoryItem[] = [
    {
      round: 1,
      capturedAt: "2026-05-20T01:00:00.000Z",
      summary: {
        completedRuns: 10,
        failedRuns: 0,
        consistentCompletedRuns: 8,
        consistencyPercentage: 80,
        averageScore: 82,
        medianScore: 82,
        minScore: 80,
        maxScore: 84,
        scoreStandardDeviation: 1.2,
        averageRuleUnsatisfactionRatio: 0.125,
        averageRiskCount: 2,
        conclusion: "一致性为 80%。",
        runConsistencyByTaskId: {},
      },
      ruleReport: [],
      riskReport: [],
      runs: [],
    },
  ];

  assert.deepEqual(buildConsistencyHistoryChartRows(history), [
    {
      label: "第 1 轮",
      capturedAt: "2026-05-20T01:00:00.000Z",
      completedRuns: 10,
      failedRuns: 0,
      consistencyPercentage: 80,
      averageScore: 82,
      scoreStandardDeviation: 1.2,
      ruleUnsatisfactionPercentage: 12.5,
      averageRiskCount: 2,
    },
  ]);
});

test("normalizeConsistencyRunStatus keeps only current status labels", () => {
  assert.equal(normalizeConsistencyRunStatus("queued"), "queued");
  assert.equal(normalizeConsistencyRunStatus("unknown"), "pending_submit");
});

test("compactConsistencyTaskSnapshots strips derived reports before persistence", () => {
  const compacted = compactConsistencyTaskSnapshots([
    {
      id: "C-001",
      sequence: 1,
      serviceBaseUrl: "http://localhost:3000",
      originalTaskId: 1263,
      caseId: 229,
      caseName: "电视台元服务完成一多适配",
      createdAt: "2026-05-19T11:30:45.183Z",
      status: "running",
      runs: [completedRun(0)],
      analysis: analyzeConsistency([completedRun(0)]),
      ruleReport: buildRuleReport([completedRun(0)]),
      riskReport: buildRiskReport([completedRun(0)]),
    },
  ]);

  assert.equal("analysis" in compacted[0], false);
  assert.equal("ruleReport" in compacted[0], false);
  assert.equal("riskReport" in compacted[0], false);
  assert.equal(compacted[0]?.runs[0]?.status, "completed");

  const hydrated = hydrateConsistencyTaskSnapshot(compacted[0] as (typeof compacted)[number]);
  assert.equal(hydrated.analysis?.completedRuns, 1);
  assert.equal(hydrated.ruleReport?.length, 1);
  assert.equal(hydrated.riskReport?.length, 1);
});

test("buildConsistencyTaskPersistRecord omits sourceTask for refresh saves", () => {
  const snapshot = {
    id: "C-001",
    sequence: 1,
    serviceBaseUrl: "http://localhost:3000",
    originalTaskId: 1263,
    caseId: 229,
    caseName: "电视台元服务完成一多适配",
    createdAt: "2026-05-19T11:30:45.183Z",
    status: "running",
    sourceTask: JSON.parse(remoteTaskJson),
    runs: [completedRun(0)],
    analysis: analyzeConsistency([completedRun(0)]),
    ruleReport: buildRuleReport([completedRun(0)]),
    riskReport: buildRiskReport([completedRun(0)]),
  };

  const refreshPayload = buildConsistencyTaskPersistRecord(snapshot);
  const createPayload = buildConsistencyTaskPersistRecord(snapshot, true);

  assert.equal("analysis" in refreshPayload, false);
  assert.equal("sourceTask" in refreshPayload, false);
  assert.equal("sourceTask" in createPayload, true);
});

test("buildRuleReport aggregates unsatisfied rule stability", () => {
  const report = buildRuleReport([
    completedRun(0),
    completedRun(1),
    completedRun(2, {
      unsatisfiedRules: [{ ruleId: "RSP-MUST-02", summary: "失败后使用云函数获取数据" }],
    }),
    completedRun(3, { unsatisfiedRules: [] }),
  ]);

  assert.deepEqual(
    report.map((item) => ({
      ruleId: item.ruleId,
      unsatisfiedCount: item.unsatisfiedCount,
      unsatisfiedRate: item.unsatisfiedRate,
      stability: item.stability,
    })),
    [
      {
        ruleId: "REQ-MUST-01",
        unsatisfiedCount: 2,
        unsatisfiedRate: 50,
        stability: "判定波动",
      },
      {
        ruleId: "RSP-MUST-02",
        unsatisfiedCount: 1,
        unsatisfiedRate: 25,
        stability: "判定波动",
      },
    ],
  );
});

test("buildRiskReport aggregates risk appearance stability", () => {
  const report = buildRiskReport([
    completedRun(0),
    completedRun(1),
    completedRun(2),
    completedRun(3, { risks: [] }),
  ]);

  assert.equal(report.length, 1);
  assert.equal(report[0]?.appearanceCount, 3);
  assert.equal(report[0]?.appearanceRate, 75);
  assert.equal(report[0]?.stability, "偶发出现");
  assert.deepEqual(report[0]?.runIndexes, [1, 2, 3]);
});
