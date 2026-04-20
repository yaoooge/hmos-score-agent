import type { RegisteredRule } from "../engine/ruleTypes.js";
import type { CollectedEvidence } from "../evidenceCollector.js";
import type { EvaluatedRule } from "./shared.js";

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

  if (candidateFiles.length === 0) {
    return {
      rule_id: rule.rule_id,
      rule_source: rule.rule_source,
      result: "不满足",
      conclusion: `${rule.summary} 未找到匹配目标文件。`,
      matchedFiles: [],
    };
  }

  const matchedFiles = candidateFiles.map((file) => file.relativePath);
  const hasAllSignals = candidateFiles.some((file) =>
    astSignals.every((signal) =>
      getSignalTokens(signal).every((token) => file.content.includes(token)),
    ),
  );

  if (hasAllSignals) {
    return {
      rule_id: rule.rule_id,
      rule_source: rule.rule_source,
      result: "满足",
      conclusion: "在目标文件中找到了当前约束需要的直接证据。",
      matchedFiles,
    };
  }

  return {
    rule_id: rule.rule_id,
    rule_source: rule.rule_source,
    result: "未接入判定器",
    conclusion: `${rule.summary} 需要结合上下文做语义判定。`,
    matchedFiles,
  };
}
