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

function getKitAnchorTokens(kit: string[]): string[] {
  const tokens = new Set<string>();

  for (const item of kit) {
    const searchablePart = item.includes(":") ? (item.split(":").pop() ?? item) : item;
    const matches = searchablePart.match(/[A-Za-z_$][A-Za-z0-9_$]{2,}/g) ?? [];
    for (const match of matches) {
      if (match.length >= 4) {
        tokens.add(match);
      }
    }
  }

  return [...tokens];
}

function getPatchScopedContent(file: CollectedEvidence["workspaceFiles"][number]): string {
  if (file.patchLineNumbers === undefined) {
    return file.content;
  }

  const lines = file.content.split(/\r?\n/);
  return file.patchLineNumbers.map((lineNumber) => lines[lineNumber - 1] ?? "").join("\n");
}

function buildStaticPrecheck(
  candidateFiles: CollectedEvidence["workspaceFiles"],
  astSignals: Array<Record<string, string>>,
  kit: string[],
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
  const matchedFiles = new Set<string>();
  let matchedSignalCount = 0;
  const kitAnchorTokens = getKitAnchorTokens(kit);
  let matchedKitAnchorCount = 0;

  for (const signal of astSignals) {
    const tokens = getSignalTokens(signal);
    const tokenMatches = tokens.filter((token) => {
      const matchedCandidateFiles = candidateFiles.filter((file) =>
        getPatchScopedContent(file).includes(token),
      );
      for (const file of matchedCandidateFiles) {
        matchedFiles.add(file.relativePath);
      }
      return matchedCandidateFiles.length > 0;
    });

    if (tokenMatches.length === tokens.length && tokens.length > 0) {
      matchedSignalCount += 1;
    }

    for (const token of tokenMatches) {
      matchedTokens.add(token);
    }
  }

  for (const token of kitAnchorTokens) {
    const matchedCandidateFiles = candidateFiles.filter((file) =>
      getPatchScopedContent(file).includes(token),
    );
    if (matchedCandidateFiles.length > 0) {
      matchedKitAnchorCount += 1;
      matchedTokens.add(token);
      for (const file of matchedCandidateFiles) {
        matchedFiles.add(file.relativePath);
      }
    }
  }

  let signalStatus: CaseRuleStaticPrecheck["signal_status"] = "none_matched";
  const hasAllAstSignals =
    matchedSignalCount > 0 && matchedSignalCount === astSignals.length && astSignals.length > 0;
  const hasAllKitAnchors =
    matchedKitAnchorCount > 0 &&
    matchedKitAnchorCount === kitAnchorTokens.length &&
    kitAnchorTokens.length > 0;
  if (hasAllAstSignals || hasAllKitAnchors) {
    signalStatus = "all_matched";
  } else if (matchedSignalCount > 0 || matchedKitAnchorCount > 0) {
    signalStatus = "partial_matched";
  }

  const matchedSignalText =
    astSignals.length > 0 ? `${matchedSignalCount}/${astSignals.length}` : "0/0";
  const kitAnchorText =
    kitAnchorTokens.length > 0
      ? `Kit 静态锚点命中 ${matchedKitAnchorCount}/${kitAnchorTokens.length}。`
      : undefined;
  const summaryParts = [`静态预判在目标文件中命中了 ${matchedSignalText} 个 AST 信号。`];
  if (kitAnchorText) {
    summaryParts.push(kitAnchorText);
  }

  return {
    target_matched: true,
    target_files: targetFiles,
    matched_files: [...matchedFiles],
    signal_status: signalStatus,
    matched_tokens: [...matchedTokens],
    summary: summaryParts.join(" "),
  };
}

export function runCaseConstraintRule(
  rule: RegisteredRule,
  evidence: CollectedEvidence,
): EvaluatedRule {
  const targetPatterns = (rule.detector_config.targetPatterns as string[] | undefined) ?? [];
  const astSignals =
    (rule.detector_config.astSignals as Array<Record<string, string>> | undefined) ?? [];
  const kit = (rule.detector_config.kit as string[] | undefined) ?? [];
  const candidateFiles = evidence.workspaceFiles.filter((file) =>
    targetPatterns.some((pattern) => matchesCaseTargetPattern(file.relativePath, pattern)),
  );
  const staticPrecheck = buildStaticPrecheck(candidateFiles, astSignals, kit);

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
