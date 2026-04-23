# Rubric 评分稳定性优化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make rubric scoring stable by defaulting every item to full score, only allowing evidence-backed deductions, and requiring deduction items to carry code location, impact scope, rubric band comparison, and explicit reasoning end-to-end through parsing, fusion, and reporting.

**Architecture:** Tighten the rubric agent protocol in `src/agent/rubricScoring.ts`, carry the new deduction trace through `ScoreFusionDetail`, and surface it in `result.json` / HTML only for deducted items. Keep the existing `rubric base score + rule delta` pipeline, but change fallback semantics from "rule precheck base score" to "full score pending human review".

**Tech Stack:** TypeScript, Zod, Node test runner (`node --import tsx --test`), AJV schema validation, existing HTML report renderer.

---

### Task 1: 收紧 Rubric 协议与严格解析

**Files:**
- Modify: `/Users/guoyutong/MyWorkSpace/hmos-score-agent/tests/rubric-scoring.test.ts`
- Modify: `/Users/guoyutong/MyWorkSpace/hmos-score-agent/src/types.ts`
- Modify: `/Users/guoyutong/MyWorkSpace/hmos-score-agent/src/agent/rubricScoring.ts`

- [ ] **Step 1: 先写失败测试，锁定“默认满分”和“扣分必须带 deduction_trace”**

```ts
test("parseRubricScoringResultStrict rejects deducted items without deduction_trace", async () => {
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
      rationale: "存在负面证据。",
      evidence_used: ["workspace/entry/src/main/ets/pages/Index.ets"],
      confidence: "medium" as const,
      review_required: false,
    })),
  );

  assert.throws(
    () =>
      parseRubricScoringResultStrict(
        JSON.stringify({
          summary: {
            overall_assessment: "存在扣分项。",
            overall_confidence: "medium",
          },
          item_scores: itemScores,
          hard_gate_candidates: [],
          risks: [],
          strengths: [],
          main_issues: [],
        }),
        snapshot,
      ),
    /deduction_trace required for deducted rubric items/,
  );
});

test("renderRubricScoringPrompt requires full-score default and evidence-backed deductions", async () => {
  const rubric = await loadRubricForTaskType("bug_fix", referenceRoot);
  const snapshot = buildRubricSnapshot(rubric);
  const payload = buildRubricScoringPayload({
    caseInput: {
      caseId: "case-1",
      promptText: "修复页面 bug",
      originalProjectPath: "/case/original",
      generatedProjectPath: "/case/workspace",
      patchPath: "/case/diff/changes.patch",
    },
    caseRoot: "/case",
    effectivePatchPath: "/case/diff/changes.patch",
    taskType: "bug_fix",
    constraintSummary,
    rubricSnapshot: snapshot,
  });

  const prompt = renderRubricScoringPrompt(payload);

  assert.match(prompt, /默认先按每个 item 满分评估/);
  assert.match(prompt, /证据不足时必须保持满分/);
  assert.match(prompt, /扣分时必须返回 deduction_trace/);
});
```

- [ ] **Step 2: 运行定向测试，确认它们因新约束尚未实现而失败**

Run: `node --import tsx --test tests/rubric-scoring.test.ts`

Expected: FAIL，至少包含以下一种失败特征：

```text
AssertionError: Missing expected exception
```

或：

```text
The input did not match the regular expression /默认先按每个 item 满分评估/
```

- [ ] **Step 3: 最小实现新类型、Prompt 约束和解析校验**

在 `/Users/guoyutong/MyWorkSpace/hmos-score-agent/src/types.ts` 增加 deduction trace 类型，并把它挂到 rubric item 和 score fusion agent evaluation 上：

```ts
export interface RubricDeductionTrace {
  code_locations: string[];
  impact_scope: string;
  rubric_comparison: string;
  deduction_reason: string;
}

export interface RubricScoringItemScore {
  dimension_name: string;
  item_name: string;
  score: number;
  max_score: number;
  matched_band_score: number;
  rationale: string;
  evidence_used: string[];
  confidence: ConfidenceLevel;
  review_required: boolean;
  deduction_trace?: RubricDeductionTrace;
}

export interface ScoreFusionDetail {
  dimension_name: string;
  item_name: string;
  agent_evaluation: {
    base_score: number;
    matched_band_score: number;
    matched_criteria: string;
    logic: string;
    evidence_used: string[];
    confidence: ConfidenceLevel;
    deduction_trace: RubricDeductionTrace | null;
  };
  // ...
}
```

在 `/Users/guoyutong/MyWorkSpace/hmos-score-agent/src/agent/rubricScoring.ts` 收紧 schema、prompt 和严格解析：

```ts
const deductionTraceSchema = z
  .object({
    code_locations: z.array(z.string().min(1)).min(1),
    impact_scope: z.string().min(1),
    rubric_comparison: z.string().min(1),
    deduction_reason: z.string().min(1),
  })
  .strict();

// item schema
deduction_trace: deductionTraceSchema.optional(),
```

```ts
"默认先按每个 item 满分评估，只有发现明确负面证据时才允许降档。",
"如果找不到足够负面证据，必须保持满分，不得保守扣分。",
"当 score < max_score 时，必须返回 deduction_trace，写明 code_locations、impact_scope、rubric_comparison、deduction_reason。",
```

```ts
if (item.score < item.max_score) {
  if (!item.deduction_trace) {
    throw new Error(`deduction_trace required for deducted rubric items: ${key}`);
  }
  if (item.deduction_trace.code_locations.length === 0) {
    throw new Error(`deduction_trace.code_locations must be non-empty: ${key}`);
  }
  if (
    !item.deduction_trace.rubric_comparison.includes("未命中") ||
    !item.deduction_trace.rubric_comparison.includes("命中当前档")
  ) {
    throw new Error(`deduction_trace.rubric_comparison must compare higher and current bands: ${key}`);
  }
}
```

同时把 YAML 示例补成：

```ts
"    deduction_trace:",
"      code_locations:",
"        - workspace/entry/src/main/ets/pages/Index.ets:12",
"      impact_scope: 影响页面初始化逻辑",
"      rubric_comparison: 未命中高分档，因为存在空指针风险；命中当前档，因为主体路径可运行但稳定性不足",
"      deduction_reason: 发现明确稳定性问题，因此降到当前档",
```

- [ ] **Step 4: 重新运行协议测试，确认新约束已生效**

Run: `node --import tsx --test tests/rubric-scoring.test.ts`

Expected:

```text
# tests ... 
# pass ...
# fail 0
```

- [ ] **Step 5: 提交这一轮协议收紧改动**

```bash
git add /Users/guoyutong/MyWorkSpace/hmos-score-agent/tests/rubric-scoring.test.ts /Users/guoyutong/MyWorkSpace/hmos-score-agent/src/types.ts /Users/guoyutong/MyWorkSpace/hmos-score-agent/src/agent/rubricScoring.ts
git commit -m "feat: stabilize rubric scoring protocol"
```

### Task 2: 调整 Score Fusion 的兜底语义并透传 deduction trace

**Files:**
- Modify: `/Users/guoyutong/MyWorkSpace/hmos-score-agent/tests/score-fusion.test.ts`
- Modify: `/Users/guoyutong/MyWorkSpace/hmos-score-agent/src/scoring/scoreFusion.ts`

- [ ] **Step 1: 先写失败测试，锁定 fallback 必须回到满分且扣分依据要被透传**

```ts
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
    const dimension = snapshot.dimension_summaries.find((item) => item.name === detail.dimension_name);
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
```

- [ ] **Step 2: 运行融合测试，确认现有 fallback 和透传行为还不满足要求**

Run: `node --import tsx --test tests/score-fusion.test.ts`

Expected: FAIL，至少包含以下一种失败特征：

```text
Expected values to be strictly equal:
+ actual - expected
```

或：

```text
The input did not match the regular expression /当前按满分保留/
```

- [ ] **Step 3: 最小修改融合逻辑，改为“满分待复核”并保留 deduction trace**

在 `/Users/guoyutong/MyWorkSpace/hmos-score-agent/src/scoring/scoreFusion.ts` 调整 fallback 和 agent evaluation 构造：

```ts
function buildFallbackRubricItems(rubric: LoadedRubric): RubricScoringItemScore[] {
  return rubric.dimensions.flatMap((dimension) =>
    dimension.items.map((item) => {
      const bestBand = item.scoringBands[0];
      return {
        dimension_name: dimension.name,
        item_name: item.name,
        score: bestBand?.score ?? item.weight,
        max_score: item.weight,
        matched_band_score: bestBand?.score ?? item.weight,
        rationale: "rubric agent 未产出可信扣分依据，暂按满分保留，待人工复核。",
        evidence_used: [],
        confidence: "low",
        review_required: true,
        deduction_trace: undefined,
      };
    }),
  );
}
```

```ts
agent_evaluation: {
  base_score: item.score,
  matched_band_score: item.matched_band_score,
  matched_criteria: criteriaByMetric.get(key) ?? "",
  logic: item.rationale,
  evidence_used: item.evidence_used,
  confidence: item.confidence,
  deduction_trace: item.deduction_trace ?? null,
},
```

```ts
current_assessment: "rubric agent 未产出可信扣分依据，当前按满分保留。",
```

- [ ] **Step 4: 重新运行融合测试，确认 fallback 与透传行为正确**

Run: `node --import tsx --test tests/score-fusion.test.ts`

Expected:

```text
# tests ...
# pass ...
# fail 0
```

- [ ] **Step 5: 提交融合层改动**

```bash
git add /Users/guoyutong/MyWorkSpace/hmos-score-agent/tests/score-fusion.test.ts /Users/guoyutong/MyWorkSpace/hmos-score-agent/src/scoring/scoreFusion.ts
git commit -m "feat: preserve rubric deduction trace in score fusion"
```

### Task 3: 扩展结果 Schema、报告生成与 HTML 展示

**Files:**
- Modify: `/Users/guoyutong/MyWorkSpace/hmos-score-agent/tests/schema-validator.test.ts`
- Modify: `/Users/guoyutong/MyWorkSpace/hmos-score-agent/tests/report-renderer.test.ts`
- Modify: `/Users/guoyutong/MyWorkSpace/hmos-score-agent/tests/fixtures/report_result_schema.json`
- Modify: `/Users/guoyutong/MyWorkSpace/hmos-score-agent/references/scoring/report_result_schema.json`
- Modify: `/Users/guoyutong/MyWorkSpace/hmos-score-agent/src/nodes/reportGenerationNode.ts`
- Modify: `/Users/guoyutong/MyWorkSpace/hmos-score-agent/src/report/renderer/buildHtmlReportViewModel.ts`
- Modify: `/Users/guoyutong/MyWorkSpace/hmos-score-agent/src/report/renderer/renderHtmlReport.ts`

- [ ] **Step 1: 先写失败测试，锁定 result.json 和 HTML 必须按扣分项展示 deduction trace**

在 `/Users/guoyutong/MyWorkSpace/hmos-score-agent/tests/schema-validator.test.ts` 更新合法样本：

```ts
agent_evaluation: {
  base_score: 10,
  matched_band_score: 10,
  matched_criteria: "直接命中根因，修复路径闭环。",
  logic: "patch 命中目标函数，但闭环证据不足。",
  evidence_used: ["workspace/entry/src/main/ets/pages/Index.ets"],
  confidence: "medium",
  deduction_trace: null,
},
```

并补充扣分样本断言：

```ts
test("validateReportResult accepts deduction_trace for deducted items", () => {
  const schemaPath = path.resolve(process.cwd(), "references/scoring/report_result_schema.json");
  const valid = makeValidResultJson();
  const firstItem = (valid.dimension_results as Array<Record<string, unknown>>)[0]
    .item_results[0] as Record<string, unknown>;
  firstItem.agent_evaluation = {
    base_score: 8,
    matched_band_score: 8,
    matched_criteria: "8分：基本满足。",
    logic: "存在明确负面证据。",
    evidence_used: ["workspace/entry/src/main/ets/pages/Index.ets:12"],
    confidence: "medium",
    deduction_trace: {
      code_locations: ["workspace/entry/src/main/ets/pages/Index.ets:12"],
      impact_scope: "影响页面初始化稳定性",
      rubric_comparison: "未命中高分档；命中当前档。",
      deduction_reason: "存在空值未防御。",
    },
  };

  assert.doesNotThrow(() => validateReportResult(valid, schemaPath));
});
```

在 `/Users/guoyutong/MyWorkSpace/hmos-score-agent/tests/report-renderer.test.ts` 增加 HTML 断言：

```ts
assert.match(html, /代码位置/);
assert.match(html, /影响范围/);
assert.match(html, /Rubric 对照/);
assert.match(html, /评分理由/);
assert.match(html, /workspace\/entry\/src\/main\/ets\/pages\/Index\.ets:12/);
```

- [ ] **Step 2: 运行结果与渲染测试，确认 schema 和页面模板尚未支持 deduction trace**

Run: `node --import tsx --test tests/schema-validator.test.ts tests/report-renderer.test.ts`

Expected: FAIL，至少包含以下一种失败特征：

```text
Schema validation failed
```

或：

```text
The input did not match the regular expression /代码位置/
```

- [ ] **Step 3: 最小修改 report schema、result 生成与 renderer**

在 `/Users/guoyutong/MyWorkSpace/hmos-score-agent/references/scoring/report_result_schema.json` 和 `/Users/guoyutong/MyWorkSpace/hmos-score-agent/tests/fixtures/report_result_schema.json` 的 `agent_evaluation.properties` 下新增：

```json
"deduction_trace": {
  "anyOf": [
    {
      "type": "object",
      "properties": {
        "code_locations": {
          "type": "array",
          "items": { "type": "string" }
        },
        "impact_scope": { "type": "string" },
        "rubric_comparison": { "type": "string" },
        "deduction_reason": { "type": "string" }
      },
      "required": [
        "code_locations",
        "impact_scope",
        "rubric_comparison",
        "deduction_reason"
      ],
      "additionalProperties": false
    },
    { "type": "null" }
  ]
}
```

并把 `deduction_trace` 加入 `agent_evaluation.required`。

在 `/Users/guoyutong/MyWorkSpace/hmos-score-agent/src/nodes/reportGenerationNode.ts` 透传新字段：

```ts
agent_evaluation:
  fusionDetail?.agent_evaluation ?? {
    base_score: 0,
    matched_band_score: 0,
    matched_criteria: "",
    logic: "缺少 rubric agent 对该评分项的评价逻辑。",
    evidence_used: [],
    confidence: "low",
    deduction_trace: null,
  },
```

在 `/Users/guoyutong/MyWorkSpace/hmos-score-agent/src/report/renderer/buildHtmlReportViewModel.ts` 给 item view model 增加 deduction trace 展示字段：

```ts
items: Array<{
  name: string;
  weight: number;
  score: number;
  matchedBandText: string;
  confidence: string;
  reviewRequired: boolean;
  rationale: string;
  evidence: string;
  deductionTrace: null | {
    codeLocations: string;
    impactScope: string;
    rubricComparison: string;
    deductionReason: string;
  };
}>;
```

```ts
const deductionTrace = asRecord(agentEvaluation.deduction_trace);
// ...
deductionTrace:
  Object.keys(deductionTrace).length === 0
    ? null
    : {
        codeLocations: formatEvidence(deductionTrace.code_locations),
        impactScope: String(deductionTrace.impact_scope ?? ""),
        rubricComparison: String(deductionTrace.rubric_comparison ?? ""),
        deductionReason: String(deductionTrace.deduction_reason ?? ""),
      },
```

在 `/Users/guoyutong/MyWorkSpace/hmos-score-agent/src/report/renderer/renderHtmlReport.ts` 只为扣分项渲染这一块：

```ts
${item.deductionTrace
  ? `
    <div class="detail-card">
      <strong>扣分依据</strong>
      <p><strong>代码位置：</strong>${escapeHtml(item.deductionTrace.codeLocations)}</p>
      <p><strong>影响范围：</strong>${escapeHtml(item.deductionTrace.impactScope)}</p>
      <p><strong>Rubric 对照：</strong>${escapeHtml(item.deductionTrace.rubricComparison)}</p>
      <p><strong>评分理由：</strong>${escapeHtml(item.deductionTrace.deductionReason)}</p>
    </div>`
  : ""}
```

- [ ] **Step 4: 重新运行 schema 和渲染测试**

Run: `node --import tsx --test tests/schema-validator.test.ts tests/report-renderer.test.ts`

Expected:

```text
# tests ...
# pass ...
# fail 0
```

- [ ] **Step 5: 提交结果输出与报告展示改动**

```bash
git add /Users/guoyutong/MyWorkSpace/hmos-score-agent/tests/schema-validator.test.ts /Users/guoyutong/MyWorkSpace/hmos-score-agent/tests/report-renderer.test.ts /Users/guoyutong/MyWorkSpace/hmos-score-agent/tests/fixtures/report_result_schema.json /Users/guoyutong/MyWorkSpace/hmos-score-agent/references/scoring/report_result_schema.json /Users/guoyutong/MyWorkSpace/hmos-score-agent/src/nodes/reportGenerationNode.ts /Users/guoyutong/MyWorkSpace/hmos-score-agent/src/report/renderer/buildHtmlReportViewModel.ts /Users/guoyutong/MyWorkSpace/hmos-score-agent/src/report/renderer/renderHtmlReport.ts
git commit -m "feat: expose rubric deduction trace in reports"
```

### Task 4: 补齐工作流集成回归并做最终验证

**Files:**
- Modify: `/Users/guoyutong/MyWorkSpace/hmos-score-agent/tests/score-agent.test.ts`

- [ ] **Step 1: 先写失败的工作流回归测试，确认节点级产物包含 deduction trace 和新 fallback 文案**

在 `/Users/guoyutong/MyWorkSpace/hmos-score-agent/tests/score-agent.test.ts` 增加一个报告节点回归用例：

```ts
test("reportGenerationNode writes deduction_trace for deducted rubric items only", async (t) => {
  const referenceRoot = await createReferenceRoot(t);
  const rubric = await loadRubricForTaskType("bug_fix", referenceRoot);
  const rubricSnapshot = buildRubricSnapshot(rubric);
  const firstDimension = rubricSnapshot.dimension_summaries[0];
  const firstItem = firstDimension.item_summaries[0];
  const deductedBand = firstItem.scoring_bands[1];
  assert.ok(deductedBand);

  const state = makeState();
  const result = await reportGenerationNode(
    {
      ...state,
      taskType: "bug_fix",
      rubricSnapshot,
      scoreComputation: {
        ...state.scoreComputation!,
        scoreFusionDetails: rubricSnapshot.dimension_summaries.flatMap((dimension) =>
          dimension.item_summaries.map((item) => ({
            dimension_name: dimension.name,
            item_name: item.name,
            agent_evaluation: {
              base_score:
                dimension.name === firstDimension.name && item.name === firstItem.name
                  ? deductedBand.score
                  : item.scoring_bands[0].score,
              matched_band_score:
                dimension.name === firstDimension.name && item.name === firstItem.name
                  ? deductedBand.score
                  : item.scoring_bands[0].score,
              matched_criteria: "评分档位说明",
              logic: "评分理由",
              evidence_used: ["workspace/entry/src/main/ets/pages/Index.ets:12"],
              confidence: "medium",
              deduction_trace:
                dimension.name === firstDimension.name && item.name === firstItem.name
                  ? {
                      code_locations: ["workspace/entry/src/main/ets/pages/Index.ets:12"],
                      impact_scope: "影响页面初始化稳定性",
                      rubric_comparison: "未命中高分档；命中当前档。",
                      deduction_reason: "存在空值未防御。",
                    }
                  : null,
            },
            rule_impacts: [],
            score_fusion: {
              base_score: item.scoring_bands[0].score,
              rule_delta: 0,
              final_score:
                dimension.name === firstDimension.name && item.name === firstItem.name
                  ? deductedBand.score
                  : item.scoring_bands[0].score,
              fusion_logic: "无规则修正",
            },
          })),
        ),
      },
    } as never,
    { referenceRoot },
  );

  const firstDimensionResult = (result.resultJson?.dimension_results as Array<Record<string, unknown>>)[0];
  const firstItemResult = (firstDimensionResult.item_results as Array<Record<string, unknown>>)[0];
  assert.equal(
    (firstItemResult.agent_evaluation as Record<string, unknown>).deduction_trace !== null,
    true,
  );
});
```

再补一个 fallback 文案回归断言：

```ts
assert.match(
  scoringResult.scoreComputation?.humanReviewItems[0]?.current_assessment ?? "",
  /当前按满分保留/,
);
```

- [ ] **Step 2: 运行工作流回归测试，确认旧 fixture / 旧断言仍会失败**

Run: `node --import tsx --test tests/score-agent.test.ts`

Expected: FAIL，至少包含以下一种失败特征：

```text
Expected values to be strictly equal:
```

或：

```text
The input did not match the regular expression /当前按满分保留/
```

- [ ] **Step 3: 补齐测试夹具与最小集成修正，使工作流结果满足新约束**

按测试报错更新 `/Users/guoyutong/MyWorkSpace/hmos-score-agent/tests/score-agent.test.ts` 里所有手写 `scoreFusionDetails` / `agent_evaluation` fixture，使其统一包含：

```ts
deduction_trace: null,
```

并把涉及 rubric fallback 的旧文案：

```ts
"rubric agent 未产出有效评分，当前使用规则预检结果。"
```

替换为：

```ts
"rubric agent 未产出可信扣分依据，当前按满分保留。"
```

- [ ] **Step 4: 运行最终验证，确认目标范围和全量测试都通过**

Run: `node --import tsx --test tests/rubric-scoring.test.ts tests/score-fusion.test.ts tests/schema-validator.test.ts tests/report-renderer.test.ts tests/score-agent.test.ts`

Expected:

```text
# tests ...
# pass ...
# fail 0
```

Run: `npm test`

Expected:

```text
> hmos-score-agent@0.1.0 test
> node --import tsx --test tests/*.test.ts
```

并以最终 `fail 0` 结束。

- [ ] **Step 5: 提交最终回归与验证通过的改动**

```bash
git add /Users/guoyutong/MyWorkSpace/hmos-score-agent/tests/score-agent.test.ts
git commit -m "test: cover rubric scoring stability workflow"
```
