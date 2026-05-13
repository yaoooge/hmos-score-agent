<template>
  <div class="metric-card">
    <div class="metric-label">{{ label }}</div>
    <div class="metric-value">{{ value }}</div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  label: string;
  value: string | number;
}>();
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
  font-size: 24px;
  font-weight: 700;
}
</style>
