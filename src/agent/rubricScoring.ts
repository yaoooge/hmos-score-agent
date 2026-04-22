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

const confidenceSchema = z.enum(["high", "medium", "low"]);

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
      dimension.item_summaries.map((item) => [
        makeItemKey(dimension.name, item.name),
        {
          weight: item.weight,
          scores: new Set(item.scoring_bands.map((band) => band.score)),
        },
      ] as const),
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
    "不要判断规则 ID，不要输出 rule_id 级结论；规则判断由独立 rules 分支处理。",
    "必须只输出一个 JSON object，禁止 markdown、代码块或额外解释。",
    "顶层字段必须包含 summary、item_scores、hard_gate_candidates、risks、strengths、main_issues。",
    "item_scores 必须覆盖 rubric_summary.dimension_summaries 中的每个 item，且不得遗漏、重复或新增未知 item。",
    "每个 item 的 score 与 matched_band_score 必须使用该 item scoring_bands 中声明过的 score。",
    "所有说明性文案必须使用中文。",
    "",
    JSON.stringify(payload, null, 2),
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
  }

  const missingItemKeys = Array.from(expectedItemMap.keys()).filter((key) => !seenItemKeys.has(key));
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
