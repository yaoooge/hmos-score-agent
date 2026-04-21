import { z } from "zod";
import type {
  AgentBootstrapPayload,
  CaseAwareAgentFinalAnswer,
  CaseAwareAgentPlannerOutput,
} from "../types.js";
import { renderAgentBootstrapPrompt } from "./ruleAssistance.js";
import { caseToolNameSchema } from "./caseToolSchemas.js";

const finalAnswerSchema = z
  .object({
    action: z.literal("final_answer"),
    summary: z
      .object({
        assistant_scope: z.string(),
        overall_confidence: z.enum(["high", "medium", "low"]),
      })
      .strict(),
    rule_assessments: z.array(
      z
        .object({
          rule_id: z.string(),
          decision: z.enum(["violation", "pass", "not_applicable", "uncertain"]),
          confidence: z.enum(["high", "medium", "low"]),
          reason: z.string(),
          evidence_used: z.array(z.string()),
          needs_human_review: z.boolean(),
        })
        .strict(),
    ),
  })
  .strict();

const toolCallSchema = z
  .object({
    action: z.literal("tool_call"),
    tool: caseToolNameSchema,
    args: z.record(z.string(), z.unknown()),
    reason: z.string().default(""),
  })
  .strict();

const plannerOutputSchema = z.union([toolCallSchema, finalAnswerSchema]);

type NestedModelFinalAnswer = {
  summary?: string;
  summary_judgement?: string;
  confidence?: string;
  requirement_judgement?: {
    fulfilled?: boolean;
    confidence?: string;
  };
  overall_judgment?: {
    result?: string;
    summary?: string;
    confidence?: string;
  };
  case_rule_verdicts?: Array<{
    rule_id?: string;
    passed?: boolean;
    confidence?: string;
    evidence?: string[] | string;
  }>;
  case_rule_results?: Array<{
    rule_id?: string;
    result?: string;
    confidence?: string;
    evidence?: string[] | string;
  }>;
  rule_results?: Array<{
    rule_id?: string;
    result?: string;
    confidence?: string;
    evidence?: string[] | string;
  }>;
  rule_checks?: Array<{
    rule_id?: string;
    result?: string;
    confidence?: string;
    evidence?: string[] | string;
  }>;
  rule_assessment?: Array<{
    rule_id?: string;
    passed?: boolean;
    assessment?: string;
    rule_assessment?: string;
    judgement?: string;
    confidence?: string | number;
    evidence?: Array<{ file?: string; detail?: string } | string> | string;
    reasoning?: string;
  }>;
  rule_assessments?: Array<{
    rule_id?: string;
    passed?: boolean;
    assessment?: string;
    rule_assessment?: string;
    judgement?: string;
    confidence?: string | number;
    evidence?: Array<{ file?: string; detail?: string } | string> | string;
    reasoning?: string;
  }>;
  human_review_flags?: string[];
};

function extractJsonObjectFrom(rawText: string, start: number): string {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < rawText.length; index += 1) {
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
        return rawText.slice(start, index + 1);
      }
    }
  }

  throw new SyntaxError("Unterminated JSON object");
}

function extractJsonObjectCandidates(rawText: string): string[] {
  const candidates: string[] = [];

  for (let start = rawText.indexOf("{"); start >= 0; start = rawText.indexOf("{", start + 1)) {
    try {
      candidates.push(extractJsonObjectFrom(rawText, start));
    } catch {
      // Ignore incomplete or malformed candidates and continue scanning.
    }
  }

  if (candidates.length === 0) {
    throw new SyntaxError("No JSON object found");
  }

  return candidates;
}

export function renderCaseAwareBootstrapPrompt(payload: AgentBootstrapPayload): string {
  return renderAgentBootstrapPrompt(payload);
}

export function renderCaseAwareFollowupPrompt(input: {
  bootstrapPayload: AgentBootstrapPayload;
  turn: number;
  latestObservation: string;
}): string {
  return [
    "你正在继续同一个 case-aware 辅助判定任务。",
    "下面是最近一次工具调用返回的结果，请结合已有上下文继续决定下一步。",
    "如果证据已经足够，请直接输出 final_answer。",
    "如果你准备输出 final_answer，必须补齐每一条候选规则的 rule_assessment，不能只给总体判断。",
    "如果还需要补查，请继续输出 tool_call，但必须控制在剩余预算内。",
    `当前回合: ${input.turn}`,
    "最近一次工具观察结果：",
    input.latestObservation,
    "",
    "原始 bootstrap 载荷如下：",
    JSON.stringify(input.bootstrapPayload, null, 2),
  ].join("\n");
}

export function renderCaseAwareRepairPrompt(input: {
  bootstrapPayload: AgentBootstrapPayload;
  turn: number;
  missingRuleIds: string[];
  receivedRuleIds: string[];
  latestObservation: string;
}): string {
  return [
    "你上一轮输出的 final_answer 不完整，当前不能结束任务。",
    "请直接重发完整的 final_answer，不要再次输出 summary-only，不要省略 rule_assessments。",
    "除非你明确缺少关键证据，否则不要再次调用 tool_call。",
    "如果某条规则证据不足，也必须保留该 rule_id，并将 decision 设为 uncertain、needs_human_review 设为 true。",
    `当前回合: ${input.turn}`,
    `缺失的 rule_id: ${input.missingRuleIds.join(", ")}`,
    input.receivedRuleIds.length > 0
      ? `已收到的 rule_id: ${input.receivedRuleIds.join(", ")}`
      : "已收到的 rule_id: 无",
    "最近一次校验反馈：",
    input.latestObservation,
    "",
    "请确保 rule_assessments 覆盖以下全部候选规则：",
    input.bootstrapPayload.assisted_rule_candidates.map((candidate) => `- ${candidate.rule_id}`).join("\n"),
    "",
    "请直接输出一个完整 JSON object，推荐结构如下：",
    JSON.stringify(
      {
        action: "final_answer",
        summary: {
          assistant_scope: "请填写总体判断",
          overall_confidence: "medium",
        },
        rule_assessments: input.bootstrapPayload.assisted_rule_candidates.map((candidate) => ({
          rule_id: candidate.rule_id,
          decision: "uncertain",
          confidence: "medium",
          reason: "请填写该规则的具体判断依据",
          evidence_used: candidate.evidence_files,
          needs_human_review: true,
        })),
      },
      null,
      2,
    ),
  ].join("\n");
}

function normalizePlannerOutput(raw: unknown): unknown {
  if (
    raw &&
    typeof raw === "object" &&
    !Array.isArray(raw) &&
    (raw as { action?: unknown }).action === "tool_call"
  ) {
    const toolCall = raw as { tool_name?: unknown; tool?: unknown; [key: string]: unknown };
    const toolName = (raw as { tool_name?: unknown }).tool_name;
    const tool = (raw as { tool?: unknown }).tool;
    const { tool_name: _ignored, ...rest } = toolCall;
    return {
      ...rest,
      tool: typeof tool === "string" && tool.length > 0 ? tool : toolName,
    };
  }

  if (
    !raw ||
    typeof raw !== "object" ||
    Array.isArray(raw) ||
    (raw as { action?: unknown }).action !== "final_answer"
  ) {
    return raw;
  }

  const nested = (raw as { final_answer?: NestedModelFinalAnswer }).final_answer;
  if (!nested || typeof nested !== "object" || Array.isArray(nested)) {
    return raw;
  }

  const confidence = inferOverallConfidence(nested);
  const summaryText =
    typeof nested.summary === "string" && nested.summary.trim().length > 0
      ? nested.summary.trim()
      : typeof nested.summary_judgement === "string" && nested.summary_judgement.trim().length > 0
        ? nested.summary_judgement.trim()
        : typeof nested.overall_judgment?.summary === "string" &&
            nested.overall_judgment.summary.trim().length > 0
          ? nested.overall_judgment.summary.trim()
      : "基于 case 与 patch 完成辅助判定。";
  const humanReviewFlags = Array.isArray(nested.human_review_flags)
    ? nested.human_review_flags
    : [];

  return {
    action: "final_answer",
    summary: {
      assistant_scope: summaryText,
      overall_confidence: confidence,
    },
    rule_assessments: normalizeNestedRuleAssessments(nested, confidence, humanReviewFlags),
  };
}

function inferOverallConfidence(nested: NestedModelFinalAnswer): "high" | "medium" | "low" {
  const explicitConfidence =
    nested.requirement_judgement?.confidence ??
    nested.overall_judgment?.confidence ??
    nested.confidence;
  if (explicitConfidence !== undefined) {
    return normalizeConfidence(explicitConfidence);
  }

  const itemConfidences = [...(nested.rule_assessment ?? []), ...(nested.rule_assessments ?? [])]
    .map((item) => normalizeConfidence(item?.confidence))
    .filter((value): value is "high" | "medium" | "low" => Boolean(value));

  if (itemConfidences.includes("high")) {
    return "high";
  }
  if (itemConfidences.includes("medium")) {
    return "medium";
  }
  if (itemConfidences.includes("low")) {
    return "low";
  }

  return "medium";
}

function normalizeEvidence(
  evidence:
    | Array<{ file?: string; detail?: string } | string>
    | string[]
    | string
    | undefined,
): string[] {
  if (typeof evidence === "string" && evidence.length > 0) {
    return [evidence];
  }
  if (Array.isArray(evidence)) {
    return evidence.flatMap((entry) => {
      if (typeof entry === "string") {
        return entry.length > 0 ? [entry] : [];
      }
      if (!entry || typeof entry !== "object") {
        return [];
      }
      if (typeof entry.file === "string" && entry.file.length > 0) {
        return [entry.file];
      }
      if (typeof entry.detail === "string" && entry.detail.length > 0) {
        return [entry.detail];
      }
      return [];
    });
  }
  return [];
}

function normalizeConfidence(value: unknown): "high" | "medium" | "low" {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value >= 0.8) {
      return "high";
    }
    if (value >= 0.5) {
      return "medium";
    }
    return "low";
  }

  if (value === "high" || value === "medium" || value === "low") {
    return value;
  }

  if (typeof value !== "string") {
    return "medium";
  }

  const normalized = value.trim().toLowerCase();
  if (normalized.includes("medium")) {
    return "medium";
  }
  if (normalized.includes("high")) {
    return "high";
  }
  if (normalized.includes("low")) {
    return "low";
  }
  return "medium";
}

function normalizeRuleResultDecision(result: string | undefined): "violation" | "pass" | "not_applicable" | "uncertain" {
  if (!result) {
    return "uncertain";
  }
  const normalized = result.toLowerCase();
  if (["pass", "passed", "success", "ok", "满足"].includes(normalized)) {
    return "pass";
  }
  if (
    [
      "fail",
      "failed",
      "violation",
      "not_met",
      "not_satisfied",
      "not_satisfied",
      "notmet",
      "不满足",
      "不通过",
    ].includes(normalized)
  ) {
    return "violation";
  }
  if (["not_applicable", "not applicable", "n/a", "不涉及"].includes(normalized)) {
    return "not_applicable";
  }
  if (["partially_satisfied", "partially_met", "partial", "insufficient_evidence"].includes(normalized)) {
    return "uncertain";
  }
  return "uncertain";
}

function normalizeExplicitRuleAssessments(
  items:
    | NestedModelFinalAnswer["rule_assessment"]
    | NestedModelFinalAnswer["rule_assessments"]
    | undefined,
  fallbackConfidence: "high" | "medium" | "low",
): CaseAwareAgentFinalAnswer["rule_assessments"] {
  if (!Array.isArray(items)) {
    return [];
  }

  return items
    .filter((item): item is NonNullable<NestedModelFinalAnswer["rule_assessment"]>[number] => {
      return Boolean(item && typeof item.rule_id === "string" && item.rule_id.length > 0);
    })
    .map((item) => {
      const evidenceUsed = normalizeEvidence(item.evidence);
      const decision =
        typeof item.passed === "boolean"
          ? item.passed
            ? "pass"
            : "violation"
          : normalizeRuleResultDecision(item.assessment ?? item.rule_assessment ?? item.judgement);
      return {
        rule_id: item.rule_id as string,
        decision,
        confidence: normalizeConfidence(item.confidence ?? fallbackConfidence),
        reason:
          typeof item.reasoning === "string" && item.reasoning.length > 0
            ? item.reasoning
            : evidenceUsed[0] ?? "基于工具读取结果完成辅助判定。",
        evidence_used: evidenceUsed,
        needs_human_review: decision === "uncertain",
      };
    });
}

function normalizeNestedRuleAssessments(
  nested: NestedModelFinalAnswer,
  fallbackConfidence: "high" | "medium" | "low",
  humanReviewFlags: string[],
): CaseAwareAgentFinalAnswer["rule_assessments"] {
  const needsHumanReview = humanReviewFlags.length > 0;
  const explicitRuleAssessments = normalizeExplicitRuleAssessments(
    nested.rule_assessment ?? nested.rule_assessments,
    fallbackConfidence,
  );

  if (explicitRuleAssessments.length > 0) {
    return explicitRuleAssessments.map((item) => ({
      ...item,
      needs_human_review: item.needs_human_review || needsHumanReview,
    }));
  }

  if (Array.isArray(nested.case_rule_verdicts)) {
    return nested.case_rule_verdicts
      .filter((item): item is NonNullable<NestedModelFinalAnswer["case_rule_verdicts"]>[number] => {
        return Boolean(item && typeof item.rule_id === "string" && item.rule_id.length > 0);
      })
      .map((item) => {
        const ruleId = item.rule_id as string;
        const evidenceUsed = normalizeEvidence(item.evidence);
        return {
          rule_id: ruleId,
          decision: item.passed === true ? "pass" : "violation",
          confidence: normalizeConfidence(item.confidence ?? fallbackConfidence),
          reason:
            evidenceUsed[0] ??
            (item.passed === true ? "已找到满足该规则的证据。" : "未找到满足该规则的证据。"),
          evidence_used: evidenceUsed,
          needs_human_review: needsHumanReview,
        };
      });
  }

  const ruleResults = Array.isArray(nested.case_rule_results)
    ? nested.case_rule_results
    : Array.isArray(nested.rule_results)
    ? nested.rule_results
    : Array.isArray(nested.rule_checks)
      ? nested.rule_checks
      : [];

  return ruleResults
    .filter((item): item is NonNullable<NestedModelFinalAnswer["rule_results"]>[number] => {
      return Boolean(item && typeof item.rule_id === "string" && item.rule_id.length > 0);
    })
    .map((item) => {
      const ruleId = item.rule_id as string;
      const evidenceUsed = normalizeEvidence(item.evidence);
      const decision = normalizeRuleResultDecision(item.result);
      return {
        rule_id: ruleId,
        decision,
        confidence: normalizeConfidence(item.confidence ?? fallbackConfidence),
        reason: evidenceUsed[0] ?? "基于工具读取结果完成辅助判定。",
        evidence_used: evidenceUsed,
        needs_human_review: needsHumanReview || decision === "uncertain",
      };
    });
}

export function parseCaseAwarePlannerOutput(rawText: string): CaseAwareAgentPlannerOutput {
  const candidates = extractJsonObjectCandidates(rawText);
  let lastError: Error | undefined;

  for (const candidate of candidates) {
    try {
      const parsed = normalizePlannerOutput(JSON.parse(candidate) as unknown);
      return plannerOutputSchema.parse(parsed) as CaseAwareAgentPlannerOutput;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  throw lastError ?? new SyntaxError("No valid JSON object found");
}

export function stripFinalAnswerAction(
  finalAnswer: CaseAwareAgentFinalAnswer,
): Omit<CaseAwareAgentFinalAnswer, "action"> {
  const { action: _ignored, ...rest } = finalAnswer;
  return rest;
}
