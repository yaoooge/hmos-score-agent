import { collectEvidence } from "./evidenceCollector.js";
import { listRegisteredRules } from "./engine/rulePackRegistry.js";
import type { RegisteredRule } from "./engine/ruleTypes.js";
import { runProjectStructureRule } from "./evaluators/projectStructureEvaluator.js";
import type { EvaluatedRule } from "./evaluators/shared.js";
import { runTextPatternRule } from "./evaluators/textPatternEvaluator.js";
import {
  AssistedRuleCandidate,
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

export async function runRuleEngine(input: {
  referenceRoot: string;
  caseInput: CaseInput;
  taskType: TaskType;
}): Promise<RuleEngineOutput> {
  const evidence = await collectEvidence(input.caseInput);
  const evaluatedRules = listRegisteredRules().map((rule) => evaluateRegisteredRule(rule, evidence));

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
          .map((relativePath) => evidence.workspaceFiles.find((file) => file.relativePath === relativePath)?.content ?? "")
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
      .map((relativePath) => evidence.workspaceFiles.find((file) => file.relativePath === relativePath)?.content ?? "")
      .filter(Boolean)
      .map((content) => content.slice(0, 200)),
  };

  const staticRuleAuditResults: StaticRuleAuditResult[] = evaluatedRules.map(({ matchedFiles: _matchedFiles, ...rule }) => rule);
  const deterministicRuleResults: RuleAuditResult[] = staticRuleAuditResults.filter(
    (rule): rule is RuleAuditResult => rule.result !== "未接入判定器",
  );
  const assistedRuleCandidates: AssistedRuleCandidate[] = staticRuleAuditResults
    .filter((rule) => rule.result === "未接入判定器")
    .map((rule) => ({
      rule_id: rule.rule_id,
      rule_source: rule.rule_source,
      why_uncertain: rule.conclusion,
      local_preliminary_signal: "未接入判定器",
      evidence_files:
        ruleEvidenceIndex[rule.rule_id]?.evidenceFiles?.length
          ? ruleEvidenceIndex[rule.rule_id].evidenceFiles
          : fallbackEvidenceFiles,
      evidence_snippets:
        ruleEvidenceIndex[rule.rule_id]?.evidenceSnippets?.length
          ? ruleEvidenceIndex[rule.rule_id].evidenceSnippets
          : ruleEvidenceIndex.__fallback__?.evidenceSnippets ?? [],
    }));

  return {
    staticRuleAuditResults,
    deterministicRuleResults,
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
