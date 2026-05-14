<template>
  <div class="page-stack">
    <el-tabs v-model="tab">
      <el-tab-pane label="人工评分差异分析" name="gap">
        <div class="table-card">
          <div class="toolbar" style="margin-bottom: 12px">
            <el-input
              v-model="gapFilters.keyword"
              clearable
              placeholder="名称 / ID"
              style="width: 220px"
            />
            <el-select
              v-model="gapFilters.primaryConclusion"
              placeholder="结论"
              clearable
              style="width: 240px"
            >
              <el-option
                v-for="item in gapConclusionOptions"
                :key="item"
                :label="item"
                :value="item"
              />
            </el-select>
          </div>
          <el-table :data="gaps" v-loading="gapLoading" stripe height="560">
            <el-table-column prop="taskId" label="taskId" width="100" />
            <el-table-column prop="caseName" label="名称" min-width="220" />
            <el-table-column prop="manualRating" label="人工" width="90" />
            <el-table-column prop="autoRating" label="自动" width="90" />
            <el-table-column prop="autoScore" label="自动分" width="90" />
            <el-table-column prop="primaryConclusion" label="结论" min-width="200" />
            <el-table-column prop="reasonSummary" label="摘要" min-width="260" />
          </el-table>
          <div class="table-pagination">
            <el-pagination
              v-model:current-page="gapPage"
              v-model:page-size="gapPageSize"
              :total="gapTotal"
              :page-sizes="[10, 20, 50, 100]"
              layout="total, sizes, prev, pager, next"
              background
            />
          </div>
        </div>
      </el-tab-pane>
      <el-tab-pane label="负向结果分析" name="negative">
        <div class="page-stack" v-loading="negativeLoading">
          <div class="metrics-grid">
            <MetricCard label="失败任务" :value="negative?.summary.failedTaskCount ?? 0" />
            <MetricCard label="低分任务" :value="negative?.summary.lowScoreTaskCount ?? 0" />
            <MetricCard label="硬门槛" :value="negative?.summary.hardGateTaskCount ?? 0" />
            <MetricCard label="高风险" :value="negative?.summary.highRiskTaskCount ?? 0" />
            <MetricCard label="规则违反" :value="negative?.summary.violatedRuleCount ?? 0" />
          </div>
          <div class="table-card">
            <el-table :data="negative?.topRuleViolations ?? []" stripe>
              <el-table-column prop="rule_id" label="规则" width="180" />
              <el-table-column prop="rule_summary" label="摘要" />
              <el-table-column prop="violationCount" label="次数" width="100" />
            </el-table>
          </div>
          <div class="table-card">
            <div class="section-title">失败任务</div>
            <el-table :data="negative?.failedTasks ?? []" stripe height="260">
              <el-table-column prop="taskId" label="taskId" width="100" />
              <el-table-column prop="name" label="名称" min-width="220" show-overflow-tooltip />
              <el-table-column prop="taskType" label="类型" width="140" />
              <el-table-column prop="error" label="错误" min-width="260" show-overflow-tooltip />
            </el-table>
          </div>
          <div class="table-card">
            <div class="section-title">低分 / hard gate 任务</div>
            <el-table :data="negativeFocusTasks" stripe height="300">
              <el-table-column prop="taskId" label="taskId" width="100" />
              <el-table-column prop="name" label="名称" min-width="220" show-overflow-tooltip />
              <el-table-column prop="taskType" label="类型" width="140" />
              <el-table-column prop="score" label="分数" width="90" />
              <el-table-column prop="reason" label="原因" width="130" />
            </el-table>
          </div>
        </div>
      </el-tab-pane>
      <el-tab-pane label="风险项分析" name="risk">
        <div class="table-card">
          <div class="toolbar" style="margin-bottom: 12px">
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
              style="width: 160px"
            >
              <el-option label="同意" value="agreed" />
              <el-option label="不同意" value="disagreed" />
            </el-select>
          </div>
          <el-table :data="riskReviews" v-loading="riskLoading" stripe height="620">
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
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import MetricCard from "../components/MetricCard.vue";
import {
  fetchHumanRatingGaps,
  fetchNegativeResults,
  fetchRiskReviewCalibrations,
  type HumanRatingGap,
  type RiskReviewCalibration,
} from "../api/dashboard";

const tab = ref("gap");
const gapLoading = ref(false);
const riskLoading = ref(false);
const negativeLoading = ref(false);
const gaps = ref<HumanRatingGap[]>([]);
const riskReviews = ref<RiskReviewCalibration[]>([]);
const negative = ref<Awaited<ReturnType<typeof fetchNegativeResults>> | null>(null);
const gapPage = ref(1);
const gapPageSize = ref(20);
const gapTotal = ref(0);
const riskPage = ref(1);
const riskPageSize = ref(20);
const riskTotal = ref(0);

const gapFilters = reactive({
  keyword: "",
  primaryConclusion: "",
});

const riskFilters = reactive({
  keyword: "",
  agreement: "" as "" | "agreed" | "disagreed",
});
const baseGapConclusionOptions = [
  "aligned",
  "human_rating_needs_improvement",
  "scoring_system_needs_improvement",
  "both_need_review",
  "insufficient_evidence",
];

const negativeFocusTasks = computed(() => {
  const lowScoreTasks =
    negative.value?.lowScoreTasks.map((task) => ({ ...task, reason: "低分" })) ?? [];
  const hardGateTasks =
    negative.value?.hardGateTasks.map((task) => ({ ...task, reason: "hard gate" })) ?? [];
  return [...lowScoreTasks, ...hardGateTasks].sort(
    (left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt),
  );
});

const gapConclusionOptions = computed(() => {
  const conclusions = new Set([
    ...baseGapConclusionOptions,
    ...gaps.value
      .map((item) => item.primaryConclusion)
      .filter((item): item is string => typeof item === "string" && item.length > 0),
  ]);
  if (gapFilters.primaryConclusion) {
    conclusions.add(gapFilters.primaryConclusion);
  }
  return Array.from(conclusions).sort();
});

async function loadGaps() {
  gapLoading.value = true;
  try {
    const gapResponse = await fetchHumanRatingGaps({
      page: gapPage.value,
      pageSize: gapPageSize.value,
      keyword: gapFilters.keyword || undefined,
      primaryConclusion: gapFilters.primaryConclusion || undefined,
    });
    gaps.value = gapResponse.items;
    gapTotal.value = gapResponse.total;
  } finally {
    gapLoading.value = false;
  }
}

async function loadRiskReviews() {
  riskLoading.value = true;
  try {
    const riskResponse = await fetchRiskReviewCalibrations({
      page: riskPage.value,
      pageSize: riskPageSize.value,
      keyword: riskFilters.keyword || undefined,
      agreement: riskFilters.agreement || undefined,
    });
    riskReviews.value = riskResponse.items;
    riskTotal.value = riskResponse.total;
  } finally {
    riskLoading.value = false;
  }
}

async function loadNegativeResults() {
  negativeLoading.value = true;
  try {
    negative.value = await fetchNegativeResults();
  } finally {
    negativeLoading.value = false;
  }
}

async function loadData() {
  await Promise.all([loadGaps(), loadRiskReviews(), loadNegativeResults()]);
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

function reloadGapsFromFirstPage() {
  if (gapPage.value === 1) {
    void loadGaps();
    return;
  }
  gapPage.value = 1;
}

function reloadRiskReviewsFromFirstPage() {
  if (riskPage.value === 1) {
    void loadRiskReviews();
    return;
  }
  riskPage.value = 1;
}

watch([gapPage, gapPageSize], loadGaps);
watch([riskPage, riskPageSize], loadRiskReviews);
watch(() => [gapFilters.keyword, gapFilters.primaryConclusion], reloadGapsFromFirstPage);
watch(() => [riskFilters.keyword, riskFilters.agreement], reloadRiskReviewsFromFirstPage);

onMounted(() => {
  loadData();
  window.addEventListener("dashboard:refresh", loadData as EventListener);
});

onBeforeUnmount(() => {
  window.removeEventListener("dashboard:refresh", loadData as EventListener);
});
</script>

<style scoped>
.section-title {
  margin-bottom: 10px;
  font-size: 15px;
  font-weight: 700;
}

.table-pagination {
  display: flex;
  justify-content: flex-end;
  margin-top: 12px;
}
</style>
