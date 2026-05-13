<template>
  <el-tag :type="tagType" effect="light">{{ label }}</el-tag>
</template>

<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{ statusCategory: string }>();

const label = computed(() => {
  const labels: Record<string, string> = {
    received: "已接收",
    queued: "排队中",
    running: "执行中",
    completed: "已执行",
    failed: "失败",
  };
  return labels[props.statusCategory] ?? props.statusCategory;
});

const tagType = computed(() => {
  const types: Record<string, "primary" | "success" | "warning" | "danger" | "info"> = {
    received: "info",
    queued: "warning",
    running: "primary",
    completed: "success",
    failed: "danger",
  };
  return types[props.statusCategory] ?? "info";
});
</script>
