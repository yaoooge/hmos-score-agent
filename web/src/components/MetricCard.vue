<template>
  <button
    v-if="clickable"
    type="button"
    class="metric-card metric-card-button"
    :class="{ 'is-active': active }"
    :style="cardStyle"
    :aria-pressed="active"
    @click="emit('select')"
  >
    <div class="metric-label">{{ label }}</div>
    <div class="metric-value">{{ value }}</div>
  </button>
  <div v-else class="metric-card" :style="cardStyle">
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
  clickable?: boolean;
  active?: boolean;
}>();

const emit = defineEmits<{
  select: [];
}>();

const cardStyle = computed(() => ({
  "--metric-accent": props.accent ?? "#1f2937",
}));
</script>

<style scoped>
.metric-card {
  width: 100%;
  min-height: 84px;
  padding: 14px;
  border: 1px solid #e5e9ef;
  border-radius: 8px;
  background: #ffffff;
  text-align: left;
}

.metric-card-button {
  appearance: none;
  color: inherit;
  font: inherit;
  cursor: pointer;
  transition:
    border-color 0.16s ease,
    box-shadow 0.16s ease;
}

.metric-card-button:hover {
  border-color: #9db7f5;
  box-shadow: 0 8px 20px rgb(31 41 55 / 8%);
}

.metric-card-button.is-active {
  border-color: #2563eb;
  box-shadow: 0 0 0 2px rgb(37 99 235 / 14%);
}

.metric-card-button:focus-visible {
  outline: 2px solid #2563eb;
  outline-offset: 2px;
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
