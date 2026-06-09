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

    <div class="table-card consistency-task-table-card" v-loading="loadingTasks || refreshingAllTasks">
      <el-table :data="pagedTasks" stripe highlight-current-row class="consistency-task-table">
        <el-table-column prop="id" label="任务ID" width="96" />
        <el-table-column prop="originalTaskId" label="原始taskId" width="112" />
        <el-table-column prop="caseName" label="用例名称" min-width="180" show-overflow-tooltip />
        <el-table-column label="进度" width="86">
          <template #default="{ row }">
            {{ completedRunCount(row) }}/{{ row.runs.length }}
          </template>
        </el-table-column>
        <el-table-column label="一致性" width="86">
          <template #default="{ row }">
            {{ formatPercent(row.analysis.consistencyPercentage) }}
          </template>
        </el-table-column>
        <el-table-column label="状态" width="104">
          <template #default="{ row }">
            <el-tag size="small" effect="plain" :type="taskStatusTagType(row.status)">
              {{ formatTaskStatus(row.status) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="创建时间" min-width="152">
          <template #default="{ row }">
            {{ formatDateTime(row.createdAt) }}
          </template>
        </el-table-column>
        <el-table-column label="更新时间" min-width="152">
          <template #default="{ row }">
            {{ formatDateTime(row.updatedAt) }}
          </template>
        </el-table-column>
        <el-table-column label="操作" width="128" align="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openTaskDetail(row.id)">详情</el-button>
            <el-dropdown trigger="click" @command="(command: string) => handleTaskAction(row, command)">
              <el-button link type="primary" :icon="MoreFilled" class="consistency-more-button" />
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item command="task-info">任务信息</el-dropdown-item>
                  <el-dropdown-item command="refresh">刷新状态</el-dropdown-item>
                  <el-dropdown-item command="rerun" :disabled="!canRerunTask(row)">重新运行</el-dropdown-item>
                  <el-dropdown-item command="delete" divided>删除</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
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

  <div v-else class="page-stack consistency-detail-page">
    <template v-if="selectedTask && selectedRoundView">
      <div class="table-card consistency-detail-header">
        <div class="detail-title">
          <el-button class="detail-back-button" :icon="ArrowLeft" circle text @click="backToTaskList" />
          <div>
            <h2>{{ selectedTask.id }} / {{ selectedTask.caseName }}</h2>
            <p>{{ selectedTask.analysis.conclusion }}</p>
          </div>
        </div>
        <div class="toolbar consistency-detail-actions">
          <el-button
            :icon="Download"
            :loading="downloadingResults"
            :disabled="!selectedTaskDownloadable"
            @click="downloadSelectedTaskResults"
          >
            下载结果 ZIP
          </el-button>
          <el-button @click="openSelectedTaskInfo">任务信息</el-button>
          <el-button
            :icon="Refresh"
            :loading="refreshingTaskId === selectedTask.id"
            @click="refreshTaskStatus(selectedTask)"
          >
            刷新状态
          </el-button>
          <el-button :icon="Refresh" :disabled="!canRerunTask(selectedTask)" @click="rerunTask(selectedTask.id)">
            重新运行
          </el-button>
          <el-button :icon="Delete" type="danger" plain @click="deleteTask(selectedTask.id)">
            删除任务
          </el-button>
        </div>
      </div>

      <div class="metrics-grid">
        <MetricCard label="已保存轮次" :value="String(historyRoundCount)" />
        <MetricCard label="最新轮次" :value="latestRoundLabel" />
        <MetricCard label="完成数" :value="`${selectedTask.analysis.completedRuns}/10`" />
        <MetricCard label="平均一致性" :value="formatPercent(selectedTask.analysis.consistencyPercentage)" />
        <MetricCard label="平均分" :value="formatNullableNumber(selectedTask.analysis.averageScore)" />
      </div>

      <div class="consistency-history-grid">
        <EChartPanel
          title="多轮一致性趋势"
          compact
          :option="historyConsistencyOption"
          :empty="historyChartRows.length === 0"
        />
        <EChartPanel
          title="多轮质量指标"
          compact
          :option="historyQualityOption"
          :empty="historyChartRows.length === 0"
        />
      </div>

      <div class="table-card consistency-round-panel">
        <div class="consistency-round-header">
          <div>
            <h3>固定轮次信息</h3>
            <p>当前查看 {{ selectedRoundLabel }}。切换后，下方的表格与报表只显示该轮快照。</p>
          </div>
          <div class="toolbar consistency-round-actions">
            <el-select v-model="selectedRound" class="consistency-round-select" size="small">
              <el-option
                v-for="option in roundOptions"
                :key="String(option.value)"
                :label="option.label"
                :value="option.value"
              />
            </el-select>
            <el-button
              v-if="selectedRoundDeleteable"
              :icon="Delete"
              type="danger"
              plain
              @click="deleteSelectedRound"
            >
              删除当前轮次
            </el-button>
          </div>
        </div>

        <div class="metrics-grid consistency-round-metrics">
          <MetricCard label="完成数" :value="`${selectedRoundView.analysis.completedRuns}/10`" />
          <MetricCard label="失败数" :value="selectedRoundView.analysis.failedRuns" />
          <MetricCard label="平均分" :value="formatNullableNumber(selectedRoundView.analysis.averageScore)" />
          <MetricCard
            label="平均 pre_score"
            :value="formatNullableNumber(selectedRoundView.analysis.averagePreScore)"
          />
          <MetricCard
            label="标准差"
            :value="formatNullableNumber(selectedRoundView.analysis.scoreStandardDeviation)"
          />
          <MetricCard
            label="规则不满足度"
            :value="formatRatioPercent(selectedRoundView.analysis.averageRuleUnsatisfactionRatio)"
          />
          <MetricCard
            label="一致性"
            :value="formatPercent(selectedRoundView.analysis.consistencyPercentage)"
          />
        </div>

        <el-tabs v-model="detailTab">
          <el-tab-pane label="运行对比" name="runs">
            <el-table :data="selectedRoundView.runs" stripe class="consistency-report-table">
              <el-table-column label="运行" width="70">
                <template #default="{ row }">{{ row.runIndex + 1 }}</template>
              </el-table-column>
              <el-table-column prop="taskId" label="taskId" min-width="100" />
              <el-table-column label="状态" min-width="110">
                <template #default="{ row }">
                  <el-tag size="small" effect="plain" :type="runStatusTagType(row.status)">
                    {{ formatRunStatus(row.status) }}
                  </el-tag>
                </template>
              </el-table-column>
              <el-table-column label="总分" min-width="80">
                <template #default="{ row }">{{ formatNullableNumber(row.totalScore) }}</template>
              </el-table-column>
              <el-table-column label="pre_score" min-width="92">
                <template #default="{ row }">{{ formatNullableNumber(row.preScore) }}</template>
              </el-table-column>
              <el-table-column label="分差" min-width="80">
                <template #default="{ row }">{{ formatScoreDelta(row) }}</template>
              </el-table-column>
              <el-table-column label="硬门槛" min-width="80">
                <template #default="{ row }">{{ formatHardGate(row.hardGateTriggered) }}</template>
              </el-table-column>
              <el-table-column label="规则不满足" min-width="105">
                <template #default="{ row }">
                  {{ formatRatioPercent(row.ruleUnsatisfactionRatio) }}
                </template>
              </el-table-column>
              <el-table-column label="风险" min-width="70">
                <template #default="{ row }">{{ row.risks.length }}</template>
              </el-table-column>
              <el-table-column label="一致性" min-width="85">
                <template #default="{ row }">
                  {{ formatRunConsistency(row) }}
                </template>
              </el-table-column>
              <el-table-column label="操作" min-width="100">
                <template #default="{ row }">
                  <el-button link type="primary" @click="openRunReport(row)">查看报告</el-button>
                </template>
              </el-table-column>
            </el-table>
          </el-tab-pane>

          <el-tab-pane label="规则不满足报表" name="rules">
            <el-table :data="selectedRoundView.ruleReport" stripe class="consistency-report-table">
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
            <el-table :data="selectedRoundView.riskReport" stripe class="consistency-report-table">
              <el-table-column prop="level" label="等级" width="90" />
              <el-table-column label="风险标题" min-width="260" show-overflow-tooltip>
                <template #default="{ row }">
                  <el-button link type="primary" @click="openRiskDetailDrawer(row)">
                    {{ row.title ?? row.key }}
                  </el-button>
                </template>
              </el-table-column>
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

    <el-drawer v-model="riskDetailDrawerVisible" size="48%" :title="riskDetailDrawerTitle">
      <div v-if="riskDetailItem" class="page-stack">
        <el-descriptions :column="2" border>
          <el-descriptions-item label="风险等级">
            {{ riskDetailItem.level ?? "-" }}
          </el-descriptions-item>
          <el-descriptions-item label="触发次数">
            {{ riskDetailItem.appearanceCount }}
          </el-descriptions-item>
          <el-descriptions-item label="出现率">
            {{ riskDetailItem.appearanceRate }}%
          </el-descriptions-item>
          <el-descriptions-item label="运行序号">
            {{ riskDetailItem.runIndexes.join(", ") }}
          </el-descriptions-item>
        </el-descriptions>

        <el-collapse>
          <el-collapse-item
            v-for="detail in riskDetailItem?.details ?? []"
            :key="`${String(detail.runIndex)}-${String(detail.taskId)}`"
            :title="`第 ${String(detail.runIndex)} 次运行 / taskId ${String(detail.taskId)}`"
          >
            <el-descriptions :column="1" border>
              <el-descriptions-item label="Agent 结论">
                {{ detail.description ?? detail.title ?? "-" }}
              </el-descriptions-item>
              <el-descriptions-item label="证据">
                {{ detail.evidence ?? "-" }}
              </el-descriptions-item>
              <el-descriptions-item v-if="detail.riskCode" label="risk_code">
                {{ detail.riskCode }}
              </el-descriptions-item>
              <el-descriptions-item v-if="detail.sourceRuleId" label="source_rule_id">
                {{ detail.sourceRuleId }}
              </el-descriptions-item>
            </el-descriptions>
          </el-collapse-item>
        </el-collapse>
      </div>
      <el-empty v-else description="未选择风险项" />
    </el-drawer>
  </div>

  <el-drawer v-model="taskInfoDrawerVisible" size="46%" title="一致性任务信息">
    <div v-if="taskInfoDrawerTask && taskInfoDrawerInputInfo" class="page-stack">
      <el-descriptions :column="2" border class="consistency-task-info">
        <el-descriptions-item label="评分服务地址">
          {{ taskInfoDrawerInputInfo.serviceBaseUrl }}
        </el-descriptions-item>
        <el-descriptions-item label="运行次数">
          {{ taskInfoDrawerInputInfo.runCount }}
        </el-descriptions-item>
        <el-descriptions-item label="原始 taskId">
          {{ taskInfoDrawerInputInfo.originalTaskId }}
        </el-descriptions-item>
        <el-descriptions-item label="用例 ID">
          {{ taskInfoDrawerInputInfo.caseId }}
        </el-descriptions-item>
        <el-descriptions-item label="用例名称" :span="2">
          {{ taskInfoDrawerInputInfo.caseName }}
        </el-descriptions-item>
      </el-descriptions>

      <el-alert
        v-if="!taskInfoDrawerInputInfo.sourceTaskAvailable"
        type="warning"
        :closable="false"
        show-icon
        title="该任务缺少完整的首次输入 JSON，可能来自旧数据或原始任务文件已不可用。"
      />

      <div class="consistency-source-json-header">
        <h4>执行使用的 JSON</h4>
        <el-button
          size="small"
          :disabled="taskInfoDrawerInputInfo.sourceTaskJson.length === 0"
          @click="copyTaskInfoJson"
        >
          复制 JSON
        </el-button>
      </div>
      <el-input
        :model-value="taskInfoDrawerInputInfo.sourceTaskJson"
        type="textarea"
        :rows="18"
        readonly
        resize="vertical"
      />
    </div>
    <el-empty v-else description="未找到任务信息" />
  </el-drawer>
</template>

<script setup lang="ts">
import type { EChartsOption } from "echarts";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { ArrowLeft, Delete, Download, MoreFilled, Plus, Refresh } from "@element-plus/icons-vue";
import { useRoute, useRouter } from "vue-router";
import CaseReportDrawer from "../components/CaseReportDrawer.vue";
import EChartPanel from "../components/EChartPanel.vue";
import MetricCard from "../components/MetricCard.vue";
import {
  deleteConsistencyTask,
  deleteRemoteTasks,
  fetchConsistencyTasks,
  fetchRemoteScoreResult,
  fetchRemoteTaskStatuses,
  normalizeServiceBaseUrl,
  patchConsistencyTask,
  saveConsistencyTask,
  submitRemoteScoreTask,
  type RemoteTaskRegistryStatus,
} from "../api/scoreConsistency";
import {
  buildCaseReportViewModel,
  type CaseReportViewModel,
} from "./caseReportViewModel";
import {
  analyzeConsistency,
  appendAnalysisHistorySnapshot,
  buildConsistencyExportFiles,
  buildConsistencyExportPayload,
  buildConsistencyHistoryChartRows,
  buildConsistencyTaskInputInfo,
  buildConsistencyTaskPersistDelta,
  buildConsistencyTaskRoundOptions,
  buildConsistencyTaskPersistRecord,
  buildRiskReport,
  buildRuleReport,
  collectExclusiveRoundTaskIds,
  collectConsistencyExportRuns,
  DEFAULT_SERVICE_BASE_URL,
  extractConsistencyRunSummary,
  generateSubmittedTaskIds,
  generateNextSubmittedTaskIds,
  getConsistencyTaskDefaultRoundSelection,
  hydrateConsistencyTaskSnapshot,
  isConsistencyTaskTerminal,
  removeConsistencyAnalysisHistoryRound,
  resetConsistencyRunForRerun,
  createStoredZip,
  selectConsistencyTaskRoundSnapshot,
  validateRemoteEvaluationTaskInput,
  validateRemoteTaskJson,
  type ConsistencyAnalysisHistoryItem,
  type ConsistencyTaskCollectionRecord,
  type ConsistencyTaskInputInfo,
  type ConsistencyAnalysisSummary,
  type ConsistencyRiskSummary,
  type ConsistencyRunStatus,
  type ConsistencyRunSummary,
  type RemoteEvaluationTaskInput,
  type RiskConsistencyReportItem,
  type ConsistencyTaskRoundOption,
  type ConsistencyTaskRoundSelection,
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
  updatedAt: string;
  status: ConsistencyTaskStatus;
  sourceTask: RemoteEvaluationTaskInput;
  runs: ConsistencyRunSummary[];
  analysis: ConsistencyAnalysisSummary;
  ruleReport: RuleConsistencyReportItem[];
  riskReport: RiskConsistencyReportItem[];
  analysisHistory: ConsistencyAnalysisHistoryItem[];
};

const RUN_COUNT = 10;
const MAX_RESUBMIT_ATTEMPTS = 1;

const tasks = ref<ConsistencyTask[]>([]);
const selectedTaskId = ref("");
const page = ref(1);
const pageSize = ref(10);
const detailTab = ref("runs");
const createDrawerVisible = ref(false);
const reportDrawerVisible = ref(false);
const reportLoading = ref(false);
const reportError = ref("");
const reportRun = ref<ConsistencyRunSummary | null>(null);
const reportCase = ref<CaseReportViewModel | null>(null);
const downloadingResults = ref(false);
const taskInfoDrawerVisible = ref(false);
const taskInfoDrawerTaskId = ref("");
const riskDetailDrawerVisible = ref(false);
const riskDetailItem = ref<RiskConsistencyReportItem | null>(null);
const serviceBaseUrl = ref(DEFAULT_SERVICE_BASE_URL);
const jsonInput = ref("");
const validationErrors = ref<string[]>([]);
const creating = ref(false);
const loadingTasks = ref(false);
const refreshingTaskId = ref("");
const refreshingAllTasks = ref(false);
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
const selectedTaskDownloadable = computed(() => {
  return selectedTask.value ? isConsistencyTaskTerminal(selectedTask.value.runs) : false;
});
const historyRoundCount = computed(() => selectedTask.value?.analysisHistory.length ?? 0);
const roundOptions = computed<ConsistencyTaskRoundOption[]>(() =>
  selectedTask.value ? buildConsistencyTaskRoundOptions(selectedTask.value) : [],
);
const selectedRound = ref<ConsistencyTaskRoundSelection>("current");
const selectedRoundOption = computed(() =>
  roundOptions.value.find((option) => option.value === selectedRound.value),
);
const selectedRoundDeleteable = computed(
  () => selectedRoundOption.value?.value !== "current" && selectedRoundOption.value?.round !== undefined,
);
const selectedRoundLabel = computed(() => selectedRoundOption.value?.label ?? "当前运行状态");
const latestRoundLabel = computed(() => {
  const latestRound = selectedTask.value?.analysisHistory.at(-1);
  return latestRound ? `第 ${String(latestRound.round)} 轮` : "当前运行状态";
});
const selectedRoundView = computed<ConsistencyTask | null>(() => {
  if (!selectedTask.value) {
    return null;
  }
  return selectConsistencyTaskRoundSnapshot(selectedTask.value, selectedRound.value) as ConsistencyTask;
});
const taskInfoDrawerTask = computed(() =>
  tasks.value.find((task) => task.id === taskInfoDrawerTaskId.value),
);
const taskInfoDrawerInputInfo = computed<ConsistencyTaskInputInfo | null>(() =>
  taskInfoDrawerTask.value ? buildConsistencyTaskInputInfo(taskInfoDrawerTask.value, RUN_COUNT) : null,
);
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
    {
      type: "line",
      name: "规则 Jaccard",
      data: historyChartRows.value.map((item) => item.ruleJaccardPercentage),
      smooth: true,
    },
    {
      type: "line",
      name: "风险 Jaccard",
      data: historyChartRows.value.map((item) => item.riskJaccardPercentage),
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
      name: "平均 pre_score",
      data: historyChartRows.value.map((item) => item.averagePreScore),
      smooth: true,
    },
  ],
}));
const reportDrawerTitle = computed(() => {
  if (!reportRun.value || !selectedTask.value) {
    return "用例报告";
  }
  return `#${String(reportRun.value.taskId)} ${selectedTask.value.caseName}`;
});
const riskDetailDrawerTitle = computed(() => {
  if (!riskDetailItem.value) {
    return "风险项详情";
  }
  return riskDetailItem.value.title ?? riskDetailItem.value.key;
});

watch(
  selectedTask,
  (task) => {
    selectedRound.value = task ? getConsistencyTaskDefaultRoundSelection(task) : "current";
    detailTab.value = "runs";
    reportRun.value = null;
    reportCase.value = null;
    reportError.value = "";
    reportDrawerVisible.value = false;
    riskDetailItem.value = null;
    riskDetailDrawerVisible.value = false;
  },
  { immediate: true },
);

watch(selectedRound, () => {
  reportRun.value = null;
  reportCase.value = null;
  reportError.value = "";
  reportDrawerVisible.value = false;
  riskDetailItem.value = null;
  riskDetailDrawerVisible.value = false;
});

function buildPersistPayload(task: ConsistencyTask, includeSourceTask = false) {
  return buildConsistencyTaskPersistRecord(task, includeSourceTask);
}

function persistTaskNow(task: ConsistencyTask, includeSourceTask = false): Promise<void> {
  pendingPersistTaskIds.delete(task.id);
  task.updatedAt = new Date().toISOString();
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

function cloneTaskForDelta(task: ConsistencyTask): ConsistencyTask {
  return JSON.parse(JSON.stringify(task)) as ConsistencyTask;
}

function persistTaskDelta(previous: ConsistencyTask, next: ConsistencyTask): Promise<void> {
  pendingPersistTaskIds.delete(next.id);
  next.updatedAt = new Date().toISOString();
  const payload = buildConsistencyTaskPersistDelta(previous, next);
  if (Object.keys(payload).length === 0) {
    return Promise.resolve();
  }
  const run = persistChain.then(async () => {
    await patchConsistencyTask(next.id, payload);
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

async function refreshConsistencyMenu() {
  await loadTasks();
  await refreshAllTaskStatuses();
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
  refreshTaskHistorySnapshot(task);
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
  let previousTask = cloneTaskForDelta(task);
  run.status = "submitted";
  run.error = undefined;
  refreshTaskAggregates(task);
  void persistTaskDelta(previousTask, task).catch((error) => {
    console.error(`consistency_tasks_persist_failed ${String(error)}`);
    ElMessage.error(`一致性任务保存失败：${error instanceof Error ? error.message : String(error)}`);
  });
  try {
    await submitRemoteScoreTask(task.serviceBaseUrl, buildSubmittedPayload(task, run.taskId));
    previousTask = cloneTaskForDelta(task);
    run.status = "queued";
    refreshTaskAggregates(task);
    void persistTaskDelta(previousTask, task).catch((error) => {
      console.error(`consistency_tasks_persist_failed ${String(error)}`);
      ElMessage.error(`一致性任务保存失败：${error instanceof Error ? error.message : String(error)}`);
    });
  } catch (error) {
    if (attempt < MAX_RESUBMIT_ATTEMPTS) {
      window.setTimeout(() => {
        void submitRun(task, run, attempt + 1);
      }, 1000);
      return;
    }
    previousTask = cloneTaskForDelta(task);
    run.status = "failed";
    run.error = error instanceof Error ? error.message : String(error);
    refreshTaskAggregates(task);
    void persistTaskDelta(previousTask, task).catch((persistError) => {
      console.error(`consistency_tasks_persist_failed ${String(persistError)}`);
      ElMessage.error(
        `一致性任务保存失败：${persistError instanceof Error ? persistError.message : String(persistError)}`,
      );
    });
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

async function refreshTaskStatus(task: ConsistencyTask, options: { silent?: boolean } = {}) {
  refreshingTaskId.value = task.id;
  try {
    const previousTask = cloneTaskForDelta(task);
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
    await persistTaskDelta(previousTask, task);
    if (!options.silent) {
      ElMessage.success("任务状态已刷新");
    }
  } catch (error) {
    if (!options.silent) {
      ElMessage.error(error instanceof Error ? error.message : String(error));
    }
    if (options.silent) {
      throw error;
    }
  } finally {
    refreshingTaskId.value = "";
  }
}

async function refreshAllTaskStatuses() {
  if (tasks.value.length === 0) {
    return;
  }
  refreshingAllTasks.value = true;
  try {
    const refreshableTasks = [...tasks.value];
    const failures: string[] = [];
    for (const task of refreshableTasks) {
      try {
        await refreshTaskStatus(task, { silent: true });
      } catch (error) {
        failures.push(`${task.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (failures.length > 0) {
      ElMessage.warning(`部分一致性任务状态刷新失败：${failures[0]}`);
    }
  } finally {
    refreshingAllTasks.value = false;
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
    const now = new Date().toISOString();
    const task: ConsistencyTask = {
      id: `C-${String(sequence).padStart(3, "0")}`,
      sequence,
      serviceBaseUrl: normalizeServiceBaseUrl(serviceBaseUrl.value),
      originalTaskId: validation.task.taskId,
      caseId: validation.task.testCase.id,
      caseName: validation.task.testCase.name,
      createdAt: now,
      updatedAt: now,
      status: "running",
      sourceTask: validation.task,
      runs,
      analysis: analyzeConsistency(runs),
      ruleReport: [],
      riskReport: [],
      analysisHistory: [],
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

function openTaskInfo(taskId: string) {
  taskInfoDrawerTaskId.value = taskId;
  taskInfoDrawerVisible.value = true;
}

function openSelectedTaskInfo() {
  if (!selectedTask.value) {
    return;
  }
  openTaskInfo(selectedTask.value.id);
}

function backToTaskList() {
  void router.push("/consistency");
}

async function deleteTask(taskId: string) {
  const task = tasks.value.find((item) => item.id === taskId);
  if (!task) {
    return;
  }
  try {
    await ElMessageBox.confirm(
      `确定删除一致性任务 ${task.id} / ${task.caseName} 吗？此操作无法撤销。`,
      "删除一致性任务",
      {
        confirmButtonText: "删除",
        cancelButtonText: "取消",
        type: "warning",
      },
    );
  } catch {
    return;
  }

  try {
    await deleteConsistencyTask(taskId);
    tasks.value = tasks.value.filter((item) => item.id !== taskId);
    for (const run of task.runs) {
      rawResults.delete(run.taskId);
    }
    taskSequence = tasks.value.reduce((max, item) => Math.max(max, item.sequence), 0);
    if (selectedTaskId.value === taskId || routeTaskId.value === taskId) {
      selectedTaskId.value = tasks.value[0]?.id ?? "";
      if (routeTaskId.value === taskId) {
        backToTaskList();
      }
    }
    ElMessage.success("一致性任务已删除");
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : String(error));
  }
}

async function deleteSelectedRound() {
  const task = selectedTask.value;
  const roundOption = selectedRoundOption.value;
  const roundView = selectedRoundView.value;
  if (!task || !roundOption || roundOption.round === undefined || !roundView) {
    return;
  }
  try {
    await ElMessageBox.confirm(
      `确定删除第 ${String(roundOption.round)} 轮吗？删除后会重新编号剩余轮次。`,
      "删除轮次",
      {
        confirmButtonText: "删除",
        cancelButtonText: "取消",
        type: "warning",
      },
    );
  } catch {
    return;
  }

  try {
    const taskIds = collectExclusiveRoundTaskIds(task, roundOption.round);
    if (taskIds.length > 0) {
      await deleteRemoteTasks(taskIds);
      for (const taskId of taskIds) {
        rawResults.delete(taskId);
      }
    }
    const nextTask = removeConsistencyAnalysisHistoryRound(task, roundOption.round) as ConsistencyTask;
    Object.assign(task, nextTask);
    const nextSelection = roundOptions.value.some((option) => option.value === roundOption.value)
      ? roundOption.value
      : getConsistencyTaskDefaultRoundSelection(task);
    selectedRound.value = nextSelection;
    await persistTaskNow(task);
    ElMessage.success("轮次已删除");
  } catch (error) {
    ElMessage.error(`轮次删除失败：${error instanceof Error ? error.message : String(error)}`);
  }
}

function rerunTask(taskId: string) {
  const task = tasks.value.find((item) => item.id === taskId);
  if (!task) {
    return;
  }
  if (!canRerunTask(task)) {
    ElMessage.warning("当前任务仍在运行，结束后才能重新运行");
    return;
  }
  const validation = validateRemoteEvaluationTaskInput(task.sourceTask);
  if (!validation.valid) {
    ElMessage.error(`无法重新运行：原始远端任务信息不完整。${validation.errors.join("；")}`);
    return;
  }
  const previousTask = cloneTaskForDelta(task);
  refreshTaskHistorySnapshot(task);
  const nextTaskIds = generateNextSubmittedTaskIds(task, RUN_COUNT);
  for (const run of task.runs) {
    resetConsistencyRunForRerun(run, nextTaskIds[run.runIndex] ?? run.taskId);
  }
  refreshTaskAggregates(task);
  void persistTaskDelta(previousTask, task).catch((error) => {
    console.error(`consistency_tasks_persist_failed ${String(error)}`);
    ElMessage.error(`一致性任务保存失败：${error instanceof Error ? error.message : String(error)}`);
  });
  rawResults.clear();
  reportRun.value = null;
  reportCase.value = null;
  reportError.value = "";
  void runTask(task);
}

function canRerunTask(task: ConsistencyTask) {
  return task.status !== "running";
}

function handleTaskAction(task: ConsistencyTask, command: string) {
  if (command === "task-info") {
    openTaskInfo(task.id);
    return;
  }
  if (command === "refresh") {
    void refreshTaskStatus(task);
    return;
  }
  if (command === "rerun") {
    rerunTask(task.id);
    return;
  }
  if (command === "delete") {
    void deleteTask(task.id);
  }
}

async function copyTaskInfoJson() {
  const json = taskInfoDrawerInputInfo.value?.sourceTaskJson ?? "";
  if (!json) {
    return;
  }
  try {
    await navigator.clipboard.writeText(json);
    ElMessage.success("任务 JSON 已复制");
  } catch (error) {
    ElMessage.error(`复制失败：${error instanceof Error ? error.message : String(error)}`);
  }
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

function openRiskDetailDrawer(item: RiskConsistencyReportItem) {
  riskDetailItem.value = item;
  riskDetailDrawerVisible.value = true;
}

function triggerZipDownload(filename: string, archive: Uint8Array) {
  const body = archive.buffer.slice(
    archive.byteOffset,
    archive.byteOffset + archive.byteLength,
  ) as ArrayBuffer;
  const blob = new Blob([body], { type: "application/zip" });
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
    const exportRuns = collectConsistencyExportRuns(task);
    for (const run of exportRuns) {
      try {
        results.set(run.taskId, await ensureRunResult(task, run));
      } catch (error) {
        results.set(run.taskId, error);
      }
    }
    const payload = buildConsistencyExportPayload(task, results);
    triggerZipDownload(
      `consistency-${task.id}-results.zip`,
      createStoredZip(buildConsistencyExportFiles(payload)),
    );
    const successCount = [...results.values()].filter((value) => !(value instanceof Error)).length;
    if (successCount === 0) {
      ElMessage.warning("未下载到运行原始结果，已导出分析结果和错误信息");
    } else if (successCount < exportRuns.length) {
      ElMessage.warning("部分运行结果不可用，已导出可用结果和错误信息");
    } else {
      ElMessage.success("一致性任务结果已下载");
    }
  } finally {
    downloadingResults.value = false;
  }
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

function formatScoreDelta(run: ConsistencyRunSummary) {
  const baseline = selectedRoundView.value?.analysis.medianScore;
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

function formatRunConsistency(run: ConsistencyRunSummary) {
  if (run.status !== "completed") {
    return "-";
  }
  return selectedRoundView.value?.analysis.runConsistencyByTaskId[run.taskId] ? "一致" : "波动";
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
  await refreshConsistencyMenu();
}

watch([tasks, pageSize], () => {
  if ((page.value - 1) * pageSize.value >= tasks.value.length && page.value > 1) {
    page.value -= 1;
  }
});

watch(isDetailPage, (inDetailPage, wasDetailPage) => {
  if (!inDetailPage && wasDetailPage) {
    void refreshConsistencyMenu();
  }
});

onMounted(() => {
  void refreshConsistencyMenu();
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
