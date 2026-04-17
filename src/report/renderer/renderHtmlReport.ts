import { HtmlReportViewModel } from "./buildHtmlReportViewModel.js";

function escapeHtml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderList(items: string[], emptyState: string): string {
  if (items.length === 0) {
    return `<p class="empty-state">${escapeHtml(emptyState)}</p>`;
  }
  return `<ul class="plain-list">${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
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
        --bg: #eef3f8;
        --card: #ffffff;
        --card-soft: #f6f8fb;
        --text: #142033;
        --muted: #5c697a;
        --border: #d9e2ec;
        --primary: #205ecf;
        --danger: #b42318;
        --warning: #b54708;
        --success: #027a48;
        --shadow: 0 18px 40px rgba(20, 32, 51, 0.08);
      }
      * { box-sizing: border-box; }
      html { scroll-behavior: smooth; }
      body {
        margin: 0;
        font-family: "PingFang SC", "Noto Sans SC", "Microsoft YaHei", sans-serif;
        background:
          radial-gradient(circle at top left, rgba(32, 94, 207, 0.08), transparent 30%),
          linear-gradient(180deg, #f6f9fc 0%, var(--bg) 100%);
        color: var(--text);
      }
      a { color: inherit; text-decoration: none; }
      .page { max-width: 1240px; margin: 0 auto; padding: 28px 24px 64px; }
      .top-nav {
        position: sticky;
        top: 16px;
        z-index: 10;
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
        margin-bottom: 18px;
        padding: 12px;
        background: rgba(255, 255, 255, 0.8);
        border: 1px solid rgba(217, 226, 236, 0.9);
        border-radius: 18px;
        backdrop-filter: blur(10px);
      }
      .top-nav a {
        padding: 9px 14px;
        border-radius: 999px;
        background: #fff;
        border: 1px solid var(--border);
        color: var(--muted);
        font-size: 14px;
      }
      .hero, .section-card {
        background: var(--card);
        border: 1px solid var(--border);
        border-radius: 28px;
        box-shadow: var(--shadow);
      }
      .hero { padding: 28px; margin-bottom: 18px; }
      .hero-grid {
        display: grid;
        grid-template-columns: minmax(0, 1.3fr) minmax(260px, 0.7fr);
        gap: 16px;
      }
      .hero-main {
        padding: 24px;
        border-radius: 24px;
        background: linear-gradient(145deg, #f8fbff, #eef4ff);
        border: 1px solid #d6e5ff;
      }
      .hero-side {
        display: grid;
        gap: 16px;
      }
      .eyebrow, .section-title small {
        color: var(--muted);
        text-transform: uppercase;
        letter-spacing: 0.08em;
        font-size: 12px;
        font-weight: 600;
      }
      .score-row {
        display: flex;
        align-items: flex-end;
        gap: 14px;
        margin: 14px 0 10px;
        flex-wrap: wrap;
      }
      .score {
        font-size: 64px;
        line-height: 0.95;
        font-weight: 750;
      }
      .badge {
        display: inline-flex;
        align-items: center;
        padding: 8px 12px;
        border-radius: 999px;
        font-size: 13px;
        font-weight: 600;
      }
      .badge.success { background: #e8f7ef; color: var(--success); }
      .badge.danger { background: #fdecea; color: var(--danger); }
      .meta-list, .summary-stats {
        display: grid;
        gap: 12px;
      }
      .mini-card {
        padding: 18px;
        border-radius: 20px;
        border: 1px solid var(--border);
        background: var(--card);
      }
      .meta-item {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        color: var(--muted);
        font-size: 14px;
      }
      .summary-grid { margin-top: 16px; }
      .progress-block { margin-top: 14px; }
      .progress-head {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 6px;
        font-size: 14px;
      }
      .progress-track {
        height: 10px;
        background: #ebf0f5;
        border-radius: 999px;
        overflow: hidden;
      }
      .progress-bar {
        height: 100%;
        border-radius: inherit;
        background: linear-gradient(90deg, var(--primary), #5a8eff);
      }
      .muted { color: var(--muted); }
      .section-card { padding: 24px; margin-bottom: 18px; }
      .section-title {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        gap: 16px;
        margin-bottom: 16px;
      }
      .section-title h2 {
        margin: 0;
        font-size: 24px;
      }
      .dimension-card {
        padding: 18px 0;
        border-top: 1px solid var(--border);
      }
      .dimension-card:first-of-type,
      .review-item:first-of-type,
      .rule-row:first-of-type {
        border-top: 0;
        padding-top: 0;
      }
      .dimension-head {
        display: flex;
        justify-content: space-between;
        gap: 16px;
        align-items: baseline;
        margin-bottom: 8px;
      }
      .dimension-items {
        display: grid;
        gap: 10px;
        margin-top: 14px;
      }
      .detail-card {
        padding: 14px;
        border-radius: 16px;
        background: var(--card-soft);
        border: 1px solid #e5ebf2;
      }
      .detail-card strong { display: block; margin-bottom: 8px; }
      .detail-meta {
        display: flex;
        gap: 12px;
        flex-wrap: wrap;
        color: var(--muted);
        font-size: 13px;
      }
      .review-item, .rule-row {
        padding: 16px 0;
        border-top: 1px solid var(--border);
      }
      .review-toggle, .filter-chip {
        appearance: none;
        border: 1px solid var(--border);
        background: #fff;
        color: var(--text);
        cursor: pointer;
      }
      .review-toggle {
        width: 100%;
        border-radius: 18px;
        padding: 14px 16px;
        text-align: left;
      }
      .review-detail {
        margin-top: 10px;
        padding: 14px;
        border-radius: 16px;
        background: var(--card-soft);
        border: 1px solid #e5ebf2;
      }
      .review-detail[hidden], .rule-row[hidden] { display: none; }
      .rule-toolbar {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        margin-bottom: 8px;
      }
      .filter-chip {
        border-radius: 999px;
        padding: 9px 14px;
        font-size: 13px;
      }
      .filter-chip[data-active="true"] {
        background: #e8efff;
        border-color: #c4d8ff;
        color: var(--primary);
      }
      .rule-head {
        display: flex;
        justify-content: space-between;
        gap: 16px;
        align-items: center;
      }
      .rule-status {
        border-radius: 999px;
        padding: 6px 10px;
        font-size: 12px;
        font-weight: 600;
      }
      .rule-status.不满足 { background: #fdecea; color: var(--danger); }
      .rule-status.待人工复核 { background: #fff3e8; color: var(--warning); }
      .rule-status.满足 { background: #e8f7ef; color: var(--success); }
      .rule-status.不涉及 { background: #eef2f6; color: var(--muted); }
      .plain-list {
        margin: 0;
        padding-left: 20px;
        display: grid;
        gap: 10px;
      }
      .empty-state {
        margin: 0;
        color: var(--muted);
      }
      @media (max-width: 900px) {
        .hero-grid, .summary-grid {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </head>
  <body>
    <main class="page">
      <nav class="top-nav">
        <a href="#summary">摘要</a>
        <a href="#dimensions">维度得分</a>
        <a href="#human-review">待人工复核</a>
        <a href="#rule-audit">规则审计结果</a>
        <a href="#risks">风险与问题</a>
        <a href="#strengths">亮点与建议</a>
      </nav>

      <section id="summary" class="hero">
        <div class="hero-grid">
          <div class="hero-main">
            <div class="eyebrow">Overall Summary</div>
            <div class="score-row">
              <div class="score">${escapeHtml(viewModel.summary.totalScore)}</div>
              <span class="badge ${viewModel.summary.hardGateLabel.includes("未") ? "success" : "danger"}">${escapeHtml(viewModel.summary.hardGateLabel)}</span>
              <span class="badge">${escapeHtml(viewModel.summary.taskType)}</span>
            </div>
            <p>${escapeHtml(viewModel.summary.summaryText)}</p>
            ${
              viewModel.summary.recommendationText
                ? `<p><strong>${escapeHtml(viewModel.summary.recommendationText)}</strong></p>`
                : ""
            }
          </div>
          <div class="hero-side">
            <div class="mini-card meta-list">
              <div class="eyebrow">Case Meta</div>
              <div class="meta-item"><span>用例</span><strong>${escapeHtml(viewModel.summary.caseId)}</strong></div>
              <div class="meta-item"><span>任务类型</span><strong>${escapeHtml(viewModel.summary.taskType)}</strong></div>
              <div class="meta-item"><span>生成时间</span><strong>${escapeHtml(viewModel.summary.generatedAt)}</strong></div>
            </div>
            <div class="mini-card summary-stats">
              <div class="eyebrow">待处理提醒</div>
              <div class="meta-item"><span>人工复核</span><strong>${viewModel.summary.reviewCount}</strong></div>
              <div class="meta-item"><span>主要风险</span><strong>${viewModel.summary.riskCount}</strong></div>
              <div class="meta-item"><span>规则不满足</span><strong>${viewModel.summary.violationCount}</strong></div>
            </div>
          </div>
        </div>
        <div class="summary-grid">
          <div class="mini-card">
            <div class="eyebrow">维度得分概览</div>
            ${viewModel.dimensions
              .map(
                (dimension) => `
                  <div class="progress-block">
                    <div class="progress-head">
                      <span>${escapeHtml(dimension.name)}</span>
                      <strong>${escapeHtml(dimension.scoreText)}</strong>
                    </div>
                    <div class="progress-track"><div class="progress-bar" style="width:${dimension.progressPercent}%"></div></div>
                  </div>`,
              )
              .join("")}
          </div>
        </div>
      </section>

      <section id="dimensions" class="section-card">
        <div class="section-title">
          <h2>维度得分</h2>
          <small>完整展示所有评分维度</small>
        </div>
        ${viewModel.dimensions
          .map(
            (dimension) => `
              <article class="dimension-card">
                <div class="dimension-head">
                  <div>
                    <strong>${escapeHtml(dimension.name)}</strong>
                    <p class="muted">${escapeHtml(dimension.intent)}</p>
                  </div>
                  <strong>${escapeHtml(dimension.scoreText)}</strong>
                </div>
                <div class="progress-track"><div class="progress-bar" style="width:${dimension.progressPercent}%"></div></div>
                <p>${escapeHtml(dimension.comment)}</p>
                <div class="dimension-items">
                  ${
                    dimension.items.length > 0
                      ? dimension.items
                          .map(
                            (item) => `
                            <div class="detail-card">
                              <strong>${escapeHtml(item.name)}</strong>
                              <div class="detail-meta">
                                <span>权重 ${item.weight}</span>
                                <span>得分 ${item.score}</span>
                                <span>置信度 ${escapeHtml(item.confidence)}</span>
                                <span>${item.reviewRequired ? "需要人工复核" : "无需人工复核"}</span>
                              </div>
                              <p>${escapeHtml(item.matchedBandText)}</p>
                              <p>${escapeHtml(item.rationale)}</p>
                              <p class="muted">${escapeHtml(item.evidence)}</p>
                            </div>`,
                          )
                          .join("")
                      : `<p class="empty-state">当前维度没有 item 明细。</p>`
                  }
                </div>
              </article>`,
          )
          .join("")}
      </section>

      <section id="human-review" class="section-card">
        <div class="section-title">
          <h2>待人工复核</h2>
          <small>展开查看当前判断、不确定原因与建议关注点</small>
        </div>
        ${
          viewModel.humanReview.items.length > 0
            ? viewModel.humanReview.items
                .map(
                  (item, index) => `
                    <article class="review-item">
                      <button type="button" class="review-toggle" data-review-toggle="review-${index}" aria-expanded="false">
                        <strong>${escapeHtml(item.item)}</strong>
                        <div class="muted">${escapeHtml(item.currentAssessment)}</div>
                      </button>
                      <div id="review-${index}" class="review-detail" hidden>
                        <p><strong>当前判断：</strong>${escapeHtml(item.currentAssessment)}</p>
                        <p><strong>不确定原因：</strong>${escapeHtml(item.uncertaintyReason)}</p>
                        <p><strong>建议关注点：</strong>${escapeHtml(item.suggestedFocus)}</p>
                      </div>
                    </article>`,
                )
                .join("")
            : `<p class="empty-state">${escapeHtml(viewModel.humanReview.emptyState)}</p>`
        }
      </section>

      <section id="rule-audit" class="section-card">
        <div class="section-title">
          <h2>规则审计结果</h2>
          <small>按状态筛选快速定位异常规则</small>
        </div>
        <div class="rule-toolbar">
          ${(["全部", "不满足", "待人工复核", "满足", "不涉及"] as const)
            .map((filter, index) => {
              const count =
                filter === "全部"
                  ? viewModel.ruleAudit.items.length
                  : (viewModel.ruleAudit.counts[
                      filter as keyof typeof viewModel.ruleAudit.counts
                    ] ?? 0);
              return `<button type="button" class="filter-chip" data-filter="${filter}" data-active="${index === 0 ? "true" : "false"}">${filter} ${count}</button>`;
            })
            .join("")}
        </div>
        ${
          viewModel.ruleAudit.items.length > 0
            ? viewModel.ruleAudit.items
                .map(
                  (item) => `
                    <article class="rule-row" data-rule-result="${escapeHtml(item.result)}">
                      <div class="rule-head">
                        <strong>${escapeHtml(item.ruleId)}</strong>
                        <span class="rule-status ${escapeHtml(item.result)}">${escapeHtml(item.result)}</span>
                      </div>
                      <p class="muted">${escapeHtml(item.ruleSource)}</p>
                      <p>${escapeHtml(item.conclusion)}</p>
                    </article>`,
                )
                .join("")
            : `<p class="empty-state">${escapeHtml(viewModel.ruleAudit.emptyState)}</p>`
        }
      </section>

      <section id="risks" class="section-card">
        <div class="section-title">
          <h2>风险与主要问题</h2>
          <small>先看风险，再看主要问题</small>
        </div>
        ${renderList(viewModel.risks.items, viewModel.risks.emptyState)}
        ${renderList(viewModel.issues.items, viewModel.issues.emptyState)}
      </section>

      <section id="strengths" class="section-card">
        <div class="section-title">
          <h2>亮点与建议</h2>
          <small>汇总正向结果与后续行动</small>
        </div>
        ${renderList(viewModel.strengths, "当前没有亮点总结。")}
        ${renderList(viewModel.recommendations, "当前没有补充建议。")}
      </section>
    </main>
    <script>
      document.querySelectorAll("[data-review-toggle]").forEach((button) => {
        button.addEventListener("click", () => {
          const target = document.getElementById(button.getAttribute("data-review-toggle"));
          const expanded = button.getAttribute("aria-expanded") === "true";
          button.setAttribute("aria-expanded", String(!expanded));
          if (target) {
            target.hidden = expanded;
          }
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
