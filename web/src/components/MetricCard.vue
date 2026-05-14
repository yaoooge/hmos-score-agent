<template>
  <div class="metric-card" :style="cardStyle">
    <div class="metric-label">{{ label }}</div>
    <div class="metric-value">{{ value }}</div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{
  label: string;
  value: string | number;
  accent?: string;
}>();

const cardStyle = computed(() => ({
  "--metric-accent": props.accent ?? "#1f2937",
}));
</script>

<style scoped>
.metric-card {
  min-height: 84px;
  padding: 14px;
  border: 1px solid #e5e9ef;
  border-radius: 8px;
  background: #ffffff;
}

.metric-label {
  color: #667085;
  font-size: 13px;
}

.metric-value {
  margin-top: 10px;
  color: var(--metric-accent);
  font-size: 24px;
  font-weight: 700;
}
</style>
