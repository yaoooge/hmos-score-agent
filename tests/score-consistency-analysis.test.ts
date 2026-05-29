import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeConsistency,
  appendAnalysisHistorySnapshot,
  buildConsistencyTaskPersistRecord,
  buildConsistencyTaskPersistDelta,
  collectExclusiveRoundTaskIds,
  buildConsistencyTaskRoundOptions,
  buildConsistencyExportFiles,
  buildConsistencyExportPayload,
  buildConsistencyHistoryChartRows,
  createStoredZip,
  buildRiskReport,
  buildRuleReport,
  compactConsistencyTaskSnapshots,
  extractConsistencyRunSummary,
  generateNextSubmittedTaskIds,
  generateSubmittedTaskIds,
  hydrateConsistencyTaskSnapshot,
  isConsistencyTaskTerminal,
  jaccardSimilarity,
  normalizeConsistencyRunStatus,
  removeConsistencyAnalysisHistoryRound,
  selectConsistencyTaskRoundSnapshot,
  validateRemoteEvaluationTaskInput,
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

test("generateNextSubmittedTaskIds derives the next unused block across rounds", () => {
  const firstRoundRuns = generateSubmittedTaskIds(1263, 2).map((taskId, index) =>
    completedRun(index, { taskId }),
  );
  const history = appendAnalysisHistorySnapshot(
    [],
    firstRoundRuns,
    "2026-05-20T01:00:00.000Z",
  );

  assert.deepEqual(
    generateNextSubmittedTaskIds({
      id: "C-002",
      sequence: 2,
      serviceBaseUrl: "http://localhost:3000",
      originalTaskId: 1263,
      caseId: 63,
      caseName: "点餐元服务模板新增安装预加载功能",
      createdAt: "2026-05-20T00:00:00.000Z",
      status: "completed",
      runs: firstRoundRuns,
      analysisHistory: history,
    }),
    [
      126300211, 126300212, 126300213, 126300214, 126300215, 126300216, 126300217,
      126300218, 126300219, 126300220,
    ],
  );
});

test("extractConsistencyRunSummary reads score, unsatisfied rules, and risks", () => {
  const summary = extractConsistencyRunSummary(0, 130600101, {
    overall_conclusion: {
      total_score: 82,
      pre_cap_score: 88,
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
  assert.equal(summary.preScore, 88);
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

test("extractConsistencyRunSummary prefers risk_code over generated identity text", () => {
  const summary = extractConsistencyRunSummary(0, 130600101, {
    overall_conclusion: {
      total_score: 82,
      hard_gate_triggered: false,
      summary: "基本满足",
    },
    rule_audit_results: [],
    risks: [
      {
        id: 1,
        level: "low",
        title: "随意生成的标题",
        description: "关键需求没有实现。",
        evidence: "EntryAbility.ets",
        risk_code: "REQUIREMENT_NOT_IMPLEMENTED",
        source_rule_id: "ARKTS-MUST-001",
      },
    ],
  });

  assert.equal(summary.risks[0]?.key, "risk_code|REQUIREMENT_NOT_IMPLEMENTED");
});

test("extractConsistencyRunSummary deduplicates risks by key within one run", () => {
  const summary = extractConsistencyRunSummary(0, 130600101, {
    overall_conclusion: {
      total_score: 82,
      hard_gate_triggered: false,
    },
    rule_audit_results: [],
    risks: [
      {
        id: 1,
        level: "medium",
        title: "需求实现不完整",
        risk_code: "REQUIREMENT_PARTIALLY_IMPLEMENTED",
        evidence: "TelevisionPage.ets",
      },
      {
        id: 2,
        level: "medium",
        title: "需求实现不完整",
        risk_code: "REQUIREMENT_PARTIALLY_IMPLEMENTED",
        evidence: "MinePage.ets",
      },
    ],
  });

  assert.deepEqual(
    summary.risks.map((risk) => risk.key),
    ["risk_code|REQUIREMENT_PARTIALLY_IMPLEMENTED"],
  );
});

test("buildRiskReport counts each risk at most once per run", () => {
  const report = buildRiskReport([
    completedRun(0, {
      risks: [
        {
          key: "risk_code|REQUIREMENT_PARTIALLY_IMPLEMENTED",
          level: "medium",
          title: "需求实现不完整",
          evidence: "TelevisionPage.ets",
        },
        {
          key: "risk_code|REQUIREMENT_PARTIALLY_IMPLEMENTED",
          level: "medium",
          title: "需求实现不完整",
          evidence: "MinePage.ets",
        },
      ],
    }),
    completedRun(1, { risks: [] }),
  ]);

  assert.equal(report[0]?.appearanceCount, 1);
  assert.deepEqual(report[0]?.runIndexes, [1]);
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

test("analyzeConsistency exposes split score gate and finding stability", () => {
  const analysis = analyzeConsistency([
    completedRun(0, {
      totalScore: 69,
      hardGateTriggered: true,
      risks: [
        {
          key: "risk_code|REQUIREMENT_NOT_IMPLEMENTED",
          level: "high",
          title: "需求未实现",
          risk_code: "REQUIREMENT_NOT_IMPLEMENTED",
        } as never,
      ],
    }),
    completedRun(1, {
      totalScore: 69,
      hardGateTriggered: true,
      risks: [
        {
          key: "risk_code|REQUIREMENT_NOT_IMPLEMENTED",
          level: "high",
          title: "需求未实现",
          risk_code: "REQUIREMENT_NOT_IMPLEMENTED",
        } as never,
      ],
    }),
    completedRun(2, {
      totalScore: 69,
      hardGateTriggered: true,
      risks: [
        {
          key: "risk_code|REQUIREMENT_NOT_IMPLEMENTED",
          level: "high",
          title: "需求未实现",
          risk_code: "REQUIREMENT_NOT_IMPLEMENTED",
        } as never,
      ],
    }),
  ]);

  assert.equal(analysis.scoreStability?.standardDeviation, 0);
  assert.equal(analysis.gateStability?.hardGateConsistencyPercentage, 100);
  assert.equal(analysis.findingStability?.averageRiskJaccard, 1);
});

test("analyzeConsistency conclusion separates stable scores from finding volatility", () => {
  const analysis = analyzeConsistency([
    completedRun(0, {
      totalScore: 69,
      hardGateTriggered: true,
      unsatisfiedRules: [{ ruleId: "RSP-MUST-01", summary: "断点边界不完整" }],
      risks: [{ key: "risk_code|A", riskCode: "A", title: "A" }],
    }),
    completedRun(1, {
      totalScore: 69,
      hardGateTriggered: true,
      unsatisfiedRules: [{ ruleId: "RSP-MUST-02", summary: "硬编码宽度" }],
      risks: [{ key: "risk_code|B", riskCode: "B", title: "B" }],
    }),
    completedRun(2, {
      totalScore: 69,
      hardGateTriggered: true,
      unsatisfiedRules: [{ ruleId: "RSP-MUST-03", summary: "缺少 xl" }],
      risks: [{ key: "risk_code|C", riskCode: "C", title: "C" }],
    }),
  ]);

  assert.equal(analysis.scoreStandardDeviation, 0);
  assert.doesNotMatch(analysis.conclusion, /评分结果波动明显/);
  assert.match(analysis.conclusion, /总分稳定/);
  assert.match(analysis.conclusion, /规则或风险集合存在波动/);
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

test("buildConsistencyTaskRoundOptions includes the current view and each history round", () => {
  const runs = [completedRun(0), completedRun(1, { totalScore: 86 })];
  const history = appendAnalysisHistorySnapshot([], runs, "2026-05-20T01:00:00.000Z");

  assert.deepEqual(
    buildConsistencyTaskRoundOptions({
      id: "C-001",
      sequence: 1,
      serviceBaseUrl: "http://localhost:3000",
      originalTaskId: 1306,
      caseId: 63,
      caseName: "点餐元服务模板新增安装预加载功能",
      createdAt: "2026-05-20T00:00:00.000Z",
      status: "completed",
      runs,
      analysisHistory: history,
    }).map((item) => item.value),
    ["current", "2026-05-20T01:00:00.000Z"],
  );
});

test("selectConsistencyTaskRoundSnapshot returns a historical round view", () => {
  const firstRuns = [completedRun(0), completedRun(1, { totalScore: 86 })];
  const firstHistory = appendAnalysisHistorySnapshot([], firstRuns, "2026-05-20T01:00:00.000Z");
  const secondRuns = [completedRun(0, { totalScore: 70 }), completedRun(1, { totalScore: 74 })];
  const history = appendAnalysisHistorySnapshot(firstHistory, secondRuns, "2026-05-20T02:00:00.000Z");

  const selected = selectConsistencyTaskRoundSnapshot(
    {
      id: "C-001",
      sequence: 1,
      serviceBaseUrl: "http://localhost:3000",
      originalTaskId: 1306,
      caseId: 63,
      caseName: "点餐元服务模板新增安装预加载功能",
      createdAt: "2026-05-20T00:00:00.000Z",
      status: "completed",
      runs: secondRuns,
      analysis: analyzeConsistency(secondRuns),
      ruleReport: buildRuleReport(secondRuns),
      riskReport: buildRiskReport(secondRuns),
      analysisHistory: history,
    },
    "2026-05-20T01:00:00.000Z",
  );

  assert.equal(selected.analysis?.averageScore, 84);
  assert.deepEqual(selected.runs.map((run) => run.taskId), [130600101, 130600102]);
});

test("removeConsistencyAnalysisHistoryRound removes the latest current round and rolls back current data", () => {
  const firstRuns = [completedRun(0), completedRun(1, { totalScore: 86 })];
  const firstHistory = appendAnalysisHistorySnapshot([], firstRuns, "2026-05-20T01:00:00.000Z");
  const secondRuns = [completedRun(0, { totalScore: 70 }), completedRun(1, { totalScore: 74 })];
  const history = appendAnalysisHistorySnapshot(firstHistory, secondRuns, "2026-05-20T02:00:00.000Z");

  const removed = removeConsistencyAnalysisHistoryRound(
    {
      id: "C-001",
      sequence: 1,
      serviceBaseUrl: "http://localhost:3000",
      originalTaskId: 1306,
      caseId: 63,
      caseName: "点餐元服务模板新增安装预加载功能",
      createdAt: "2026-05-20T00:00:00.000Z",
      status: "completed",
      runs: secondRuns,
      analysis: analyzeConsistency(secondRuns),
      ruleReport: buildRuleReport(secondRuns),
      riskReport: buildRiskReport(secondRuns),
      analysisHistory: history,
    },
    2,
  );

  assert.equal(removed.analysisHistory?.length, 1);
  assert.equal(removed.analysisHistory?.[0]?.round, 1);
  assert.equal(removed.analysis?.averageScore, 84);
  assert.deepEqual(removed.runs.map((run) => run.totalScore), [82, 86]);
});

test("collectExclusiveRoundTaskIds skips ids still referenced by current data or other rounds", () => {
  const firstRuns = [completedRun(0, { taskId: 130600101 }), completedRun(1, { taskId: 130600102 })];
  const sharedRuns = [completedRun(0, { taskId: 130600201 }), completedRun(1, { taskId: 130600202 })];
  const firstHistory = appendAnalysisHistorySnapshot([], firstRuns, "2026-05-20T01:00:00.000Z");
  const history = appendAnalysisHistorySnapshot(firstHistory, sharedRuns, "2026-05-20T02:00:00.000Z");

  const exclusiveIds = collectExclusiveRoundTaskIds(
    {
      id: "C-001",
      sequence: 1,
      serviceBaseUrl: "http://localhost:3000",
      originalTaskId: 1306,
      caseId: 63,
      caseName: "点餐元服务模板新增安装预加载功能",
      createdAt: "2026-05-20T00:00:00.000Z",
      status: "completed",
      runs: sharedRuns,
      analysis: analyzeConsistency(sharedRuns),
      ruleReport: buildRuleReport(sharedRuns),
      riskReport: buildRiskReport(sharedRuns),
      analysisHistory: history,
    },
    2,
  );

  assert.deepEqual(exclusiveIds, []);
});

test("removeConsistencyAnalysisHistoryRound removes an earlier history round without changing current data", () => {
  const firstRuns = [completedRun(0), completedRun(1, { totalScore: 86 })];
  const firstHistory = appendAnalysisHistorySnapshot([], firstRuns, "2026-05-20T01:00:00.000Z");
  const secondRuns = [completedRun(0, { totalScore: 70 }), completedRun(1, { totalScore: 74 })];
  const history = appendAnalysisHistorySnapshot(firstHistory, secondRuns, "2026-05-20T02:00:00.000Z");

  const removed = removeConsistencyAnalysisHistoryRound(
    {
      id: "C-001",
      sequence: 1,
      serviceBaseUrl: "http://localhost:3000",
      originalTaskId: 1306,
      caseId: 63,
      caseName: "点餐元服务模板新增安装预加载功能",
      createdAt: "2026-05-20T00:00:00.000Z",
      status: "completed",
      runs: secondRuns,
      analysis: analyzeConsistency(secondRuns),
      ruleReport: buildRuleReport(secondRuns),
      riskReport: buildRiskReport(secondRuns),
      analysisHistory: history,
    },
    1,
  );

  assert.equal(removed.analysisHistory?.length, 1);
  assert.equal(removed.analysisHistory?.[0]?.round, 1);
  assert.equal(removed.analysis?.averageScore, 72);
  assert.deepEqual(removed.runs.map((run) => run.totalScore), [70, 74]);
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
  assert.equal(text.includes("PK\u0005\u0006"), true);
});

test("createStoredZip writes large result files without exceeding the call stack", () => {
  const largeResult = JSON.stringify({
    overall_conclusion: { total_score: 82 },
    details: "x".repeat(200_000),
  });

  const archive = createStoredZip(new Map([["rounds/round-001/run-01.json", largeResult]]));
  const text = new TextDecoder().decode(archive);

  assert.match(text, /rounds\/round-001\/run-01\.json/);
  assert.match(text, /overall_conclusion/);
  assert.equal(text.includes("PK\u0005\u0006"), true);
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
        averagePreScore: 88,
        medianScore: 82,
        minScore: 80,
        maxScore: 84,
        scoreStandardDeviation: 1.2,
        averageRuleUnsatisfactionRatio: 0.125,
        averageRiskCount: 2,
        findingStability: {
          averageRuleJaccard: 0.8754,
          averageRiskJaccard: 0.625,
        },
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
      averagePreScore: 88,
      scoreStandardDeviation: 1.2,
      ruleUnsatisfactionPercentage: 12.5,
      averageRiskCount: 2,
      ruleJaccardPercentage: 87.54,
      riskJaccardPercentage: 62.5,
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

test("buildConsistencyTaskPersistRecord keeps valid sourceTask for refresh saves", () => {
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
  assert.equal("sourceTask" in refreshPayload, true);
  assert.equal("sourceTask" in createPayload, true);
});

test("buildConsistencyTaskPersistDelta includes only changed runs and appended history", () => {
  const previous = {
    id: "C-001",
    sequence: 1,
    serviceBaseUrl: "http://localhost:3000",
    originalTaskId: 1263,
    caseId: 229,
    caseName: "电视台元服务完成一多适配",
    createdAt: "2026-05-19T11:30:45.183Z",
    status: "running",
    sourceTask: JSON.parse(remoteTaskJson),
    runs: [
      { runIndex: 0, taskId: 126300101, status: "running", unsatisfiedRules: [], risks: [] },
      { runIndex: 1, taskId: 126300102, status: "queued", unsatisfiedRules: [], risks: [] },
    ],
    analysisHistory: [
      {
        round: 1,
        capturedAt: "2026-05-19T11:30:45.183Z",
        summary: analyzeConsistency([completedRun(0)]),
        ruleReport: buildRuleReport([completedRun(0)]),
        riskReport: buildRiskReport([completedRun(0)]),
        runs: [completedRun(0)],
      },
    ],
  };
  const nextHistory = {
    round: 2,
    capturedAt: "2026-05-19T11:40:45.183Z",
    summary: analyzeConsistency([completedRun(0), completedRun(1)]),
    ruleReport: buildRuleReport([completedRun(0), completedRun(1)]),
    riskReport: buildRiskReport([completedRun(0), completedRun(1)]),
    runs: [completedRun(0), completedRun(1)],
  };
  const next = {
    ...previous,
    status: "completed",
    runs: [
      {
        runIndex: 0,
        taskId: 126300101,
        status: "completed",
        totalScore: 86,
        unsatisfiedRules: [{ ruleId: "REQ-MUST-01", summary: "已完成" }],
        risks: [],
      },
      previous.runs[1],
    ],
    analysisHistory: [...previous.analysisHistory, nextHistory],
  };

  const delta = buildConsistencyTaskPersistDelta(previous, next);

  assert.deepEqual(Object.keys(delta).sort(), ["analysisHistory", "runs", "status"]);
  assert.equal(delta.runs?.length, 1);
  assert.equal(delta.runs?.[0]?.taskId, 126300101);
  assert.deepEqual(delta.analysisHistory, [nextHistory]);
  assert.equal("sourceTask" in delta, false);
});

test("buildConsistencyTaskPersistDelta replaces current runs when rerun changes task ids", () => {
  const previousRuns = [
    completedRun(0, { taskId: 126300101 }),
    completedRun(1, { taskId: 126300102, totalScore: 84 }),
  ];
  const previous = {
    id: "C-001",
    sequence: 1,
    serviceBaseUrl: "http://localhost:3000",
    originalTaskId: 1263,
    caseId: 229,
    caseName: "电视台元服务完成一多适配",
    createdAt: "2026-05-19T11:30:45.183Z",
    status: "completed",
    sourceTask: JSON.parse(remoteTaskJson),
    runs: previousRuns,
    analysisHistory: appendAnalysisHistorySnapshot(
      [],
      previousRuns,
      "2026-05-19T11:30:45.183Z",
    ),
  };
  const next = {
    ...previous,
    status: "running",
    runs: [
      { runIndex: 0, taskId: 126300103, status: "pending_submit", unsatisfiedRules: [], risks: [] },
      { runIndex: 1, taskId: 126300104, status: "pending_submit", unsatisfiedRules: [], risks: [] },
    ],
  };

  const delta = buildConsistencyTaskPersistDelta(previous, next);

  assert.equal(delta.replaceRuns, true);
  assert.deepEqual(
    delta.runs?.map((run) => run.taskId),
    [126300103, 126300104],
  );
});

test("hydrateConsistencyTaskSnapshot compacts duplicated current runs from old rerun patches", () => {
  const firstRoundRuns = [
    completedRun(0, { taskId: 126300101, totalScore: 80 }),
    completedRun(1, { taskId: 126300102, totalScore: 82 }),
  ];
  const secondRoundRuns = [
    completedRun(0, { taskId: 126300103, totalScore: 90 }),
    completedRun(1, { taskId: 126300104, totalScore: 92 }),
  ];
  const hydrated = hydrateConsistencyTaskSnapshot({
    id: "C-001",
    sequence: 1,
    serviceBaseUrl: "http://localhost:3000",
    originalTaskId: 1263,
    caseId: 229,
    caseName: "电视台元服务完成一多适配",
    createdAt: "2026-05-19T11:30:45.183Z",
    status: "completed",
    sourceTask: JSON.parse(remoteTaskJson),
    runs: [...firstRoundRuns, ...secondRoundRuns],
    analysisHistory: [
      {
        round: 1,
        capturedAt: "2026-05-19T11:30:45.183Z",
        summary: analyzeConsistency(firstRoundRuns),
        ruleReport: buildRuleReport(firstRoundRuns),
        riskReport: buildRiskReport(firstRoundRuns),
        runs: firstRoundRuns,
      },
    ],
  });

  assert.deepEqual(
    hydrated.runs.map((run) => run.taskId),
    [126300103, 126300104],
  );
  assert.equal(hydrated.analysis?.completedRuns, 2);
  assert.equal(hydrated.analysis?.averageScore, 91);
});

test("validateRemoteEvaluationTaskInput rejects fallback sourceTask without original payload", () => {
  const hydrated = hydrateConsistencyTaskSnapshot({
    id: "C-001",
    sequence: 1,
    serviceBaseUrl: "http://localhost:3000",
    originalTaskId: 1263,
    caseId: 229,
    caseName: "电视台元服务完成一多适配",
    createdAt: "2026-05-19T11:30:45.183Z",
    status: "completed",
    runs: [completedRun(0)],
  });

  const validation = validateRemoteEvaluationTaskInput(hydrated.sourceTask);
  const refreshPayload = buildConsistencyTaskPersistRecord(hydrated);

  assert.equal(validation.valid, false);
  assert.match(validation.errors.join("\n"), /sourceTask\.testCase\.fileUrl/);
  assert.match(validation.errors.join("\n"), /sourceTask\.executionResult\.outputCodeUrl/);
  assert.equal("sourceTask" in refreshPayload, false);
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
