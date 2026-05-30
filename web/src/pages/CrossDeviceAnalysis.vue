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
          <el-table :data="cases" v-loading="caseLoading" stripe>
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
            <div class="rule-summary">
              <el-tag effect="plain">{{ ruleSummaryText }}</el-tag>
            </div>
          </div>
          <el-table :data="rules" v-loading="ruleLoading" stripe>
            <el-table-column prop="ruleId" label="规则" min-width="260" show-overflow-tooltip />
            <el-table-column prop="ruleSummary" label="摘要" min-width="260" show-overflow-tooltip />
            <el-table-column prop="sourceRuleSet" label="来源" min-width="220" show-overflow-tooltip />
            <el-table-column prop="affectedTaskCount" label="影响用例" width="100" />
            <el-table-column label="最近命中" min-width="170">
              <template #default="{ row }">
                {{ formatDashboardDateTime(row.lastViolatedAt) }}
              </template>
            </el-table-column>
            <el-table-column label="命中比例" width="150">
              <template #default="{ row }">
                {{ formatHitRatio(row.affectedTaskCount, ruleSummary.relatedCaseCount) }}
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
          <el-table :data="riskReviews" v-loading="riskLoading" stripe>
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

    <el-drawer v-model="caseDrawerVisible" size="64%" :title="caseDrawerTitle">
      <div v-if="selectedCase" class="case-report-drawer">
        <section class="report-hero">
          <div class="report-hero-main">
            <div class="report-eyebrow">Cross-device evaluation</div>
            <div class="score-row">
              <span class="score-number">{{ formatScore(selectedCase.score) }}</span>
              <el-tag :type="selectedCase.hardGateTriggered ? 'danger' : 'success'" effect="light">
                {{ selectedCase.hardGateTriggered ? "触发硬门槛" : "未触发硬门槛" }}
              </el-tag>
            </div>
            <div class="case-name">{{ selectedCase.name }}</div>
            <div class="hero-meta">
              <span>taskId {{ selectedCase.taskId }}</span>
              <span>testCaseId {{ selectedCase.testCaseId ?? "-" }}</span>
              <span>{{ selectedCase.taskType }}</span>
              <span>{{ formatDashboardDateTime(selectedCase.updatedAt) }}</span>
            </div>
          </div>
          <div class="report-stat-grid">
            <div class="report-stat">
              <span>内置规则违背</span>
              <strong>{{ selectedCase.crossDeviceRuleAuditCounts.violated }}</strong>
            </div>
            <div class="report-stat">
              <span>官方检查命中</span>
              <strong>{{ selectedCase.crossDeviceFindingCount }}</strong>
            </div>
            <div class="report-stat">
              <span>待复核规则</span>
              <strong>{{ selectedCase.crossDeviceRuleAuditCounts.review }}</strong>
            </div>
            <div class="report-stat">
              <span>风险项</span>
              <strong>{{ selectedCase.riskCount }}</strong>
            </div>
          </div>
        </section>

        <section class="report-section">
          <div class="report-section-title">
            <div>
              <small>Rule packs</small>
              <h3>启用规则集</h3>
            </div>
            <el-tag :type="selectedCase.crossDeviceRuleSetApplied ? 'success' : 'info'" effect="plain">
              官方一多规则集{{ selectedCase.crossDeviceRuleSetApplied ? "已启用" : "未启用" }}
            </el-tag>
          </div>
          <div class="pack-list">
            <div
              v-for="pack in selectedCase.boundRulePacks"
              :key="pack.packId"
              class="pack-row"
              :class="{ 'pack-row-strong': isCrossDevicePack(pack.packId) }"
            >
              <div>
                <strong>{{ pack.displayName }}</strong>
                <span>{{ pack.packId }}</span>
              </div>
              <el-tag :type="isCrossDevicePack(pack.packId) ? 'primary' : 'info'" effect="light">
                {{ isCrossDevicePack(pack.packId) ? "一多条件规则包" : "基础规则包" }}
              </el-tag>
            </div>
            <div class="pack-row pack-row-strong">
              <div>
                <strong>官方 Code Linter 一多规则集</strong>
                <span>plugin:@cross-device-app-dev/recommended</span>
              </div>
              <el-tag :type="selectedCase.crossDeviceRuleSetApplied ? 'success' : 'info'" effect="light">
                {{ selectedCase.crossDeviceRuleSetApplied ? "已启用" : "未启用" }}
              </el-tag>
            </div>
          </div>
        </section>

        <section class="report-section">
          <div class="report-section-title">
            <div>
              <small>Built-in rule audit</small>
              <h3>一多内置规则审计</h3>
            </div>
            <div class="result-chip-row">
              <el-tag type="danger" effect="plain">
                不满足 {{ selectedCase.crossDeviceRuleAuditCounts.violated }}
              </el-tag>
              <el-tag type="warning" effect="plain">
                待复核 {{ selectedCase.crossDeviceRuleAuditCounts.review }}
              </el-tag>
              <el-tag type="success" effect="plain">
                满足 {{ selectedCase.crossDeviceRuleAuditCounts.satisfied }}
              </el-tag>
              <el-tag effect="plain">
                不涉及 {{ selectedCase.crossDeviceRuleAuditCounts.notInvolved }}
              </el-tag>
            </div>
          </div>
          <div class="audit-filter-row">
            <el-radio-group v-model="ruleAuditFilter" size="small">
              <el-radio-button
                v-for="option in ruleAuditFilterOptions"
                :key="option"
                :label="option"
              >
                {{ option === "全部" ? "全部" : `${option} (${getRuleAuditCount(option)})` }}
              </el-radio-button>
            </el-radio-group>
          </div>
          <el-table
            :data="filteredCrossDeviceRuleAuditResults"
            size="small"
            stripe
            empty-text="暂无一多内置规则审计结果"
          >
            <el-table-column label="结果" width="96">
              <template #default="{ row }">
                <el-tag :type="formatRuleResultTag(row.result)" effect="light">
                  {{ row.result ?? "-" }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="规则" min-width="130">
              <template #default="{ row }">
                <OverflowTextTooltip :text="row.ruleId" />
              </template>
            </el-table-column>
            <el-table-column label="类型" width="96">
              <template #default="{ row }">
                {{ formatRuleSource(row.ruleSource) }}
              </template>
            </el-table-column>
            <el-table-column label="摘要" min-width="230">
              <template #default="{ row }">
                <OverflowTextTooltip :text="row.ruleSummary" />
              </template>
            </el-table-column>
            <el-table-column label="结论" min-width="260">
              <template #default="{ row }">
                <OverflowTextTooltip :text="row.conclusion" />
              </template>
            </el-table-column>
          </el-table>
        </section>

        <section class="report-section">
          <div class="report-section-title">
            <div>
              <small>Official linter</small>
              <h3>官方一多检查结果</h3>
            </div>
            <el-tag effect="plain">状态 {{ selectedCase.officialLinterRunStatus ?? "-" }}</el-tag>
          </div>
          <el-table
            :data="selectedCase.crossDeviceOfficialLinterResults"
            size="small"
            stripe
            empty-text="暂无官方一多检查结果"
          >
            <el-table-column label="规则" min-width="220">
              <template #default="{ row }">
                <OverflowTextTooltip :text="row.ruleId" />
              </template>
            </el-table-column>
            <el-table-column prop="severity" label="级别" width="90" />
            <el-table-column prop="findingCount" label="命中" width="80" />
            <el-table-column label="结论" min-width="280">
              <template #default="{ row }">
                <OverflowTextTooltip :text="row.conclusion" />
              </template>
            </el-table-column>
          </el-table>
        </section>

        <section class="report-section report-two-column">
          <div>
            <div class="report-section-title compact">
              <div>
                <small>Understanding</small>
                <h3>一多判定原因</h3>
              </div>
            </div>
            <ul class="detail-list">
              <li v-for="reason in selectedCase.reasons" :key="reason">{{ reason }}</li>
            </ul>
          </div>
          <div>
            <div class="report-section-title compact">
              <div>
                <small>Risks</small>
                <h3>风险摘要</h3>
              </div>
            </div>
            <div class="risk-summary-row">
              <el-tag v-for="item in selectedCase.riskLevelCounts" :key="item.level" effect="plain">
                {{ item.level }}: {{ item.count }}
              </el-tag>
              <span v-if="selectedCase.riskLevelCounts.length === 0" class="empty-inline">
                暂无风险项
              </span>
            </div>
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
import OverflowTextTooltip from "../components/OverflowTextTooltip.vue";
import TaskStatusTag from "../components/TaskStatusTag.vue";
import { createRecentDashboardRange, refreshDashboardRangeEnd } from "../dashboardDateRange";
import { formatDashboardDateTime } from "../dateTime";
import { buildCrossDeviceRiskQueryParams } from "./crossDeviceRiskQuery";

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
const ruleSummary = ref({ relatedCaseCount: 0, violatedRuleCount: 0, totalViolationEvents: 0 });
const caseLoading = ref(false);
const ruleLoading = ref(false);
const riskLoading = ref(false);
const casePage = ref(1);
const casePageSize = ref(10);
const caseTotal = ref(0);
const rulePage = ref(1);
const rulePageSize = ref(10);
const ruleTotal = ref(0);
const riskPage = ref(1);
const riskPageSize = ref(10);
const riskTotal = ref(0);
const caseDrawerVisible = ref(false);
const selectedCase = ref<CrossDeviceCase | null>(null);
const ruleAuditFilter = ref<"全部" | "不满足" | "待人工复核" | "满足" | "不涉及">("不满足");
const ruleAuditFilterOptions = ["不满足", "待人工复核", "满足", "不涉及", "全部"] as const;

const caseFilters = reactive({
  keyword: "",
});
const ruleFilters = reactive({
  keyword: "",
});
const riskFilters = reactive({
  keyword: "",
  riskLevel: "" as "" | "high" | "medium" | "low",
});

const caseDrawerTitle = computed(() => {
  if (!selectedCase.value) {
    return "用例详情";
  }
  return `#${String(selectedCase.value.taskId)} ${selectedCase.value.name}`;
});

const ruleSummaryText = computed(() => {
  return `用例 ${ruleSummary.value.relatedCaseCount} / 规则 ${ruleSummary.value.violatedRuleCount} / 命中 ${ruleSummary.value.totalViolationEvents}`;
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
    });
    rules.value = response.items;
    ruleTotal.value = response.total;
    ruleSummary.value = response.summary;
  } finally {
    ruleLoading.value = false;
  }
}

async function loadRiskReviews() {
  riskLoading.value = true;
  try {
    const response = await fetchCrossDeviceRiskReviewCalibrations(
      buildCrossDeviceRiskQueryParams({
        ...dateParams(),
        page: riskPage.value,
        pageSize: riskPageSize.value,
        keyword: riskFilters.keyword || undefined,
        riskLevel: riskFilters.riskLevel || undefined,
      }),
    );
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
  ruleAuditFilter.value = "不满足";
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

function formatScore(score: number | null): string {
  return score === null ? "--" : String(score);
}

function formatHitRatio(hitCount: number, totalCount: number): string {
  if (totalCount <= 0) {
    return "0/0 (0%)";
  }
  const percent = (hitCount / totalCount) * 100;
  return `${String(hitCount)}/${String(totalCount)} (${percent.toFixed(1)}%)`;
}

function isCrossDevicePack(packId: string): boolean {
  return packId === "cross-device-adaptation";
}

function formatRuleSource(ruleSource?: string): string {
  if (ruleSource === "must_rule") {
    return "must";
  }
  if (ruleSource === "should_rule") {
    return "should";
  }
  if (ruleSource === "forbidden_pattern") {
    return "forbidden";
  }
  return ruleSource ?? "-";
}

function formatRuleResultTag(result?: string): "success" | "warning" | "danger" | "info" {
  if (result === "不满足") {
    return "danger";
  }
  if (result === "待人工复核") {
    return "warning";
  }
  if (result === "满足") {
    return "success";
  }
  return "info";
}

function getRuleAuditCount(
  filter: (typeof ruleAuditFilterOptions)[number],
): number {
  if (!selectedCase.value) {
    return 0;
  }
  if (filter === "全部") {
    return selectedCase.value.crossDeviceRuleAuditCounts.total;
  }
  if (filter === "不满足") {
    return selectedCase.value.crossDeviceRuleAuditCounts.violated;
  }
  if (filter === "待人工复核") {
    return selectedCase.value.crossDeviceRuleAuditCounts.review;
  }
  if (filter === "满足") {
    return selectedCase.value.crossDeviceRuleAuditCounts.satisfied;
  }
  return selectedCase.value.crossDeviceRuleAuditCounts.notInvolved;
}

const filteredCrossDeviceRuleAuditResults = computed(() => {
  if (!selectedCase.value) {
    return [];
  }
  if (ruleAuditFilter.value === "全部") {
    return selectedCase.value.crossDeviceRuleAuditResults;
  }
  return selectedCase.value.crossDeviceRuleAuditResults.filter(
    (item) => item.result === ruleAuditFilter.value,
  );
});

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
  const refreshedRange = refreshDashboardRangeEnd(range.value);
  if (refreshedRange) {
    range.value = refreshedRange;
    return;
  }
  void loadActiveTab();
}

watch(tab, loadActiveTab);
watch(range, loadActiveTab);
watch([casePage, casePageSize], loadCases);
watch([rulePage, rulePageSize], loadRules);
watch([riskPage, riskPageSize], loadRiskReviews);
watch(() => caseFilters.keyword, reloadCasesFromFirstPage);
watch(() => ruleFilters.keyword, reloadRulesFromFirstPage);
watch(
  () => [riskFilters.keyword, riskFilters.riskLevel],
  reloadRiskReviewsFromFirstPage,
);

onMounted(() => {
  range.value = createRecentDashboardRange(7);
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
  align-items: center;
  margin-bottom: 12px;
}

.rule-summary {
  display: flex;
  flex: 1;
  justify-content: flex-end;
}

.table-pagination {
  display: flex;
  justify-content: flex-end;
  margin-top: 12px;
}

.case-report-drawer {
  display: flex;
  flex-direction: column;
  gap: 16px;
  color: #142033;
}

.report-hero,
.report-section {
  border: 1px solid #d9e2ec;
  border-radius: 8px;
  background: #ffffff;
  box-shadow: 0 12px 28px rgba(20, 32, 51, 0.06);
}

.report-hero {
  display: grid;
  grid-template-columns: minmax(0, 1.3fr) minmax(260px, 0.7fr);
  gap: 14px;
  padding: 16px;
}

.report-hero-main {
  min-width: 0;
  padding: 18px;
  border: 1px solid #d6e5ff;
  border-radius: 8px;
  background: linear-gradient(145deg, #f8fbff, #eef4ff);
}

.report-eyebrow,
.report-section-title small {
  color: #667085;
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
}

.score-row {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 12px;
  margin: 12px 0 8px;
}

.score-number {
  font-size: 54px;
  font-weight: 760;
  line-height: 0.95;
}

.case-name {
  overflow-wrap: anywhere;
  font-size: 18px;
  font-weight: 700;
}

.hero-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 14px;
  margin-top: 12px;
  color: #667085;
  font-size: 13px;
}

.report-stat-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.report-stat {
  min-width: 0;
  padding: 14px;
  border: 1px solid #e5e9ef;
  border-radius: 8px;
  background: #f8fafc;
}

.report-stat span {
  display: block;
  color: #667085;
  font-size: 13px;
}

.report-stat strong {
  display: block;
  margin-top: 6px;
  font-size: 26px;
  line-height: 1;
}

.report-section {
  padding: 16px;
}

.report-section-title {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}

.report-section-title.compact {
  margin-bottom: 10px;
}

.report-section-title h3 {
  margin: 3px 0 0;
  font-size: 18px;
}

.result-chip-row,
.pack-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.audit-filter-row {
  margin-bottom: 12px;
}

.pack-list {
  flex-direction: column;
}

.pack-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-width: 0;
  padding: 12px 14px;
  border: 1px solid #e5e9ef;
  border-radius: 8px;
  background: #f8fafc;
}

.pack-row-strong {
  border-color: #b8d2ff;
  background: #f2f7ff;
}

.pack-row div {
  min-width: 0;
}

.pack-row strong,
.pack-row span {
  display: block;
  overflow-wrap: anywhere;
}

.pack-row span {
  margin-top: 4px;
  color: #667085;
  font-size: 13px;
}

.report-two-column {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 18px;
}

.empty-inline {
  color: #667085;
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

@media (max-width: 900px) {
  .report-hero,
  .report-two-column {
    grid-template-columns: 1fr;
  }

  .report-stat-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
