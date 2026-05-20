# Consistency Analysis Report Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add completed-task JSON export, report rendering, rerun history snapshots, history charts, and remove the summary column from the consistency analysis detail table.

**Architecture:** Keep network and browser-only actions in `ConsistencyAnalysis.vue`, but move all reusable data shaping into pure TypeScript helpers under `web/src/pages/scoreConsistencyAnalysis.ts`. Extract the existing score task report drawer into `web/src/components/CaseReportDrawer.vue` so both the task dashboard and consistency detail page render the same report UI.

**Tech Stack:** Vue 3 `<script setup>`, Element Plus, ECharts via existing `EChartPanel`, TypeScript, Node test runner with `tsx`.

---

## File Map

- `web/src/pages/scoreConsistencyAnalysis.ts`: add `analysisHistory` types and pure helpers for terminal detection, history snapshots, export payloads, and chart rows.
- `tests/score-consistency-analysis.test.ts`: TDD coverage for history snapshots, duplicate prevention, export payloads, and chart data.
- `web/src/components/CaseReportDrawer.vue`: new reusable report drawer component, moved from `TaskDashboard.vue`.
- `web/src/pages/TaskDashboard.vue`: replace inline report drawer markup and formatting helpers with `CaseReportDrawer`.
- `web/src/pages/ConsistencyAnalysis.vue`: add download button, disable it until task terminal, add history chart, remove `主要结论` column, use `CaseReportDrawer` for per-run reports, and append history snapshots during refresh/rerun flows.
- `web/src/styles/base.css`: keep shared report styles here; add only small consistency history chart layout styles if needed.

---

### Task 1: Pure Consistency History And Export Helpers

**Files:**
- Modify: `web/src/pages/scoreConsistencyAnalysis.ts`
- Test: `tests/score-consistency-analysis.test.ts`

- [ ] **Step 1: Write failing tests for history and export helpers**

Add these imports in `tests/score-consistency-analysis.test.ts`:

```ts
import {
  appendAnalysisHistorySnapshot,
  buildConsistencyExportPayload,
  buildConsistencyHistoryChartRows,
  isConsistencyTaskTerminal,
  type ConsistencyAnalysisHistoryItem,
} from "../web/src/pages/scoreConsistencyAnalysis.js";
```

Add these tests after `analyzeConsistency does not count in-progress runs as failed`:

```ts
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
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
node --import tsx --test tests/score-consistency-analysis.test.ts
```

Expected: FAIL because the imported helpers and types do not exist.

- [ ] **Step 3: Implement helper types and functions**

In `web/src/pages/scoreConsistencyAnalysis.ts`, add these exported types after `RiskConsistencyReportItem`:

```ts
export type ConsistencyAnalysisHistoryItem = {
  round: number;
  capturedAt: string;
  summary: ConsistencyAnalysisSummary;
  ruleReport: RuleConsistencyReportItem[];
  riskReport: RiskConsistencyReportItem[];
  runs: ConsistencyRunSummary[];
};

export type ConsistencyExportTask = ConsistencyTaskSnapshot & {
  analysis: ConsistencyAnalysisSummary;
  ruleReport: RuleConsistencyReportItem[];
  riskReport: RiskConsistencyReportItem[];
  analysisHistory: ConsistencyAnalysisHistoryItem[];
};

export type ConsistencyExportPayload = {
  task: {
    id: string;
    originalTaskId: number;
    caseId: number;
    caseName: string;
    createdAt: string;
    status: string;
    serviceBaseUrl: string;
  };
  analysis: {
    summary: ConsistencyAnalysisSummary;
    ruleReport: RuleConsistencyReportItem[];
    riskReport: RiskConsistencyReportItem[];
  };
  analysisHistory: ConsistencyAnalysisHistoryItem[];
  runs: Array<{
    runIndex: number;
    taskId: number;
    status: ConsistencyRunStatus;
    summary: ConsistencyRunSummary;
    resultData?: unknown;
    error?: string;
  }>;
};

export type ConsistencyHistoryChartRow = {
  label: string;
  capturedAt: string;
  completedRuns: number;
  failedRuns: number;
  consistencyPercentage: number | null;
  averageScore: number | null;
  scoreStandardDeviation: number | null;
  ruleUnsatisfactionPercentage: number | null;
  averageRiskCount: number | null;
};
```

Extend `ConsistencyTaskCollectionRecord` with:

```ts
  analysisHistory?: ConsistencyAnalysisHistoryItem[];
```

Add these helper functions near the existing analysis helpers:

```ts
function isTerminalRunStatus(status: ConsistencyRunStatus): boolean {
  return status === "completed" || status === "failed" || status === "timed_out" || status === "missing";
}

function cloneRunSummary(run: ConsistencyRunSummary): ConsistencyRunSummary {
  return {
    ...run,
    unsatisfiedRules: run.unsatisfiedRules.map((rule) => ({ ...rule })),
    risks: run.risks.map((risk) => ({ ...risk })),
  };
}

function runSetKey(runs: ConsistencyRunSummary[]): string {
  return runs.map((run) => `${String(run.runIndex)}:${String(run.taskId)}:${run.status}`).join("|");
}

function errorMessage(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return value instanceof Error ? value.message : String(value);
}

export function isConsistencyTaskTerminal(runs: ConsistencyRunSummary[]): boolean {
  return runs.length > 0 && runs.every((run) => isTerminalRunStatus(run.status));
}

export function appendAnalysisHistorySnapshot(
  history: ConsistencyAnalysisHistoryItem[],
  runs: ConsistencyRunSummary[],
  capturedAt = new Date().toISOString(),
): ConsistencyAnalysisHistoryItem[] {
  if (!isConsistencyTaskTerminal(runs)) {
    return history;
  }
  const currentRunSetKey = runSetKey(runs);
  if (history.some((item) => runSetKey(item.runs) === currentRunSetKey)) {
    return history;
  }
  const runSnapshot = runs.map(cloneRunSummary);
  return [
    ...history,
    {
      round: history.length + 1,
      capturedAt,
      summary: analyzeConsistency(runSnapshot),
      ruleReport: buildRuleReport(runSnapshot),
      riskReport: buildRiskReport(runSnapshot),
      runs: runSnapshot,
    },
  ];
}

export function buildConsistencyExportPayload(
  task: ConsistencyExportTask,
  runResults: Map<number, unknown>,
): ConsistencyExportPayload {
  return {
    task: {
      id: task.id,
      originalTaskId: task.originalTaskId,
      caseId: task.caseId,
      caseName: task.caseName,
      createdAt: task.createdAt,
      status: task.status,
      serviceBaseUrl: task.serviceBaseUrl,
    },
    analysis: {
      summary: task.analysis,
      ruleReport: task.ruleReport,
      riskReport: task.riskReport,
    },
    analysisHistory: task.analysisHistory,
    runs: task.runs.map((run) => {
      const result = runResults.get(run.taskId);
      const error = errorMessage(result);
      return {
        runIndex: run.runIndex,
        taskId: run.taskId,
        status: run.status,
        summary: cloneRunSummary(run),
        ...(error ? { error } : { resultData: result }),
      };
    }),
  };
}

export function buildConsistencyHistoryChartRows(
  history: ConsistencyAnalysisHistoryItem[],
): ConsistencyHistoryChartRow[] {
  return history.map((item) => ({
    label: `第 ${String(item.round)} 轮`,
    capturedAt: item.capturedAt,
    completedRuns: item.summary.completedRuns,
    failedRuns: item.summary.failedRuns,
    consistencyPercentage: item.summary.consistencyPercentage,
    averageScore: item.summary.averageScore,
    scoreStandardDeviation: item.summary.scoreStandardDeviation,
    ruleUnsatisfactionPercentage:
      item.summary.averageRuleUnsatisfactionRatio === null
        ? null
        : roundNumber(item.summary.averageRuleUnsatisfactionRatio * 100, 2),
    averageRiskCount: item.summary.averageRiskCount,
  }));
}
```

Update `hydrateConsistencyTaskSnapshot()` so returned snapshots include:

```ts
analysisHistory: record.analysisHistory ?? [],
```

Update `compactConsistencyTaskSnapshots()` so it preserves `analysisHistory` as part of `record`.

- [ ] **Step 4: Run tests to verify GREEN**

Run:

```bash
node --import tsx --test tests/score-consistency-analysis.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 1**

Run:

```bash
git add web/src/pages/scoreConsistencyAnalysis.ts tests/score-consistency-analysis.test.ts
git commit -m "feat: add consistency history export helpers"
```

---

### Task 2: Extract Reusable Case Report Drawer

**Files:**
- Create: `web/src/components/CaseReportDrawer.vue`
- Modify: `web/src/pages/TaskDashboard.vue`

- [ ] **Step 1: Create the reusable drawer component**

Create `web/src/components/CaseReportDrawer.vue` with the full report drawer template currently embedded in `TaskDashboard.vue`. The component must accept:

```ts
const visible = defineModel<boolean>({ default: false });
const props = defineProps<{
  title: string;
  loading: boolean;
  error: string;
  report: CaseReportViewModel | null;
  taskId?: number;
  testCaseId?: number;
  taskName?: string;
}>();

defineEmits<{
  refresh: [];
}>();
```

Move these helper functions from `TaskDashboard.vue` into the component:

```ts
formatReportValue
formatHardGate
formatScorePair
formatReportDate
dimensionScorePercent
scoreToneClass
hardGateClass
```

Use `formatDashboardDateTime` and `type CaseReportViewModel` imports:

```ts
import { Refresh } from "@element-plus/icons-vue";
import { formatDashboardDateTime } from "../dateTime";
import type { CaseReportViewModel } from "../pages/caseReportViewModel";
```

Keep the same report markup, replacing `reportDrawerVisible`, `reportDrawerTitle`, `reportLoading`, `reportError`, `caseReport`, and `reportTask` references with component props and `visible`.

- [ ] **Step 2: Update `TaskDashboard.vue` to use the component**

In `web/src/pages/TaskDashboard.vue`:

- Replace the existing report `<el-drawer ...>` block with:

```vue
<CaseReportDrawer
  v-model="reportDrawerVisible"
  :title="reportDrawerTitle"
  :loading="reportLoading"
  :error="reportError"
  :report="caseReport"
  :task-id="reportTask?.taskId"
  :test-case-id="reportTask?.testCaseId"
  :task-name="reportTask?.name"
  @refresh="reloadCaseReport"
/>
```

- Add import:

```ts
import CaseReportDrawer from "../components/CaseReportDrawer.vue";
```

- Delete the report formatting helper functions that moved into `CaseReportDrawer.vue`.

- [ ] **Step 3: Run build to verify extraction**

Run:

```bash
npm --prefix web run build
```

Expected: PASS. Existing Rollup pure-comment and chunk-size warnings are acceptable.

- [ ] **Step 4: Commit Task 2**

Run:

```bash
git add web/src/components/CaseReportDrawer.vue web/src/pages/TaskDashboard.vue
git commit -m "refactor: extract case report drawer"
```

---

### Task 3: Wire Consistency Detail Download, Report Drawer, History Chart, And Table Cleanup

**Files:**
- Modify: `web/src/pages/ConsistencyAnalysis.vue`
- Modify: `web/src/styles/base.css`

- [ ] **Step 1: Update imports and state**

In `web/src/pages/ConsistencyAnalysis.vue`, add imports:

```ts
import type { EChartsOption } from "echarts";
import { Download } from "@element-plus/icons-vue";
import CaseReportDrawer from "../components/CaseReportDrawer.vue";
import EChartPanel from "../components/EChartPanel.vue";
import { buildCaseReportViewModel, type CaseReportViewModel } from "./caseReportViewModel";
```

Extend the `scoreConsistencyAnalysis` import list with:

```ts
appendAnalysisHistorySnapshot,
buildConsistencyExportPayload,
buildConsistencyHistoryChartRows,
isConsistencyTaskTerminal,
type ConsistencyAnalysisHistoryItem,
```

Update `ConsistencyTask` type:

```ts
  analysisHistory: ConsistencyAnalysisHistoryItem[];
```

Replace raw drawer state:

```ts
const rawDrawerVisible = ref(false);
const rawDrawerContent = ref("");
```

with report/download state:

```ts
const reportDrawerVisible = ref(false);
const reportLoading = ref(false);
const reportError = ref("");
const reportRun = ref<ConsistencyRunSummary | null>(null);
const reportCase = ref<CaseReportViewModel | null>(null);
const downloadingResults = ref(false);
```

- [ ] **Step 2: Update detail template**

In the detail header toolbar, add the download button before refresh:

```vue
<el-button
  :icon="Download"
  :loading="downloadingResults"
  :disabled="!selectedTaskDownloadable"
  @click="downloadSelectedTaskResults"
>
  下载 10 条 JSON
</el-button>
```

After the metrics grid, add:

```vue
<div class="consistency-history-grid">
  <EChartPanel
    title="多轮一致性趋势"
    :option="historyConsistencyOption"
    :empty="historyChartRows.length === 0"
  />
  <EChartPanel
    title="多轮质量指标"
    :option="historyQualityOption"
    :empty="historyChartRows.length === 0"
  />
</div>
```

In the runs table:

- Delete the `<el-table-column prop="summary" label="主要结论" ... />` column.
- Change the operation button to:

```vue
<el-button link type="primary" @click="openRunReport(row)">查看报告</el-button>
```

At the bottom of the detail template, replace the raw drawer with:

```vue
<CaseReportDrawer
  v-model="reportDrawerVisible"
  :title="reportDrawerTitle"
  :loading="reportLoading"
  :error="reportError"
  :report="reportCase"
  :task-id="reportRun?.taskId"
  :test-case-id="selectedTask?.caseId"
  :task-name="selectedTask?.caseName"
  @refresh="reloadRunReport"
/>
```

- [ ] **Step 3: Add computed values and helpers**

Add computed values:

```ts
const selectedTaskDownloadable = computed(() => {
  return selectedTask.value ? isConsistencyTaskTerminal(selectedTask.value.runs) : false;
});

const historyChartRows = computed(() =>
  selectedTask.value ? buildConsistencyHistoryChartRows(selectedTask.value.analysisHistory) : [],
);

const historyConsistencyOption = computed<EChartsOption>(() => ({
  tooltip: {
    trigger: "axis",
    formatter: (params) => formatHistoryTooltip(params),
  },
  legend: { top: 0 },
  grid: { top: 44, left: 42, right: 18, bottom: 36 },
  xAxis: { type: "category", data: historyChartRows.value.map((item) => item.label) },
  yAxis: { type: "value", min: 0, max: 100 },
  series: [
    {
      type: "line",
      name: "一致性",
      data: historyChartRows.value.map((item) => item.consistencyPercentage),
      smooth: true,
    },
    {
      type: "line",
      name: "规则不满足度",
      data: historyChartRows.value.map((item) => item.ruleUnsatisfactionPercentage),
      smooth: true,
    },
  ],
}));

const historyQualityOption = computed<EChartsOption>(() => ({
  tooltip: {
    trigger: "axis",
    formatter: (params) => formatHistoryTooltip(params),
  },
  legend: { top: 0 },
  grid: { top: 44, left: 42, right: 18, bottom: 36 },
  xAxis: { type: "category", data: historyChartRows.value.map((item) => item.label) },
  yAxis: { type: "value" },
  series: [
    {
      type: "line",
      name: "平均分",
      data: historyChartRows.value.map((item) => item.averageScore),
      smooth: true,
    },
    {
      type: "line",
      name: "标准差",
      data: historyChartRows.value.map((item) => item.scoreStandardDeviation),
      smooth: true,
    },
    {
      type: "bar",
      name: "平均风险数",
      data: historyChartRows.value.map((item) => item.averageRiskCount),
    },
  ],
}));

const reportDrawerTitle = computed(() => {
  if (!reportRun.value || !selectedTask.value) {
    return "用例报告";
  }
  return `#${String(reportRun.value.taskId)} ${selectedTask.value.caseName}`;
});
```

Add helper functions:

```ts
function formatHistoryTooltip(params: unknown): string {
  const rows = Array.isArray(params) ? params : [params];
  const first = rows[0] as { dataIndex?: number; axisValueLabel?: string } | undefined;
  const row =
    typeof first?.dataIndex === "number" ? historyChartRows.value[first.dataIndex] : undefined;
  const lines = [
    first?.axisValueLabel ?? row?.label ?? "",
    row ? `捕获时间：${formatDateTime(row.capturedAt)}` : "",
    row ? `完成/失败：${String(row.completedRuns)}/${String(row.failedRuns)}` : "",
    ...rows.map((item) => {
      const point = item as { marker?: string; seriesName?: string; value?: unknown };
      return `${point.marker ?? ""}${point.seriesName ?? ""}: ${formatNullableNumber(
        typeof point.value === "number" ? point.value : null,
      )}`;
    }),
  ];
  return lines.filter(Boolean).join("<br/>");
}

function refreshTaskHistorySnapshot(task: ConsistencyTask) {
  const nextHistory = appendAnalysisHistorySnapshot(task.analysisHistory, task.runs);
  if (nextHistory !== task.analysisHistory) {
    task.analysisHistory = nextHistory;
  }
}

async function ensureRunResult(task: ConsistencyTask, run: ConsistencyRunSummary): Promise<unknown> {
  if (!rawResults.has(run.taskId)) {
    const response = await fetchRemoteScoreResult(task.serviceBaseUrl, run.taskId);
    rawResults.set(run.taskId, response.resultData);
  }
  return rawResults.get(run.taskId);
}

async function openRunReport(run: ConsistencyRunSummary) {
  const task = selectedTask.value;
  if (!task) {
    return;
  }
  reportRun.value = run;
  reportDrawerVisible.value = true;
  await reloadRunReport();
}

async function reloadRunReport() {
  const task = selectedTask.value;
  const run = reportRun.value;
  if (!task || !run) {
    return;
  }
  reportLoading.value = true;
  reportError.value = "";
  try {
    const result = await ensureRunResult(task, run);
    reportCase.value = buildCaseReportViewModel(result);
  } catch (error) {
    reportCase.value = null;
    reportError.value = error instanceof Error ? error.message : String(error);
  } finally {
    reportLoading.value = false;
  }
}

function triggerJsonDownload(filename: string, payload: unknown) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function downloadSelectedTaskResults() {
  const task = selectedTask.value;
  if (!task || !isConsistencyTaskTerminal(task.runs)) {
    ElMessage.warning("一致性任务结束运行后才能下载");
    return;
  }
  downloadingResults.value = true;
  try {
    const results = new Map<number, unknown>();
    for (const run of task.runs) {
      try {
        results.set(run.taskId, await ensureRunResult(task, run));
      } catch (error) {
        results.set(run.taskId, error);
      }
    }
    const payload = buildConsistencyExportPayload(task, results);
    triggerJsonDownload(`consistency-${task.id}-results.json`, payload);
    const successCount = [...results.values()].filter((value) => !(value instanceof Error)).length;
    if (successCount === 0) {
      ElMessage.warning("未下载到运行原始结果，已导出分析结果和错误信息");
    } else if (successCount < task.runs.length) {
      ElMessage.warning("部分运行结果不可用，已导出可用结果和错误信息");
    } else {
      ElMessage.success("一致性任务结果已下载");
    }
  } finally {
    downloadingResults.value = false;
  }
}
```

- [ ] **Step 4: Update refresh and rerun flows**

In `refreshTaskAggregates(task)`, after status calculation and before `queuePersistTask(task)`, call:

```ts
  refreshTaskHistorySnapshot(task);
```

In `createTask()`, set:

```ts
      analysisHistory: [],
```

In `rerunTask(taskId)`, before clearing current run fields, call:

```ts
  refreshTaskHistorySnapshot(task);
```

Then clear current report state after `rawResults.clear()`:

```ts
  reportRun.value = null;
  reportCase.value = null;
  reportError.value = "";
```

Delete the old `openRawResult()` function.

- [ ] **Step 5: Add small layout CSS**

In `web/src/styles/base.css`, add:

```css
.consistency-history-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}
```

Inside the existing mobile media query, add:

```css
  .consistency-history-grid {
    grid-template-columns: 1fr;
  }
```

- [ ] **Step 6: Run build**

Run:

```bash
npm --prefix web run build
```

Expected: PASS. Existing Rollup pure-comment and chunk-size warnings are acceptable.

- [ ] **Step 7: Commit Task 3**

Run:

```bash
git add web/src/pages/ConsistencyAnalysis.vue web/src/styles/base.css
git commit -m "feat: add consistency report export UI"
```

---

### Task 4: Final Verification

**Files:**
- No new files.

- [ ] **Step 1: Run focused consistency tests**

Run:

```bash
node --import tsx --test tests/score-consistency-analysis.test.ts tests/case-report-view-model.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run full test suite**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 3: Run web build**

Run:

```bash
npm --prefix web run build
```

Expected: PASS. Existing Rollup pure-comment and chunk-size warnings are acceptable.

- [ ] **Step 4: Inspect final diff**

Run:

```bash
git status --short
git diff --stat main...HEAD
```

Expected: only planned files changed and no uncommitted changes except build artifacts if the build produced ignored `web/dist`.
