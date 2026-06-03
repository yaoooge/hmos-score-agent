<template>
  <div class="page-stack">
    <div class="metrics-grid">
      <MetricCard label="已接收" :value="summary?.statusCounts.received ?? 0" />
      <MetricCard label="排队中" :value="summary?.statusCounts.queued ?? 0" />
      <MetricCard label="执行中" :value="summary?.statusCounts.running ?? 0" />
      <MetricCard label="已执行" :value="summary?.statusCounts.completed ?? 0" />
      <MetricCard label="失败" :value="summary?.statusCounts.failed ?? 0" />
    </div>

    <div class="metrics-grid">
      <MetricCard
        v-for="item in taskTypeMetrics"
        :key="item.label"
        :label="item.label"
        :value="item.value"
        :accent="item.accent"
      />
    </div>

    <div class="table-card">
      <div class="toolbar" style="margin-bottom: 12px">
        <el-select v-model="filters.status" placeholder="状态" clearable style="width: 140px">
          <el-option label="已接收" value="received" />
          <el-option label="排队中" value="queued" />
          <el-option label="执行中" value="running" />
          <el-option label="已执行" value="completed" />
          <el-option label="失败" value="failed" />
        </el-select>
        <el-input
          v-model="filters.keyword"
          clearable
          placeholder="任务名 / ID"
          style="width: 180px"
        />
        <el-select v-model="filters.taskType" placeholder="任务类型" clearable style="width: 150px">
          <el-option v-for="item in taskTypeOptions" :key="item" :label="item" :value="item" />
        </el-select>
        <el-input-number
          v-model="filters.scoreMin"
          :min="0"
          :max="100"
          placeholder="最低分"
          controls-position="right"
          style="width: 120px"
        />
        <el-input-number
          v-model="filters.scoreMax"
          :min="0"
          :max="100"
          placeholder="最高分"
          controls-position="right"
          style="width: 120px"
        />
        <el-button
          type="primary"
          :icon="Plus"
          style="margin-left: auto"
          @click="openCreateDrawer"
        >
          创建任务
        </el-button>
      </div>

      <el-table :data="tasks" v-loading="loading" stripe class="task-dashboard-table">
        <el-table-column prop="taskId" label="taskId" width="82" />
        <el-table-column label="名称" min-width="180" show-overflow-tooltip>
          <template #default="{ row }">
            <el-button link type="primary" class="task-name-link" @click="openCaseReport(row)">
              {{ row.name }}
            </el-button>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="96">
          <template #default="{ row }">
            <TaskStatusTag :status-category="row.statusCategory" />
          </template>
        </el-table-column>
        <el-table-column prop="taskType" label="类型" width="112" show-overflow-tooltip />
        <el-table-column prop="score" label="分数" width="70" />
        <el-table-column prop="testCaseId" label="testCaseId" width="96" />
        <el-table-column label="更新时间" min-width="150">
          <template #default="{ row }">
            {{ formatDashboardDateTime(row.updatedAt) }}
          </template>
        </el-table-column>
        <el-table-column label="操作" width="136" align="right">
          <template #default="{ row }">
            <div class="toolbar task-action-bar">
              <el-button link type="primary" @click="openLog(row)">查看日志</el-button>
              <el-button
                link
                type="primary"
                :icon="Download"
                :loading="downloadingTaskId === row.taskId"
                :disabled="!row.resultAvailable"
                @click="downloadRawResult(row)"
              >
                下载json
              </el-button>
              <el-button
                link
                type="danger"
                :icon="Delete"
                :loading="deletingTaskId === row.taskId"
                :disabled="deletingTaskId !== null && deletingTaskId !== row.taskId"
                @click="deleteTask(row)"
              >
                删除
              </el-button>
            </div>
          </template>
        </el-table-column>
      </el-table>

      <div style="display: flex; justify-content: flex-end; margin-top: 12px">
        <el-pagination
          v-model:current-page="page"
          v-model:page-size="pageSize"
          :total="total"
          :page-sizes="[10, 20, 50, 100]"
          layout="total, sizes, prev, pager, next"
          background
        />
      </div>
    </div>

    <el-drawer v-model="drawerVisible" size="55%" :title="drawerTitle">
      <template #header>
        <div class="toolbar" style="justify-content: space-between; width: 100%">
          <strong>{{ drawerTitle }}</strong>
          <el-button :icon="Refresh" @click="reloadLog">刷新日志</el-button>
        </div>
      </template>
      <el-empty v-if="!logState.available" description="日志暂不可用" />
      <pre v-else class="log-content">{{ logState.content }}</pre>
    </el-drawer>

    <el-drawer v-model="createDrawerVisible" size="46%" title="创建任务">
      <div class="page-stack">
        <el-form label-position="top">
          <el-form-item label="评分服务地址">
            <el-input v-model="serviceBaseUrl" />
          </el-form-item>
          <el-form-item label="远端任务 JSON">
            <el-input
              v-model="jsonInput"
              type="textarea"
              :rows="20"
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
          <ul class="create-task-error-list">
            <li v-for="error in validationErrors" :key="error">{{ error }}</li>
          </ul>
        </el-alert>

        <div class="drawer-actions">
          <el-button @click="createDrawerVisible = false">取消</el-button>
          <el-button type="primary" :loading="creatingTask" @click="createTask">创建任务</el-button>
        </div>
      </div>
    </el-drawer>

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
  </div>
</template>

<script setup lang="ts">
import { computed, inject, onMounted, onBeforeUnmount, reactive, ref, watch, type Ref } from "vue";
import { Delete, Download, Plus, Refresh } from "@element-plus/icons-vue";
import { ElMessage, ElMessageBox } from "element-plus";
import CaseReportDrawer from "../components/CaseReportDrawer.vue";
import MetricCard from "../components/MetricCard.vue";
import TaskStatusTag from "../components/TaskStatusTag.vue";
import {
  fetchSummary,
  fetchTasks,
  fetchTaskLog,
  fetchTaskRawResult,
  fetchTaskResult,
  deleteDashboardTask,
  type DashboardTask,
  type DashboardSummary,
} from "../api/dashboard";
import { formatDashboardDateTime } from "../dateTime";
import {
  buildTaskTypeOptions,
  normalizeDashboardTask,
  summarizeTaskTypeCounts,
} from "../taskTypes";
import { createRecentDashboardRange, refreshDashboardRangeEnd } from "../dashboardDateRange";
import { loadTaskDashboardData } from "./taskDashboardDataLoader";
import {
  buildCaseReportViewModel,
  type CaseReportViewModel,
} from "./caseReportViewModel";
import {
  submitRemoteScoreTask,
  normalizeServiceBaseUrl,
} from "../api/scoreConsistency";
import {
  DEFAULT_SERVICE_BASE_URL,
  validateRemoteTaskJson,
} from "./scoreConsistencyAnalysis";

const loading = ref(false);
const summary = ref<DashboardSummary | null>(null);
const tasks = ref<DashboardTask[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(10);
const drawerVisible = ref(false);
const drawerTask = ref<DashboardTask | null>(null);
const downloadingTaskId = ref<number | null>(null);
const deletingTaskId = ref<number | null>(null);
const logState = reactive({ available: false, content: "", truncated: false });
const reportDrawerVisible = ref(false);
const reportTask = ref<DashboardTask | null>(null);
const reportLoading = ref(false);
const reportError = ref("");
const caseReport = ref<CaseReportViewModel | null>(null);
const range = ref<[Date, Date] | null>(null);
const createDrawerVisible = ref(false);
const serviceBaseUrl = ref(DEFAULT_SERVICE_BASE_URL);
const jsonInput = ref("");
const validationErrors = ref<string[]>([]);
const creatingTask = ref(false);
const taskTypeAccentPalette = [
  "#2563eb",
  "#16a34a",
  "#dc2626",
  "#7c3aed",
  "#0891b2",
  "#ea580c",
  "#be123c",
  "#4f46e5",
];

type DashboardTitleControls = {
  dateRange?: {
    model: Ref<[Date, Date] | null>;
  };
};

const setTitleControls =
  inject<(controls: DashboardTitleControls | null) => void>("setDashboardTitleControls");

const filters = reactive({
  status: "" as string,
  taskType: "" as string,
  keyword: "",
  scoreMin: undefined as number | undefined,
  scoreMax: undefined as number | undefined,
});
let latestLoadId = 0;

const taskTypeOptions = computed(() => {
  return buildTaskTypeOptions(summary.value?.taskTypeCounts ?? []);
});

const taskTypeMetrics = computed(() => [
  ...(summarizeTaskTypeCounts(summary.value?.taskTypeCounts ?? []).map((item) => ({
    label: `${item.taskType} 个数`,
    value: item.count,
    accent: taskTypeAccent(item.taskType),
  })) ?? []),
]);

const drawerTitle = computed(() => {
  if (!drawerTask.value) {
    return "运行日志";
  }
  return `#${String(drawerTask.value.taskId)} ${drawerTask.value.name}`;
});

const reportDrawerTitle = computed(() => {
  if (!reportTask.value) {
    return "用例报告";
  }
  return `#${String(reportTask.value.taskId)} ${reportTask.value.name}`;
});

function buildTaskListParams() {
  const from = range.value?.[0]?.toISOString();
  const to = range.value?.[1]?.toISOString();
  return {
    summaryParams: { from, to },
    taskParams: {
      page: page.value,
      pageSize: pageSize.value,
      status: filters.status || undefined,
      taskType: filters.taskType || undefined,
      keyword: filters.keyword || undefined,
      scoreMin: filters.scoreMin,
      scoreMax: filters.scoreMax,
      from,
      to,
      sortBy: "updatedAt",
      sortOrder: "desc",
    },
  };
}

async function loadData(options: { includeSummary?: boolean } = {}) {
  const loadId = ++latestLoadId;
  loading.value = true;
  try {
    const { summaryParams, taskParams } = buildTaskListParams();
    const response = await loadTaskDashboardData({
      includeSummary: options.includeSummary ?? false,
      fetchSummary: () => fetchSummary(summaryParams),
      fetchTasks: () => fetchTasks(taskParams),
    });
    if (loadId !== latestLoadId) {
      return;
    }
    if (response.summary) {
      summary.value = response.summary;
    }
    tasks.value = response.tasks.items.map(normalizeDashboardTask);
    total.value = response.tasks.total;
  } finally {
    if (loadId === latestLoadId) {
      loading.value = false;
    }
  }
}

function taskTypeAccent(taskType: string): string {
  let hash = 0;
  for (const character of taskType) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }
  return taskTypeAccentPalette[hash % taskTypeAccentPalette.length] ?? taskTypeAccentPalette[0];
}

async function openLog(task: DashboardTask) {
  drawerTask.value = task;
  drawerVisible.value = true;
  await reloadLog();
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
  creatingTask.value = true;
  try {
    serviceBaseUrl.value = normalizeServiceBaseUrl(serviceBaseUrl.value);
    const response = await submitRemoteScoreTask(serviceBaseUrl.value, validation.task);
    createDrawerVisible.value = false;
    ElMessage.success(`评测任务 #${String(response.taskId)} 已创建`);
    await loadData({ includeSummary: true });
  } catch (error) {
    validationErrors.value = [error instanceof Error ? error.message : String(error)];
  } finally {
    creatingTask.value = false;
  }
}

function resolveRawResultFilename(contentDisposition: string | null, taskId: number): string {
  if (!contentDisposition) {
    return `task-${String(taskId)}-result.json`;
  }
  const quotedMatch = /filename="([^"]+)"/i.exec(contentDisposition);
  if (quotedMatch?.[1]) {
    return quotedMatch[1];
  }
  const encodedMatch = /filename\*=UTF-8''([^;]+)/i.exec(contentDisposition);
  if (encodedMatch?.[1]) {
    return decodeURIComponent(encodedMatch[1]);
  }
  return `task-${String(taskId)}-result.json`;
}

function triggerJsonDownload(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function downloadRawResult(task: DashboardTask) {
  if (!task.resultAvailable) {
    ElMessage.warning("结果暂不可下载");
    return;
  }
  downloadingTaskId.value = task.taskId;
  try {
    const response = await fetchTaskRawResult(task.taskId);
    if (!response.ok) {
      throw new Error(await response.text());
    }
    const blob = await response.blob();
    triggerJsonDownload(
      resolveRawResultFilename(response.headers.get("content-disposition"), task.taskId),
      blob,
    );
    ElMessage.success("原始 JSON 已下载");
  } catch (error) {
    ElMessage.error(`原始 JSON 下载失败：${error instanceof Error ? error.message : String(error)}`);
  } finally {
    downloadingTaskId.value = null;
  }
}

async function deleteTask(task: DashboardTask) {
  try {
    await ElMessageBox.confirm(
      `确定删除任务 #${String(task.taskId)} ${task.name} 吗？删除后任务列表中将不再显示该记录。`,
      "删除评测任务",
      {
        confirmButtonText: "删除",
        cancelButtonText: "取消",
        type: "warning",
      },
    );
  } catch {
    return;
  }

  deletingTaskId.value = task.taskId;
  try {
    const response = await deleteDashboardTask(task.taskId);
    if (!response.deletedTaskIds.includes(task.taskId)) {
      ElMessage.warning("任务记录不存在或已被删除");
    } else {
      ElMessage.success("评测任务已删除");
    }
    if (drawerTask.value?.taskId === task.taskId) {
      drawerVisible.value = false;
      drawerTask.value = null;
    }
    if (reportTask.value?.taskId === task.taskId) {
      reportDrawerVisible.value = false;
      reportTask.value = null;
      caseReport.value = null;
    }
    await loadData({ includeSummary: true });
  } catch (error) {
    ElMessage.error(`评测任务删除失败：${error instanceof Error ? error.message : String(error)}`);
  } finally {
    deletingTaskId.value = null;
  }
}

async function reloadLog() {
  if (!drawerTask.value) {
    return;
  }
  const response = await fetchTaskLog(drawerTask.value.taskId);
  logState.available = response.available;
  logState.content = response.content;
  logState.truncated = response.truncated;
}

async function openCaseReport(task: DashboardTask) {
  reportTask.value = task;
  reportDrawerVisible.value = true;
  await reloadCaseReport();
}

async function reloadCaseReport() {
  if (!reportTask.value) {
    return;
  }
  reportLoading.value = true;
  reportError.value = "";
  try {
    const response = await fetchTaskResult(reportTask.value.taskId);
    caseReport.value = buildCaseReportViewModel(response.resultData);
  } catch (error) {
    caseReport.value = null;
    reportError.value = error instanceof Error ? error.message : String(error);
  } finally {
    reportLoading.value = false;
  }
}

watch([page, pageSize], () => loadData());
watch(range, () => loadData({ includeSummary: true }));
watch(
  () => [filters.status, filters.taskType, filters.keyword, filters.scoreMin, filters.scoreMax],
  () => {
    if (page.value !== 1) {
      page.value = 1;
      return;
    }
    page.value = 1;
    loadData();
  },
);

function onRefresh() {
  const refreshedRange = refreshDashboardRangeEnd(range.value);
  if (refreshedRange) {
    range.value = refreshedRange;
    return;
  }
  loadData({ includeSummary: true });
}

onMounted(() => {
  range.value = createRecentDashboardRange(7);
  setTitleControls?.({ dateRange: { model: range } });
  window.addEventListener("dashboard:refresh", onRefresh as EventListener);
});

onBeforeUnmount(() => {
  setTitleControls?.(null);
  window.removeEventListener("dashboard:refresh", onRefresh as EventListener);
});
</script>

<style scoped>
.task-action-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 4px 8px;
  white-space: normal;
}

.task-action-bar :deep(.el-button) {
  margin-left: 0;
  padding: 0;
}

.drawer-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.create-task-error-list {
  margin: 4px 0 0;
  padding-left: 18px;
}
</style>
