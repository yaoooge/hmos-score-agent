<template>
  <el-tooltip
    effect="light"
    placement="top"
    :content="displayText"
    :show-after="300"
    :popper-style="tooltipPopperStyle"
  >
    <span
      ref="triggerRef"
      class="overflow-text-tooltip"
      :title="undefined"
      @mouseenter="removeNativeTitle"
      @focus="removeNativeTitle"
    >
      {{ displayText }}
    </span>
  </el-tooltip>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch, type CSSProperties } from "vue";

const props = withDefaults(
  defineProps<{
    text?: string | number | null;
  }>(),
  {
    text: "-",
  },
);

const displayText = computed(() =>
  props.text === null || props.text === undefined ? "-" : String(props.text),
);

const triggerRef = ref<HTMLElement | null>(null);

const tooltipPopperStyle: CSSProperties = {
  maxWidth: "420px",
  background: "#ffffff",
  color: "#1f2937",
  border: "1px solid #d8dee6",
  boxShadow: "0 10px 24px rgba(15, 23, 42, 0.16)",
  lineHeight: "1.55",
  overflowWrap: "anywhere",
};

function removeNativeTitle() {
  const trigger = triggerRef.value;
  if (!trigger) {
    return;
  }

  trigger.removeAttribute("title");
  for (const element of trigger.querySelectorAll("[title]")) {
    element.removeAttribute("title");
  }
  trigger.closest("td")?.removeAttribute("title");
}

onMounted(() => {
  void nextTick(removeNativeTitle);
});

watch(displayText, () => {
  void nextTick(removeNativeTitle);
});
</script>

<style scoped>
.overflow-text-tooltip {
  display: block;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
