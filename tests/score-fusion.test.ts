import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { buildRubricSnapshot } from "../src/agent/ruleAssistance.js";
import { fuseRubricScoreWithRules } from "../src/scoring/scoreFusion.js";
import { loadRubricForTaskType } from "../src/scoring/rubricLoader.js";
import type { RubricScoringResult, RuleAuditResult } from "../src/types.js";

const referenceRoot = path.resolve(process.cwd(), "references/scoring");

test("fuseRubricScoreWithRules uses rubric agent scores as the base", async () => {
  const rubric = await loadRubricForTaskType("full_generation", referenceRoot);
  const snapshot = buildRubricSnapshot(rubric);
  const itemScores = snapshot.dimension_summaries.flatMap((dimension) =>
    dimension.item_summaries.map((item) => {
      const lowestBand = item.scoring_bands.at(-1);
      assert.ok(lowestBand);
      return {
        dimension_name: dimension.name,
        item_name: item.name,
        score: lowestBand.score,
        max_score: item.weight,
        matched_band_score: lowestBand.score,
        rationale: "agent 给出低分。",
        evidence_used: ["workspace/entry/src/main/ets/pages/Index.ets"],
        confidence: "medium" as const,
        review_required: false,
      };
    }),
  );
  const rubricResult: RubricScoringResult = {
    summary: {
      overall_assessment: "agent 基础分偏低。",
      overall_confidence: "medium",
    },
    item_scores: itemScores,
    hard_gate_candidates: [],
    risks: [],
    strengths: [],
    main_issues: [],
  };

  const result = fuseRubricScoreWithRules({
    taskType: "full_generation",
    rubric,
    rubricSnapshot: snapshot,
    rubricScoringResult: rubricResult,
    rubricAgentRunStatus: "success",
    ruleAuditResults: [],
    ruleViolations: [],
    evidenceSummary: {
      workspaceFileCount: 1,
      originalFileCount: 1,
      changedFileCount: 1,
      changedFiles: ["entry/src/main/ets/pages/Index.ets"],
      hasPatch: true,
    },
  });

  assert.equal(
    result.totalScore,
    itemScores.reduce((sum, item) => sum + item.score, 0),
  );
  assert.equal(result.scoreFusionDetails.length, itemScores.length);
});

test("fuseRubricScoreWithRules records rule impacts on affected rubric items", async () => {
  const rubric = await loadRubricForTaskType("full_generation", referenceRoot);
  const snapshot = buildRubricSnapshot(rubric);
  const itemScores = snapshot.dimension_summaries.flatMap((dimension) =>
    dimension.item_summaries.map((item) => ({
      dimension_name: dimension.name,
      item_name: item.name,
      score: item.scoring_bands[0].score,
      max_score: item.weight,
      matched_band_score: item.scoring_bands[0].score,
      rationale: "agent 给出高分。",
      evidence_used: ["workspace/entry/src/main/ets/pages/Index.ets"],
      confidence: "high" as const,
      review_required: false,
    })),
  );
  const ruleAuditResults: RuleAuditResult[] = [
    {
      rule_id: "ARKTS-FORBID-005",
      rule_source: "must_rule",
      result: "不满足",
      conclusion: "使用 any。",
    },
  ];

  const result = fuseRubricScoreWithRules({
    taskType: "full_generation",
    rubric,
    rubricSnapshot: snapshot,
    rubricScoringResult: {
      summary: { overall_assessment: "基础评分较高。", overall_confidence: "high" },
      item_scores: itemScores,
      hard_gate_candidates: [],
      risks: [],
      strengths: [],
      main_issues: [],
    },
    rubricAgentRunStatus: "success",
    ruleAuditResults,
    ruleViolations: [],
    evidenceSummary: {
      workspaceFileCount: 1,
      originalFileCount: 1,
      changedFileCount: 1,
      changedFiles: ["entry/src/main/ets/pages/Index.ets"],
      hasPatch: true,
    },
  });

  const arktsDetail = result.scoreFusionDetails.find(
    (detail) => detail.item_name === "ArkTS/ArkUI语法与类型安全",
  );

  assert.ok(arktsDetail);
  assert.equal(arktsDetail.rule_impacts[0].rule_id, "ARKTS-FORBID-005");
  assert.ok(arktsDetail.score_fusion.rule_delta < 0);
  assert.ok(
    Number.isInteger(arktsDetail.score_fusion.final_score),
    "rule-adjusted score should be snapped to a declared discrete rubric band",
  );
  assert.equal(
    snapshot.dimension_summaries
      .find((dimension) => dimension.name === arktsDetail.dimension_name)
      ?.item_summaries.find((item) => item.name === arktsDetail.item_name)
      ?.scoring_bands.some((band) => band.score === arktsDetail.score_fusion.final_score),
    true,
  );
});

test("fuseRubricScoreWithRules maps official unsafe crypto linter rules to security boundary penalties", async () => {
  const rubric = await loadRubricForTaskType("bug_fix", referenceRoot);
  const snapshot = buildRubricSnapshot(rubric);
  const result = fuseRubricScoreWithRules({
    taskType: "bug_fix",
    rubric,
    rubricSnapshot: snapshot,
    rubricScoringResult: undefined,
    rubricAgentRunStatus: "invalid_output",
    ruleAuditResults: [
      {
        rule_id: "OFFICIAL-LINTER:@security/no-unsafe-aes",
        rule_source: "forbidden_pattern",
        result: "不满足",
        conclusion: "entry/src/main/ets/pages/Index.ets:1:1 @security/no-unsafe-aes unsafe crypto",
      },
    ],
    ruleViolations: [],
    evidenceSummary: {
      workspaceFileCount: 1,
      originalFileCount: 1,
      changedFileCount: 1,
      changedFiles: ["entry/src/main/ets/pages/Index.ets"],
      hasPatch: true,
    },
  });

  const securityDetail = result.scoreFusionDetails.find(
    (detail) => detail.item_name === "安全/边界意识",
  );
  assert.ok(securityDetail);
  assert.equal(securityDetail.rule_impacts[0]?.rule_id, "OFFICIAL-LINTER:@security/no-unsafe-aes");
  assert.equal(securityDetail.rule_impacts[0]?.severity, "heavy");
  assert.ok((securityDetail.rule_impacts[0]?.score_delta ?? 0) < 0);
});

test("fuseRubricScoreWithRules maps official commented-code rule to static quality only", async () => {
  const rubric = await loadRubricForTaskType("bug_fix", referenceRoot);
  const snapshot = buildRubricSnapshot(rubric);
  const result = fuseRubricScoreWithRules({
    taskType: "bug_fix",
    rubric,
    rubricSnapshot: snapshot,
    rubricScoringResult: undefined,
    rubricAgentRunStatus: "invalid_output",
    ruleAuditResults: [
      {
        rule_id: "OFFICIAL-LINTER:@security/no-commented-code",
        rule_source: "forbidden_pattern",
        result: "不满足",
        conclusion: "entry/src/main/ets/pages/Index.ets:1:1 @security/no-commented-code remove code",
      },
    ],
    ruleViolations: [],
    evidenceSummary: {
      workspaceFileCount: 1,
      originalFileCount: 1,
      changedFileCount: 1,
      changedFiles: ["entry/src/main/ets/pages/Index.ets"],
      hasPatch: true,
    },
  });

  const impactedDetails = result.scoreFusionDetails.filter((detail) =>
    detail.rule_impacts.some(
      (impact) => impact.rule_id === "OFFICIAL-LINTER:@security/no-commented-code",
    ),
  );

  assert.deepEqual(
    impactedDetails.map((detail) => detail.item_name),
    ["静态坏味道控制"],
  );
  assert.equal(impactedDetails[0]?.rule_impacts[0]?.severity, "light");
  assert.ok((impactedDetails[0]?.rule_impacts[0]?.score_delta ?? 0) < 0);
});

test("fuseRubricScoreWithRules maps official performance linter rules to performance risk penalties", async () => {
  const rubric = await loadRubricForTaskType("full_generation", referenceRoot);
  const snapshot = buildRubricSnapshot(rubric);
  const result = fuseRubricScoreWithRules({
    taskType: "full_generation",
    rubric,
    rubricSnapshot: snapshot,
    rubricScoringResult: undefined,
    rubricAgentRunStatus: "invalid_output",
    ruleAuditResults: [
      {
        rule_id: "OFFICIAL-LINTER:@performance/foreach-args-check",
        rule_source: "should_rule",
        result: "不满足",
        conclusion:
          "entry/src/main/ets/pages/Index.ets:1:1 @performance/foreach-args-check avoid expensive foreach",
      },
    ],
    ruleViolations: [],
    evidenceSummary: {
      workspaceFileCount: 1,
      originalFileCount: 1,
      changedFileCount: 1,
      changedFiles: ["entry/src/main/ets/pages/Index.ets"],
      hasPatch: true,
    },
  });

  const performanceDetail = result.scoreFusionDetails.find(
    (detail) => detail.item_name === "性能风险",
  );
  assert.ok(performanceDetail);
  assert.equal(
    performanceDetail.rule_impacts[0]?.rule_id,
    "OFFICIAL-LINTER:@performance/foreach-args-check",
  );
  assert.equal(performanceDetail.rule_impacts[0]?.severity, "medium");
  assert.ok((performanceDetail.rule_impacts[0]?.score_delta ?? 0) < 0);
});

test("fuseRubricScoreWithRules maps official max-len linter rule to one static quality penalty", async () => {
  const rubric = await loadRubricForTaskType("full_generation", referenceRoot);
  const snapshot = buildRubricSnapshot(rubric);
  const result = fuseRubricScoreWithRules({
    taskType: "full_generation",
    rubric,
    rubricSnapshot: snapshot,
    rubricScoringResult: undefined,
    rubricAgentRunStatus: "invalid_output",
    ruleAuditResults: [
      {
        rule_id: "OFFICIAL-LINTER:@hw-stylistic/max-len",
        rule_source: "should_rule",
        result: "不满足",
        conclusion: "entry/src/main/ets/pages/Index.ets:1:1 @hw-stylistic/max-len line too long",
      },
    ],
    ruleViolations: [],
    evidenceSummary: {
      workspaceFileCount: 1,
      originalFileCount: 1,
      changedFileCount: 1,
      changedFiles: ["entry/src/main/ets/pages/Index.ets"],
      hasPatch: true,
    },
  });

  const impactedDetails = result.scoreFusionDetails.filter((detail) =>
    detail.rule_impacts.some(
      (impact) => impact.rule_id === "OFFICIAL-LINTER:@hw-stylistic/max-len",
    ),
  );

  assert.deepEqual(
    impactedDetails.map((detail) => detail.item_name),
    ["静态坏味道控制"],
  );
  assert.equal(impactedDetails[0]?.rule_impacts[0]?.severity, "light");
  assert.ok((impactedDetails[0]?.rule_impacts[0]?.score_delta ?? 0) < 0);
});

test("fuseRubricScoreWithRules does not apply prefix fallback for unmapped official linter rules", async () => {
  const rubric = await loadRubricForTaskType("full_generation", referenceRoot);
  const snapshot = buildRubricSnapshot(rubric);
  const result = fuseRubricScoreWithRules({
    taskType: "full_generation",
    rubric,
    rubricSnapshot: snapshot,
    rubricScoringResult: undefined,
    rubricAgentRunStatus: "invalid_output",
    ruleAuditResults: [
      {
        rule_id: "OFFICIAL-LINTER:@hw-stylistic/future-rule",
        rule_source: "should_rule",
        result: "不满足",
        conclusion: "entry/src/main/ets/pages/Index.ets:1:1 @hw-stylistic/future-rule issue",
      },
    ],
    ruleViolations: [],
    evidenceSummary: {
      workspaceFileCount: 1,
      originalFileCount: 1,
      changedFileCount: 1,
      changedFiles: ["entry/src/main/ets/pages/Index.ets"],
      hasPatch: true,
    },
  });

  const impacts = result.scoreFusionDetails.flatMap((detail) =>
    detail.rule_impacts.filter(
      (impact) => impact.rule_id === "OFFICIAL-LINTER:@hw-stylistic/future-rule",
    ),
  );

  assert.deepEqual(impacts, []);
});

test("fuseRubricScoreWithRules falls back to top rubric band when rubric output is invalid", async () => {
  const rubric = await loadRubricForTaskType("bug_fix", referenceRoot);
  const snapshot = buildRubricSnapshot(rubric);

  const result = fuseRubricScoreWithRules({
    taskType: "bug_fix",
    rubric,
    rubricSnapshot: snapshot,
    rubricScoringResult: undefined,
    rubricAgentRunStatus: "invalid_output",
    ruleAuditResults: [],
    ruleViolations: [],
    evidenceSummary: {
      workspaceFileCount: 1,
      originalFileCount: 1,
      changedFileCount: 1,
      changedFiles: ["entry/src/main/ets/Index.ets"],
      hasPatch: true,
    },
  });

  for (const detail of result.scoreFusionDetails) {
    const dimension = snapshot.dimension_summaries.find(
      (item) => item.name === detail.dimension_name,
    );
    const metric = dimension?.item_summaries.find((item) => item.name === detail.item_name);
    assert.equal(detail.agent_evaluation.base_score, metric?.scoring_bands[0].score);
  }
  assert.match(result.humanReviewItems[0]?.current_assessment ?? "", /当前按满分保留/);
});

test("fuseRubricScoreWithRules preserves deduction_trace from rubric scoring result", async () => {
  const rubric = await loadRubricForTaskType("bug_fix", referenceRoot);
  const snapshot = buildRubricSnapshot(rubric);
  const firstDimension = snapshot.dimension_summaries[0];
  const firstItem = firstDimension.item_summaries[0];
  const deductedBand = firstItem.scoring_bands[1];
  assert.ok(deductedBand);

  const itemScores = snapshot.dimension_summaries.flatMap((dimension) =>
    dimension.item_summaries.map((item) => ({
      dimension_name: dimension.name,
      item_name: item.name,
      score:
        dimension.name === firstDimension.name && item.name === firstItem.name
          ? deductedBand.score
          : item.scoring_bands[0].score,
      max_score: item.weight,
      matched_band_score:
        dimension.name === firstDimension.name && item.name === firstItem.name
          ? deductedBand.score
          : item.scoring_bands[0].score,
      rationale: "存在明确负面证据。",
      evidence_used: ["workspace/entry/src/main/ets/pages/Index.ets:12"],
      confidence: "medium" as const,
      review_required: false,
      deduction_trace:
        dimension.name === firstDimension.name && item.name === firstItem.name
          ? {
              code_locations: ["workspace/entry/src/main/ets/pages/Index.ets:12"],
              impact_scope: "影响页面初始化稳定性",
              rubric_comparison: "未命中高分档；命中当前档。",
              deduction_reason: "发现空值未防御。",
              improvement_suggestion: "在访问前增加空值校验并补充异常路径处理。",
            }
          : undefined,
    })),
  );

  const result = fuseRubricScoreWithRules({
    taskType: "bug_fix",
    rubric,
    rubricSnapshot: snapshot,
    rubricScoringResult: {
      summary: { overall_assessment: "存在单项扣分。", overall_confidence: "medium" },
      item_scores: itemScores,
      hard_gate_candidates: [],
      risks: [],
      strengths: [],
      main_issues: [],
    },
    rubricAgentRunStatus: "success",
    ruleAuditResults: [],
    ruleViolations: [],
    evidenceSummary: {
      workspaceFileCount: 1,
      originalFileCount: 1,
      changedFileCount: 1,
      changedFiles: ["entry/src/main/ets/Index.ets"],
      hasPatch: true,
    },
  });

  const detail = result.scoreFusionDetails.find(
    (item) => item.dimension_name === firstDimension.name && item.item_name === firstItem.name,
  );
  assert.equal(detail?.agent_evaluation.deduction_trace?.impact_scope, "影响页面初始化稳定性");
});

test("fuseRubricScoreWithRules snaps rule-adjusted scores back to declared rubric bands", async () => {
  const rubric = await loadRubricForTaskType("full_generation", referenceRoot);
  const snapshot = buildRubricSnapshot(rubric);
  const itemScores = snapshot.dimension_summaries.flatMap((dimension) =>
    dimension.item_summaries.map((item) => ({
      dimension_name: dimension.name,
      item_name: item.name,
      score: item.scoring_bands[0].score,
      max_score: item.weight,
      matched_band_score: item.scoring_bands[0].score,
      rationale: "未找到明确负面证据，按满分保留。",
      evidence_used: ["workspace/entry/src/main/ets/pages/Index.ets"],
      confidence: "high" as const,
      review_required: false,
    })),
  );
  const ruleAuditResults: RuleAuditResult[] = [
    {
      rule_id: "ARKTS-FORBID-012",
      rule_source: "must_rule",
      result: "不满足",
      conclusion: "命中 must_rule。",
    },
    {
      rule_id: "ARKTS-FORBID-001",
      rule_source: "forbidden_pattern",
      result: "不满足",
      conclusion: "命中 forbidden_pattern any。",
    },
    {
      rule_id: "ARKTS-FORBID-003",
      rule_source: "forbidden_pattern",
      result: "不满足",
      conclusion: "命中 forbidden_pattern index access。",
    },
  ];

  const result = fuseRubricScoreWithRules({
    taskType: "full_generation",
    rubric,
    rubricSnapshot: snapshot,
    rubricScoringResult: {
      summary: { overall_assessment: "基础分满分。", overall_confidence: "high" },
      item_scores: itemScores,
      hard_gate_candidates: [],
      risks: [],
      strengths: [],
      main_issues: [],
    },
    rubricAgentRunStatus: "success",
    ruleAuditResults,
    ruleViolations: [],
    evidenceSummary: {
      workspaceFileCount: 1,
      originalFileCount: 1,
      changedFileCount: 1,
      changedFiles: ["entry/src/main/ets/pages/Index.ets"],
      hasPatch: true,
    },
  });

  const securityDetail = result.scoreFusionDetails.find(
    (detail) =>
      detail.dimension_name === "风险控制与稳定性" && detail.item_name === "安全与边界意识",
  );
  assert.ok(securityDetail);
  assert.equal(securityDetail.score_fusion.rule_delta, -1.95);
  assert.equal(securityDetail.score_fusion.final_score, 1);

  const securityRubricItem = rubric.dimensions
    .find((dimension) => dimension.name === "风险控制与稳定性")
    ?.items.find((item) => item.name === "安全与边界意识");
  assert.ok(securityRubricItem);
  assert.equal(
    securityRubricItem?.scoringBands.some(
      (band) => band.score === securityDetail.score_fusion.final_score,
    ),
    true,
  );

  const riskDimension = result.dimensionScores.find(
    (dimension) => dimension.dimension_name === "风险控制与稳定性",
  );
  assert.equal(riskDimension?.score, 5);
  assert.ok(Number.isInteger(riskDimension?.score));

  const forbiddenRisk = result.risks.find((risk) => risk.title === "规则违规：ARKTS-FORBID-001") as
    | (typeof result.risks[number] & { score_effect?: Record<string, unknown> })
    | undefined;
  assert.ok(forbiddenRisk?.score_effect);
  assert.equal(forbiddenRisk.score_effect.type, "risk_level_rule_impact");
  assert.equal(forbiddenRisk.score_effect.rule_id, "ARKTS-FORBID-001");
  assert.deepEqual(forbiddenRisk.score_effect.level_weights, {
    high: 1,
    medium: 0.6,
    low: 0.3,
    none: 0,
  });
  assert.deepEqual(forbiddenRisk.score_effect.hard_gate_ids, ["G3"]);
  assert.ok(Array.isArray(forbiddenRisk.score_effect.impacts));

  assert.equal(result.hardGateTriggered, true);
  assert.equal(
    result.humanReviewItems.some((item) => item.item === "硬门槛复核"),
    false,
  );
});

test("fuseRubricScoreWithRules writes uncertain hard gate rules into suggested focus", async () => {
  const rubric = await loadRubricForTaskType("bug_fix", referenceRoot);
  const snapshot = buildRubricSnapshot(rubric);
  const itemScores = snapshot.dimension_summaries.flatMap((dimension) =>
    dimension.item_summaries.map((item) => ({
      dimension_name: dimension.name,
      item_name: item.name,
      score: item.scoring_bands[0].score,
      max_score: item.weight,
      matched_band_score: item.scoring_bands[0].score,
      rationale: "未找到明确负面证据，按满分保留。",
      evidence_used: ["workspace/entry/src/main/ets/pages/Index.ets"],
      confidence: "high" as const,
      review_required: false,
    })),
  );

  const result = fuseRubricScoreWithRules({
    taskType: "bug_fix",
    rubric,
    rubricSnapshot: snapshot,
    rubricScoringResult: {
      summary: { overall_assessment: "基础分满分。", overall_confidence: "high" },
      item_scores: itemScores,
      hard_gate_candidates: [],
      risks: [],
      strengths: [],
      main_issues: [],
    },
    rubricAgentRunStatus: "success",
    ruleAuditResults: [
      {
        rule_id: "ARKTS-FORBID-026",
        rule_source: "forbidden_pattern",
        result: "待人工复核",
        conclusion: "无法确认 finally 中 return 是否真实存在。",
      },
    ],
    ruleViolations: [],
    evidenceSummary: {
      workspaceFileCount: 1,
      originalFileCount: 1,
      changedFileCount: 1,
      changedFiles: ["entry/src/main/ets/pages/Index.ets"],
      hasPatch: true,
    },
  });

  assert.equal(result.hardGateTriggered, false);
  const hardGateReview = result.humanReviewItems.find((item) => item.item === "硬门槛复核") as
    | (typeof result.humanReviewItems[number] & { score_effect?: Record<string, unknown> })
    | undefined;
  assert.ok(hardGateReview);
  assert.equal(hardGateReview.current_assessment, "none");
  assert.match(hardGateReview.uncertainty_reason, /ARKTS-FORBID-026/);
  assert.match(hardGateReview.suggested_focus, /G3/);
  assert.match(hardGateReview.suggested_focus, /严重工程风险/);
  assert.match(hardGateReview.suggested_focus, /空值或异步竞争风险高/);
  assert.match(hardGateReview.suggested_focus, /ARKTS-FORBID-026/);
  assert.match(hardGateReview.suggested_focus, /无法确认 finally 中 return 是否真实存在/);
  assert.deepEqual(hardGateReview.score_effect, {
    type: "hard_gate",
    gate_ids: ["G3"],
    gate_caps: { G3: 79 },
  });
});

test("fuseRubricScoreWithRules caps total score at 59 when hvigor build check fails", async () => {
  const rubric = await loadRubricForTaskType("full_generation", referenceRoot);
  const snapshot = buildRubricSnapshot(rubric);
  const itemScores = snapshot.dimension_summaries.flatMap((dimension) =>
    dimension.item_summaries.map((item) => ({
      dimension_name: dimension.name,
      item_name: item.name,
      score: item.scoring_bands[0].score,
      max_score: item.weight,
      matched_band_score: item.scoring_bands[0].score,
      rationale: "基础评分较高。",
      evidence_used: ["workspace/features/feature1/src/main/ets/Index.ets"],
      confidence: "high" as const,
      review_required: false,
    })),
  );

  const result = fuseRubricScoreWithRules({
    taskType: "full_generation",
    rubric,
    rubricSnapshot: snapshot,
    rubricScoringResult: {
      summary: { overall_assessment: "基础分满分。", overall_confidence: "high" },
      item_scores: itemScores,
      hard_gate_candidates: [],
      risks: [],
      strengths: [],
      main_issues: [],
    },
    rubricAgentRunStatus: "success",
    ruleAuditResults: [],
    ruleViolations: [],
    evidenceSummary: {
      workspaceFileCount: 1,
      originalFileCount: 1,
      changedFileCount: 1,
      changedFiles: ["features/feature1/src/main/ets/Index.ets"],
      hasPatch: true,
    },
    hvigorBuildCheckSummary: {
      enabled: true,
      status: "failed",
      hvigorRunDir: "/tools/hvigor",
      checkedModules: ["entry"],
      hardGateTriggered: true,
      scoreCap: 59,
      diagnostics: "整包 assembleApp 编译失败：组件包可编译，但整包编译未通过，判断为原代码问题，非新增修改引入。",
      durationMs: 1000,
      moduleResults: [
        {
          modulePath: "entry",
          moduleName: "entry",
          command: "assembleHap",
          status: "success",
          exitCode: 0,
          durationMs: 500,
        },
        {
          modulePath: ".",
          moduleName: "app",
          command: "assembleApp",
          status: "failed",
          exitCode: 7,
          durationMs: 500,
          stderrExcerpt: "baseline app compile failed",
          diagnostics:
            "整包 assembleApp 编译失败：组件包可编译，但整包编译未通过，判断为原代码问题，非新增修改引入。",
        },
      ],
      cleanup: {
        attempted: true,
        removedPaths: ["features/feature1/build"],
        failedPaths: [],
      },
    },
  });

  assert.equal(result.totalScore, 59);
  assert.equal(result.hardGateTriggered, true);
  assert.match(result.hardGateReason ?? "", /BUILD-CHECK/);
  assert.match(result.overallConclusion.summary, /原代码问题，非新增修改引入/);
  assert.ok(result.risks.some((risk) => /编译/.test(`${risk.title}${risk.description}`)));
  assert.ok(result.risks.some((risk) => /原代码问题，非新增修改引入/.test(risk.evidence)));
});
