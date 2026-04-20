import { collectEvidence } from "./evidenceCollector.js";
import { listRegisteredRules } from "./engine/rulePackRegistry.js";
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
}): Promise<RuleEngineOutput> {
  const evidence = await collectEvidence(input.caseInput);
  const evaluatedRules = listRegisteredRules(input.runtimeRules ?? []).map((rule) =>
    evaluateRegisteredRule(rule, evidence),
  );
  const evaluatedRuleById = new Map(evaluatedRules.map((rule) => [rule.rule_id, rule]));
  const caseRuleIds = new Set((input.runtimeRules ?? []).map((rule) => rule.rule_id));

  const ruleViolations: RuleViolation[] = evaluatedRules
    .filter((rule) => rule.result === "不满足")
    .map((rule) => ({
      rule_source: rule.rule_source,
      rule_id: rule.rule_id,
      rule_summary: rule.conclusion,
      affected_items: rule.matchedFiles,
      handling_result: "待人工复核",
      evidence: rule.conclusion,
    }));

  const ruleEvidenceIndex: RuleEvidenceIndex = Object.fromEntries(
    evaluatedRules.map((rule) => [
      rule.rule_id,
      {
        evidenceFiles: rule.matchedFiles,
        evidenceSnippets: rule.matchedFiles
          .map(
            (relativePath) =>
              evidence.workspaceFiles.find((file) => file.relativePath === relativePath)?.content ??
              "",
          )
          .filter(Boolean)
          .map((content) => content.slice(0, 200)),
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
    ({ matchedFiles: _matchedFiles, ...rule }) => {
      if (caseRuleIds.has(rule.rule_id)) {
        return rule;
      }
      const directEvidence = ruleEvidenceIndex[rule.rule_id];
      if (rule.result === "未接入判定器" && (directEvidence?.evidenceFiles?.length ?? 0) === 0) {
        return {
          ...rule,
          result: "不涉及",
          conclusion: "未发现相关实现证据，当前不涉及。",
        };
      }
      return rule;
    },
  );
  const deterministicRuleResults: RuleAuditResult[] = staticRuleAuditResults
    .filter(isDeterministicStaticRule)
    .filter((rule) => !caseRuleIds.has(rule.rule_id))
    .map((rule) => ({
      rule_id: rule.rule_id,
      rule_source: rule.rule_source,
      result: rule.result,
      conclusion: rule.conclusion,
    }));
  const caseRuleResults: RuleAuditResult[] = [];
  const assistedRuleCandidates: AssistedRuleCandidate[] = staticRuleAuditResults
    .filter((rule) => rule.result === "未接入判定器" || caseRuleIds.has(rule.rule_id))
    .map((rule) => {
      const runtimeRule = (input.runtimeRules ?? []).find((item) => item.rule_id === rule.rule_id);
      const staticPrecheck = evaluatedRuleById.get(rule.rule_id)?.preliminaryData?.static_precheck as
        | AssistedRuleCandidate["static_precheck"]
        | undefined;
      return {
        rule_id: rule.rule_id,
        rule_source: rule.rule_source,
        why_uncertain: rule.conclusion,
        local_preliminary_signal:
          staticPrecheck?.signal_status ?? (runtimeRule?.is_case_rule ? "unknown" : "未接入判定器"),
        evidence_files: ruleEvidenceIndex[rule.rule_id]?.evidenceFiles ?? [],
        evidence_snippets: ruleEvidenceIndex[rule.rule_id]?.evidenceSnippets ?? [],
        rule_name: runtimeRule?.rule_name,
        priority: runtimeRule?.priority,
        llm_prompt: runtimeRule?.detector_config.llmPrompt,
        ast_signals: runtimeRule?.detector_config.astSignals,
        static_precheck: staticPrecheck,
        is_case_rule: runtimeRule?.is_case_rule,
      };
    });

  return {
    staticRuleAuditResults,
    deterministicRuleResults,
    caseRuleResults,
    assistedRuleCandidates,
    ruleViolations,
    ruleEvidenceIndex,
    evidenceSummary: evidence.summary,
  };
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
