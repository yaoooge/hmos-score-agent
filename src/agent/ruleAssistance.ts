import { z } from "zod";
import type {
  AgentAssistedRuleResult,
  AgentPromptPayload,
  AgentRunStatus,
  AssistedRuleCandidate,
  ConstraintSummary,
  LoadedRubricSnapshot,
  RuleAuditResult,
  TaskType,
} from "../types.js";
import type { LoadedRubric } from "../scoring/rubricLoader.js";

type SelectAssistedRuleCandidatesInput = {
  evidenceByRuleId?: Record<
    string,
    {
      evidenceFiles: string[];
      evidenceSnippets: string[];
    }
  >;
  fallbackEvidence?: {
    evidenceFiles: string[];
    evidenceSnippets: string[];
  };
};

type BuildAgentPromptPayloadInput = {
  caseInput: {
    caseId: string;
    promptText: string;
    originalProjectPath: string;
    generatedProjectPath: string;
    patchPath?: string;
  };
  taskType: TaskType;
  constraintSummary: ConstraintSummary;
  rubricSnapshot: LoadedRubricSnapshot;
  deterministicRuleResults: RuleAuditResult[];
  assistedRuleCandidates: AssistedRuleCandidate[];
};

type MergeRuleAuditResultsInput = {
  deterministicRuleResults: RuleAuditResult[];
  assistedRuleCandidates: AssistedRuleCandidate[];
  agentOutputText: string;
};

type MergeRuleAuditResultsOutput = {
  agentRunStatus: AgentRunStatus;
  agentAssistedRuleResults: AgentAssistedRuleResult | null;
  mergedRuleAuditResults: RuleAuditResult[];
};

const agentResponseSchema = z.object({
  summary: z.object({
    assistant_scope: z.string(),
    overall_confidence: z.enum(["high", "medium", "low"]),
  }),
  rule_assessments: z.array(
    z.object({
      rule_id: z.string(),
      decision: z.enum(["violation", "pass", "not_applicable", "uncertain"]),
      confidence: z.enum(["high", "medium", "low"]),
      reason: z.string(),
      evidence_used: z.array(z.string()),
      needs_human_review: z.boolean(),
    }),
  ),
});

const compatibleChineseAgentResponseSchema = z.object({
  case_id: z.string().optional(),
  assisted_rule_judgments: z.array(
    z.object({
      rule_id: z.string(),
      result: z.enum(["满足", "不满足", "不涉及", "无法判断"]).optional(),
      judgment: z.enum(["满足", "不满足", "不涉及", "无法判断"]).optional(),
      confidence: z.enum(["高", "中", "低"]),
      needs_human_review: z.boolean(),
      reason: z.string(),
      evidence_used: z.array(z.string()).optional(),
    }),
  ),
  summary: z
    .object({
      needs_human_review: z.boolean().optional(),
      reason: z.string().optional(),
    })
    .optional(),
  global_assessment: z
    .object({
      needs_human_review: z.boolean().optional(),
      overall_needs_human_review: z.boolean().optional(),
      reason: z.string().optional(),
      summary: z.string().optional(),
    })
    .optional(),
});

// selectAssistedRuleCandidates 根据当前快速版策略，优先把 should_rule 交给 Agent 辅助判定。
export function selectAssistedRuleCandidates(
  ruleAuditResults: RuleAuditResult[],
  input: SelectAssistedRuleCandidatesInput = {},
): {
  deterministicRuleResults: RuleAuditResult[];
  assistedRuleCandidates: AssistedRuleCandidate[];
} {
  const deterministicRuleResults: RuleAuditResult[] = [];
  const assistedRuleCandidates: AssistedRuleCandidate[] = [];

  for (const rule of ruleAuditResults) {
    if (rule.rule_source !== "should_rule") {
      deterministicRuleResults.push(rule);
      continue;
    }

    const evidence = input.evidenceByRuleId?.[rule.rule_id];
    const fallbackEvidence = input.fallbackEvidence;
    assistedRuleCandidates.push({
      rule_id: rule.rule_id,
      rule_source: rule.rule_source,
      why_uncertain: "当前规则需要 Agent 结合上下文做辅助判定。",
      local_preliminary_signal:
        rule.result === "不满足" ? "possible_violation" : rule.result === "满足" ? "possible_pass" : "unknown",
      evidence_files: evidence?.evidenceFiles?.length ? evidence.evidenceFiles : fallbackEvidence?.evidenceFiles ?? [],
      evidence_snippets:
        evidence?.evidenceSnippets?.length ? evidence.evidenceSnippets : fallbackEvidence?.evidenceSnippets ?? [],
    });
  }

  return {
    deterministicRuleResults,
    assistedRuleCandidates,
  };
}

// buildRubricSnapshot 只保留评分 prompt 真正需要的摘要，避免把整份 rubric 传给 Agent。
export function buildRubricSnapshot(rubric: LoadedRubric): LoadedRubricSnapshot {
  return {
    task_type: rubric.taskType,
    evaluation_mode: rubric.evaluationMode,
    dimension_summaries: rubric.dimensions.map((dimension) => ({
      name: dimension.name,
      weight: dimension.weight,
      item_names: dimension.items.map((item) => item.name),
    })),
    hard_gates: rubric.hardGates.map((gate) => ({
      id: gate.id,
      score_cap: gate.scoreCap,
    })),
    review_rule_summary:
      rubric.reviewRules.scoreBands.length > 0
        ? ["关键分段分数需要人工复核"]
        : [],
  };
}

// buildAgentPromptPayload 把评分上下文组织成可回放的结构化载荷。
export function buildAgentPromptPayload(input: BuildAgentPromptPayloadInput): AgentPromptPayload {
  return {
    case_context: {
      case_id: input.caseInput.caseId,
      task_type: input.taskType,
      original_prompt_summary: input.caseInput.promptText,
      has_patch: Boolean(input.caseInput.patchPath),
      project_paths: {
        original_project_path: input.caseInput.originalProjectPath,
        generated_project_path: input.caseInput.generatedProjectPath,
      },
    },
    task_understanding: input.constraintSummary,
    rubric_summary: input.rubricSnapshot,
    deterministic_rule_results: input.deterministicRuleResults,
    assisted_rule_candidates: input.assistedRuleCandidates,
    response_contract: {
      output_language: "zh-CN",
      json_only: true,
      fallback_rule: "不确定时必须返回 needs_human_review=true",
    },
  };
}

// renderAgentPrompt 生成真正发送给 Agent 的中文 prompt，并明确 JSON-only 契约。
export function renderAgentPrompt(payload: AgentPromptPayload): string {
  return [
    "你不是最终评分器，而是评分工作流中的辅助判定模块。",
    "你只需要基于提供的证据，对 assisted_rule_candidates 中的候选弱规则给出结构化辅助判断。",
    "请优先依据证据文件和代码片段，不要改写 deterministic_rule_results 中的本地已确定结果。",
    "当证据不足或无法稳定判断时，必须返回 needs_human_review=true。",
    "所有描述型文案必须使用中文。",
    "只能输出 JSON，不允许输出额外说明性文本。",
    "",
    JSON.stringify(payload, null, 2),
  ].join("\n");
}

function makeFallbackResult(candidate: AssistedRuleCandidate): RuleAuditResult {
  return {
    rule_id: candidate.rule_id,
    rule_source: candidate.rule_source,
    result: "待人工复核",
    conclusion: `Agent 未能提供有效判定，候选规则 ${candidate.rule_id} 已回退为待人工复核。`,
  };
}

function normalizeCompatibleChineseResponse(parsed: unknown): AgentAssistedRuleResult | null {
  const validation = compatibleChineseAgentResponseSchema.safeParse(parsed);
  if (!validation.success) {
    return null;
  }

  return {
    summary: {
      assistant_scope: "本次仅辅助弱规则判定",
      overall_confidence:
        validation.data.assisted_rule_judgments.some((item) => item.confidence === "低")
          ? "low"
          : validation.data.assisted_rule_judgments.some((item) => item.confidence === "中")
            ? "medium"
            : "high",
    },
    rule_assessments: validation.data.assisted_rule_judgments.map((item) => ({
      rule_id: item.rule_id,
      decision:
        (item.result ?? item.judgment) === "满足"
          ? "pass"
          : (item.result ?? item.judgment) === "不满足"
            ? "violation"
            : (item.result ?? item.judgment) === "不涉及"
              ? "not_applicable"
              : "uncertain",
      confidence: item.confidence === "高" ? "high" : item.confidence === "中" ? "medium" : "low",
      reason: item.reason,
      evidence_used: item.evidence_used ?? [],
      needs_human_review: item.needs_human_review,
    })),
  };
}

function mapAssessmentToRuleAuditResult(
  candidate: AssistedRuleCandidate,
  assessment: AgentAssistedRuleResult["rule_assessments"][number],
): RuleAuditResult {
  if (assessment.needs_human_review || assessment.decision === "uncertain" || assessment.confidence === "low") {
    return {
      rule_id: candidate.rule_id,
      rule_source: candidate.rule_source,
      result: "待人工复核",
      conclusion: assessment.reason,
    };
  }

  if (assessment.decision === "violation") {
    return {
      rule_id: candidate.rule_id,
      rule_source: candidate.rule_source,
      result: "不满足",
      conclusion: assessment.reason,
    };
  }

  if (assessment.decision === "pass") {
    return {
      rule_id: candidate.rule_id,
      rule_source: candidate.rule_source,
      result: "满足",
      conclusion: assessment.reason,
    };
  }

  return {
    rule_id: candidate.rule_id,
    rule_source: candidate.rule_source,
    result: "不涉及",
    conclusion: assessment.reason,
  };
}

// mergeRuleAuditResults 负责本地优先合并，保证非法输出时仍能稳定回退。
export function mergeRuleAuditResults(input: MergeRuleAuditResultsInput): MergeRuleAuditResultsOutput {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input.agentOutputText);
  } catch {
    return {
      agentRunStatus: "invalid_output",
      agentAssistedRuleResults: null,
      mergedRuleAuditResults: [
        ...input.deterministicRuleResults,
        ...input.assistedRuleCandidates.map((candidate) => makeFallbackResult(candidate)),
      ],
    };
  }

  const validation = agentResponseSchema.safeParse(parsed);
  const agentAssistedRuleResults = validation.success ? validation.data : normalizeCompatibleChineseResponse(parsed);
  if (!agentAssistedRuleResults) {
    return {
      agentRunStatus: "invalid_output",
      agentAssistedRuleResults: null,
      mergedRuleAuditResults: [
        ...input.deterministicRuleResults,
        ...input.assistedRuleCandidates.map((candidate) => makeFallbackResult(candidate)),
      ],
    };
  }

  const assessmentByRuleId = new Map(agentAssistedRuleResults.rule_assessments.map((item) => [item.rule_id, item]));
  const mergedCandidates = input.assistedRuleCandidates.map((candidate) => {
    const assessment = assessmentByRuleId.get(candidate.rule_id);
    return assessment ? mapAssessmentToRuleAuditResult(candidate, assessment) : makeFallbackResult(candidate);
  });

  return {
    agentRunStatus: "success",
    agentAssistedRuleResults,
    mergedRuleAuditResults: [...input.deterministicRuleResults, ...mergedCandidates],
  };
}
