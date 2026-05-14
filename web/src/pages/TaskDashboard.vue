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
      </div>

      <el-table :data="tasks" v-loading="loading" stripe height="560">
        <el-table-column prop="taskId" label="taskId" width="100" />
        <el-table-column prop="name" label="名称" min-width="220" show-overflow-tooltip />
        <el-table-column label="状态" width="110">
          <template #default="{ row }">
            <TaskStatusTag :status-category="row.statusCategory" />
          </template>
        </el-table-column>
        <el-table-column prop="taskType" label="类型" width="140" />
        <el-table-column prop="score" label="分数" width="90" />
        <el-table-column prop="testCaseId" label="testCaseId" width="120" />
        <el-table-column prop="updatedAt" label="更新时间" min-width="180" />
        <el-table-column label="操作" width="120" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openLog(row)">查看日志</el-button>
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
  </div>
</template>

<script setup lang="ts">
import { computed, inject, onMounted, onBeforeUnmount, reactive, ref, watch, type Ref } from "vue";
import { Refresh } from "@element-plus/icons-vue";
import MetricCard from "../components/MetricCard.vue";
import TaskStatusTag from "../components/TaskStatusTag.vue";
import {
  fetchSummary,
  fetchTasks,
  fetchTaskLog,
  type DashboardTask,
  type DashboardSummary,
} from "../api/dashboard";

const loading = ref(false);
const summary = ref<DashboardSummary | null>(null);
const tasks = ref<DashboardTask[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(20);
const drawerVisible = ref(false);
const drawerTask = ref<DashboardTask | null>(null);
const logState = reactive({ available: false, content: "", truncated: false });
const range = ref<[Date, Date] | null>(null);
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

const taskTypeOptions = computed(() => {
  const fromSummary = summary.value?.taskTypeCounts.map((item) => item.taskType) ?? [];
  return Array.from(new Set(fromSummary)).sort();
});

const taskTypeMetrics = computed(() => [
  ...((summary.value?.taskTypeCounts ?? []).map((item) => ({
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

async function loadData() {
  loading.value = true;
  try {
    const from = range.value?.[0]?.toISOString();
    const to = range.value?.[1]?.toISOString();
    summary.value = await fetchSummary({ from, to });
    const response = await fetchTasks({
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
    });
    tasks.value = response.items;
    total.value = response.total;
  } finally {
    loading.value = false;
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

async function reloadLog() {
  if (!drawerTask.value) {
    return;
  }
  const response = await fetchTaskLog(drawerTask.value.taskId);
  logState.available = response.available;
  logState.content = response.content;
  logState.truncated = response.truncated;
}

watch([page, pageSize], loadData);
watch(range, loadData);
watch(
  () => [filters.status, filters.taskType, filters.keyword, filters.scoreMin, filters.scoreMax],
  () => {
    page.value = 1;
    loadData();
  },
);

function onRefresh() {
  loadData();
}

onMounted(() => {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 7);
  range.value = [start, end];
  setTitleControls?.({ dateRange: { model: range } });
  loadData();
  window.addEventListener("dashboard:refresh", onRefresh as EventListener);
});

onBeforeUnmount(() => {
  setTitleControls?.(null);
  window.removeEventListener("dashboard:refresh", onRefresh as EventListener);
});
</script>
