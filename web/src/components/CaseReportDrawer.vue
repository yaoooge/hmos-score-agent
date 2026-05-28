<template>
  <el-drawer
    v-model="visible"
    size="72%"
    :class="['case-report-drawer', { 'case-report-drawer-trace': activeTab === 'trace' }]"
    :title="title"
  >
    <template #header>
      <div class="toolbar" style="justify-content: space-between; width: 100%">
        <strong>{{ title }}</strong>
        <el-button :icon="Refresh" :loading="loading" @click="$emit('refresh')">
          刷新报告
        </el-button>
      </div>
    </template>

    <el-tabs v-model="activeTab" class="case-report-tabs">
      <el-tab-pane label="报告" name="report">
        <el-alert v-if="error" :title="error" type="error" show-icon :closable="false" />
        <div v-else-if="loading" class="report-loading">
          <el-skeleton :rows="10" animated />
        </div>
        <el-empty v-else-if="!report" description="暂无用例报告" />
        <div v-else class="case-report-stack report-document">
      <section class="report-cover">
        <div class="report-cover-main">
          <div class="report-kicker">测试报告</div>
          <h2>{{ taskName ?? "用例报告" }}</h2>
          <p v-if="report.summary.targetDescription" class="report-target">
            {{ report.summary.targetDescription }}
          </p>
          <p class="report-conclusion">
            {{ report.summary.conclusion ?? "暂无总体结论。" }}
          </p>
          <div class="report-meta-row">
            <span>Task ID: {{ taskId ?? "-" }}</span>
            <span>Test Case ID: {{ testCaseId ?? "-" }}</span>
            <span>{{ formatReportDate(report.summary.generatedAt) }}</span>
          </div>
        </div>
        <div class="report-score-panel" :class="scoreToneClass(report.summary.totalScore)">
          <span>综合评分</span>
          <strong>{{ formatReportValue(report.summary.totalScore) }}</strong>
          <em>/ 100</em>
        </div>
      </section>

      <div class="report-stat-grid">
        <div class="report-stat-card">
          <span>硬门禁</span>
          <strong :class="hardGateClass(report.summary.hardGateTriggered)">
            {{ formatHardGate(report.summary.hardGateTriggered) }}
          </strong>
        </div>
        <div class="report-stat-card">
          <span>任务类型</span>
          <strong>{{ report.summary.taskType ?? "-" }}</strong>
        </div>
        <div class="report-stat-card">
          <span>风险项</span>
          <strong class="tone-danger">{{ report.risks.length }}</strong>
        </div>
        <div class="report-stat-card">
          <span>待复核</span>
          <strong class="tone-warning">{{ report.humanReviewItems.length }}</strong>
        </div>
      </div>

      <section class="report-section">
        <div class="report-section-heading">
          <span>01</span>
          <div>
            <h3>维度评分</h3>
            <p>按评分维度展示得分、权重和评语。</p>
          </div>
        </div>
        <el-empty v-if="report.dimensions.length === 0" description="暂无维度评分" />
        <div v-else class="dimension-list">
          <article
            v-for="dimension in report.dimensions"
            :key="dimension.name"
            class="dimension-row"
          >
            <div class="dimension-row-main">
              <div class="dimension-title-row">
                <strong>{{ dimension.name }}</strong>
                <span>{{ dimension.itemCount }} 个评分项</span>
              </div>
              <p>{{ dimension.comment ?? "暂无评语。" }}</p>
              <el-progress
                :percentage="dimensionScorePercent(dimension.score, dimension.maxScore)"
                :stroke-width="8"
                :show-text="false"
              />
            </div>
            <div class="dimension-score" :class="scoreToneClass(dimension.score, dimension.maxScore)">
              {{ formatScorePair(dimension.score, dimension.maxScore) }}
            </div>
          </article>
        </div>
      </section>

      <section class="report-section">
        <div class="report-section-heading">
          <span>02</span>
          <div>
            <h3>主要问题</h3>
            <p>影响评分结果的关键问题摘要。</p>
          </div>
        </div>
        <ul v-if="report.mainIssues.length > 0" class="report-list">
          <li v-for="issue in report.mainIssues" :key="issue">{{ issue }}</li>
        </ul>
        <span v-else class="empty-inline">暂无主要问题</span>
      </section>

      <section class="report-section">
        <div class="report-section-heading">
          <span>03</span>
          <div>
            <h3>风险项</h3>
            <p>需要关注的质量、稳定性或规则风险。</p>
          </div>
        </div>
        <el-empty v-if="report.risks.length === 0" description="暂无风险项" />
        <div v-else class="report-card-list">
          <article
            v-for="risk in report.risks"
            :key="`${risk.id ?? risk.title}`"
            class="report-card report-card-risk"
          >
            <div class="report-card-header">
              <strong>{{ risk.title }}</strong>
              <el-tag v-if="risk.level" size="small" effect="plain">{{ risk.level }}</el-tag>
            </div>
            <p v-if="risk.description">{{ risk.description }}</p>
            <p v-if="risk.evidence" class="report-muted">{{ risk.evidence }}</p>
          </article>
        </div>
      </section>

      <section class="report-section">
        <div class="report-section-heading">
          <span>04</span>
          <div>
            <h3>待人工复核</h3>
            <p>自动评分中需要人工确认的判断点。</p>
          </div>
        </div>
        <el-empty v-if="report.humanReviewItems.length === 0" description="暂无待复核项" />
        <div v-else class="report-card-list">
          <article
            v-for="item in report.humanReviewItems"
            :key="`${item.id ?? item.title}`"
            class="report-card"
          >
            <strong>{{ item.title }}</strong>
            <p v-if="item.currentAssessment">{{ item.currentAssessment }}</p>
            <p v-if="item.reason" class="report-muted">{{ item.reason }}</p>
            <p v-if="item.suggestedFocus" class="report-muted">{{ item.suggestedFocus }}</p>
          </article>
        </div>
      </section>

      <section class="report-section">
        <div class="report-section-heading">
          <span>05</span>
          <div>
            <h3>规则与代码检查</h3>
            <p>官方检查器和规则审计的执行摘要。</p>
          </div>
        </div>
        <div class="detail-grid">
          <span>官方检查状态</span>
          <strong>{{ report.linterSummary?.runStatus ?? "-" }}</strong>
          <span>有效问题数</span>
          <strong>{{ formatReportValue(report.linterSummary?.effectiveFindingCount) }}</strong>
          <span>规则审计项</span>
          <strong>{{ report.ruleAuditItems.length }}</strong>
        </div>
      </section>

      <section class="report-section">
        <div class="report-section-heading">
          <span>06</span>
          <div>
            <h3>建议动作</h3>
            <p>基于当前报告给出的后续处理建议。</p>
          </div>
        </div>
        <ul v-if="report.recommendations.length > 0" class="report-list">
          <li v-for="item in report.recommendations" :key="item">{{ item }}</li>
        </ul>
        <span v-else class="empty-inline">暂无建议动作</span>
      </section>
        </div>
      </el-tab-pane>
      <el-tab-pane label="Agent Trace" name="trace">
        <AgentTracePanel :task-id="taskId" />
      </el-tab-pane>
    </el-tabs>
  </el-drawer>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { Refresh } from "@element-plus/icons-vue";
import AgentTracePanel from "./AgentTracePanel.vue";
import { formatDashboardDateTime } from "../dateTime";
import type { CaseReportViewModel } from "../pages/caseReportViewModel";

const visible = defineModel<boolean>({ default: false });
const activeTab = ref("report");

defineProps<{
  title: string;
  loading: boolean;
  error: string;
  report: CaseReportViewModel | null;
  taskId?: number;
  testCaseId?: number;
  taskName?: string;
}>();

defineEmits<{
  refresh: [];
}>();

function formatReportValue(value: unknown): string {
  return value === undefined || value === null || value === "" ? "-" : String(value);
}

function formatHardGate(value: boolean | undefined): string {
  if (value === undefined) {
    return "-";
  }
  return value ? "已触发" : "未触发";
}

function formatScorePair(score: number | undefined, maxScore: number | undefined): string {
  if (score === undefined && maxScore === undefined) {
    return "-";
  }
  return `${formatReportValue(score)} / ${formatReportValue(maxScore)}`;
}

function formatReportDate(value: string | undefined): string {
  return value ? formatDashboardDateTime(value) : "-";
}

function dimensionScorePercent(score: number | undefined, maxScore: number | undefined): number {
  if (score === undefined || maxScore === undefined || maxScore <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round((score / maxScore) * 100)));
}

function scoreToneClass(score: number | undefined, maxScore = 100): string {
  if (score === undefined || maxScore <= 0) {
    return "tone-neutral";
  }
  const percent = (score / maxScore) * 100;
  if (percent >= 80) {
    return "tone-success";
  }
  if (percent >= 60) {
    return "tone-warning";
  }
  return "tone-danger";
}

function hardGateClass(value: boolean | undefined): string {
  if (value === undefined) {
    return "tone-neutral";
  }
  return value ? "tone-danger" : "tone-success";
}
</script>
