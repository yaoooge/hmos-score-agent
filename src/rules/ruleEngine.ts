import { collectEvidence } from "./evidenceCollector.js";
import { getEnabledRulePacks, listRegisteredRules } from "./engine/rulePackRegistry.js";
import type { RegisteredRule } from "./engine/ruleTypes.js";
import { runCaseConstraintRule } from "./evaluators/caseConstraintEvaluator.js";
import { runProjectStructureRule } from "./evaluators/projectStructureEvaluator.js";
import type { EvaluatedRule } from "./evaluators/shared.js";
import { runTextPatternRule } from "./evaluators/textPatternEvaluator.js";
import {
  AssistedRuleCandidate,
  CaseRuleDefinition,
  CaseInput,
  RuleAuditResult,
  RuleEvidenceIndex,
  RuleViolation,
  StaticRuleAuditResult,
  TaskType,
} from "../types.js";

// Rule engine 的输出会被 workflow 直接写盘并送入 scoring engine。
export interface RuleEngineOutput {
  staticRuleAuditResults: StaticRuleAuditResult[];
  deterministicRuleResults: RuleAuditResult[];
  caseRuleResults: RuleAuditResult[];
  assistedRuleCandidates: AssistedRuleCandidate[];
  ruleViolations: RuleViolation[];
  enabledRulePacks: Array<{ pack_id: string; display_name: string }>;
  ruleEvidenceIndex: RuleEvidenceIndex;
  evidenceSummary: {
    workspaceFileCount: number;
    originalFileCount: number;
    changedFileCount: number;
    changedFiles: string[];
    hasPatch: boolean;
  };
}

type DeterministicStaticRuleAuditResult = StaticRuleAuditResult & {
  result: Exclude<StaticRuleAuditResult["result"], "未接入判定器">;
};

type RuntimeTargetCheck = {
  target: string;
  astSignals: Array<Record<string, string>>;
  llmPrompt: string;
};

type AssistedRuleTargetCheck = NonNullable<AssistedRuleCandidate["target_checks"]>[number];

function isDeterministicStaticRule(
  rule: StaticRuleAuditResult,
): rule is DeterministicStaticRuleAuditResult {
  return rule.result !== "未接入判定器";
}

export async function runRuleEngine(input: {
  referenceRoot: string;
  caseInput: CaseInput;
  taskType: TaskType;
  runtimeRules?: CaseRuleDefinition[];
  enabledRulePackIds?: string[];
}): Promise<RuleEngineOutput> {
  const evidence = await collectEvidence(input.caseInput, { taskType: input.taskType });
  const enabledRulePacks = input.enabledRulePackIds
    ? getEnabledRulePacks(input.enabledRulePackIds)
    : getEnabledRulePacks(["arkts-language", "arkts-performance"]);
  const registeredRules = listRegisteredRules({
    enabledPackIds: enabledRulePacks.map((pack) => pack.packId),
    runtimeRules: input.runtimeRules ?? [],
  });
  const ruleSummaryById = new Map(registeredRules.map((rule) => [rule.rule_id, rule.summary]));
  const registeredRuleById = new Map(registeredRules.map((rule) => [rule.rule_id, rule]));
  const evaluatedRules = registeredRules.map((rule) => evaluateRegisteredRule(rule, evidence));
  const evaluatedRuleById = new Map(evaluatedRules.map((rule) => [rule.rule_id, rule]));
  const caseRuleIds = new Set((input.runtimeRules ?? []).map((rule) => rule.rule_id));

  const ruleViolations: RuleViolation[] = evaluatedRules
    .filter((rule) => rule.result === "不满足")
    .map((rule) => ({
      rule_source: rule.rule_source,
      rule_id: rule.rule_id,
      rule_summary: rule.conclusion,
      affected_items: getRuleEvidenceFiles(rule),
      handling_result: "待人工复核",
      evidence: rule.conclusion,
    }));

  const ruleEvidenceIndex: RuleEvidenceIndex = Object.fromEntries(
    evaluatedRules.map((rule) => [
      rule.rule_id,
      {
        evidenceFiles: getRuleEvidenceFiles(rule),
        evidenceSnippets: getRuleEvidenceSnippets(rule, evidence.workspaceFiles),
      },
    ]),
  );
  const fallbackEvidenceFiles =
    evidence.changedFiles.length > 0
      ? evidence.changedFiles.slice(0, 3)
      : evidence.workspaceFiles.slice(0, 3).map((file) => file.relativePath);

  ruleEvidenceIndex.__fallback__ = {
    evidenceFiles: fallbackEvidenceFiles,
    evidenceSnippets: fallbackEvidenceFiles
      .map((relativePath) => normalizeWorkspaceRelativePath(relativePath))
      .map(
        (relativePath) =>
          evidence.workspaceFiles.find((file) => file.relativePath === relativePath)?.content ?? "",
      )
      .filter(Boolean)
      .map((content) => content.slice(0, 200)),
  };

  const staticRuleAuditResults: StaticRuleAuditResult[] = evaluatedRules.map(
    ({
      matchedFiles: _matchedFiles,
      matchedLocations: _matchedLocations,
      matchedSnippets: _matchedSnippets,
      ...rule
    }) => {
      const normalizedRule = {
        ...rule,
        rule_summary: rule.rule_summary ?? ruleSummaryById.get(rule.rule_id) ?? "",
      };
      if (caseRuleIds.has(rule.rule_id)) {
        return normalizedRule;
      }
      return normalizedRule;
    },
  );
  const deterministicRuleResults: RuleAuditResult[] = staticRuleAuditResults
    .filter(isDeterministicStaticRule)
    .filter((rule) => !caseRuleIds.has(rule.rule_id))
    .map((rule) => ({
      rule_id: rule.rule_id,
      rule_summary: rule.rule_summary,
      rule_source: rule.rule_source,
      result: rule.result,
      conclusion: rule.conclusion,
    }));
  const caseRuleResults: RuleAuditResult[] = [];
  const assistedRuleCandidates: AssistedRuleCandidate[] = staticRuleAuditResults
    .filter((rule) => rule.result === "未接入判定器" || caseRuleIds.has(rule.rule_id))
    .map((rule) => {
      const registeredRule = registeredRuleById.get(rule.rule_id);
      const staticPrecheck = evaluatedRuleById.get(rule.rule_id)?.preliminaryData
        ?.static_precheck as AssistedRuleCandidate["static_precheck"] | undefined;
      return {
        rule_id: rule.rule_id,
        rule_summary: rule.rule_summary,
        rule_source: rule.rule_source,
        why_uncertain: rule.conclusion,
        local_preliminary_signal:
          staticPrecheck?.signal_status ??
          (registeredRule?.is_case_rule ? "unknown" : "未接入静态判定器，需要agent辅助判定"),
        evidence_files: ruleEvidenceIndex[rule.rule_id]?.evidenceFiles ?? [],
        evidence_snippets: ruleEvidenceIndex[rule.rule_id]?.evidenceSnippets ?? [],
        rule_name: registeredRule?.rule_name,
        priority: registeredRule?.priority,
        decision_criteria: registeredRule?.decision_criteria,
        kit: readStringArray(registeredRule?.detector_config.kit),
        llm_prompt: readLlmPrompt(registeredRule?.detector_config),
        ast_signals: readAstSignals(registeredRule?.detector_config.astSignals),
        target_checks: readTargetChecks(registeredRule?.detector_config.targetChecks),
        static_precheck: staticPrecheck,
        is_case_rule: registeredRule?.is_case_rule,
      };
    });

  return {
    staticRuleAuditResults,
    deterministicRuleResults,
    caseRuleResults,
    assistedRuleCandidates,
    ruleViolations,
    enabledRulePacks: enabledRulePacks.map((pack) => ({
      pack_id: pack.packId,
      display_name: pack.displayName,
    })),
    ruleEvidenceIndex,
    evidenceSummary: evidence.summary,
  };
}

function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const strings = value.filter((item): item is string => typeof item === "string");
  return strings.length > 0 ? strings : undefined;
}

function readLlmPrompt(detectorConfig: Record<string, unknown> | undefined): string | undefined {
  if (typeof detectorConfig?.llmPrompt === "string") {
    return detectorConfig.llmPrompt;
  }

  const targetChecks = readTargetChecks(detectorConfig?.targetChecks);
  if (!targetChecks) {
    return undefined;
  }

  const checksWithPrompt = targetChecks.filter((check) => check.llm_prompt.length > 0);
  if (checksWithPrompt.length === 0) {
    return undefined;
  }
  if (checksWithPrompt.length === 1) {
    return checksWithPrompt[0]?.llm_prompt;
  }

  return checksWithPrompt.map((check) => `${check.target}: ${check.llm_prompt}`).join("\n");
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  return Object.values(value).every((item) => typeof item === "string");
}

function readTargetChecks(value: unknown): AssistedRuleCandidate["target_checks"] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const targetChecks = value.flatMap((item): AssistedRuleTargetCheck[] => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return [];
    }
    const check = item as Partial<RuntimeTargetCheck>;
    if (typeof check.target !== "string") {
      return [];
    }
    const astSignals = Array.isArray(check.astSignals)
      ? check.astSignals.filter(isStringRecord)
      : [];
    return [
      {
        target: check.target,
        ast_signals: astSignals,
        llm_prompt: typeof check.llmPrompt === "string" ? check.llmPrompt : "",
      },
    ];
  });

  return targetChecks.length > 0 ? targetChecks : undefined;
}

function readAstSignals(value: unknown): Array<Record<string, string>> | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const astSignals = value.filter(isStringRecord);
  return astSignals.length > 0 ? astSignals : undefined;
}

function evaluateRegisteredRule(
  rule: RegisteredRule,
  evidence: Awaited<ReturnType<typeof collectEvidence>>,
): EvaluatedRule {
  if (rule.detector_kind === "text_pattern") {
    return runTextPatternRule(rule, evidence);
  }

  if (rule.detector_kind === "project_structure") {
    return runProjectStructureRule(rule, evidence);
  }

  if (rule.detector_kind === "case_constraint") {
    return runCaseConstraintRule(rule, evidence);
  }

  return {
    rule_id: rule.rule_id,
    rule_source: rule.rule_source,
    result: "未接入判定器",
    conclusion: `${rule.summary} 当前版本未接入对应判定器。`,
    matchedFiles: [],
  };
}

function normalizeWorkspaceRelativePath(relativePath: string): string {
  return relativePath.replace(/^workspace\//, "").replace(/^original\//, "");
}

function getRuleEvidenceFiles(rule: EvaluatedRule): string[] {
  return (rule.matchedLocations?.length ?? 0) > 0
    ? (rule.matchedLocations ?? [])
    : rule.matchedFiles;
}

function getRuleEvidenceSnippets(
  rule: EvaluatedRule,
  workspaceFiles: Awaited<ReturnType<typeof collectEvidence>>["workspaceFiles"],
): string[] {
  if ((rule.matchedSnippets?.length ?? 0) > 0) {
    return rule.matchedSnippets ?? [];
  }

  return rule.matchedFiles
    .map(
      (relativePath) =>
        workspaceFiles.find((file) => file.relativePath === relativePath)?.content ?? "",
    )
    .filter(Boolean)
    .map((content) => content.slice(0, 200));
}
