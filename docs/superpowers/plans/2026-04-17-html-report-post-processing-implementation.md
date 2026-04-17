# HTML Report Post-Processing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不改变 `result.json` 标准输出协议的前提下，引入 `artifactPostProcessNode` 和本地 HTML 渲染器，为每个评分用例自动生成适合本地快速浏览的单文件 `report.html`。

**Architecture:** 保留 `reportGenerationNode` 只做 `resultJson` 组装与 schema 校验，新增独立报告渲染模块负责 `resultJson -> view model -> html` 转换，再由 `artifactPostProcessNode` 将渲染结果挂到工作流状态并交给 `persistAndUploadNode` 统一写盘。页面使用内嵌 CSS 与少量原生 JS，交互只覆盖锚点导航、规则状态筛选和待人工复核展开。用户已要求最后再做 git 操作，因此本计划不包含中间提交步骤。

**Tech Stack:** TypeScript, Node.js test runner (`node --import tsx --test`), LangGraph, 原生 HTML/CSS/JavaScript, AJV schema 校验

---

## File Structure

### Create

- `src/report/renderer/buildHtmlReportViewModel.ts`
  - 将 `resultJson` 转为页面展示模型，补充汇总统计、空状态和状态计数。
- `src/report/renderer/renderHtmlReport.ts`
  - 将展示模型渲染成单文件 HTML，内嵌样式和轻量交互脚本。
- `src/nodes/artifactPostProcessNode.ts`
  - 读取 `resultJson` 并生成 `htmlReport`，为后续衍生产物扩展预留入口。
- `tests/report-renderer.test.ts`
  - 覆盖 view model 和 HTML 渲染的核心结构、空状态、筛选按钮和非 `<pre>` 输出。

### Modify

- `src/nodes/reportGenerationNode.ts`
  - 移除 HTML 拼装逻辑，仅返回 `resultJson`。
- `src/workflow/scoreWorkflow.ts`
  - 注册 `artifactPostProcessNode` 并插入工作流。
- `tests/score-agent.test.ts`
  - 更新节点级和工作流级测试，验证新节点和新 HTML 输出。

### Reuse Without Structural Changes

- `src/nodes/persistAndUploadNode.ts`
  - 继续统一落盘 `outputs/result.json` 和 `outputs/report.html`。
- `references/scoring/report_result_schema.json`
  - 保持不变，只继续作为 `resultJson` 的 schema gate。

## Task 1: Lock Renderer Requirements with Failing Tests

**Files:**
- Create: `tests/report-renderer.test.ts`
- Modify: `tests/score-agent.test.ts`
- Check: `src/nodes/reportGenerationNode.ts`

- [ ] **Step 1: 写报告渲染单测，锁定页面结构和空状态**

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { buildHtmlReportViewModel } from "../src/report/renderer/buildHtmlReportViewModel.js";
import { renderHtmlReport } from "../src/report/renderer/renderHtmlReport.js";

function makeResultJson(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    basic_info: {
      rubric_version: "v1",
      task_type: "bug_fix",
      evaluation_mode: "auto_precheck_with_human_review",
      rules_enabled: true,
      build_check_enabled: false,
      target_description: "HarmonyOS 生成工程评分",
      target_scope: "/tmp/workspace",
      task_type_basis: "bug_fix",
    },
    overall_conclusion: {
      total_score: 97.6,
      hard_gate_triggered: false,
      summary: "整体质量较高，建议优先复核低置信度项。",
    },
    dimension_results: [
      {
        dimension_name: "改动精准度与最小侵入性",
        dimension_intent: "评价是否精准修复问题且控制改动范围",
        score: 22,
        max_score: 25,
        comment: "整体较好",
        item_results: [],
      },
      {
        dimension_name: "工程规范与质量",
        dimension_intent: "评价代码规范与可维护性",
        score: 18,
        max_score: 20,
        comment: "存在少量复核点",
        item_results: [],
      },
    ],
    risks: [],
    strengths: ["命中主要问题点"],
    main_issues: ["存在 1 条待人工复核规则"],
    human_review_items: [],
    final_recommendation: ["优先复核低置信度指标"],
    rule_audit_results: [
      {
        rule_id: "ARKTS-MUST-005",
        rule_source: "must_rule",
        result: "不满足",
        conclusion: "检测到 any 类型使用。",
      },
      {
        rule_id: "ARKTS-SHOULD-002",
        rule_source: "should_rule",
        result: "待人工复核",
        conclusion: "证据不足，需要人工复核。",
      },
    ],
    report_meta: {
      report_file_name: "report.html",
      result_json_file_name: "result.json",
      unit_name: "case-1",
      generated_at: "2026-04-17T04:00:00.000Z",
    },
    ...overrides,
  };
}

test("renderHtmlReport renders summary, full dimension list, filters, and no raw json dump", () => {
  const html = renderHtmlReport(buildHtmlReportViewModel(makeResultJson()));
  assert.match(html, /评分报告/);
  assert.match(html, /97\\.6/);
  assert.match(html, /维度得分概览/);
  assert.match(html, /改动精准度与最小侵入性/);
  assert.match(html, /工程规范与质量/);
  assert.match(html, /规则审计结果/);
  assert.match(html, /data-filter=\"不满足\"/);
  assert.match(html, /data-filter=\"待人工复核\"/);
  assert.doesNotMatch(html, /<pre>\\s*\\{/);
});

test("buildHtmlReportViewModel provides explicit empty states", () => {
  const viewModel = buildHtmlReportViewModel(
    makeResultJson({
      human_review_items: [],
      risks: [],
      rule_audit_results: [],
    }),
  );
  assert.equal(viewModel.humanReview.emptyState, "当前没有待人工复核项。");
  assert.equal(viewModel.risks.emptyState, "当前没有明显风险项。");
  assert.equal(viewModel.ruleAudit.emptyState, "当前没有可展示的规则审计结果。");
});
```

- [ ] **Step 2: 运行渲染测试，确认当前实现失败**

Run: `node --import tsx --test tests/report-renderer.test.ts`

Expected: FAIL，提示 `buildHtmlReportViewModel` 或 `renderHtmlReport` 模块不存在。

- [ ] **Step 3: 扩充节点级测试，锁定 report/result 职责拆分**

```ts
test("reportGenerationNode only returns schema-valid resultJson without html report", async (t) => {
  const referenceRoot = await createReferenceRoot(t);
  const scoringResult = await scoringOrchestrationNode({
    taskType: "bug_fix",
    staticRuleAuditResults: [],
    deterministicRuleResults: [],
    ruleViolations: [],
    constraintSummary: {
      explicitConstraints: [],
      contextualConstraints: [],
      implicitConstraints: [],
      classificationHints: ["bug_fix"],
    },
    featureExtraction: {
      basicFeatures: [],
      structuralFeatures: [],
      semanticFeatures: [],
      changeFeatures: [],
    },
    evidenceSummary: {
      workspaceFileCount: 1,
      originalFileCount: 1,
      changedFileCount: 1,
      changedFiles: ["entry/src/main/ets/Index.ets"],
      hasPatch: true,
    },
  } as never);

  const reportResult = await reportGenerationNode(
    {
      taskType: "bug_fix",
      caseInput: {
        caseId: "case-1",
        promptText: "请修复餐厅列表页中的 bug",
        originalProjectPath: "/tmp/original",
        generatedProjectPath: "/tmp/workspace",
      },
      constraintSummary: {
        explicitConstraints: [],
        contextualConstraints: [],
        implicitConstraints: [],
        classificationHints: ["bug_fix"],
      },
      rubricSnapshot: {
        task_type: "bug_fix",
        evaluation_mode: "auto_precheck_with_human_review",
        scenario: "用户提供 Bug 修复 diff、修复前后代码、问题描述与修复结果，目标是评价修复是否命中问题且控制侵入范围。",
        scoring_method: "discrete_band",
        scoring_note: "二级指标按离散档位给分。",
        common_risks: ["因顺手优化造成 diff 噪音和误修。"],
        report_emphasis: ["是否命中问题点。"],
        dimension_summaries: [
          {
            name: "改动精准度与最小侵入性",
            weight: 25,
            intent: "评价是否精准修复问题且控制改动范围",
            item_summaries: [
              {
                name: "问题点命中程度",
                weight: 10,
                scoring_bands: [{ score: 10, criteria: "修改直接命中根因或完整故障链路。" }],
              },
            ],
          },
        ],
        hard_gates: [{ id: "G4", score_cap: 59 }],
        review_rule_summary: ["关键分段分数需要人工复核"],
      },
      deterministicRuleResults: [],
      scoreComputation: scoringResult.scoreComputation,
      ruleViolations: [],
    } as never,
    { referenceRoot },
  );

  assert.ok(reportResult.resultJson);
  assert.equal(reportResult.htmlReport, undefined);
});
```

- [ ] **Step 4: 运行节点级测试，确认职责拆分断言先失败**

Run: `node --import tsx --test tests/score-agent.test.ts`

Expected: FAIL，旧实现仍返回 `htmlReport`，新断言尚未满足。

## Task 2: Implement the HTML Report View Model and Renderer

**Files:**
- Create: `src/report/renderer/buildHtmlReportViewModel.ts`
- Create: `src/report/renderer/renderHtmlReport.ts`
- Test: `tests/report-renderer.test.ts`

- [ ] **Step 1: 实现展示模型转换，统一处理汇总数字和空状态**

```ts
export interface HtmlReportViewModel {
  summary: {
    title: string;
    totalScore: string;
    hardGateLabel: string;
    summaryText: string;
    caseId: string;
    taskType: string;
    generatedAt: string;
    reviewCount: number;
    riskCount: number;
    violationCount: number;
  };
  dimensions: Array<{
    name: string;
    intent: string;
    scoreText: string;
    progressPercent: number;
    comment: string;
    items: Array<{
      name: string;
      weight: number;
      score: number;
      matchedBandText: string;
      confidence: string;
      reviewRequired: boolean;
      rationale: string;
      evidence: string;
    }>;
  }>;
  humanReview: {
    items: Array<{
      item: string;
      currentAssessment: string;
      uncertaintyReason: string;
      suggestedFocus: string;
    }>;
    emptyState: string;
  };
  ruleAudit: {
    counts: Record<"不满足" | "待人工复核" | "满足" | "不涉及", number>;
    items: Array<{
      ruleId: string;
      ruleSource: string;
      result: string;
      conclusion: string;
    }>;
    emptyState: string;
  };
  risks: { items: string[]; emptyState: string };
  issues: { items: string[]; emptyState: string };
  strengths: string[];
  recommendations: string[];
}

export function buildHtmlReportViewModel(resultJson: Record<string, unknown>): HtmlReportViewModel {
  const basicInfo = (resultJson.basic_info ?? {}) as Record<string, unknown>;
  const overallConclusion = (resultJson.overall_conclusion ?? {}) as Record<string, unknown>;
  const reportMeta = (resultJson.report_meta ?? {}) as Record<string, unknown>;
  const dimensionResults = Array.isArray(resultJson.dimension_results) ? resultJson.dimension_results : [];
  const humanReviewItems = Array.isArray(resultJson.human_review_items) ? resultJson.human_review_items : [];
  const ruleAuditResults = Array.isArray(resultJson.rule_audit_results) ? resultJson.rule_audit_results : [];
  const risks = Array.isArray(resultJson.risks) ? resultJson.risks : [];
  const mainIssues = Array.isArray(resultJson.main_issues) ? resultJson.main_issues : [];
  const strengths = Array.isArray(resultJson.strengths) ? resultJson.strengths.map(String) : [];
  const recommendations = Array.isArray(resultJson.final_recommendation)
    ? resultJson.final_recommendation.map(String)
    : [];

  return {
    summary: {
      title: "评分报告",
      totalScore: String(overallConclusion.total_score ?? "-"),
      hardGateLabel: overallConclusion.hard_gate_triggered ? "已触发硬门禁" : "未触发硬门禁",
      summaryText: String(overallConclusion.summary ?? "暂无总体结论。"),
      caseId: String(reportMeta.unit_name ?? "unknown-case"),
      taskType: String(basicInfo.task_type ?? "unknown"),
      generatedAt: String(reportMeta.generated_at ?? ""),
      reviewCount: humanReviewItems.length,
      riskCount: risks.length,
      violationCount: ruleAuditResults.filter((item) => (item as Record<string, unknown>).result === "不满足").length,
    },
    dimensions: dimensionResults.map((dimension) => {
      const current = dimension as Record<string, unknown>;
      const score = Number(current.score ?? 0);
      const maxScore = Number(current.max_score ?? 0);
      return {
        name: String(current.dimension_name ?? ""),
        intent: String(current.dimension_intent ?? ""),
        scoreText: `${score} / ${maxScore}`,
        progressPercent: maxScore > 0 ? Math.min(100, Math.round((score / maxScore) * 100)) : 0,
        comment: String(current.comment ?? "暂无评语。"),
        items: Array.isArray(current.item_results)
          ? current.item_results.map((item) => {
              const currentItem = item as Record<string, unknown>;
              const matchedBand = (currentItem.matched_band ?? null) as Record<string, unknown> | null;
              return {
                name: String(currentItem.item_name ?? ""),
                weight: Number(currentItem.item_weight ?? 0),
                score: Number(currentItem.score ?? 0),
                matchedBandText: matchedBand
                  ? `${String(matchedBand.score ?? "")} 分：${String(matchedBand.criteria ?? "")}`
                  : "未命中评分档位",
                confidence: String(currentItem.confidence ?? "low"),
                reviewRequired: Boolean(currentItem.review_required),
                rationale: String(currentItem.rationale ?? "暂无理由。"),
                evidence: String(currentItem.evidence ?? "暂无证据。"),
              };
            })
          : [],
      };
    }),
    humanReview: {
      items: humanReviewItems.map((item) => {
        const current = item as Record<string, unknown>;
        return {
          item: String(current.item ?? ""),
          currentAssessment: String(current.current_assessment ?? ""),
          uncertaintyReason: String(current.uncertainty_reason ?? ""),
          suggestedFocus: String(current.suggested_focus ?? ""),
        };
      }),
      emptyState: "当前没有待人工复核项。",
    },
    ruleAudit: {
      counts: {
        不满足: ruleAuditResults.filter((item) => (item as Record<string, unknown>).result === "不满足").length,
        待人工复核: ruleAuditResults.filter((item) => (item as Record<string, unknown>).result === "待人工复核").length,
        满足: ruleAuditResults.filter((item) => (item as Record<string, unknown>).result === "满足").length,
        不涉及: ruleAuditResults.filter((item) => (item as Record<string, unknown>).result === "不涉及").length,
      },
      items: ruleAuditResults.map((item) => {
        const current = item as Record<string, unknown>;
        return {
          ruleId: String(current.rule_id ?? ""),
          ruleSource: String(current.rule_source ?? ""),
          result: String(current.result ?? ""),
          conclusion: String(current.conclusion ?? ""),
        };
      }),
      emptyState: "当前没有可展示的规则审计结果。",
    },
    risks: {
      items: risks.map((item) => String((item as Record<string, unknown>).description ?? item)),
      emptyState: "当前没有明显风险项。",
    },
    issues: {
      items: mainIssues.map(String),
      emptyState: "当前没有主要问题项。",
    },
    strengths,
    recommendations,
  };
}
```

- [ ] **Step 2: 实现单文件 HTML 渲染器，加入轻量交互**

```ts
import { HtmlReportViewModel } from "./buildHtmlReportViewModel.js";

function escapeHtml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function renderHtmlReport(viewModel: HtmlReportViewModel): string {
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(viewModel.summary.caseId)} 评分报告</title>
    <style>
      :root {
        --bg: #f3f6fb;
        --card: #ffffff;
        --text: #162033;
        --muted: #5b6778;
        --border: #d8dee8;
        --primary: #1f6feb;
      }
      * { box-sizing: border-box; }
      body { margin: 0; font-family: "PingFang SC","Noto Sans SC",sans-serif; background: var(--bg); color: var(--text); }
      .container { max-width: 1200px; margin: 0 auto; padding: 32px 24px 56px; }
      .card { background: var(--card); border: 1px solid var(--border); border-radius: 24px; padding: 24px; margin-bottom: 18px; }
      .hero { padding: 28px; }
      .filter-chip[data-active="true"] { background: #e8f0fe; color: var(--primary); }
      .review-detail[hidden], .rule-row[hidden] { display: none; }
      .progress { height: 10px; background: #edf1f6; border-radius: 999px; overflow: hidden; }
      .progress > span { display: block; height: 100%; background: var(--primary); }
    </style>
  </head>
  <body>
    <div class="container">
      <nav class="card" style="display:flex; gap:12px; flex-wrap:wrap;">
        <a href="#summary">摘要</a>
        <a href="#dimensions">维度得分</a>
        <a href="#human-review">待人工复核</a>
        <a href="#rule-audit">规则审计</a>
        <a href="#risks">风险与问题</a>
        <a href="#strengths">亮点与建议</a>
      </nav>
      <section id="summary" class="card hero">
        <h1 style="margin:0 0 8px;">${escapeHtml(viewModel.summary.title)}</h1>
        <div style="display:flex; gap:16px; align-items:baseline; flex-wrap:wrap;">
          <strong style="font-size:56px;">${escapeHtml(viewModel.summary.totalScore)}</strong>
          <span>${escapeHtml(viewModel.summary.hardGateLabel)}</span>
          <span>${escapeHtml(viewModel.summary.taskType)}</span>
        </div>
        <p>${escapeHtml(viewModel.summary.summaryText)}</p>
      </section>
      <section id="dimensions" class="card">
        <h2>维度得分概览</h2>
        ${viewModel.dimensions.map((dimension) => `
          <article style="padding:16px 0; border-top:1px solid var(--border);">
            <div style="display:flex; justify-content:space-between; gap:16px;">
              <strong>${escapeHtml(dimension.name)}</strong>
              <span>${escapeHtml(dimension.scoreText)}</span>
            </div>
            <p>${escapeHtml(dimension.intent)}</p>
            <div class="progress"><span style="width:${dimension.progressPercent}%;"></span></div>
            <p>${escapeHtml(dimension.comment)}</p>
          </article>
        `).join("")}
      </section>
      <section id="human-review" class="card">
        <h2>待人工复核</h2>
        ${viewModel.humanReview.items.length > 0
          ? viewModel.humanReview.items.map((item, index) => `
              <article style="padding:14px 0; border-top:1px solid var(--border);">
                <button type="button" data-review-toggle="review-${index}" aria-expanded="false">${escapeHtml(item.item)}</button>
                <div id="review-${index}" class="review-detail" hidden>
                  <p>${escapeHtml(item.currentAssessment)}</p>
                  <p>${escapeHtml(item.uncertaintyReason)}</p>
                  <p>${escapeHtml(item.suggestedFocus)}</p>
                </div>
              </article>
            `).join("")
          : `<p>${escapeHtml(viewModel.humanReview.emptyState)}</p>`}
      </section>
      <section id="rule-audit" class="card">
        <h2>规则审计结果</h2>
        <div style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:16px;">
          ${["全部", "不满足", "待人工复核", "满足", "不涉及"].map((filter, index) => `
            <button type="button" class="filter-chip" data-filter="${filter}" data-active="${index === 0 ? "true" : "false"}">${filter}</button>
          `).join("")}
        </div>
        ${viewModel.ruleAudit.items.length > 0
          ? viewModel.ruleAudit.items.map((item) => `
              <article class="rule-row" data-rule-result="${escapeHtml(item.result)}" style="padding:14px 0; border-top:1px solid var(--border);">
                <div style="display:flex; justify-content:space-between; gap:16px;">
                  <strong>${escapeHtml(item.ruleId)}</strong>
                  <span>${escapeHtml(item.result)}</span>
                </div>
                <p>${escapeHtml(item.ruleSource)}</p>
                <p>${escapeHtml(item.conclusion)}</p>
              </article>
            `).join("")
          : `<p>${escapeHtml(viewModel.ruleAudit.emptyState)}</p>`}
      </section>
      <section id="risks" class="card">
        <h2>风险与主要问题</h2>
        ${viewModel.risks.items.length > 0 ? `<ul>${viewModel.risks.items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : `<p>${escapeHtml(viewModel.risks.emptyState)}</p>`}
        ${viewModel.issues.items.length > 0 ? `<ul>${viewModel.issues.items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : `<p>${escapeHtml(viewModel.issues.emptyState)}</p>`}
      </section>
      <section id="strengths" class="card">
        <h2>亮点与建议</h2>
        <ul>${viewModel.strengths.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
        <ul>${viewModel.recommendations.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
      </section>
    </div>
    <script>
      document.querySelectorAll("[data-review-toggle]").forEach((button) => {
        button.addEventListener("click", () => {
          const target = document.getElementById(button.getAttribute("data-review-toggle"));
          const expanded = button.getAttribute("aria-expanded") === "true";
          button.setAttribute("aria-expanded", String(!expanded));
          if (target) target.hidden = expanded;
        });
      });
      document.querySelectorAll("[data-filter]").forEach((button) => {
        button.addEventListener("click", () => {
          const filter = button.getAttribute("data-filter");
          document.querySelectorAll("[data-filter]").forEach((item) => item.setAttribute("data-active", "false"));
          button.setAttribute("data-active", "true");
          document.querySelectorAll("[data-rule-result]").forEach((row) => {
            row.hidden = filter !== "全部" && row.getAttribute("data-rule-result") !== filter;
          });
        });
      });
    </script>
  </body>
</html>`;
}
```

- [ ] **Step 3: 运行渲染测试，确认新模块通过**

Run: `node --import tsx --test tests/report-renderer.test.ts`

Expected: PASS，至少包含 2 个通过用例。

## Task 3: Insert the Post-Processing Node into the Workflow

**Files:**
- Create: `src/nodes/artifactPostProcessNode.ts`
- Modify: `src/nodes/reportGenerationNode.ts`
- Modify: `src/workflow/scoreWorkflow.ts`
- Test: `tests/score-agent.test.ts`

- [ ] **Step 1: 新增通用后处理节点，封装 HTML 生成**

```ts
import { buildHtmlReportViewModel } from "../report/renderer/buildHtmlReportViewModel.js";
import { renderHtmlReport } from "../report/renderer/renderHtmlReport.js";
import { emitNodeFailed, emitNodeStarted } from "../workflow/observability/nodeCustomEvents.js";
import { ScoreGraphState } from "../workflow/state.js";

export async function artifactPostProcessNode(state: ScoreGraphState): Promise<Partial<ScoreGraphState>> {
  emitNodeStarted("artifactPostProcessNode");
  try {
    const resultJson = state.resultJson ?? {};
    const htmlReport = renderHtmlReport(buildHtmlReportViewModel(resultJson));
    return { htmlReport };
  } catch (error) {
    emitNodeFailed("artifactPostProcessNode", error);
    throw error;
  }
}
```

- [ ] **Step 2: 收窄 `reportGenerationNode` 职责，只返回 `resultJson`**

```ts
export async function reportGenerationNode(
  state: ScoreGraphState,
  config: { referenceRoot: string },
): Promise<Partial<ScoreGraphState>> {
  const schemaPath = path.join(config.referenceRoot, "report_result_schema.json");
  const resultJson = {
    basic_info: {
      rubric_version: "v1",
      task_type: state.taskType,
      evaluation_mode: "auto_precheck_with_human_review",
      rules_enabled: true,
      build_check_enabled: false,
      target_description: "HarmonyOS 生成工程评分",
      target_scope: state.caseInput.generatedProjectPath,
      task_type_basis: state.constraintSummary.classificationHints.join("; "),
    },
    rubric_summary: state.rubricSnapshot,
    overall_conclusion: state.scoreComputation.overallConclusion,
    dimension_results: buildDimensionResults(state),
    rule_violations: state.ruleViolations,
    risks: state.scoreComputation.risks,
    strengths: state.scoreComputation.strengths,
    main_issues: state.scoreComputation.mainIssues,
    human_review_items: state.scoreComputation.humanReviewItems,
    final_recommendation: state.scoreComputation.finalRecommendation,
    rule_audit_results: effectiveRuleAuditResults,
    report_meta: {
      report_file_name: "report.html",
      result_json_file_name: "result.json",
      unit_name: state.caseInput.caseId,
      generated_at: new Date().toISOString(),
    },
  };

  validateReportResult(resultJson, schemaPath);
  return { resultJson };
}
```

- [ ] **Step 3: 调整工作流节点顺序，插入 `artifactPostProcessNode`**

```ts
import { artifactPostProcessNode } from "../nodes/artifactPostProcessNode.js";

const graph = new StateGraph(ScoreState)
  .addNode("reportGenerationNode", (s) => reportGenerationNode(s, { referenceRoot: input.referenceRoot }))
  .addNode("artifactPostProcessNode", (s) => artifactPostProcessNode(s))
  .addNode("persistAndUploadNode", (s) =>
    persistAndUploadNode(s, {
      artifactStore: input.artifactStore,
      uploadEndpoint: input.uploadEndpoint,
      uploadToken: input.uploadToken,
    }),
  )
  .addEdge("scoringOrchestrationNode", "reportGenerationNode")
  .addEdge("reportGenerationNode", "artifactPostProcessNode")
  .addEdge("artifactPostProcessNode", "persistAndUploadNode");
```

- [ ] **Step 4: 更新工作流测试，验证新节点和新 HTML 输出**

```ts
test("artifactPostProcessNode generates layered html report from resultJson", async () => {
  const postProcessResult = await artifactPostProcessNode({
    resultJson: makeValidResultJson(),
  } as never);

  assert.match(postProcessResult.htmlReport ?? "", /维度得分概览/);
  assert.match(postProcessResult.htmlReport ?? "", /待人工复核/);
  assert.match(postProcessResult.htmlReport ?? "", /规则审计结果/);
});

test("runScoreWorkflow writes layered report html instead of raw preformatted json", async (t) => {
  const referenceRoot = await createReferenceRoot(t);
  const localCaseRoot = await makeTempDir(t);
  const artifactStore = new ArtifactStore(localCaseRoot);
  const caseDir = await artifactStore.ensureCaseDir("case-1");
  const caseRootDir = await makeTempDir(t);
  const fixtureCaseDir = await writeCaseFixture(caseRootDir, {
    promptText: "请修复餐厅列表页中的 bug",
    withPatch: true,
    workspaceContent: "let x: any = 1;\\nvar y = 2;\\n",
  });
  const caseInput = await loadCaseFromPath(fixtureCaseDir);

  await runScoreWorkflow({
    caseInput: { ...caseInput, caseId: "case-1" },
    caseDir,
    referenceRoot,
    artifactStore,
  });

  const reportHtml = await fs.readFile(path.join(caseDir, "outputs", "report.html"), "utf-8");
  assert.match(reportHtml, /维度得分概览/);
  assert.match(reportHtml, /规则审计结果/);
  assert.doesNotMatch(reportHtml, /<pre>\\s*\\{/);
});
```

- [ ] **Step 5: 运行工作流测试，确认节点接线和产物落盘正确**

Run: `node --import tsx --test tests/score-agent.test.ts`

Expected: PASS，`artifactPostProcessNode` 相关断言通过，原有工作流测试仍通过。

## Task 4: Verify End-to-End Output and Local Browsing Experience

**Files:**
- Modify: `tests/score-agent.test.ts`
- Reuse: `.local-cases/`

- [ ] **Step 1: 跑完整测试套件，确保没有引入回归**

Run: `npm test`

Expected: PASS，全部现有测试与新增测试通过。

- [ ] **Step 2: 运行真实评分命令，确认新 HTML 报告落盘**

Run: `npm run score -- --case init-input`

Expected: 命令成功结束，并在最新生成的 `.local-cases/` 子目录下产生 `outputs/result.json` 和 `outputs/report.html`。

- [ ] **Step 3: 人工检查生成报告是否满足产品约束**

```text
打开 Step 2 生成的最新 `.local-cases/` 子目录中的 `outputs/report.html`，逐项确认：
1. 首屏先看到总分、硬门禁状态、结论摘要、用例元信息
2. 维度得分完整展示，无折叠
3. 待人工复核项可展开
4. 规则审计可按状态筛选
5. 页面不展示原始 JSON
```

- [ ] **Step 4: 记录验证结果并准备最终 git 操作**

```text
在最终总结中附带：
- 通过的测试命令
- 最新 score case 输出目录
- report.html 关键验证点

按用户要求，所有 git add / git commit 延后到实现与验证全部完成之后再执行。
```

## Self-Review

### Spec coverage

- `artifactPostProcessNode` 命名与通用后处理职责：Task 3
- `result.json` 作为唯一标准输出：Task 1 + Task 3
- 单文件 HTML 报告与轻量交互：Task 2
- 首屏摘要、完整维度展示、待复核展开、规则筛选：Task 2 + Task 4
- 工作流接线、落盘与真实评分验证：Task 3 + Task 4

### Placeholder scan

- 没有使用 `TODO`、`TBD`、`implement later`、省略号占位或“类似 Task N”写法。
- 每个测试步骤都给了明确命令和预期结果。
- 代码步骤提供了需要实现的接口、函数或断言骨架。

### Type consistency

- 后处理节点统一使用 `artifactPostProcessNode`
- HTML 产物字段统一为 `htmlReport`
- 渲染入口统一为 `buildHtmlReportViewModel` + `renderHtmlReport`
