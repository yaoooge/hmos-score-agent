<template>
  <div class="page-stack">
    <el-tabs v-model="tab">
      <el-tab-pane label="人工评分差异分析" name="gap">
        <div class="table-card">
          <el-table :data="gaps" v-loading="loading" stripe height="560">
            <el-table-column prop="taskId" label="taskId" width="100" />
            <el-table-column prop="caseName" label="名称" min-width="220" />
            <el-table-column prop="manualRating" label="人工" width="90" />
            <el-table-column prop="autoRating" label="自动" width="90" />
            <el-table-column prop="autoScore" label="自动分" width="90" />
            <el-table-column prop="primaryConclusion" label="结论" min-width="200" />
            <el-table-column prop="reasonSummary" label="摘要" min-width="260" />
          </el-table>
        </div>
      </el-tab-pane>
      <el-tab-pane label="负向结果分析" name="negative">
        <div class="page-stack">
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
          <el-table :data="riskReviews" v-loading="loading" stripe height="620">
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
        </div>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import MetricCard from "../components/MetricCard.vue";
import {
  fetchHumanRatingGaps,
  fetchNegativeResults,
  fetchRiskReviewCalibrations,
  type RiskReviewCalibration,
} from "../api/dashboard";

const tab = ref("gap");
const loading = ref(false);
const gaps = ref<Array<Record<string, unknown>>>([]);
const riskReviews = ref<RiskReviewCalibration[]>([]);
const negative = ref<Awaited<ReturnType<typeof fetchNegativeResults>> | null>(null);

const negativeFocusTasks = computed(() => {
  const lowScoreTasks =
    negative.value?.lowScoreTasks.map((task) => ({ ...task, reason: "低分" })) ?? [];
  const hardGateTasks =
    negative.value?.hardGateTasks.map((task) => ({ ...task, reason: "hard gate" })) ?? [];
  return [...lowScoreTasks, ...hardGateTasks].sort((left, right) => left.taskId - right.taskId);
});

async function loadData() {
  loading.value = true;
  try {
    const gapResponse = await fetchHumanRatingGaps({ page: 1, pageSize: 100 });
    gaps.value = gapResponse.items;
    const riskResponse = await fetchRiskReviewCalibrations({ page: 1, pageSize: 200 });
    riskReviews.value = riskResponse.items;
    negative.value = await fetchNegativeResults();
  } finally {
    loading.value = false;
  }
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
</style>
