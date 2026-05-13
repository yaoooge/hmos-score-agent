<template>
  <div class="app-shell">
    <aside class="sidebar">
      <div class="brand">HMOS Score</div>
      <el-menu :default-active="activePath" router class="nav-menu">
        <el-menu-item index="/tasks">
          <el-icon><List /></el-icon>
          <span>评测任务</span>
        </el-menu-item>
        <el-menu-item index="/reports">
          <el-icon><TrendCharts /></el-icon>
          <span>用例报表</span>
        </el-menu-item>
        <el-menu-item index="/analysis">
          <el-icon><DataAnalysis /></el-icon>
          <span>结果分析</span>
        </el-menu-item>
      </el-menu>
    </aside>
    <main class="main-panel">
      <header class="topbar">
        <div>
          <h1>{{ title }}</h1>
          <p>{{ subtitle }}</p>
        </div>
        <el-button :icon="Refresh" @click="reloadPage">刷新</el-button>
      </header>
      <router-view />
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";
import { DataAnalysis, List, Refresh, TrendCharts } from "@element-plus/icons-vue";

const route = useRoute();

const activePath = computed(() => route.path);
const title = computed(() => {
  if (route.path.startsWith("/reports")) {
    return "用例报表";
  }
  if (route.path.startsWith("/analysis")) {
    return "结果分析";
  }
  return "评测任务";
});
const subtitle = computed(() => {
  if (route.path.startsWith("/reports")) {
    return "任务趋势、完成情况和分数分布";
  }
  if (route.path.startsWith("/analysis")) {
    return "人工评分差异和负向结果归因";
  }
  return "任务状态、类型概览和执行日志";
});

function reloadPage() {
  window.dispatchEvent(new CustomEvent("dashboard:refresh"));
}
</script>
