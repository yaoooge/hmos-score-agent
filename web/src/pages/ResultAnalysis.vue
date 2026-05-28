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
            <el-select
              v-model="gapFilters.manualAnalysisStatus"
              placeholder="分析状态"
              clearable
              style="width: 140px"
            >
              <el-option label="待分析" value="pending" />
              <el-option label="已分析" value="analyzed" />
            </el-select>
            <el-button
              type="primary"
              plain
              :disabled="gapSelection.length === 0"
              :loading="gapStatusUpdating"
              @click="markSelectedGaps('analyzed')"
            >
              标记已分析
            </el-button>
            <el-button
              plain
              :disabled="gapSelection.length === 0"
              :loading="gapStatusUpdating"
              @click="markSelectedGaps('pending')"
            >
              标记待分析
            </el-button>
          </div>
          <el-table
            :data="gaps"
            v-loading="gapLoading"
            stripe
            height="560"
            @selection-change="onGapSelectionChange"
          >
            <el-table-column type="selection" width="48" />
            <el-table-column label="分析状态" width="110">
              <template #default="{ row }">
                <el-tag
                  size="small"
                  :type="manualAnalysisStatusTagType(row.manualAnalysisStatus)"
                  effect="plain"
                >
                  {{ formatManualAnalysisStatus(row.manualAnalysisStatus) }}
                </el-tag>
              </template>
            </el-table-column>
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
              v-model="riskFilters.manualAnalysisStatus"
              placeholder="分析状态"
              clearable
              style="width: 140px"
            >
              <el-option label="待分析" value="pending" />
              <el-option label="已分析" value="analyzed" />
            </el-select>
            <el-button
              type="primary"
              plain
              :disabled="riskSelection.length === 0"
              :loading="riskStatusUpdating"
              @click="markSelectedRisks('analyzed')"
            >
              标记已分析
            </el-button>
            <el-button
              plain
              :disabled="riskSelection.length === 0"
              :loading="riskStatusUpdating"
              @click="markSelectedRisks('pending')"
            >
              标记待分析
            </el-button>
          </div>
          <el-table
            :data="riskReviews"
            v-loading="riskLoading"
            stripe
            height="620"
            @selection-change="onRiskSelectionChange"
          >
            <el-table-column type="selection" width="48" />
            <el-table-column label="分析状态" width="110">
              <template #default="{ row }">
                <el-tag
                  size="small"
                  :type="manualAnalysisStatusTagType(row.manualAnalysisStatus)"
                  effect="plain"
                >
                  {{ formatManualAnalysisStatus(row.manualAnalysisStatus) }}
                </el-tag>
              </template>
            </el-table-column>
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
      <el-tab-pane label="违反规则列表" name="negative">
        <div class="table-card" v-loading="negativeLoading">
          <el-table :data="negative?.topRuleViolations ?? []" stripe height="620">
            <el-table-column prop="rule_id" label="规则" width="220" />
            <el-table-column prop="rule_summary" label="摘要" min-width="260" show-overflow-tooltip />
            <el-table-column prop="violationCount" label="次数" width="100" />
          </el-table>
        </div>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import {
  fetchHumanRatingGaps,
  fetchNegativeResults,
  fetchRiskReviewCalibrations,
  updateHumanRatingGapManualAnalysisStatus,
  updateRiskReviewManualAnalysisStatus,
  type HumanRatingGap,
  type ManualAnalysisStatus,
  type RiskReviewCalibration,
} from "../api/dashboard";

const tab = ref("gap");
const gapLoading = ref(false);
const riskLoading = ref(false);
const negativeLoading = ref(false);
const gapStatusUpdating = ref(false);
const riskStatusUpdating = ref(false);
const gaps = ref<HumanRatingGap[]>([]);
const riskReviews = ref<RiskReviewCalibration[]>([]);
const gapSelection = ref<HumanRatingGap[]>([]);
const riskSelection = ref<RiskReviewCalibration[]>([]);
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
  manualAnalysisStatus: "pending" as "" | ManualAnalysisStatus,
});

const riskFilters = reactive({
  keyword: "",
  manualAnalysisStatus: "pending" as "" | ManualAnalysisStatus,
});
const baseGapConclusionOptions = [
  "aligned",
  "human_rating_needs_improvement",
  "scoring_system_needs_improvement",
  "both_need_review",
  "insufficient_evidence",
];

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
      manualAnalysisStatus: gapFilters.manualAnalysisStatus || undefined,
    });
    gaps.value = gapResponse.items;
    gapSelection.value = [];
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
      agreement: "disagreed",
      manualAnalysisStatus: riskFilters.manualAnalysisStatus || undefined,
    });
    riskReviews.value = riskResponse.items;
    riskSelection.value = [];
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

function formatManualAnalysisStatus(status: ManualAnalysisStatus | undefined): string {
  return status === "analyzed" ? "已分析" : "待分析";
}

function manualAnalysisStatusTagType(status: ManualAnalysisStatus | undefined): "success" | "info" {
  return status === "analyzed" ? "success" : "info";
}

function onGapSelectionChange(selection: HumanRatingGap[]) {
  gapSelection.value = selection;
}

function onRiskSelectionChange(selection: RiskReviewCalibration[]) {
  riskSelection.value = selection;
}

async function markSelectedGaps(status: ManualAnalysisStatus) {
  if (gapSelection.value.length === 0) {
    return;
  }
  gapStatusUpdating.value = true;
  try {
    await updateHumanRatingGapManualAnalysisStatus(
      gapSelection.value.map((item) => item.taskId),
      status,
    );
    await loadGaps();
  } finally {
    gapStatusUpdating.value = false;
  }
}

async function markSelectedRisks(status: ManualAnalysisStatus) {
  const items = riskSelection.value.flatMap((item) =>
    typeof item.riskId === "number" ? [{ taskId: item.taskId, riskId: item.riskId }] : [],
  );
  if (items.length === 0) {
    return;
  }
  riskStatusUpdating.value = true;
  try {
    await updateRiskReviewManualAnalysisStatus(items, status);
    await loadRiskReviews();
  } finally {
    riskStatusUpdating.value = false;
  }
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
watch(
  () => [gapFilters.keyword, gapFilters.primaryConclusion, gapFilters.manualAnalysisStatus],
  reloadGapsFromFirstPage,
);
watch(
  () => [riskFilters.keyword, riskFilters.manualAnalysisStatus],
  reloadRiskReviewsFromFirstPage,
);

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
