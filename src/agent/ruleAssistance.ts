import type {
  AgentAssistedRuleResult,
  AgentRunStatus,
  AgentBootstrapPayload,
  AssistedRuleCandidate,
  CaseAwareAgentFinalAnswer,
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
  caseRoot: string;
  effectivePatchPath?: string;
  taskType: TaskType;
  constraintSummary: ConstraintSummary;
  rubricSnapshot: LoadedRubricSnapshot;
  assistedRuleCandidates: AssistedRuleCandidate[];
  initialTargetFiles: string[];
};

type MergeRuleAuditResultsInput = {
  deterministicRuleResults: RuleAuditResult[];
  assistedRuleCandidates: AssistedRuleCandidate[];
  agentFinalAnswer?: CaseAwareAgentFinalAnswer;
};

type MergeRuleAuditResultsOutput = {
  agentRunStatus: AgentRunStatus;
  agentAssistedRuleResults: AgentAssistedRuleResult | null;
  mergedRuleAuditResults: RuleAuditResult[];
};

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
        rule.result === "不满足"
          ? "possible_violation"
          : rule.result === "满足"
            ? "possible_pass"
            : "unknown",
      evidence_files: evidence?.evidenceFiles?.length
        ? evidence.evidenceFiles
        : (fallbackEvidence?.evidenceFiles ?? []),
      evidence_snippets: evidence?.evidenceSnippets?.length
        ? evidence.evidenceSnippets
        : (fallbackEvidence?.evidenceSnippets ?? []),
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
    scenario: rubric.scenario,
    scoring_method: rubric.scoringMethod,
    scoring_note: rubric.scoringNote,
    common_risks: rubric.commonRisks,
    report_emphasis: rubric.reportEmphasis,
    dimension_summaries: rubric.dimensions.map((dimension) => ({
      name: dimension.name,
      weight: dimension.weight,
      intent: dimension.intent,
      item_summaries: dimension.items.map((item) => ({
        name: item.name,
        weight: item.weight,
        scoring_bands: item.scoringBands.map((band) => ({
          score: band.score,
          criteria: band.criteria,
        })),
      })),
    })),
    hard_gates: rubric.hardGates.map((gate) => ({
      id: gate.id,
      score_cap: gate.scoreCap,
    })),
    review_rule_summary:
      rubric.reviewRules.scoreBands.length > 0 ? ["关键分段分数需要人工复核"] : [],
  };
}

// buildAgentBootstrapPayload 把评分上下文组织成 case-aware runner 的 bootstrap 载荷。
export function buildAgentBootstrapPayload(
  input: BuildAgentPromptPayloadInput,
): AgentBootstrapPayload {
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
    assisted_rule_candidates: input.assistedRuleCandidates,
    initial_target_files: input.initialTargetFiles,
    tool_contract: {
      allowed_tools: [
        "read_patch",
        "list_dir",
        "read_file",
        "read_file_chunk",
        "grep_in_files",
        "read_json",
      ],
      max_tool_calls: 6,
      max_total_bytes: 61440,
      max_files: 20,
    },
    response_contract: {
      action_enum: ["tool_call", "final_answer"],
      output_language: "zh-CN",
      json_only: true,
    },
  };
}

// renderAgentBootstrapPrompt 生成 case-aware runner 的首轮 bootstrap prompt。
export function renderAgentBootstrapPrompt(payload: AgentBootstrapPayload): string {
  const candidateRuleIds = payload.assisted_rule_candidates.map((candidate) => candidate.rule_id);
  return [
    "你是评分工作流中的 case-aware 辅助判定模块。",
    "你可以在受限预算内调用 case 目录只读工具来补查上下文。",
    "你只能返回 tool_call 或 final_answer 两种 JSON action。",
    "一次只允许输出一个 JSON object，不要输出多个 JSON object，不要把多个 action 串在一起。",
    "tool_call 时必须包含 tool、args、reason；final_answer 时必须包含 action、summary、rule_assessments。",
    "如果证据不足，必须在对应 rule_assessments 中将 needs_human_review 置为 true。",
    "所有描述型文案必须使用中文。",
    "禁止输出 markdown、代码块或任何额外解释。",
    "case 目录只读工具包括：read_patch、list_dir、read_file、read_file_chunk、grep_in_files、read_json。",
    "工具参数必须严格匹配以下结构，不允许自造字段名：",
    "read_patch: args 可为空，或仅允许 path 字段。",
    "list_dir: args = { path }，只允许 path 字段。",
    "read_file: args = { path }，只允许 path 字段。",
    "read_file_chunk: args = { path, startLine, lineCount }。",
    "grep_in_files: args = { pattern, path, limit }。",
    "read_json: args = { path }，只允许 path 字段。",
    "输出结构约束：",
    "tool_call 必须包含 action=tool_call、tool、args、reason。",
    "final_answer 必须包含 action=final_answer、summary、rule_assessments。",
    "summary 必须包含 assistant_scope 与 overall_confidence。",
    "每条 rule_assessment 必须包含 rule_id、decision、confidence、reason、evidence_used、needs_human_review。",
    "不要输出示例 JSON，不要输出 markdown，不要输出额外解释。",
    "请优先从 initial_target_files 和 effective_patch_path 开始收集证据，再决定是否继续读取其他文件。",
    "最终只对 assisted_rule_candidates 中的候选规则给出判断，不要改写本地静态规则结果。",
    `本次共有 ${candidateRuleIds.length} 条 assisted_rule_candidates；final_answer.rule_assessments 必须逐条覆盖 assisted_rule_candidates 中的每个 rule_id，禁止只输出 summary 或空数组。`,
    candidateRuleIds.length > 0
      ? `本次必须覆盖的 rule_id: ${candidateRuleIds.join(", ")}。`
      : "当前没有 assisted_rule_candidates，只有在上游误调用时才可能看到本提示。",
    "final_answer 中的 decision 只能是 violation、pass、not_applicable、uncertain。",
    "final_answer 中的 confidence 只能是 high、medium、low。",
    "请直接输出一个 JSON object，不要输出多个 JSON object。",
    "",
    JSON.stringify(payload, null, 2),
  ].join("\n");
}

function formatAgentSummaryForFallback(
  summary?: AgentAssistedRuleResult["summary"],
): string | undefined {
  if (!summary) {
    return undefined;
  }
  return `Agent 总体判断：${summary.assistant_scope}（整体置信度：${summary.overall_confidence}）。`;
}

function makeFallbackResult(
  candidate: AssistedRuleCandidate,
  summary?: AgentAssistedRuleResult["summary"],
): RuleAuditResult {
  const summaryText = formatAgentSummaryForFallback(summary);
  return {
    rule_id: candidate.rule_id,
    rule_summary: candidate.rule_summary ?? candidate.rule_name,
    rule_source: candidate.rule_source,
    result: "待人工复核",
    conclusion: summaryText
      ? `${summaryText} 但缺少针对 ${candidate.rule_id} 的结构化判定，已回退为待人工复核。`
      : `Agent 未能提供有效判定，候选规则 ${candidate.rule_id} 已回退为待人工复核。`,
  };
}

function mapAgentDecisionToRuleResult(
  decision: "violation" | "pass" | "not_applicable" | "uncertain",
): RuleAuditResult["result"] {
  switch (decision) {
    case "violation":
      return "不满足";
    case "pass":
      return "满足";
    case "not_applicable":
      return "不涉及";
    case "uncertain":
      return "待人工复核";
  }
}

// mergeRuleAuditResults 负责本地优先合并，保证非法输出时仍能稳定回退。
export function mergeRuleAuditResults(
  input: MergeRuleAuditResultsInput,
): MergeRuleAuditResultsOutput {
  const agentResult = input.agentFinalAnswer;
  if (!agentResult) {
    return {
      agentRunStatus: "invalid_output",
      agentAssistedRuleResults: null,
      mergedRuleAuditResults: [
        ...input.deterministicRuleResults,
        ...input.assistedRuleCandidates.map((candidate) => makeFallbackResult(candidate)),
      ],
    };
  }

  const assessmentByRuleId = new Map(
    agentResult.rule_assessments.map((item) => [item.rule_id, item]),
  );
  const mergedCandidates = input.assistedRuleCandidates.map((candidate) => {
    const assessment = assessmentByRuleId.get(candidate.rule_id);
    if (!assessment) {
      if (agentResult.rule_assessments.length === 0) {
        return makeFallbackResult(candidate, agentResult.summary);
      }
      return {
        rule_id: candidate.rule_id,
        rule_summary: candidate.rule_summary ?? candidate.rule_name,
        rule_source: candidate.rule_source,
        result: "待人工复核" as const,
        conclusion: `Agent 未提供规则 ${candidate.rule_id} 的分条判定，已回退为待人工复核。`,
      };
    }

    return {
      rule_id: candidate.rule_id,
      rule_summary: candidate.rule_summary ?? candidate.rule_name,
      rule_source: candidate.rule_source,
      result: mapAgentDecisionToRuleResult(assessment.decision),
      conclusion: assessment.reason,
    };
  });

  return {
    agentRunStatus: "success",
    agentAssistedRuleResults: {
      summary: agentResult.summary,
      rule_assessments: agentResult.rule_assessments,
    },
    mergedRuleAuditResults: [...input.deterministicRuleResults, ...mergedCandidates],
  };
}
