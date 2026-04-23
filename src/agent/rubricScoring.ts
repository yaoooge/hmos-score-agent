import { z } from "zod";
import type {
  CaseInput,
  ConstraintSummary,
  LoadedRubricSnapshot,
  RubricScoringPayload,
  RubricScoringResult,
  TaskType,
} from "../types.js";

type BuildRubricScoringPayloadInput = {
  caseInput: CaseInput;
  caseRoot: string;
  effectivePatchPath?: string;
  taskType: TaskType;
  constraintSummary: ConstraintSummary;
  rubricSnapshot: LoadedRubricSnapshot;
};

type RenderRubricScoringRetryPromptInput = {
  originalPrompt: string;
  invalidOutput: string;
  errorMessage: string;
};

const confidenceSchema = z.enum(["high", "medium", "low"]);
const deductionTraceSchema = z
  .object({
    code_locations: z.array(z.string().min(1)).min(1),
    impact_scope: z.string().min(1),
    rubric_comparison: z.string().min(1),
    deduction_reason: z.string().min(1),
    improvement_suggestion: z.string().min(1),
  })
  .strict();

const rubricScoringResultSchema = z
  .object({
    summary: z
      .object({
        overall_assessment: z.string().min(1),
        overall_confidence: confidenceSchema,
      })
      .strict(),
    item_scores: z
      .array(
        z
          .object({
            dimension_name: z.string().min(1),
            item_name: z.string().min(1),
            score: z.number(),
            max_score: z.number(),
            matched_band_score: z.number(),
            rationale: z.string().min(1),
            evidence_used: z.array(z.string()),
            confidence: confidenceSchema,
            review_required: z.boolean(),
            deduction_trace: deductionTraceSchema.optional(),
          })
          .strict(),
      )
      .min(1),
    hard_gate_candidates: z.array(
      z
        .object({
          gate_id: z.enum(["G1", "G2", "G3", "G4"]),
          triggered: z.boolean(),
          reason: z.string(),
          confidence: confidenceSchema,
        })
        .strict(),
    ),
    risks: z.array(
      z
        .object({
          level: z.string(),
          title: z.string(),
          description: z.string(),
          evidence: z.string(),
        })
        .strict(),
    ),
    strengths: z.array(z.string()),
    main_issues: z.array(z.string()),
  })
  .strict();

function makeItemKey(dimensionName: string, itemName: string): string {
  return `${dimensionName}::${itemName}`;
}

function buildExpectedItemMap(
  rubricSnapshot: LoadedRubricSnapshot,
): Map<string, { weight: number; scores: Set<number> }> {
  return new Map(
    rubricSnapshot.dimension_summaries.flatMap((dimension) =>
      dimension.item_summaries.map(
        (item) =>
          [
            makeItemKey(dimension.name, item.name),
            {
              weight: item.weight,
              scores: new Set(item.scoring_bands.map((band) => band.score)),
            },
          ] as const,
      ),
    ),
  );
}

export function buildRubricScoringPayload(
  input: BuildRubricScoringPayloadInput,
): RubricScoringPayload {
  return {
    case_context: {
      case_id: input.caseInput.caseId,
      case_root: input.caseRoot,
      task_type: input.taskType,
      original_prompt_summary: input.caseInput.promptText,
      original_project_path: input.caseInput.originalProjectPath,
      generated_project_path: input.caseInput.generatedProjectPath,
      effective_patch_path: input.effectivePatchPath,
    },
    task_understanding: input.constraintSummary,
    rubric_summary: input.rubricSnapshot,
    response_contract: {
      output_language: "zh-CN",
      json_only: true,
      required_top_level_fields: [
        "summary",
        "item_scores",
        "hard_gate_candidates",
        "risks",
        "strengths",
        "main_issues",
      ],
    },
  };
}

export function renderRubricScoringPrompt(payload: RubricScoringPayload): string {
  return [
    "你是评分工作流中的 rubric 主评分 agent。",
    "请基于 task_understanding、case_context 和 rubric_summary，逐项输出 rubric item 的评分。",
    "默认先按每个 item 满分评估，只有发现明确负面证据时才允许降档。",
    "证据不足时必须保持满分，不得保守扣分。",
    "扣分时必须返回 deduction_trace。",
    "当 score < max_score 时，必须返回 deduction_trace，写明 code_locations、impact_scope、rubric_comparison、deduction_reason、improvement_suggestion。",
    "不要判断规则 ID，不要输出 rule_id 级结论；规则判断由独立 rules 分支处理。",
    "必须只输出一个 JSON object，禁止 markdown、代码块或额外解释。",
    ...renderRubricScoringBrevityRules({ compact: false }),
    "下面的 YAML 结构示例仅用于说明字段结构，不要输出 YAML；实际最终输出仍必须是 JSON object。",
    "",
    renderRubricScoringYamlShapeExample(),
    "",
    "顶层字段必须包含 summary、item_scores、hard_gate_candidates、risks、strengths、main_issues。",
    "item_scores 必须覆盖 rubric_summary.dimension_summaries 中的每个 item，且不得遗漏、重复或新增未知 item。",
    "每个 item 的 score 与 matched_band_score 必须使用该 item scoring_bands 中声明过的 score。",
    "所有说明性文案必须使用中文。",
    "",
    JSON.stringify(payload, null, 2),
  ].join("\n");
}

export function renderCompactRubricScoringPrompt(payload: RubricScoringPayload): string {
  return [
    "这是 rubric 评分的 compact 重试 prompt。",
    "上一轮 rubric 评分请求疑似因长耗时或连接被关闭而失败；请在保持字段完整的前提下，用最短可判定文本重新输出。",
    "你仍然只能输出一个 JSON object，禁止 markdown、代码块、YAML 或额外解释。",
    ...renderRubricScoringBrevityRules({ compact: true }),
    "",
    "YAML 结构示例仅用于说明字段结构，不要输出 YAML：",
    renderRubricScoringYamlShapeExample(),
    "",
    JSON.stringify(payload),
  ].join("\n");
}

export function renderRubricScoringRetryPrompt(input: RenderRubricScoringRetryPromptInput): string {
  return [
    "这是一次 rubric 评分协议修复重试。",
    "上一轮输出不符合 schema，请基于原始 rubric 评分上下文重新输出。",
    "本轮只能重新输出一个 JSON object，禁止 markdown、代码块、YAML 或任何额外解释。",
    "不要沿用上一轮的错误字段名；必须使用 canonical 字段，例如 summary.overall_assessment、dimension_name、item_name、max_score、matched_band_score、gate_id、risks[].description。",
    "item_scores 必须覆盖原始 prompt 中 rubric_summary.dimension_summaries 的每个 item，且不得遗漏、重复或新增未知 item。",
    "score 与 matched_band_score 必须相等，并且只能使用该 item scoring_bands 中声明过的 score；max_score 必须等于该 item weight。",
    "扣分项必须保留原有 band 结论，除非原 band 本身不合法；当 score < max_score 时，必须补齐 deduction_trace。",
    "所有说明性文案必须使用中文。",
    ...renderRubricScoringBrevityRules({ compact: true }),
    "",
    "YAML 结构示例仅用于说明字段结构，不要输出 YAML：",
    renderRubricScoringYamlShapeExample(),
    "",
    "上一轮解析失败原因：",
    input.errorMessage,
    "",
    "上一轮原始输出：",
    input.invalidOutput,
    "",
    "原始 rubric 评分 prompt：",
    input.originalPrompt,
  ].join("\n");
}

function renderRubricScoringBrevityRules(input: { compact: boolean }): string[] {
  return input.compact
    ? [
        "输出尽量短，但字段必须完整。",
        "summary.overall_assessment 限制为一句中文短句，避免展开分析。",
        "item_scores[*].rationale 限制为一句中文短句。",
        "item_scores[*].evidence_used 最多保留 2 条最关键证据路径。",
        "risks 最多 3 条；每条 description 和 evidence 都使用短句。",
        "strengths 和 main_issues 各最多 3 条。",
      ]
    : [
        "请保持输出克制，避免长段解释。",
        "summary.overall_assessment 尽量控制在一句中文短句内。",
        "item_scores[*].rationale 优先使用一句中文短句。",
        "item_scores[*].evidence_used 只保留最关键证据，最多 2 条。",
        "risks、strengths、main_issues 都应控制在高信号、短文本。",
      ];
}

function renderRubricScoringYamlShapeExample(): string {
  return [
    "YAML 结构示例:",
    "summary:",
    "  overall_assessment: 中文总体评价",
    "  overall_confidence: high | medium | low",
    "item_scores:",
    "  - dimension_name: rubric 维度名称",
    "    item_name: rubric item 名称",
    "    score: 10",
    "    max_score: 10",
    "    matched_band_score: 10",
    "    rationale: 中文评分理由",
    "    evidence_used:",
    "      - workspace/entry/src/main/ets/pages/Index.ets",
    "    confidence: high | medium | low",
    "    review_required: false",
    "    deduction_trace:",
    "      code_locations:",
    "        - workspace/entry/src/main/ets/pages/Index.ets:12",
    "      impact_scope: 影响页面初始化逻辑",
    "      rubric_comparison: 未命中高分档，因为存在空指针风险；命中当前档，因为主体路径可运行但稳定性不足",
    "      deduction_reason: 发现明确稳定性问题，因此降到当前档",
    "      improvement_suggestion: 在访问前增加空值校验并补充异常路径处理",
    "hard_gate_candidates:",
    "  - gate_id: G1",
    "    triggered: false",
    "    reason: 中文说明",
    "    confidence: medium",
    "risks:",
    "  - level: medium",
    "    title: 风险标题",
    "    description: 风险描述",
    "    evidence: 证据位置或说明",
    "strengths:",
    "  - 中文优势",
    "main_issues:",
    "  - 中文主要问题",
  ].join("\n");
}

export function parseRubricScoringResultStrict(
  rawText: string,
  rubricSnapshot: LoadedRubricSnapshot,
): RubricScoringResult {
  const trimmed = rawText.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    throw new Error("protocol_error: output must be one JSON object");
  }

  const parsed = rubricScoringResultSchema.parse(JSON.parse(trimmed)) as RubricScoringResult;
  const expectedItemMap = buildExpectedItemMap(rubricSnapshot);
  const seenItemKeys = new Set<string>();
  const unexpectedItemKeys: string[] = [];
  const invalidBandItems: string[] = [];
  const invalidWeightItems: string[] = [];

  for (const item of parsed.item_scores) {
    const key = makeItemKey(item.dimension_name, item.item_name);
    const expected = expectedItemMap.get(key);
    if (!expected) {
      unexpectedItemKeys.push(key);
      continue;
    }
    if (seenItemKeys.has(key)) {
      unexpectedItemKeys.push(`${key} (duplicate)`);
      continue;
    }
    seenItemKeys.add(key);

    if (item.max_score !== expected.weight) {
      invalidWeightItems.push(key);
    }
    if (!expected.scores.has(item.score) || item.matched_band_score !== item.score) {
      invalidBandItems.push(key);
    }
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
        throw new Error(
          `deduction_trace.rubric_comparison must compare higher and current bands: ${key}`,
        );
      }
      if (!item.deduction_trace.improvement_suggestion.trim()) {
        throw new Error(
          `deduction_trace.improvement_suggestion required for deducted rubric items: ${key}`,
        );
      }
    }
  }

  const missingItemKeys = Array.from(expectedItemMap.keys()).filter(
    (key) => !seenItemKeys.has(key),
  );
  if (missingItemKeys.length > 0) {
    throw new Error(`missing rubric scoring items: ${missingItemKeys.join(", ")}`);
  }
  if (unexpectedItemKeys.length > 0) {
    throw new Error(`unexpected rubric scoring items: ${unexpectedItemKeys.join(", ")}`);
  }
  if (invalidWeightItems.length > 0) {
    throw new Error(`max_score must match rubric item weight: ${invalidWeightItems.join(", ")}`);
  }
  if (invalidBandItems.length > 0) {
    throw new Error(`score must match declared rubric band: ${invalidBandItems.join(", ")}`);
  }

  return parsed;
}
