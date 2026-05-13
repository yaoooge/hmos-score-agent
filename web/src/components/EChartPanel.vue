<template>
  <div class="chart-card">
    <div class="chart-title">{{ title }}</div>
    <div v-if="empty" class="chart-empty">暂无数据</div>
    <div v-else ref="chartEl" class="chart-body" />
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import * as echarts from "echarts";
import type { EChartsOption } from "echarts";

const props = defineProps<{
  title: string;
  option: EChartsOption;
  empty?: boolean;
}>();

const chartEl = ref<HTMLDivElement>();
let chart: echarts.ECharts | undefined;

function renderChart() {
  if (!chartEl.value || props.empty) {
    return;
  }
  chart ??= echarts.init(chartEl.value);
  chart.setOption(props.option, true);
}

function resizeChart() {
  chart?.resize();
}

onMounted(() => {
  renderChart();
  window.addEventListener("resize", resizeChart);
});

onBeforeUnmount(() => {
  window.removeEventListener("resize", resizeChart);
  chart?.dispose();
});

watch(
  () => props.option,
  () => renderChart(),
  { deep: true },
);
</script>

<style scoped>
.chart-title {
  margin-bottom: 10px;
  font-size: 15px;
  font-weight: 700;
}

.chart-body,
.chart-empty {
  width: 100%;
  height: 300px;
}

.chart-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  color: #98a2b3;
}
</style>
