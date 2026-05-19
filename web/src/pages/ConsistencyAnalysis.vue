<template>
  <div v-if="!isDetailPage" class="page-stack">
    <div class="consistency-header table-card">
      <div>
        <h2>评分一致性任务</h2>
        <p>通过同一份远端任务 JSON 连续执行 10 次评分，比较 AI 评分结果稳定性。</p>
      </div>
      <el-button type="primary" :icon="Plus" @click="openCreateDrawer">创建一致性任务</el-button>
    </div>

    <div class="metrics-grid">
      <MetricCard label="总任务数" :value="tasks.length" />
      <MetricCard label="运行中任务" :value="runningTaskCount" />
      <MetricCard label="已完成任务" :value="completedTaskCount" />
      <MetricCard label="平均一致性" :value="averageConsistencyText" />
    </div>

    <div class="table-card" v-loading="loadingTasks">
      <el-table :data="pagedTasks" stripe height="360" highlight-current-row>
        <el-table-column prop="id" label="任务ID" width="110" />
        <el-table-column prop="originalTaskId" label="原始taskId" width="120" />
        <el-table-column prop="caseName" label="用例名称" min-width="240" show-overflow-tooltip />
        <el-table-column label="进度" width="120">
          <template #default="{ row }">
            {{ completedRunCount(row) }}/{{ row.runs.length }}
          </template>
        </el-table-column>
        <el-table-column label="一致性" width="110">
          <template #default="{ row }">
            {{ formatPercent(row.analysis.consistencyPercentage) }}
          </template>
        </el-table-column>
        <el-table-column label="状态" width="130">
          <template #default="{ row }">
            <el-tag size="small" effect="plain" :type="taskStatusTagType(row.status)">
              {{ formatTaskStatus(row.status) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="创建时间" min-width="170">
          <template #default="{ row }">
            {{ formatDateTime(row.createdAt) }}
          </template>
        </el-table-column>
        <el-table-column label="操作" width="220" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" :loading="refreshingTaskId === row.id" @click="refreshTaskStatus(row)">
              刷新状态
            </el-button>
            <el-button link type="primary" @click="openTaskDetail(row.id)">详情</el-button>
            <el-button link type="primary" @click="rerunTask(row.id)">重新运行</el-button>
          </template>
        </el-table-column>
      </el-table>

      <div class="table-pagination">
        <el-pagination
          v-model:current-page="page"
          v-model:page-size="pageSize"
          :total="tasks.length"
          :page-sizes="[10, 20, 50]"
          layout="total, sizes, prev, pager, next"
          background
        />
      </div>
    </div>

    <el-drawer v-model="createDrawerVisible" size="46%" title="创建一致性任务">
      <div class="page-stack">
        <el-form label-position="top">
          <el-form-item label="评分服务地址">
            <el-input v-model="serviceBaseUrl" />
          </el-form-item>
          <el-form-item label="运行次数">
            <el-input-number :model-value="10" disabled />
          </el-form-item>
          <el-form-item label="远端任务 JSON">
            <el-input
              v-model="jsonInput"
              type="textarea"
              :rows="18"
              resize="vertical"
              placeholder='{"taskId": 1306, "testCase": {...}, "executionResult": {...}}'
            />
          </el-form-item>
        </el-form>

        <el-alert
          v-if="validationErrors.length > 0"
          type="error"
          :closable="false"
          show-icon
          title="JSON 校验失败"
        >
          <ul class="consistency-error-list">
            <li v-for="error in validationErrors" :key="error">{{ error }}</li>
          </ul>
        </el-alert>
        <el-alert
          v-else-if="taskIdPreview"
          type="info"
          :closable="false"
          show-icon
          :title="taskIdPreview"
        />

        <div class="drawer-actions">
          <el-button @click="createDrawerVisible = false">取消</el-button>
          <el-button type="primary" :loading="creating" @click="createTask">创建一致性任务</el-button>
        </div>
      </div>
    </el-drawer>
  </div>

  <div v-else class="page-stack">
    <template v-if="selectedTask">
      <div class="table-card consistency-detail-header">
        <div class="detail-title">
          <el-button class="detail-back-button" :icon="ArrowLeft" circle text @click="backToTaskList" />
          <div>
            <h2>{{ selectedTask.id }} / {{ selectedTask.caseName }}</h2>
            <p>{{ selectedTask.analysis.conclusion }}</p>
          </div>
        </div>
        <div class="toolbar">
          <el-button :icon="Refresh" :loading="refreshingTaskId === selectedTask.id" @click="refreshTaskStatus(selectedTask)">
            刷新状态
          </el-button>
          <el-button :icon="Refresh" @click="rerunTask(selectedTask.id)">重新运行</el-button>
        </div>
      </div>

      <div class="metrics-grid">
        <MetricCard label="完成数" :value="`${selectedTask.analysis.completedRuns}/10`" />
        <MetricCard label="失败数" :value="selectedTask.analysis.failedRuns" />
        <MetricCard label="平均分" :value="formatNullableNumber(selectedTask.analysis.averageScore)" />
        <MetricCard
          label="标准差"
          :value="formatNullableNumber(selectedTask.analysis.scoreStandardDeviation)"
        />
        <MetricCard
          label="规则不满足度"
          :value="formatRatioPercent(selectedTask.analysis.averageRuleUnsatisfactionRatio)"
        />
        <MetricCard label="一致性" :value="formatPercent(selectedTask.analysis.consistencyPercentage)" />
      </div>

      <div class="table-card">
        <el-tabs v-model="detailTab">
          <el-tab-pane label="运行对比" name="runs">
            <el-table :data="selectedTask.runs" stripe height="420">
              <el-table-column label="运行" width="80">
                <template #default="{ row }">{{ row.runIndex + 1 }}</template>
              </el-table-column>
              <el-table-column prop="taskId" label="taskId" width="120" />
              <el-table-column label="状态" width="130">
                <template #default="{ row }">
                  <el-tag size="small" effect="plain" :type="runStatusTagType(row.status)">
                    {{ formatRunStatus(row.status) }}
                  </el-tag>
                </template>
              </el-table-column>
              <el-table-column label="总分" width="90">
                <template #default="{ row }">{{ formatNullableNumber(row.totalScore) }}</template>
              </el-table-column>
              <el-table-column label="分差" width="90">
                <template #default="{ row }">{{ formatScoreDelta(row) }}</template>
              </el-table-column>
              <el-table-column label="硬门槛" width="90">
                <template #default="{ row }">{{ formatHardGate(row.hardGateTriggered) }}</template>
              </el-table-column>
              <el-table-column label="规则不满足" width="120">
                <template #default="{ row }">
                  {{ formatRatioPercent(row.ruleUnsatisfactionRatio) }}
                </template>
              </el-table-column>
              <el-table-column label="风险" width="80">
                <template #default="{ row }">{{ row.risks.length }}</template>
              </el-table-column>
              <el-table-column label="一致性" width="90">
                <template #default="{ row }">
                  {{ formatRunConsistency(selectedTask, row) }}
                </template>
              </el-table-column>
              <el-table-column prop="summary" label="主要结论" min-width="260" show-overflow-tooltip />
              <el-table-column label="操作" width="120" fixed="right">
                <template #default="{ row }">
                  <el-button link type="primary" @click="openRawResult(row.taskId)">原始结果</el-button>
                </template>
              </el-table-column>
            </el-table>
          </el-tab-pane>

          <el-tab-pane label="规则不满足报表" name="rules">
            <el-table :data="selectedTask.ruleReport" stripe height="420">
              <el-table-column prop="ruleId" label="规则ID" width="160" />
              <el-table-column prop="summary" label="摘要" min-width="260" show-overflow-tooltip />
              <el-table-column prop="unsatisfiedCount" label="不满足次数" width="120" />
              <el-table-column label="不满足率" width="110">
                <template #default="{ row }">{{ row.unsatisfiedRate }}%</template>
              </el-table-column>
              <el-table-column prop="runIndexes" label="运行序号" min-width="140">
                <template #default="{ row }">{{ row.runIndexes.join(", ") }}</template>
              </el-table-column>
              <el-table-column prop="stability" label="稳定性" width="130" />
            </el-table>
          </el-tab-pane>

          <el-tab-pane label="风险项报表" name="risks">
            <el-table :data="selectedTask.riskReport" stripe height="420">
              <el-table-column prop="level" label="等级" width="90" />
              <el-table-column prop="title" label="风险标题" min-width="260" show-overflow-tooltip />
              <el-table-column prop="appearanceCount" label="出现次数" width="110" />
              <el-table-column label="出现率" width="100">
                <template #default="{ row }">{{ row.appearanceRate }}%</template>
              </el-table-column>
              <el-table-column label="运行序号" min-width="140">
                <template #default="{ row }">{{ row.runIndexes.join(", ") }}</template>
              </el-table-column>
              <el-table-column prop="stability" label="稳定性" width="120" />
            </el-table>
          </el-tab-pane>
        </el-tabs>
      </div>
    </template>
    <el-empty v-else description="未找到一致性任务">
      <el-button type="primary" @click="backToTaskList">返回列表</el-button>
    </el-empty>

    <el-drawer v-model="rawDrawerVisible" size="52%" title="原始结果">
      <pre class="log-content">{{ rawDrawerContent }}</pre>
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import { ArrowLeft, Plus, Refresh } from "@element-plus/icons-vue";
import { useRoute, useRouter } from "vue-router";
import MetricCard from "../components/MetricCard.vue";
import {
  fetchConsistencyTasks,
  fetchRemoteScoreResult,
  fetchRemoteTaskStatuses,
  normalizeServiceBaseUrl,
  saveConsistencyTask,
  submitRemoteScoreTask,
  type RemoteTaskRegistryStatus,
} from "../api/scoreConsistency";
import {
  analyzeConsistency,
  buildConsistencyTaskPersistRecord,
  buildRiskReport,
  buildRuleReport,
  extractConsistencyRunSummary,
  generateSubmittedTaskIds,
  hydrateConsistencyTaskSnapshot,
  validateRemoteTaskJson,
  type ConsistencyTaskCollectionRecord,
  type ConsistencyAnalysisSummary,
  type ConsistencyRiskSummary,
  type ConsistencyRunStatus,
  type ConsistencyRunSummary,
  type RemoteEvaluationTaskInput,
  type RiskConsistencyReportItem,
  type RuleConsistencyReportItem,
} from "./scoreConsistencyAnalysis";

type ConsistencyTaskStatus = "running" | "completed" | "partial_failed" | "failed";

type ConsistencyTask = {
  id: string;
  sequence: number;
  serviceBaseUrl: string;
  originalTaskId: number;
  caseId: number;
  caseName: string;
  createdAt: string;
  status: ConsistencyTaskStatus;
  sourceTask: RemoteEvaluationTaskInput;
  runs: ConsistencyRunSummary[];
  analysis: ConsistencyAnalysisSummary;
  ruleReport: RuleConsistencyReportItem[];
  riskReport: RiskConsistencyReportItem[];
};

const RUN_COUNT = 10;
const DEFAULT_SERVICE_BASE_URL = "http://8.136.155.63:3000";
const MAX_RESUBMIT_ATTEMPTS = 1;

const tasks = ref<ConsistencyTask[]>([]);
const selectedTaskId = ref("");
const page = ref(1);
const pageSize = ref(10);
const detailTab = ref("runs");
const createDrawerVisible = ref(false);
const rawDrawerVisible = ref(false);
const rawDrawerContent = ref("");
const serviceBaseUrl = ref(DEFAULT_SERVICE_BASE_URL);
const jsonInput = ref("");
const validationErrors = ref<string[]>([]);
const creating = ref(false);
const loadingTasks = ref(false);
const refreshingTaskId = ref("");
const rawResults = new Map<number, unknown>();
const pendingPersistTaskIds = new Set<string>();
let taskSequence = 0;
let persistTimer: number | undefined;
let persistChain: Promise<void> = Promise.resolve();
const route = useRoute();
const router = useRouter();

const routeTaskId = computed(() => {
  const value = route.params.taskId;
  return typeof value === "string" ? value : "";
});
const isDetailPage = computed(() => route.path.startsWith("/consistency/"));
const selectedTask = computed(() => {
  const id = routeTaskId.value || selectedTaskId.value;
  return tasks.value.find((task) => task.id === id);
});
const pagedTasks = computed(() => {
  const start = (page.value - 1) * pageSize.value;
  return tasks.value.slice(start, start + pageSize.value);
});
const runningTaskCount = computed(
  () => tasks.value.filter((task) => task.status === "running").length,
);
const completedTaskCount = computed(
  () => tasks.value.filter((task) => task.status === "completed").length,
);
const averageConsistencyText = computed(() => {
  const values = tasks.value
    .map((task) => task.analysis.consistencyPercentage)
    .filter((value): value is number => typeof value === "number");
  if (values.length === 0) {
    return "-";
  }
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  return `${Math.round(average)}%`;
});
const taskIdPreview = computed(() => {
  const validation = validateRemoteTaskJson(jsonInput.value);
  if (!validation.valid) {
    return "";
  }
  try {
    const ids = generateSubmittedTaskIds(validation.task.taskId, taskSequence + 1, RUN_COUNT);
    return `taskId 将派生为 ${String(ids[0])} - ${String(ids.at(-1))}，callback 将以空字符串提交。`;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
});

function buildPersistPayload(task: ConsistencyTask, includeSourceTask = false) {
  return buildConsistencyTaskPersistRecord(task, includeSourceTask);
}

function persistTaskNow(task: ConsistencyTask, includeSourceTask = false): Promise<void> {
  pendingPersistTaskIds.delete(task.id);
  const payload = buildPersistPayload(task, includeSourceTask);
  const run = persistChain.then(async () => {
    await saveConsistencyTask(task.id, payload);
  });
  persistChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function flushPendingPersistTasks() {
  const taskIds = [...pendingPersistTaskIds];
  pendingPersistTaskIds.clear();
  for (const taskId of taskIds) {
    const task = tasks.value.find((item) => item.id === taskId);
    if (task) {
      void persistTaskNow(task).catch((error) => {
        console.error(`consistency_tasks_persist_failed ${String(error)}`);
        ElMessage.error(`一致性任务保存失败：${error instanceof Error ? error.message : String(error)}`);
      });
    }
  }
}

function queuePersistTask(task: ConsistencyTask, delayMs = 250) {
  pendingPersistTaskIds.add(task.id);
  if (persistTimer !== undefined) {
    window.clearTimeout(persistTimer);
  }
  persistTimer = window.setTimeout(() => {
    persistTimer = undefined;
    flushPendingPersistTasks();
  }, delayMs);
}

async function loadTasks() {
  loadingTasks.value = true;
  try {
    const response = await fetchConsistencyTasks();
    tasks.value = (response.items as ConsistencyTaskCollectionRecord[]).map(
      (item) => hydrateConsistencyTaskSnapshot(item) as ConsistencyTask,
    );
    taskSequence = tasks.value.reduce((max, task) => Math.max(max, task.sequence), 0);
    const currentRouteTask = routeTaskId.value;
    selectedTaskId.value =
      tasks.value.find((task) => task.id === currentRouteTask)?.id ?? tasks.value[0]?.id ?? "";
  } catch (error) {
    ElMessage.error(`一致性任务加载失败：${error instanceof Error ? error.message : String(error)}`);
  } finally {
    loadingTasks.value = false;
  }
}

function refreshTaskAggregates(task: ConsistencyTask) {
  task.analysis = analyzeConsistency(task.runs);
  task.ruleReport = buildRuleReport(task.runs);
  task.riskReport = buildRiskReport(task.runs);
  const completed = task.runs.filter((run) => run.status === "completed").length;
  const failed = task.runs.filter(isTerminalFailedRun).length;
  if (completed === RUN_COUNT) {
    task.status = "completed";
  } else if (completed + failed === RUN_COUNT) {
    task.status = completed > 0 ? "partial_failed" : "failed";
  } else {
    task.status = "running";
  }
  queuePersistTask(task);
}

function buildSubmittedPayload(task: ConsistencyTask, taskId: number): RemoteEvaluationTaskInput {
  return {
    ...task.sourceTask,
    taskId,
    callback: "",
  };
}

function isTerminalFailedRun(run: ConsistencyRunSummary) {
  return run.status === "failed" || run.status === "timed_out" || run.status === "missing";
}

function toRunStatus(status: RemoteTaskRegistryStatus): ConsistencyRunStatus {
  return status;
}

async function submitRun(task: ConsistencyTask, run: ConsistencyRunSummary, attempt = 0) {
  run.status = "submitted";
  run.error = undefined;
  refreshTaskAggregates(task);
  try {
    await submitRemoteScoreTask(task.serviceBaseUrl, buildSubmittedPayload(task, run.taskId));
    run.status = "queued";
    refreshTaskAggregates(task);
  } catch (error) {
    if (attempt < MAX_RESUBMIT_ATTEMPTS) {
      window.setTimeout(() => {
        void submitRun(task, run, attempt + 1);
      }, 1000);
      return;
    }
    run.status = "failed";
    run.error = error instanceof Error ? error.message : String(error);
    refreshTaskAggregates(task);
  }
}

async function runTask(task: ConsistencyTask) {
  for (const run of task.runs) {
    await submitRun(task, run);
  }
}

async function loadCompletedResult(task: ConsistencyTask, run: ConsistencyRunSummary) {
  if (rawResults.has(run.taskId) && run.status === "completed" && run.totalScore !== undefined) {
    return;
  }
  const response = await fetchRemoteScoreResult(task.serviceBaseUrl, run.taskId);
  rawResults.set(run.taskId, response.resultData);
  const completed = extractConsistencyRunSummary(run.runIndex, run.taskId, response.resultData);
  Object.assign(run, completed);
}

async function refreshTaskStatus(task: ConsistencyTask) {
  refreshingTaskId.value = task.id;
  try {
    const response = await fetchRemoteTaskStatuses(
      task.serviceBaseUrl,
      task.runs.map((run) => run.taskId),
    );
    const statuses = new Map(response.items.map((item) => [item.taskId, item]));
    for (const run of task.runs) {
      const item = statuses.get(run.taskId);
      if (!item) {
        continue;
      }
      run.status = toRunStatus(item.status);
      run.error = item.error ?? item.message;
      if (item.status === "completed") {
        try {
          await loadCompletedResult(task, run);
        } catch (error) {
          run.error = error instanceof Error ? error.message : String(error);
        }
      }
    }
    refreshTaskAggregates(task);
    await persistTaskNow(task);
    ElMessage.success("任务状态已刷新");
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : String(error));
  } finally {
    refreshingTaskId.value = "";
  }
}

function openCreateDrawer() {
  validationErrors.value = [];
  createDrawerVisible.value = true;
}

async function createTask() {
  const validation = validateRemoteTaskJson(jsonInput.value);
  if (!validation.valid) {
    validationErrors.value = validation.errors;
    return;
  }
  validationErrors.value = [];
  creating.value = true;
  try {
    const sequence = taskSequence + 1;
    const ids = generateSubmittedTaskIds(validation.task.taskId, sequence, RUN_COUNT);
    taskSequence = sequence;
    const runs: ConsistencyRunSummary[] = ids.map((taskId, index) => ({
      runIndex: index,
      taskId,
      status: "pending_submit",
      unsatisfiedRules: [],
      risks: [],
    }));
    const task: ConsistencyTask = {
      id: `C-${String(sequence).padStart(3, "0")}`,
      sequence,
      serviceBaseUrl: normalizeServiceBaseUrl(serviceBaseUrl.value),
      originalTaskId: validation.task.taskId,
      caseId: validation.task.testCase.id,
      caseName: validation.task.testCase.name,
      createdAt: new Date().toISOString(),
      status: "running",
      sourceTask: validation.task,
      runs,
      analysis: analyzeConsistency(runs),
      ruleReport: [],
      riskReport: [],
    };
    tasks.value = [task, ...tasks.value];
    selectedTaskId.value = task.id;
    createDrawerVisible.value = false;
    await persistTaskNow(task, true);
    void runTask(task);
  } catch (error) {
    validationErrors.value = [error instanceof Error ? error.message : String(error)];
  } finally {
    creating.value = false;
  }
}

function openTaskDetail(taskId: string) {
  selectedTaskId.value = taskId;
  detailTab.value = "runs";
  void router.push(`/consistency/${encodeURIComponent(taskId)}`);
}

function backToTaskList() {
  void router.push("/consistency");
}

function rerunTask(taskId: string) {
  const task = tasks.value.find((item) => item.id === taskId);
  if (!task) {
    return;
  }
  for (const run of task.runs) {
    run.status = "pending_submit";
    run.totalScore = undefined;
    run.hardGateTriggered = undefined;
    run.summary = undefined;
    run.ruleUnsatisfactionRatio = undefined;
    run.unsatisfiedRules = [];
    run.risks = [];
    run.error = undefined;
  }
  refreshTaskAggregates(task);
  rawResults.clear();
  void runTask(task);
}

function openRawResult(taskId: number) {
  const result = rawResults.get(taskId);
  rawDrawerContent.value = JSON.stringify(result ?? { message: "当前页面内暂无原始结果缓存" }, null, 2);
  rawDrawerVisible.value = true;
}

function completedRunCount(task: ConsistencyTask) {
  return task.runs.filter((run) => run.status === "completed").length;
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}

function formatPercent(value: number | null) {
  return typeof value === "number" ? `${String(value)}%` : "-";
}

function formatRatioPercent(value: number | null | undefined) {
  return typeof value === "number" ? `${String(Math.round(value * 100))}%` : "-";
}

function formatNullableNumber(value: number | null | undefined) {
  return typeof value === "number" ? String(value) : "-";
}

function formatScoreDelta(run: ConsistencyRunSummary) {
  const baseline = selectedTask.value?.analysis.medianScore;
  if (baseline === null || baseline === undefined || run.totalScore === undefined) {
    return "-";
  }
  const delta = Math.round((run.totalScore - baseline) * 100) / 100;
  return delta > 0 ? `+${String(delta)}` : String(delta);
}

function formatHardGate(value: boolean | undefined) {
  if (value === undefined) {
    return "-";
  }
  return value ? "是" : "否";
}

function formatRunConsistency(task: ConsistencyTask, run: ConsistencyRunSummary) {
  if (run.status !== "completed") {
    return "-";
  }
  return task.analysis.runConsistencyByTaskId[run.taskId] ? "一致" : "波动";
}

function formatTaskStatus(status: ConsistencyTaskStatus) {
  return {
    running: "运行中",
    completed: "已完成",
    partial_failed: "部分失败",
    failed: "失败",
  }[status];
}

function formatRunStatus(status: ConsistencyRunStatus) {
  return {
    pending_submit: "待提交",
    submitted: "已提交",
    preparing: "准备中",
    queued: "排队中",
    running: "运行中",
    completed: "已完成",
    failed: "失败",
    timed_out: "超时",
    missing: "未找到",
  }[status];
}

function taskStatusTagType(status: ConsistencyTaskStatus) {
  if (status === "completed") return "success";
  if (status === "failed") return "danger";
  if (status === "partial_failed") return "warning";
  return "primary";
}

function runStatusTagType(status: ConsistencyRunStatus) {
  if (status === "completed") return "success";
  if (status === "failed" || status === "timed_out" || status === "missing") return "danger";
  if (status === "queued" || status === "running" || status === "preparing") return "warning";
  return "info";
}

async function refreshFromHeader() {
  await loadTasks();
}

watch([tasks, pageSize], () => {
  if ((page.value - 1) * pageSize.value >= tasks.value.length && page.value > 1) {
    page.value -= 1;
  }
});

onMounted(() => {
  void loadTasks();
  window.addEventListener("dashboard:refresh", refreshFromHeader as EventListener);
});

onBeforeUnmount(() => {
  if (persistTimer !== undefined) {
    window.clearTimeout(persistTimer);
  }
  pendingPersistTaskIds.clear();
  window.removeEventListener("dashboard:refresh", refreshFromHeader as EventListener);
});
</script>
