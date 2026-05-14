<template>
  <div class="page-stack">
    <div class="toolbar">
      <el-select v-model="taskType" placeholder="任务类型" clearable style="width: 180px">
        <el-option v-for="item in taskTypeOptions" :key="item" :label="item" :value="item" />
      </el-select>
    </div>

    <EChartPanel title="每日任务数" :option="dailyTaskOption" :empty="dailyItems.length === 0" />
    <EChartPanel
      title="完成 / 失败趋势"
      :option="dailyStatusOption"
      :empty="dailyItems.length === 0"
    />
    <EChartPanel title="平均分趋势" :option="scoreOption" :empty="dailyItems.length === 0" />
    <EChartPanel title="分数分布" :option="distributionOption" :empty="scoreBuckets.length === 0" />
  </div>
</template>

<script setup lang="ts">
import { computed, inject, onBeforeUnmount, onMounted, ref, watch, type Ref } from "vue";
import type { EChartsOption } from "echarts";
import EChartPanel from "../components/EChartPanel.vue";
import { fetchDailyReport, fetchScoreDistribution, fetchSummary } from "../api/dashboard";

const range = ref<[Date, Date] | null>(null);
const taskType = ref("");
const dailyItems = ref<
  {
    date: string;
    received: number;
    completed: number;
    failed: number;
    queued: number;
    running: number;
    averageScore: number | null;
  }[]
>([]);
const scoreBuckets = ref<{ label: string; count: number }[]>([]);
const taskTypeOptions = ref<string[]>([]);

type DashboardTitleControls = {
  dateRange?: {
    model: Ref<[Date, Date] | null>;
  };
};

const setTitleControls =
  inject<(controls: DashboardTitleControls | null) => void>("setDashboardTitleControls");

async function loadData() {
  const params = {
    from: range.value?.[0]?.toISOString(),
    to: range.value?.[1]?.toISOString(),
    taskType: taskType.value || undefined,
  };
  const summary = await fetchSummary(params);
  taskTypeOptions.value = summary.taskTypeCounts.map((item) => item.taskType);
  const daily = await fetchDailyReport(params);
  dailyItems.value = daily.items;
  const distribution = await fetchScoreDistribution(params);
  scoreBuckets.value = distribution.buckets.map((bucket) => ({
    label: bucket.label,
    count: bucket.count,
  }));
}

const dailyTaskOption = computed<EChartsOption>(() => ({
  tooltip: { trigger: "axis" },
  xAxis: { type: "category", data: dailyItems.value.map((item) => item.date) },
  yAxis: { type: "value" },
  series: [{ type: "bar", name: "任务数", data: dailyItems.value.map((item) => item.received) }],
}));

const dailyStatusOption = computed<EChartsOption>(() => ({
  tooltip: { trigger: "axis" },
  legend: { data: ["完成", "失败"] },
  xAxis: { type: "category", data: dailyItems.value.map((item) => item.date) },
  yAxis: { type: "value" },
  series: [
    {
      type: "bar",
      name: "完成",
      stack: "total",
      data: dailyItems.value.map((item) => item.completed),
    },
    {
      type: "bar",
      name: "失败",
      stack: "total",
      data: dailyItems.value.map((item) => item.failed),
    },
  ],
}));

const scoreOption = computed<EChartsOption>(() => ({
  tooltip: { trigger: "axis" },
  xAxis: { type: "category", data: dailyItems.value.map((item) => item.date) },
  yAxis: { type: "value" },
  series: [
    {
      type: "line",
      smooth: true,
      name: "平均分",
      data: dailyItems.value.map((item) => item.averageScore ?? 0),
    },
  ],
}));

const distributionOption = computed<EChartsOption>(() => ({
  tooltip: { trigger: "axis" },
  xAxis: { type: "category", data: scoreBuckets.value.map((item) => item.label) },
  yAxis: { type: "value" },
  series: [{ type: "bar", name: "数量", data: scoreBuckets.value.map((item) => item.count) }],
}));

watch([range, taskType], loadData);

onMounted(() => {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 7);
  range.value = [start, end];
  setTitleControls?.({ dateRange: { model: range } });
  loadData();
  window.addEventListener("dashboard:refresh", loadData as EventListener);
});

onBeforeUnmount(() => {
  setTitleControls?.(null);
  window.removeEventListener("dashboard:refresh", loadData as EventListener);
});
</script>
