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
        <el-table-column label="名称" min-width="220" show-overflow-tooltip>
          <template #default="{ row }">
            <el-button link type="primary" class="task-name-link" @click="openCaseReport(row)">
              {{ row.name }}
            </el-button>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="110">
          <template #default="{ row }">
            <TaskStatusTag :status-category="row.statusCategory" />
          </template>
        </el-table-column>
        <el-table-column prop="taskType" label="类型" width="140" />
        <el-table-column prop="score" label="分数" width="90" />
        <el-table-column prop="testCaseId" label="testCaseId" width="120" />
        <el-table-column label="更新时间" min-width="180">
          <template #default="{ row }">
            {{ formatDashboardDateTime(row.updatedAt) }}
          </template>
        </el-table-column>
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

    <el-drawer v-model="reportDrawerVisible" size="58%" :title="reportDrawerTitle">
      <template #header>
        <div class="toolbar" style="justify-content: space-between; width: 100%">
          <strong>{{ reportDrawerTitle }}</strong>
          <el-button :icon="Refresh" :loading="reportLoading" @click="reloadCaseReport">
            刷新报告
          </el-button>
        </div>
      </template>

      <el-alert
        v-if="reportError"
        :title="reportError"
        type="error"
        show-icon
        :closable="false"
      />
      <div v-else-if="reportLoading" class="report-loading">
        <el-skeleton :rows="10" animated />
      </div>
      <el-empty v-else-if="!caseReport" description="暂无用例报告" />
      <div v-else class="case-report-stack report-document">
        <section class="report-cover">
          <div class="report-cover-main">
            <div class="report-kicker">测试报告</div>
            <h2>{{ reportTask?.name ?? "用例报告" }}</h2>
            <p v-if="caseReport.summary.targetDescription" class="report-target">
              {{ caseReport.summary.targetDescription }}
            </p>
            <p class="report-conclusion">
              {{ caseReport.summary.conclusion ?? "暂无总体结论。" }}
            </p>
            <div class="report-meta-row">
              <span>Task ID: {{ reportTask?.taskId ?? "-" }}</span>
              <span>Test Case ID: {{ reportTask?.testCaseId ?? "-" }}</span>
              <span>{{ formatReportDate(caseReport.summary.generatedAt) }}</span>
            </div>
          </div>
          <div class="report-score-panel" :class="scoreToneClass(caseReport.summary.totalScore)">
            <span>综合评分</span>
            <strong>{{ formatReportValue(caseReport.summary.totalScore) }}</strong>
            <em>/ 100</em>
          </div>
        </section>

        <div class="report-stat-grid">
          <div class="report-stat-card">
            <span>硬门禁</span>
            <strong :class="hardGateClass(caseReport.summary.hardGateTriggered)">
              {{ formatHardGate(caseReport.summary.hardGateTriggered) }}
            </strong>
          </div>
          <div class="report-stat-card">
            <span>任务类型</span>
            <strong>{{ caseReport.summary.taskType ?? "-" }}</strong>
          </div>
          <div class="report-stat-card">
            <span>风险项</span>
            <strong class="tone-danger">{{ caseReport.risks.length }}</strong>
          </div>
          <div class="report-stat-card">
            <span>待复核</span>
            <strong class="tone-warning">{{ caseReport.humanReviewItems.length }}</strong>
          </div>
        </div>

        <section class="report-section">
          <div class="report-section-heading">
            <span>01</span>
            <div>
              <h3>维度评分</h3>
              <p>按评分维度展示得分、权重和评语。</p>
            </div>
          </div>
          <el-empty v-if="caseReport.dimensions.length === 0" description="暂无维度评分" />
          <div v-else class="dimension-list">
            <article
              v-for="dimension in caseReport.dimensions"
              :key="dimension.name"
              class="dimension-row"
            >
              <div class="dimension-row-main">
                <div class="dimension-title-row">
                  <strong>{{ dimension.name }}</strong>
                  <span>{{ dimension.itemCount }} 个评分项</span>
                </div>
                <p>{{ dimension.comment ?? "暂无评语。" }}</p>
                <el-progress
                  :percentage="dimensionScorePercent(dimension.score, dimension.maxScore)"
                  :stroke-width="8"
                  :show-text="false"
                />
              </div>
              <div class="dimension-score" :class="scoreToneClass(dimension.score, dimension.maxScore)">
                {{ formatScorePair(dimension.score, dimension.maxScore) }}
              </div>
            </article>
          </div>
        </section>

        <section class="report-section">
          <div class="report-section-heading">
            <span>02</span>
            <div>
              <h3>主要问题</h3>
              <p>影响评分结果的关键问题摘要。</p>
            </div>
          </div>
          <ul v-if="caseReport.mainIssues.length > 0" class="report-list">
            <li v-for="issue in caseReport.mainIssues" :key="issue">{{ issue }}</li>
          </ul>
          <span v-else class="empty-inline">暂无主要问题</span>
        </section>

        <section class="report-section">
          <div class="report-section-heading">
            <span>03</span>
            <div>
              <h3>风险项</h3>
              <p>需要关注的质量、稳定性或规则风险。</p>
            </div>
          </div>
          <el-empty v-if="caseReport.risks.length === 0" description="暂无风险项" />
          <div v-else class="report-card-list">
            <article
              v-for="risk in caseReport.risks"
              :key="`${risk.id ?? risk.title}`"
              class="report-card report-card-risk"
            >
              <div class="report-card-header">
                <strong>{{ risk.title }}</strong>
                <el-tag v-if="risk.level" size="small" effect="plain">{{ risk.level }}</el-tag>
              </div>
              <p v-if="risk.description">{{ risk.description }}</p>
              <p v-if="risk.evidence" class="report-muted">{{ risk.evidence }}</p>
            </article>
          </div>
        </section>

        <section class="report-section">
          <div class="report-section-heading">
            <span>04</span>
            <div>
              <h3>待人工复核</h3>
              <p>自动评分中需要人工确认的判断点。</p>
            </div>
          </div>
          <el-empty v-if="caseReport.humanReviewItems.length === 0" description="暂无待复核项" />
          <div v-else class="report-card-list">
            <article
              v-for="item in caseReport.humanReviewItems"
              :key="`${item.id ?? item.title}`"
              class="report-card"
            >
              <strong>{{ item.title }}</strong>
              <p v-if="item.currentAssessment">{{ item.currentAssessment }}</p>
              <p v-if="item.reason" class="report-muted">{{ item.reason }}</p>
              <p v-if="item.suggestedFocus" class="report-muted">{{ item.suggestedFocus }}</p>
            </article>
          </div>
        </section>

        <section class="report-section">
          <div class="report-section-heading">
            <span>05</span>
            <div>
              <h3>规则与代码检查</h3>
              <p>官方检查器和规则审计的执行摘要。</p>
            </div>
          </div>
          <div class="detail-grid">
            <span>官方检查状态</span>
            <strong>{{ caseReport.linterSummary?.runStatus ?? "-" }}</strong>
            <span>有效问题数</span>
            <strong>{{ formatReportValue(caseReport.linterSummary?.effectiveFindingCount) }}</strong>
            <span>规则审计项</span>
            <strong>{{ caseReport.ruleAuditItems.length }}</strong>
          </div>
        </section>

        <section class="report-section">
          <div class="report-section-heading">
            <span>06</span>
            <div>
              <h3>建议动作</h3>
              <p>基于当前报告给出的后续处理建议。</p>
            </div>
          </div>
          <ul v-if="caseReport.recommendations.length > 0" class="report-list">
            <li v-for="item in caseReport.recommendations" :key="item">{{ item }}</li>
          </ul>
          <span v-else class="empty-inline">暂无建议动作</span>
        </section>
      </div>
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
  fetchTaskResult,
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

const loading = ref(false);
const summary = ref<DashboardSummary | null>(null);
const tasks = ref<DashboardTask[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(20);
const drawerVisible = ref(false);
const drawerTask = ref<DashboardTask | null>(null);
const logState = reactive({ available: false, content: "", truncated: false });
const reportDrawerVisible = ref(false);
const reportTask = ref<DashboardTask | null>(null);
const reportLoading = ref(false);
const reportError = ref("");
const caseReport = ref<CaseReportViewModel | null>(null);
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

function formatReportValue(value: unknown): string {
  return value === undefined || value === null || value === "" ? "-" : String(value);
}

function formatHardGate(value: boolean | undefined): string {
  if (value === undefined) {
    return "-";
  }
  return value ? "已触发" : "未触发";
}

function formatScorePair(score: number | undefined, maxScore: number | undefined): string {
  if (score === undefined && maxScore === undefined) {
    return "-";
  }
  return `${formatReportValue(score)} / ${formatReportValue(maxScore)}`;
}

function formatReportDate(value: string | undefined): string {
  return value ? formatDashboardDateTime(value) : "-";
}

function dimensionScorePercent(score: number | undefined, maxScore: number | undefined): number {
  if (score === undefined || maxScore === undefined || maxScore <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round((score / maxScore) * 100)));
}

function scoreToneClass(score: number | undefined, maxScore = 100): string {
  if (score === undefined || maxScore <= 0) {
    return "tone-neutral";
  }
  const percent = (score / maxScore) * 100;
  if (percent >= 80) {
    return "tone-success";
  }
  if (percent >= 60) {
    return "tone-warning";
  }
  return "tone-danger";
}

function hardGateClass(value: boolean | undefined): string {
  if (value === undefined) {
    return "tone-neutral";
  }
  return value ? "tone-danger" : "tone-success";
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
