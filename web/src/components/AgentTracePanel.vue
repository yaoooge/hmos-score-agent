<template>
  <div class="agent-trace-panel">
    <el-alert v-if="error" :title="error" type="error" show-icon :closable="false" />
    <div v-else-if="loading" class="trace-loading">
      <el-skeleton :rows="8" animated />
    </div>
    <el-empty v-else-if="!trace?.traceAvailable || !trace.report" description="暂无 Agent Trace" />
    <div v-else class="trace-stack">
      <div class="trace-summary">
        <div v-for="item in summaryItems" :key="item.label" class="trace-summary-item">
          <span>{{ item.label }}</span>
          <strong>{{ item.value }}</strong>
        </div>
      </div>

      <el-tabs v-model="selectedRunId" class="trace-agent-tabs" @tab-change="selectRun">
        <el-tab-pane v-for="run in trace.report.runs" :key="run.id" :name="run.id">
          <template #label>
            <span class="trace-agent-tab-label">
              <strong>{{ run.agentName }}</strong>
              <small>{{ run.status }} · {{ formatDuration(run.elapsedMs) }}</small>
            </span>
          </template>
        </el-tab-pane>
      </el-tabs>

      <div class="trace-grid">
        <main class="trace-events">
          <div class="trace-filters">
            <el-select v-model="selectedRetryIndex" clearable placeholder="Attempt" size="small">
              <el-option
                v-for="attempt in selectedRun?.attempts ?? []"
                :key="attempt.id"
                :label="`#${attempt.retryIndex} ${attempt.status}`"
                :value="attempt.retryIndex"
              />
            </el-select>
            <el-select v-model="selectedEventType" clearable placeholder="Type" size="small">
              <el-option v-for="type in eventTypes" :key="type" :label="type" :value="type" />
            </el-select>
            <el-button size="small" :loading="runRawLoading" @click="loadRunRaw">Run Raw</el-button>
          </div>

          <el-empty v-if="stepGroups.length === 0" description="暂无步骤" />
          <template v-else>
            <div class="trace-duration-summary">
              Run 总耗时 {{ formatDuration(selectedRun?.elapsedMs) }}，Step 合计
              {{ formatDuration(selectedRunStepElapsedMs) }}，Step 间模型处理
              {{ formatDuration(selectedRunStepGapElapsedMs) }}，未归入
              {{ formatDuration(selectedRunUnattributedElapsedMs) }}
            </div>
            <p class="trace-timing-note">
              Step 耗时为可观测 step-start 到 step-finish 区间；Step 间模型处理为相邻 step-finish 到下一
              step-start 的时间，通常包含模型生成下一条 assistant message 和决定下一次工具调用；Run 总耗时还包含启动和收尾。
            </p>
            <template v-for="row in stepTimelineRows" :key="row.id">
              <article
                v-if="row.type === 'step'"
                class="trace-step-block"
                :class="{ active: selectedStepId === row.step.id }"
              >
                <button class="trace-step-card" type="button" @click="selectStep(row.step.id)">
                  <span class="trace-step-title">
                    <strong>Step {{ row.step.index }}</strong>
                    <span>{{ formatStepDuration(row.step) }}</span>
                  </span>
                  <span class="trace-step-meta">
                    {{ row.step.events.length }} events
                    <template v-if="row.step.toolNames.length > 0">
                      · {{ row.step.toolNames.length }} tools
                    </template>
                    <template v-if="row.tokenUsage"> · {{ formatTokenUsage(row.tokenUsage) }}</template>
                  </span>
                  <span v-if="row.step.toolNames.length > 0" class="trace-tool-tags">
                    <el-tag
                      v-for="tool in row.step.toolNames.slice(0, 4)"
                      :key="`${row.step.id}-${tool}`"
                      size="small"
                      effect="plain"
                    >
                      {{ tool }}
                    </el-tag>
                  </span>
                </button>

                <div v-if="selectedStepId === row.step.id" class="trace-step-inline-events">
                  <button
                    v-for="event in row.step.events"
                    :key="event.id"
                    class="trace-event-row"
                    :class="{ active: selectedEventId === event.id }"
                    type="button"
                    @click="selectEvent(event.id)"
                  >
                    <el-tag size="small" effect="plain">{{ event.type }}</el-tag>
                    <span class="trace-event-title">{{ event.title }}</span>
                    <span class="trace-event-meta">{{ formatEventMeta(event) }}</span>
                  </button>
                </div>
              </article>
              <div v-else class="trace-step-gap">
                ↓ Step 间模型处理 {{ formatDuration(row.gap.elapsedMs) }}
                <template v-if="row.tokenUsage"> · {{ formatTokenUsage(row.tokenUsage) }}</template>
              </div>
            </template>
          </template>
        </main>

        <aside class="trace-detail">
          <template v-if="selectedEvent">
            <section class="trace-event-detail">
              <h4>{{ selectedEvent.title }}</h4>
              <div class="detail-grid">
                <span>Type</span>
                <strong>{{ selectedEvent.type }}</strong>
                <span>Status</span>
                <strong>{{ selectedEvent.status ?? "-" }}</strong>
                <span>Duration</span>
                <strong>{{ formatDuration(selectedEvent.elapsedMs) }}</strong>
                <span>Tokens</span>
                <strong>{{ formatTokenUsageDetail(selectedEvent.tokenUsage) }}</strong>
                <span>Tool</span>
                <strong>{{ selectedEvent.toolName ?? "-" }}</strong>
                <span>Attempt</span>
                <strong>{{ selectedEvent.retryIndex ?? "-" }}</strong>
              </div>
              <p v-if="selectedEvent.summary" class="trace-muted">{{ selectedEvent.summary }}</p>
              <el-button
                v-if="selectedEvent.hasRawPayload"
                size="small"
                :loading="eventRawLoading"
                @click="loadEventRaw"
              >
                Event Raw
              </el-button>
              <pre v-if="eventRawText" class="trace-pre">{{ eventRawText }}</pre>
            </section>
          </template>
          <template v-else>
            <el-empty description="选择事件" />
          </template>

          <el-collapse v-if="runRawText" class="trace-raw-collapse">
            <el-collapse-item title="Run Raw" name="run">
              <pre class="trace-pre">{{ runRawText }}</pre>
            </el-collapse-item>
          </el-collapse>
        </aside>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  fetchTaskAgentTrace,
  fetchTaskAgentTraceEventRaw,
  fetchTaskAgentTraceRunRaw,
  type AgentTraceEvent,
  type AgentTraceResponse,
} from "../api/dashboard";
import {
  buildStepGaps,
  gapTokenUsage,
  hasCompleteStepTimestamp,
  stepDuration,
  stepTokenUsage,
  type TraceStepGap,
  type TraceTokenUsage,
} from "./agentTraceTiming";

const props = defineProps<{
  taskId?: number;
}>();

const loading = ref(false);
const error = ref("");
const trace = ref<AgentTraceResponse | null>(null);
const selectedRunId = ref("");
const selectedStepId = ref("");
const selectedEventId = ref("");
const selectedRetryIndex = ref<number | undefined>();
const selectedEventType = ref("");
const runRawLoading = ref(false);
const eventRawLoading = ref(false);
const runRawText = ref("");
const eventRawText = ref("");

const selectedRun = computed(() => {
  return trace.value?.report?.runs.find((run) => run.id === selectedRunId.value);
});

const eventTypes = computed(() => {
  return Array.from(new Set((selectedRun.value?.events ?? []).map((event) => event.type))).sort();
});

const filteredEvents = computed(() => {
  return (selectedRun.value?.events ?? []).filter((event) => {
    if (selectedRetryIndex.value !== undefined && event.retryIndex !== selectedRetryIndex.value) {
      return false;
    }
    if (selectedEventType.value && event.type !== selectedEventType.value) {
      return false;
    }
    return true;
  });
});

type TraceStepGroup = {
  id: string;
  index: number;
  events: AgentTraceEvent[];
  elapsedMs?: number;
  toolNames: string[];
};

type TraceTimelineRow =
  | { id: string; type: "step"; step: TraceStepGroup; tokenUsage?: TraceTokenUsage }
  | { id: string; type: "gap"; gap: TraceStepGap; tokenUsage?: TraceTokenUsage };

function uniqueToolNames(events: AgentTraceEvent[]): string[] {
  return Array.from(
    new Set(events.map((event) => event.toolName).filter((tool): tool is string => Boolean(tool))),
  );
}

function hasExecutableEvent(events: AgentTraceEvent[]): boolean {
  return events.some((event) => event.type !== "message" && event.type !== "text");
}

const stepGroups = computed<TraceStepGroup[]>(() => {
  const groups: TraceStepGroup[] = [];
  let currentEvents: AgentTraceEvent[] = [];

  function flush() {
    if (currentEvents.length === 0) {
      return;
    }
    const index = groups.length + 1;
    groups.push({
      id: `${selectedRunId.value}:step-${String(index)}`,
      index,
      events: currentEvents,
      elapsedMs: stepDuration(currentEvents),
      toolNames: uniqueToolNames(currentEvents),
    });
    currentEvents = [];
  }

  for (const event of filteredEvents.value) {
    if (event.type === "step-start" && currentEvents.length > 0 && hasExecutableEvent(currentEvents)) {
      flush();
    }
    currentEvents.push(event);
    if (event.type === "step-finish") {
      flush();
    }
  }
  flush();
  return groups;
});

const selectedStep = computed(() => {
  return stepGroups.value.find((step) => step.id === selectedStepId.value);
});

const stepGaps = computed(() => buildStepGaps(stepGroups.value));

const stepTimelineRows = computed<TraceTimelineRow[]>(() => {
  const gapByPreviousStepId = new Map(stepGaps.value.map((gap) => [gap.afterStepId, gap]));
  return stepGroups.value.flatMap((step, index) => {
    const rows: TraceTimelineRow[] = [
      { id: step.id, type: "step", step, tokenUsage: stepTokenUsage(step) },
    ];
    const gap = gapByPreviousStepId.get(step.id);
    if (gap && index < stepGroups.value.length - 1) {
      const nextStep = stepGroups.value[index + 1];
      rows.push({
        id: gap.id,
        type: "gap",
        gap,
        tokenUsage: nextStep ? gapTokenUsage(step, nextStep) : undefined,
      });
    }
    return rows;
  });
});

const selectedRunStepElapsedMs = computed(() =>
  stepGroups.value.reduce((sum, step) => sum + (step.elapsedMs ?? 0), 0),
);

const selectedRunStepGapElapsedMs = computed(() =>
  stepGaps.value.reduce((sum, gap) => sum + gap.elapsedMs, 0),
);

const selectedRunUnattributedElapsedMs = computed(() => {
  const runElapsedMs = selectedRun.value?.elapsedMs;
  if (runElapsedMs === undefined) {
    return undefined;
  }
  return Math.max(0, runElapsedMs - selectedRunStepElapsedMs.value - selectedRunStepGapElapsedMs.value);
});

const selectedEvent = computed<AgentTraceEvent | undefined>(() => {
  return selectedStep.value?.events.find((event) => event.id === selectedEventId.value);
});

const summaryItems = computed(() => {
  const summary = trace.value?.report?.summary;
  return [
    { label: "Runs", value: summary?.runCount ?? 0 },
    { label: "Attempts", value: summary?.attemptCount ?? 0 },
    { label: "Events", value: summary?.eventCount ?? 0 },
    { label: "Tools", value: summary?.toolEventCount ?? 0 },
    { label: "Errors", value: summary?.errorCount ?? 0 },
    { label: "Tokens", value: summary?.totalTokens ?? "-" },
  ];
});

function formatDuration(value: number | undefined): string {
  if (value === undefined) {
    return "-";
  }
  if (value < 1000) {
    return `${value}ms`;
  }
  return `${(value / 1000).toFixed(1)}s`;
}

function formatEventMeta(event: AgentTraceEvent): string {
  const parts = [
    event.toolName ?? event.status,
    formatDuration(event.elapsedMs),
    formatTokenUsage(event.tokenUsage),
  ].filter((value) => value && value !== "-");
  return parts.length > 0 ? parts.join(" · ") : "-";
}

function formatTokenUsage(tokenUsage: TraceTokenUsage | undefined): string {
  if (!tokenUsage) {
    return "";
  }
  const parts = [
    tokenUsage.total === undefined ? undefined : `tokens ${String(tokenUsage.total)}`,
    tokenUsage.output === undefined ? undefined : `out ${String(tokenUsage.output)}`,
    tokenUsage.reasoning === undefined ? undefined : `reasoning ${String(tokenUsage.reasoning)}`,
  ].filter((part): part is string => part !== undefined);
  return parts.join(" / ");
}

function formatTokenUsageDetail(tokenUsage: TraceTokenUsage | undefined): string {
  if (!tokenUsage) {
    return "-";
  }
  const parts = [
    tokenUsage.total === undefined ? undefined : `total ${String(tokenUsage.total)}`,
    tokenUsage.input === undefined ? undefined : `input ${String(tokenUsage.input)}`,
    tokenUsage.output === undefined ? undefined : `output ${String(tokenUsage.output)}`,
    tokenUsage.reasoning === undefined ? undefined : `reasoning ${String(tokenUsage.reasoning)}`,
    tokenUsage.cacheRead === undefined ? undefined : `cache read ${String(tokenUsage.cacheRead)}`,
    tokenUsage.cacheWrite === undefined ? undefined : `cache write ${String(tokenUsage.cacheWrite)}`,
  ].filter((part): part is string => part !== undefined);
  return parts.length > 0 ? parts.join(" / ") : "-";
}

function formatStepDuration(step: TraceStepGroup): string {
  const prefix = hasCompleteStepTimestamp(step.events) ? "区间 " : "估算 ";
  return `${prefix}${formatDuration(step.elapsedMs)}`;
}

function selectRun(runId: string | number) {
  selectedRunId.value = String(runId);
  selectedStepId.value = "";
  selectedEventId.value = "";
  selectedRetryIndex.value = undefined;
  selectedEventType.value = "";
  runRawText.value = "";
  eventRawText.value = "";
}

function selectStep(stepId: string) {
  if (selectedStepId.value === stepId) {
    selectedStepId.value = "";
    selectedEventId.value = "";
    eventRawText.value = "";
    return;
  }
  selectedStepId.value = stepId;
  selectedEventId.value = selectedStep.value?.events[0]?.id ?? "";
  eventRawText.value = "";
}

function selectEvent(eventId: string) {
  selectedEventId.value = eventId;
  eventRawText.value = "";
}

async function loadTrace() {
  if (!props.taskId) {
    trace.value = null;
    return;
  }
  loading.value = true;
  error.value = "";
  try {
    trace.value = await fetchTaskAgentTrace(props.taskId);
    selectedRunId.value = trace.value.report?.runs[0]?.id ?? "";
    selectedStepId.value = "";
    selectedEventId.value = "";
  } catch (caught) {
    trace.value = null;
    error.value = caught instanceof Error ? caught.message : String(caught);
  } finally {
    loading.value = false;
  }
}

async function loadRunRaw() {
  if (!props.taskId || !selectedRun.value) {
    return;
  }
  runRawLoading.value = true;
  try {
    const raw = await fetchTaskAgentTraceRunRaw(props.taskId, selectedRun.value.id);
    runRawText.value = JSON.stringify(
      {
        prompt: raw.prompt,
        assistantText: raw.assistantText,
        outputFileText: raw.outputFileText,
        opencodeMessages: raw.opencodeMessages,
      },
      null,
      2,
    );
  } finally {
    runRawLoading.value = false;
  }
}

async function loadEventRaw() {
  if (!props.taskId || !selectedEvent.value) {
    return;
  }
  eventRawLoading.value = true;
  try {
    const raw = await fetchTaskAgentTraceEventRaw(props.taskId, selectedEvent.value.id);
    eventRawText.value = JSON.stringify(raw.rawPayload, null, 2);
  } finally {
    eventRawLoading.value = false;
  }
}

watch(
  () => props.taskId,
  () => {
    void loadTrace();
  },
  { immediate: true },
);

watch(
  stepGroups,
  (groups) => {
    if (groups.length === 0) {
      selectedStepId.value = "";
      selectedEventId.value = "";
      return;
    }
    if (!groups.some((step) => step.id === selectedStepId.value)) {
      selectedStepId.value = groups[0]?.id ?? "";
      selectedEventId.value = groups[0]?.events[0]?.id ?? "";
    }
  },
  { immediate: true },
);
</script>

<style scoped>
.agent-trace-panel {
  height: calc(100vh - 230px);
  min-height: 420px;
  min-width: 0;
}

.trace-stack {
  display: flex;
  flex-direction: column;
  gap: 12px;
  height: 100%;
  min-height: 0;
}

.trace-summary {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(96px, 1fr));
  gap: 8px;
}

.trace-summary-item {
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  padding: 10px;
  background: #fff;
}

.trace-summary-item span {
  display: block;
  color: #64748b;
  font-size: 12px;
}

.trace-summary-item strong {
  display: block;
  margin-top: 4px;
  color: #111827;
  font-size: 18px;
}

.trace-agent-tabs {
  flex: 0 0 auto;
}

.trace-agent-tab-label {
  display: inline-flex;
  align-items: baseline;
  gap: 8px;
  max-width: 260px;
}

.trace-agent-tab-label strong,
.trace-agent-tab-label small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.trace-agent-tab-label small {
  color: #64748b;
  font-size: 12px;
}

.trace-grid {
  display: grid;
  grid-template-columns: minmax(320px, 0.85fr) minmax(420px, 1.15fr);
  gap: 12px;
  min-height: 0;
  flex: 1 1 auto;
}

.trace-events,
.trace-detail {
  min-width: 0;
  min-height: 0;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  background: #fff;
  padding: 10px;
  overflow: auto;
}

.trace-events {
  display: flex;
  flex-direction: column;
}

.trace-detail {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.trace-event-row,
.trace-step-block,
.trace-step-card {
  width: 100%;
  border: 0;
  border-radius: 6px;
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.trace-step-block {
  display: flex;
  flex-direction: column;
  border: 1px solid transparent;
  border-radius: 6px;
}

.trace-step-block.active {
  background: #f8fafc;
  border-color: #c7d2fe;
}

.trace-step-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px;
  color: #111827;
}

.trace-event-row.active {
  background: #eef2ff;
  border-color: #c7d2fe;
}

.trace-muted,
.trace-event-meta {
  color: #64748b;
}

.trace-filters {
  display: grid;
  grid-template-columns: 1fr 1fr auto;
  gap: 8px;
  margin-bottom: 10px;
  flex: 0 0 auto;
}

.trace-duration-summary {
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  background: #f8fafc;
  padding: 8px 10px;
  color: #111827;
  font-size: 12px;
  line-height: 1.5;
}

.trace-timing-note {
  margin: 8px 0 10px;
  color: #64748b;
  font-size: 12px;
  line-height: 1.5;
}

.trace-step-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.trace-step-title span,
.trace-step-meta {
  color: #64748b;
  font-size: 12px;
}

.trace-tool-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.trace-event-row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  padding: 8px;
  border: 1px solid transparent;
}

.trace-event-row:hover,
.trace-step-card:hover {
  background: #f8fafc;
}

.trace-step-gap {
  margin: 2px 10px;
  border-left: 2px solid #cbd5e1;
  padding: 4px 0 4px 10px;
  color: #64748b;
  font-size: 12px;
  line-height: 1.4;
}

.trace-event-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.detail-grid {
  display: grid;
  grid-template-columns: 80px minmax(0, 1fr);
  gap: 8px;
  margin-bottom: 10px;
}

.detail-grid span {
  color: #64748b;
}

.trace-event-detail h4 {
  margin: 0;
}

.trace-step-inline-events {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 0 8px 8px 18px;
}

.trace-event-detail {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
}

.trace-pre {
  border-radius: 6px;
  background: #0f172a;
  color: #e5e7eb;
  margin: 0;
  padding: 12px;
  white-space: pre-wrap;
  word-break: break-word;
}

.trace-raw-collapse {
  margin-top: 12px;
}

@media (max-width: 1100px) {
  .trace-grid {
    grid-template-columns: 1fr;
    overflow: auto;
  }
}
</style>
