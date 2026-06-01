<template>
  <router-view v-if="isLoginRoute" />
  <div v-else class="app-shell">
    <aside class="sidebar">
      <div class="brand">HMOS Score</div>
      <el-menu :default-active="activePath" router class="nav-menu">
        <el-menu-item index="/tasks">
          <el-icon><List /></el-icon>
          <span>评测任务</span>
        </el-menu-item>
        <el-menu-item index="/analysis">
          <el-icon><DataAnalysis /></el-icon>
          <span>结果分析</span>
        </el-menu-item>
        <el-menu-item index="/cross-device">
          <el-icon><Connection /></el-icon>
          <span>一多适配</span>
        </el-menu-item>
        <el-menu-item index="/consistency">
          <el-icon><Histogram /></el-icon>
          <span>一致性分析</span>
        </el-menu-item>
      </el-menu>
      <div class="sidebar-footer">
        <el-button :icon="SwitchButton" @click="logout">退出</el-button>
      </div>
    </aside>
    <main class="main-panel">
      <header class="topbar">
        <div>
          <h1>{{ title }}</h1>
          <p>{{ subtitle }}</p>
        </div>
        <div class="topbar-actions">
          <el-date-picker
            v-if="titleControls.dateRange"
            v-model="titleDateRange"
            type="daterange"
            range-separator="至"
            start-placeholder="开始"
            end-placeholder="结束"
          />
          <el-button v-if="showTopbarRefresh" :icon="Refresh" @click="reloadPage">刷新</el-button>
        </div>
      </header>
      <router-view />
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, provide, shallowRef, type Ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  Connection,
  DataAnalysis,
  Histogram,
  List,
  Refresh,
  SwitchButton,
} from "@element-plus/icons-vue";
import { clearAuthSession } from "./authSession.js";

type DashboardTitleControls = {
  dateRange?: {
    model: Ref<[Date, Date] | null>;
  };
};

const route = useRoute();
const router = useRouter();
const titleControls = shallowRef<DashboardTitleControls>({});
const titleDateRange = computed({
  get: () => titleControls.value.dateRange?.model.value ?? null,
  set: (value: [Date, Date] | null) => {
    if (titleControls.value.dateRange) {
      titleControls.value.dateRange.model.value = value;
    }
  },
});

const activePath = computed(() => route.path);
const isLoginRoute = computed(() => route.path === "/login");
const title = computed(() => {
  if (route.path.startsWith("/analysis")) {
    return "结果分析";
  }
  if (route.path.startsWith("/cross-device")) {
    return "一多适配";
  }
  if (route.path.startsWith("/consistency")) {
    return "一致性分析";
  }
  return "评测任务";
});
const subtitle = computed(() => {
  if (route.path.startsWith("/analysis")) {
    return "人工评分差异和负向结果归因";
  }
  if (route.path.startsWith("/cross-device")) {
    return "用例结果、规则违背和风险项分析";
  }
  if (route.path.startsWith("/consistency")) {
    return "重复评分、规则波动和风险项稳定性分析";
  }
  return "任务状态、类型概览和执行日志";
});
const showTopbarRefresh = computed(() => !route.path.startsWith("/consistency/"));

function reloadPage() {
  window.dispatchEvent(new CustomEvent("dashboard:refresh"));
}

async function logout() {
  clearAuthSession(window.localStorage);
  await router.replace("/login");
}

provide("setDashboardTitleControls", (controls: DashboardTitleControls | null) => {
  titleControls.value = controls ?? {};
});
</script>
