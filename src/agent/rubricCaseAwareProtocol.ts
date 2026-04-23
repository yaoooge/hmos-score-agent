import { z } from "zod";
import { caseToolNameSchema } from "./caseToolSchemas.js";
import { StrictJsonProtocolError, parseSingleJsonObjectStrict } from "./jsonProtocol.js";
import type {
  LoadedRubricSnapshot,
  RubricScoringResult,
  RubricScoringItemScore,
} from "../types.js";

export class RubricCaseAwareProtocolError extends StrictJsonProtocolError {}

const confidenceSchema = z.enum(["high", "medium", "low"]);

const deductionTraceSchema = z
  .object({
    code_locations: z.array(z.string().min(1)).min(1),
    impact_scope: z.string().min(1),
    rubric_comparison: z.string().min(1),
    deduction_reason: z.string().min(1),
    improvement_suggestion: z.string(),
  })
  .strict();

export const rubricCaseAwareToolCallSchema = z
  .object({
    action: z.literal("tool_call"),
    tool: caseToolNameSchema,
    args: z.record(z.string(), z.unknown()),
    reason: z.string().optional(),
  })
  .strict();

export const rubricCaseAwareFinalAnswerSchema = z
  .object({
    action: z.literal("final_answer"),
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

export const rubricCaseAwarePlannerOutputSchema = z.discriminatedUnion("action", [
  rubricCaseAwareToolCallSchema,
  rubricCaseAwareFinalAnswerSchema,
]);

export type RubricCaseAwareToolCall = z.infer<typeof rubricCaseAwareToolCallSchema>;
export type RubricCaseAwareFinalAnswer = z.infer<typeof rubricCaseAwareFinalAnswerSchema>;
export type RubricCaseAwarePlannerOutput = z.infer<typeof rubricCaseAwarePlannerOutputSchema>;

export type RubricFinalAnswerValidation = {
  ok: boolean;
  missing_item_keys: string[];
  duplicate_item_keys: string[];
  unexpected_item_keys: string[];
  invalid_band_item_keys: string[];
  invalid_weight_item_keys: string[];
  invalid_deduction_trace_item_keys: string[];
};

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

function hasValidDeductionTrace(item: RubricScoringItemScore): boolean {
  if (item.score >= item.max_score) {
    return true;
  }

  const trace = item.deduction_trace;
  if (!trace) {
    return false;
  }
  return (
    trace.code_locations.length > 0 &&
    trace.rubric_comparison.includes("未命中") &&
    trace.rubric_comparison.includes("命中当前档") &&
    trace.improvement_suggestion.trim().length > 0
  );
}

export function parseRubricCaseAwarePlannerOutputStrict(
  rawText: string,
): RubricCaseAwarePlannerOutput {
  try {
    return parseSingleJsonObjectStrict(rawText, rubricCaseAwarePlannerOutputSchema);
  } catch (error) {
    if (error instanceof StrictJsonProtocolError) {
      throw new RubricCaseAwareProtocolError(
        error.code,
        error.message.replace(/^protocol_error:\s*/, ""),
      );
    }
    throw error;
  }
}

export function validateRubricFinalAnswerAgainstSnapshot(
  finalAnswer: Pick<RubricScoringResult, "item_scores">,
  rubricSnapshot: LoadedRubricSnapshot,
): RubricFinalAnswerValidation {
  const expectedItemMap = buildExpectedItemMap(rubricSnapshot);
  const expectedItemKeys = Array.from(expectedItemMap.keys());
  const seen = new Set<string>();
  const duplicate = new Set<string>();
  const unexpected = new Set<string>();
  const invalidBand = new Set<string>();
  const invalidWeight = new Set<string>();
  const invalidDeductionTrace = new Set<string>();

  for (const item of finalAnswer.item_scores) {
    const key = makeItemKey(item.dimension_name, item.item_name);
    const expected = expectedItemMap.get(key);
    if (seen.has(key)) {
      duplicate.add(key);
    }
    seen.add(key);

    if (!expected) {
      unexpected.add(key);
      continue;
    }
    if (item.max_score !== expected.weight) {
      invalidWeight.add(key);
    }
    if (!expected.scores.has(item.score) || item.matched_band_score !== item.score) {
      invalidBand.add(key);
    }
    if (!hasValidDeductionTrace(item)) {
      invalidDeductionTrace.add(key);
    }
  }

  const missingItemKeys = expectedItemKeys.filter((key) => !seen.has(key));
  const duplicateItemKeys = Array.from(duplicate);
  const unexpectedItemKeys = Array.from(unexpected);
  const invalidBandItemKeys = Array.from(invalidBand);
  const invalidWeightItemKeys = Array.from(invalidWeight);
  const invalidDeductionTraceItemKeys = Array.from(invalidDeductionTrace);

  return {
    ok:
      missingItemKeys.length === 0 &&
      duplicateItemKeys.length === 0 &&
      unexpectedItemKeys.length === 0 &&
      invalidBandItemKeys.length === 0 &&
      invalidWeightItemKeys.length === 0 &&
      invalidDeductionTraceItemKeys.length === 0,
    missing_item_keys: missingItemKeys,
    duplicate_item_keys: duplicateItemKeys,
    unexpected_item_keys: unexpectedItemKeys,
    invalid_band_item_keys: invalidBandItemKeys,
    invalid_weight_item_keys: invalidWeightItemKeys,
    invalid_deduction_trace_item_keys: invalidDeductionTraceItemKeys,
  };
}

export function describeRubricFinalAnswerValidationFailure(
  validation: RubricFinalAnswerValidation,
): string {
  return [
    validation.missing_item_keys.length > 0
      ? `missing=${validation.missing_item_keys.join(",")}`
      : "",
    validation.duplicate_item_keys.length > 0
      ? `duplicate=${validation.duplicate_item_keys.join(",")}`
      : "",
    validation.unexpected_item_keys.length > 0
      ? `unexpected=${validation.unexpected_item_keys.join(",")}`
      : "",
    validation.invalid_band_item_keys.length > 0
      ? `invalid_band=${validation.invalid_band_item_keys.join(",")}`
      : "",
    validation.invalid_weight_item_keys.length > 0
      ? `invalid_weight=${validation.invalid_weight_item_keys.join(",")}`
      : "",
    validation.invalid_deduction_trace_item_keys.length > 0
      ? `invalid_deduction_trace=${validation.invalid_deduction_trace_item_keys.join(",")}`
      : "",
  ]
    .filter(Boolean)
    .join("; ");
}
