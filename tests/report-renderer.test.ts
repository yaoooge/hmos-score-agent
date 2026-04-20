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
    bound_rule_packs: [
      {
        pack_id: "arkts-language",
        display_name: "从 TypeScript 到 ArkTS 的适配规则与 ArkTS 编程规范",
      },
      {
        pack_id: "case-requirement_004",
        display_name: "用例 requirement_004 约束规则",
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
  assert.match(html, /97\.6/);
  assert.match(html, /维度得分概览/);
  assert.match(html, /改动精准度与最小侵入性/);
  assert.match(html, /工程规范与质量/);
  assert.match(html, /规则审计结果/);
  assert.doesNotMatch(html, /建议动作：优先复核低置信度指标/);
  assert.match(html, /data-filter="不满足"/);
  assert.match(html, /data-filter="待人工复核"/);
  assert.doesNotMatch(html, /<pre>\s*\{/);
  assert.doesNotMatch(html, /<div class="eyebrow">建议动作<\/div>/);
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

test("buildHtmlReportViewModel merges rule review items into the human review section", () => {
  const viewModel = buildHtmlReportViewModel(
    makeResultJson({
      human_review_items: [],
      rule_audit_results: [
        {
          rule_id: "ARKTS-SHOULD-002",
          rule_source: "should_rule",
          result: "待人工复核",
          conclusion: "证据不足，需要人工复核。",
        },
      ],
    }),
  );

  assert.equal(viewModel.humanReview.items.length, 1);
  assert.equal(viewModel.humanReview.items[0]?.item, "规则复核：ARKTS-SHOULD-002");
  assert.equal(viewModel.humanReview.items[0]?.currentAssessment, "证据不足，需要人工复核。");
});

test("renderHtmlReport renders case rule section with priority and hard gate state", () => {
  const html = renderHtmlReport(
    buildHtmlReportViewModel(
      makeResultJson({
        case_rule_results: [
          {
            rule_id: "HM-REQ-008-01",
            rule_name: "必须使用 LoginWithHuaweiIDButton",
            priority: "P0",
            rule_source: "must_rule",
            result: "不满足",
            conclusion: "未使用 LoginWithHuaweiIDButton",
            hard_gate_triggered: true,
          },
        ],
      }),
    ),
  );

  assert.match(html, /用例规则结果/);
  assert.match(html, /HM-REQ-008-01/);
  assert.match(html, /P0/);
  assert.match(html, /已触发硬门槛/);
});

test("renderHtmlReport renders bound rule packs inside overall card", () => {
  const html = renderHtmlReport(buildHtmlReportViewModel(makeResultJson()));
  const summarySection = html.slice(html.indexOf('<section id="summary"'), html.indexOf('<section id="dimensions"'));

  assert.doesNotMatch(html, /href="#bound-rule-packs"/);
  assert.doesNotMatch(html, /<section id="bound-rule-packs"/);
  assert.match(summarySection, /绑定规则集/);
  assert.match(summarySection, /arkts-language/);
  assert.match(summarySection, /从 TypeScript 到 ArkTS 的适配规则与 ArkTS 编程规范/);
  assert.match(summarySection, /case-requirement_004/);
  assert.match(summarySection, /用例 requirement_004 约束规则/);
});

test("buildHtmlReportViewModel provides empty state for bound rule packs", () => {
  const viewModel = buildHtmlReportViewModel(
    makeResultJson({
      bound_rule_packs: [],
    }),
  );

  assert.equal(viewModel.boundRulePacks.emptyState, "当前没有可展示的绑定规则集。");
});
