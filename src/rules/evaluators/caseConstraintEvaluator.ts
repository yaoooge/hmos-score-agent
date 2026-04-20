import type { RegisteredRule } from "../engine/ruleTypes.js";
import type { CollectedEvidence } from "../evidenceCollector.js";
import type { EvaluatedRule } from "./shared.js";
import type { CaseRuleStaticPrecheck } from "../../types.js";

function escapeRegex(value: string): string {
  return value.replace(/[.+^${}()|[\]\\]/g, "\\$&");
}

function globToRegExp(pattern: string): RegExp {
  let regex = "^";

  for (let index = 0; index < pattern.length; ) {
    const current = pattern[index] ?? "";
    const next = pattern[index + 1] ?? "";

    if (current === "*" && next === "*") {
      regex += ".*";
      index += 2;
      continue;
    }

    if (current === "*") {
      regex += "[^/]*";
      index += 1;
      continue;
    }

    regex += escapeRegex(current);
    index += 1;
  }

  regex += "$";
  return new RegExp(regex);
}

function matchesCaseTargetPattern(relativePath: string, pattern: string): boolean {
  return globToRegExp(pattern).test(relativePath);
}

function getSignalTokens(signal: Record<string, string>): string[] {
  return Object.entries(signal)
    .filter(([key]) => key !== "type")
    .map(([, value]) => value)
    .filter(Boolean);
}

function buildStaticPrecheck(
  candidateFiles: CollectedEvidence["workspaceFiles"],
  astSignals: Array<Record<string, string>>,
): CaseRuleStaticPrecheck {
  const targetFiles = candidateFiles.map((file) => file.relativePath);
  if (candidateFiles.length === 0) {
    return {
      target_matched: false,
      target_files: [],
      signal_status: "no_target_files",
      matched_tokens: [],
      summary: "静态预判未找到匹配目标文件。",
    };
  }

  const matchedTokens = new Set<string>();
  let matchedSignalCount = 0;

  for (const signal of astSignals) {
    const tokens = getSignalTokens(signal);
    const tokenMatches = tokens.filter((token) =>
      candidateFiles.some((file) => file.content.includes(token)),
    );

    if (tokenMatches.length === tokens.length && tokens.length > 0) {
      matchedSignalCount += 1;
    }

    for (const token of tokenMatches) {
      matchedTokens.add(token);
    }
  }

  let signalStatus: CaseRuleStaticPrecheck["signal_status"] = "none_matched";
  if (matchedSignalCount > 0 && matchedSignalCount === astSignals.length && astSignals.length > 0) {
    signalStatus = "all_matched";
  } else if (matchedSignalCount > 0) {
    signalStatus = "partial_matched";
  }

  const matchedSignalText =
    astSignals.length > 0 ? `${matchedSignalCount}/${astSignals.length}` : "0/0";

  return {
    target_matched: true,
    target_files: targetFiles,
    signal_status: signalStatus,
    matched_tokens: [...matchedTokens],
    summary: `静态预判在目标文件中命中了 ${matchedSignalText} 个 AST 信号。`,
  };
}

export function runCaseConstraintRule(
  rule: RegisteredRule,
  evidence: CollectedEvidence,
): EvaluatedRule {
  const targetPatterns = (rule.detector_config.targetPatterns as string[] | undefined) ?? [];
  const astSignals =
    (rule.detector_config.astSignals as Array<Record<string, string>> | undefined) ?? [];
  const candidateFiles = evidence.workspaceFiles.filter((file) =>
    targetPatterns.some((pattern) => matchesCaseTargetPattern(file.relativePath, pattern)),
  );
  const staticPrecheck = buildStaticPrecheck(candidateFiles, astSignals);

  return {
    rule_id: rule.rule_id,
    rule_source: rule.rule_source,
    result: "未接入判定器",
    conclusion: `${staticPrecheck.summary} 仅作为辅助证据，不作为最终结论。`,
    matchedFiles: staticPrecheck.target_files,
    preliminaryData: {
      static_precheck: staticPrecheck,
    },
  };
}
