import { z } from "zod";
import { caseToolNameSchema } from "./caseToolSchemas.js";
import type {
  AssistedRuleCandidate,
  CaseAwareAgentFinalAnswer,
  CaseAwareAgentPlannerOutput,
  CaseAwareFinalAnswerValidation,
} from "../types.js";

export class CaseAwareProtocolError extends Error {
  constructor(
    public readonly code:
      | "not_single_json_object"
      | "multiple_json_objects"
      | "invalid_json"
      | "schema_validation",
    message: string,
  ) {
    super(`protocol_error: ${message}`);
    this.name = "CaseAwareProtocolError";
  }
}

export const caseAwareFinalAnswerSchema = z
  .object({
    action: z.literal("final_answer"),
    summary: z
      .object({
        assistant_scope: z.string().min(1),
        overall_confidence: z.enum(["high", "medium", "low"]),
      })
      .strict(),
    rule_assessments: z
      .array(
        z
          .object({
            rule_id: z.string().min(1),
            decision: z.enum(["violation", "pass", "not_applicable", "uncertain"]),
            confidence: z.enum(["high", "medium", "low"]),
            reason: z.string().min(1),
            evidence_used: z.array(z.string()),
            needs_human_review: z.boolean(),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

export const caseAwareToolCallSchema = z
  .object({
    action: z.literal("tool_call"),
    tool: caseToolNameSchema,
    args: z.record(z.string(), z.unknown()),
    reason: z.string(),
  })
  .strict();

export const caseAwarePlannerOutputSchema = z.union([
  caseAwareToolCallSchema,
  caseAwareFinalAnswerSchema,
]);

function findTopLevelJsonObjectEnd(rawText: string): number {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < rawText.length; index += 1) {
    const char = rawText[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) {
      continue;
    }

    if (char === "{") {
      depth += 1;
      continue;
    }

    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
}

export function parseCaseAwarePlannerOutputStrict(rawText: string): CaseAwareAgentPlannerOutput {
  const trimmed = rawText.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    throw new CaseAwareProtocolError(
      "not_single_json_object",
      "output must be one top-level JSON object without prose",
    );
  }

  const objectEndIndex = findTopLevelJsonObjectEnd(trimmed);
  if (objectEndIndex >= 0 && objectEndIndex < trimmed.length - 1) {
    throw new CaseAwareProtocolError(
      "multiple_json_objects",
      "received multiple top-level JSON objects in one response",
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new CaseAwareProtocolError("invalid_json", `invalid JSON: ${message}`);
  }

  const result = caseAwarePlannerOutputSchema.safeParse(parsed);
  if (!result.success) {
    throw new CaseAwareProtocolError("schema_validation", z.prettifyError(result.error));
  }

  return result.data;
}

export function validateCaseAwareFinalAnswerAgainstCandidates(
  finalAnswer: CaseAwareAgentFinalAnswer,
  candidates: AssistedRuleCandidate[],
): CaseAwareFinalAnswerValidation {
  const expectedRuleIds = candidates.map((candidate) => candidate.rule_id);
  const expected = new Set(expectedRuleIds);
  const seen = new Set<string>();
  const duplicate = new Set<string>();
  const unexpected = new Set<string>();

  for (const assessment of finalAnswer.rule_assessments) {
    if (seen.has(assessment.rule_id)) {
      duplicate.add(assessment.rule_id);
    }
    seen.add(assessment.rule_id);
    if (!expected.has(assessment.rule_id)) {
      unexpected.add(assessment.rule_id);
    }
  }

  const missingRuleIds = expectedRuleIds.filter((ruleId) => !seen.has(ruleId));
  const duplicateRuleIds = Array.from(duplicate);
  const unexpectedRuleIds = Array.from(unexpected);

  return {
    ok:
      missingRuleIds.length === 0 &&
      duplicateRuleIds.length === 0 &&
      unexpectedRuleIds.length === 0,
    missing_rule_ids: missingRuleIds,
    duplicate_rule_ids: duplicateRuleIds,
    unexpected_rule_ids: unexpectedRuleIds,
  };
}

export function describeFinalAnswerValidationFailure(
  validation: CaseAwareFinalAnswerValidation,
): string {
  const parts = [
    validation.missing_rule_ids.length > 0
      ? `missing=${validation.missing_rule_ids.join(",")}`
      : "",
    validation.duplicate_rule_ids.length > 0
      ? `duplicate=${validation.duplicate_rule_ids.join(",")}`
      : "",
    validation.unexpected_rule_ids.length > 0
      ? `unexpected=${validation.unexpected_rule_ids.join(",")}`
      : "",
  ].filter(Boolean);

  return parts.join("; ") || "unknown final_answer validation failure";
}
