<template>
  <div class="page-stack">
    <el-tabs v-model="tab">
      <el-tab-pane label="一多用例" name="cases">
        <div class="table-card">
          <div class="toolbar cross-device-toolbar">
            <el-input
              v-model="caseFilters.keyword"
              clearable
              placeholder="名称 / taskId / testCaseId"
              style="width: 260px"
            />
          </div>
          <el-table :data="cases" v-loading="caseLoading" stripe height="560">
            <el-table-column prop="taskId" label="taskId" width="100" />
            <el-table-column prop="testCaseId" label="testCaseId" width="120" />
            <el-table-column label="名称" min-width="240" show-overflow-tooltip>
              <template #default="{ row }">
                <el-link type="primary" :href="buildScoringResultUrl(row.taskId)" target="_blank">
                  {{ row.name }}
                </el-link>
              </template>
            </el-table-column>
            <el-table-column prop="taskType" label="类型" width="140" />
            <el-table-column label="状态" width="110">
              <template #default="{ row }">
                <TaskStatusTag :status-category="row.statusCategory" />
              </template>
            </el-table-column>
            <el-table-column prop="score" label="分数" width="90" />
            <el-table-column prop="crossDeviceFindingCount" label="规则命中" width="100" />
            <el-table-column prop="riskCount" label="风险项" width="90" />
            <el-table-column label="更新时间" min-width="170">
              <template #default="{ row }">
                {{ formatDashboardDateTime(row.updatedAt) }}
              </template>
            </el-table-column>
            <el-table-column label="操作" width="100" fixed="right">
              <template #default="{ row }">
                <el-button link type="primary" @click="openCaseDetail(row)">详情</el-button>
              </template>
            </el-table-column>
          </el-table>
          <div class="table-pagination">
            <el-pagination
              v-model:current-page="casePage"
              v-model:page-size="casePageSize"
              :total="caseTotal"
              :page-sizes="[10, 20, 50, 100]"
              layout="total, sizes, prev, pager, next"
              background
            />
          </div>
        </div>
      </el-tab-pane>

      <el-tab-pane label="规则违背" name="rules">
        <div class="table-card">
          <div class="toolbar cross-device-toolbar">
            <el-input
              v-model="ruleFilters.keyword"
              clearable
              placeholder="规则关键词"
              style="width: 240px"
            />
            <el-checkbox v-model="ruleFilters.includeOtherRules">包含其他规则</el-checkbox>
          </div>
          <el-table :data="rules" v-loading="ruleLoading" stripe height="560">
            <el-table-column prop="ruleId" label="规则" min-width="260" show-overflow-tooltip />
            <el-table-column prop="ruleSummary" label="摘要" min-width="260" show-overflow-tooltip />
            <el-table-column prop="sourceRuleSet" label="来源" min-width="220" show-overflow-tooltip />
            <el-table-column prop="severity" label="级别" width="90" />
            <el-table-column prop="violationCount" label="次数" width="90" />
            <el-table-column prop="affectedTaskCount" label="影响用例" width="100" />
            <el-table-column label="最近命中" min-width="170">
              <template #default="{ row }">
                {{ formatDashboardDateTime(row.lastViolatedAt) }}
              </template>
            </el-table-column>
          </el-table>
          <div class="table-pagination">
            <el-pagination
              v-model:current-page="rulePage"
              v-model:page-size="rulePageSize"
              :total="ruleTotal"
              :page-sizes="[10, 20, 50, 100]"
              layout="total, sizes, prev, pager, next"
              background
            />
          </div>
        </div>
      </el-tab-pane>

      <el-tab-pane label="风险项分析" name="risk">
        <div class="table-card">
          <div class="toolbar cross-device-toolbar">
            <el-input
              v-model="riskFilters.keyword"
              clearable
              placeholder="名称 / taskId"
              style="width: 220px"
            />
            <el-select
              v-model="riskFilters.agreement"
              placeholder="人工同意"
              clearable
              style="width: 150px"
            >
              <el-option label="同意" value="agreed" />
              <el-option label="不同意" value="disagreed" />
            </el-select>
            <el-select
              v-model="riskFilters.riskLevel"
              placeholder="风险等级"
              clearable
              style="width: 150px"
            >
              <el-option label="high" value="high" />
              <el-option label="medium" value="medium" />
              <el-option label="low" value="low" />
            </el-select>
          </div>
          <el-table :data="riskReviews" v-loading="riskLoading" stripe height="560">
            <el-table-column prop="taskId" label="taskId" width="100" />
            <el-table-column prop="testCaseId" label="testCaseId" width="120" />
            <el-table-column prop="caseName" label="名称" min-width="220" show-overflow-tooltip />
            <el-table-column label="风险等级" width="100">
              <template #default="{ row }">
                {{ row.resultRisk?.level ?? "-" }}
              </template>
            </el-table-column>
            <el-table-column label="风险标题" min-width="220" show-overflow-tooltip>
              <template #default="{ row }">
                {{ row.resultRisk?.title ?? "-" }}
              </template>
            </el-table-column>
            <el-table-column label="人工同意" width="100">
              <template #default="{ row }">
                {{ formatAgreement(row.humanReview) }}
              </template>
            </el-table-column>
            <el-table-column label="修正等级" width="100">
              <template #default="{ row }">
                {{ row.humanReview?.correctedLevel ?? "-" }}
              </template>
            </el-table-column>
            <el-table-column label="原因" min-width="240" show-overflow-tooltip>
              <template #default="{ row }">
                {{ row.humanReview?.reason ?? row.humanReview?.comment ?? "-" }}
              </template>
            </el-table-column>
          </el-table>
          <div class="table-pagination">
            <el-pagination
              v-model:current-page="riskPage"
              v-model:page-size="riskPageSize"
              :total="riskTotal"
              :page-sizes="[10, 20, 50, 100]"
              layout="total, sizes, prev, pager, next"
              background
            />
          </div>
        </div>
      </el-tab-pane>
    </el-tabs>

    <el-drawer v-model="caseDrawerVisible" size="48%" :title="caseDrawerTitle">
      <div v-if="selectedCase" class="case-detail-stack">
        <section>
          <div class="detail-section-title">基本信息</div>
          <div class="detail-grid">
            <span>taskId</span>
            <strong>{{ selectedCase.taskId }}</strong>
            <span>testCaseId</span>
            <strong>{{ selectedCase.testCaseId ?? "-" }}</strong>
            <span>类型</span>
            <strong>{{ selectedCase.taskType }}</strong>
            <span>分数</span>
            <strong>{{ selectedCase.score ?? "-" }}</strong>
            <span>状态</span>
            <strong>{{ selectedCase.status }}</strong>
            <span>更新时间</span>
            <strong>{{ formatDashboardDateTime(selectedCase.updatedAt) }}</strong>
          </div>
        </section>
        <section>
          <div class="detail-section-title">一多原因</div>
          <ul class="detail-list">
            <li v-for="reason in selectedCase.reasons" :key="reason">{{ reason }}</li>
          </ul>
        </section>
        <section>
          <div class="detail-section-title">官方代码检查器</div>
          <div class="detail-grid">
            <span>状态</span>
            <strong>{{ selectedCase.officialLinterRunStatus ?? "-" }}</strong>
            <span>一多规则集</span>
            <strong>{{ selectedCase.crossDeviceRuleSetApplied ? "已启用" : "未启用" }}</strong>
            <span>命中数</span>
            <strong>{{ selectedCase.crossDeviceFindingCount }}</strong>
          </div>
        </section>
        <section>
          <div class="detail-section-title">高频违背规则</div>
          <el-table :data="selectedCase.topRuleViolations" size="small" stripe>
            <el-table-column prop="ruleId" label="规则" min-width="220" show-overflow-tooltip />
            <el-table-column prop="findingCount" label="命中" width="80" />
          </el-table>
        </section>
        <section>
          <div class="detail-section-title">风险摘要</div>
          <div class="risk-summary-row">
            <el-tag v-for="item in selectedCase.riskLevelCounts" :key="item.level" effect="plain">
              {{ item.level }}: {{ item.count }}
            </el-tag>
            <span v-if="selectedCase.riskLevelCounts.length === 0" class="empty-inline">
              暂无风险项
            </span>
          </div>
        </section>
      </div>
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, onBeforeUnmount, onMounted, reactive, ref, watch, type Ref } from "vue";
import {
  fetchCrossDeviceCases,
  fetchCrossDeviceRiskReviewCalibrations,
  fetchCrossDeviceRuleViolations,
  type CrossDeviceCase,
  type CrossDeviceRuleViolation,
  type RiskReviewCalibration,
} from "../api/dashboard";
import TaskStatusTag from "../components/TaskStatusTag.vue";
import { formatDashboardDateTime } from "../dateTime";

type DashboardTitleControls = {
  dateRange?: {
    model: Ref<[Date, Date] | null>;
  };
};

const setTitleControls =
  inject<(controls: DashboardTitleControls | null) => void>("setDashboardTitleControls");

const tab = ref<"cases" | "rules" | "risk">("cases");
const range = ref<[Date, Date] | null>(null);
const cases = ref<CrossDeviceCase[]>([]);
const rules = ref<CrossDeviceRuleViolation[]>([]);
const riskReviews = ref<RiskReviewCalibration[]>([]);
const caseLoading = ref(false);
const ruleLoading = ref(false);
const riskLoading = ref(false);
const casePage = ref(1);
const casePageSize = ref(20);
const caseTotal = ref(0);
const rulePage = ref(1);
const rulePageSize = ref(20);
const ruleTotal = ref(0);
const riskPage = ref(1);
const riskPageSize = ref(20);
const riskTotal = ref(0);
const caseDrawerVisible = ref(false);
const selectedCase = ref<CrossDeviceCase | null>(null);

const caseFilters = reactive({
  keyword: "",
});
const ruleFilters = reactive({
  keyword: "",
  includeOtherRules: false,
});
const riskFilters = reactive({
  keyword: "",
  agreement: "" as "" | "agreed" | "disagreed",
  riskLevel: "" as "" | "high" | "medium" | "low",
});

const caseDrawerTitle = computed(() => {
  if (!selectedCase.value) {
    return "用例详情";
  }
  return `#${String(selectedCase.value.taskId)} ${selectedCase.value.name}`;
});

function buildScoringResultUrl(taskId: number): string {
  return `http://47.100.28.161:3000/web/dashboard/scoring-results/${String(taskId)}`;
}

function dateParams() {
  return {
    from: range.value?.[0]?.toISOString(),
    to: range.value?.[1]?.toISOString(),
  };
}

async function loadCases() {
  caseLoading.value = true;
  try {
    const response = await fetchCrossDeviceCases({
      ...dateParams(),
      page: casePage.value,
      pageSize: casePageSize.value,
      keyword: caseFilters.keyword || undefined,
      sortBy: "updatedAt",
      sortOrder: "desc",
    });
    cases.value = response.items;
    caseTotal.value = response.total;
  } finally {
    caseLoading.value = false;
  }
}

async function loadRules() {
  ruleLoading.value = true;
  try {
    const response = await fetchCrossDeviceRuleViolations({
      ...dateParams(),
      page: rulePage.value,
      pageSize: rulePageSize.value,
      keyword: ruleFilters.keyword || undefined,
      includeOtherRules: ruleFilters.includeOtherRules ? "true" : undefined,
    });
    rules.value = response.items;
    ruleTotal.value = response.total;
  } finally {
    ruleLoading.value = false;
  }
}

async function loadRiskReviews() {
  riskLoading.value = true;
  try {
    const response = await fetchCrossDeviceRiskReviewCalibrations({
      ...dateParams(),
      page: riskPage.value,
      pageSize: riskPageSize.value,
      keyword: riskFilters.keyword || undefined,
      agreement: riskFilters.agreement || undefined,
      riskLevel: riskFilters.riskLevel || undefined,
    });
    riskReviews.value = response.items;
    riskTotal.value = response.total;
  } finally {
    riskLoading.value = false;
  }
}

async function loadActiveTab() {
  if (tab.value === "cases") {
    await loadCases();
    return;
  }
  if (tab.value === "rules") {
    await loadRules();
    return;
  }
  await loadRiskReviews();
}

function openCaseDetail(row: CrossDeviceCase) {
  selectedCase.value = row;
  caseDrawerVisible.value = true;
}

function formatAgreement(review: RiskReviewCalibration["humanReview"]): string {
  const agreed = review?.agreeWithResultLevel ?? review?.agree;
  if (agreed === true) {
    return "同意";
  }
  if (agreed === false) {
    return "不同意";
  }
  return "-";
}

function reloadCasesFromFirstPage() {
  if (casePage.value === 1) {
    void loadCases();
    return;
  }
  casePage.value = 1;
}

function reloadRulesFromFirstPage() {
  if (rulePage.value === 1) {
    void loadRules();
    return;
  }
  rulePage.value = 1;
}

function reloadRiskReviewsFromFirstPage() {
  if (riskPage.value === 1) {
    void loadRiskReviews();
    return;
  }
  riskPage.value = 1;
}

function onRefresh() {
  void loadActiveTab();
}

watch(tab, loadActiveTab);
watch(range, loadActiveTab);
watch([casePage, casePageSize], loadCases);
watch([rulePage, rulePageSize], loadRules);
watch([riskPage, riskPageSize], loadRiskReviews);
watch(() => caseFilters.keyword, reloadCasesFromFirstPage);
watch(() => [ruleFilters.keyword, ruleFilters.includeOtherRules], reloadRulesFromFirstPage);
watch(
  () => [riskFilters.keyword, riskFilters.agreement, riskFilters.riskLevel],
  reloadRiskReviewsFromFirstPage,
);

onMounted(() => {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 7);
  range.value = [start, end];
  setTitleControls?.({ dateRange: { model: range } });
  void loadCases();
  window.addEventListener("dashboard:refresh", onRefresh as EventListener);
});

onBeforeUnmount(() => {
  setTitleControls?.(null);
  window.removeEventListener("dashboard:refresh", onRefresh as EventListener);
});
</script>

<style scoped>
.cross-device-toolbar {
  margin-bottom: 12px;
}

.table-pagination {
  display: flex;
  justify-content: flex-end;
  margin-top: 12px;
}

.case-detail-stack {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.detail-section-title {
  margin-bottom: 10px;
  font-size: 15px;
  font-weight: 700;
}

.detail-grid {
  display: grid;
  grid-template-columns: 120px minmax(0, 1fr);
  gap: 8px 12px;
  padding: 12px;
  border: 1px solid #e5e9ef;
  border-radius: 8px;
  background: #f8fafc;
}

.detail-grid span,
.empty-inline {
  color: #667085;
}

.detail-grid strong {
  min-width: 0;
  overflow-wrap: anywhere;
}

.detail-list {
  margin: 0;
  padding-left: 18px;
  color: #344054;
}

.risk-summary-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
</style>
