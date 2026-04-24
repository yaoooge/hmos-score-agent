import path from "node:path";
import type { RegisteredRule } from "../engine/ruleTypes.js";
import type { CollectedEvidence } from "../evidenceCollector.js";
import type { EvaluatedRule } from "./shared.js";

function compilePatterns(patterns: string[]): RegExp[] {
  return patterns.map((pattern) => new RegExp(pattern, "m"));
}

function shouldKeepComments(patterns: string[]): boolean {
  return patterns.some(
    (pattern) => pattern.includes("@ts-ignore") || pattern.includes("@ts-nocheck"),
  );
}

function matchesAnyPattern(patterns: RegExp[], content: string): boolean {
  return patterns.some((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(content);
  });
}

function splitLines(source: string): string[] {
  return source.split(/\r?\n/);
}

// stripCommentsPreserveLayout 仅移除注释内容，并尽量保留换行与列宽，避免影响按行规则。
function stripCommentsPreserveLayout(source: string): string {
  let result = "";
  let index = 0;
  let inLineComment = false;
  let inBlockComment = false;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inTemplateString = false;
  let escaped = false;

  while (index < source.length) {
    const current = source[index] ?? "";
    const next = source[index + 1] ?? "";

    if (inLineComment) {
      if (current === "\n") {
        inLineComment = false;
        result += "\n";
      } else {
        result += " ";
      }
      index += 1;
      continue;
    }

    if (inBlockComment) {
      if (current === "*" && next === "/") {
        result += "  ";
        inBlockComment = false;
        index += 2;
        continue;
      }
      result += current === "\n" ? "\n" : " ";
      index += 1;
      continue;
    }

    if (inSingleQuote || inDoubleQuote || inTemplateString) {
      result += current;
      if (escaped) {
        escaped = false;
      } else if (current === "\\") {
        escaped = true;
      } else if (
        (inSingleQuote && current === "'") ||
        (inDoubleQuote && current === '"') ||
        (inTemplateString && current === "`")
      ) {
        inSingleQuote = false;
        inDoubleQuote = false;
        inTemplateString = false;
      }
      index += 1;
      continue;
    }

    if (current === "/" && next === "/") {
      result += "  ";
      inLineComment = true;
      index += 2;
      continue;
    }

    if (current === "/" && next === "*") {
      result += "  ";
      inBlockComment = true;
      index += 2;
      continue;
    }

    if (current === "'") {
      inSingleQuote = true;
      result += current;
      index += 1;
      continue;
    }

    if (current === '"') {
      inDoubleQuote = true;
      result += current;
      index += 1;
      continue;
    }

    if (current === "`") {
      inTemplateString = true;
      result += current;
      index += 1;
      continue;
    }

    result += current;
    index += 1;
  }

  return result;
}

interface TextPatternMatch {
  relativePath: string;
  lineLocations: string[];
  lineSnippets: string[];
}

function findTextPatternMatch(
  file: CollectedEvidence["workspaceFiles"][number],
  patterns: RegExp[],
  keepComments: boolean,
): TextPatternMatch | undefined {
  const normalizedContent = keepComments ? file.content : stripCommentsPreserveLayout(file.content);

  if (!matchesAnyPattern(patterns, normalizedContent)) {
    return undefined;
  }

  const originalLines = splitLines(file.content);
  const normalizedLines = splitLines(normalizedContent);
  const seenLocations = new Set<string>();
  const lineLocations: string[] = [];
  const lineSnippets: string[] = [];

  normalizedLines.forEach((line, index) => {
    if (!matchesAnyPattern(patterns, line)) {
      return;
    }

    const lineNumber = index + 1;
    const location = `${file.relativePath}:${lineNumber}`;
    if (seenLocations.has(location)) {
      return;
    }

    seenLocations.add(location);
    lineLocations.push(location);
    lineSnippets.push(`${location}: ${(originalLines[index] ?? "").trim()}`);
  });

  return {
    relativePath: file.relativePath,
    lineLocations,
    lineSnippets,
  };
}

// 文本规则完全由规则包中的 detector_config 驱动。
export function runTextPatternRule(
  rule: RegisteredRule,
  evidence: CollectedEvidence,
): EvaluatedRule {
  const fileExtensions = ((rule.detector_config.fileExtensions as string[] | undefined) ?? []).map(
    (item) => item.toLowerCase(),
  );
  const applicabilityPatternTexts = (
    (rule.detector_config.applicabilityPatterns as string[] | undefined) ?? []
  ).filter(Boolean);
  const patternTexts = ((rule.detector_config.patterns as string[] | undefined) ?? []).filter(
    Boolean,
  );
  const applicabilityPatterns = compilePatterns(applicabilityPatternTexts);
  const patterns = compilePatterns(patternTexts);
  const keepComments = shouldKeepComments([...applicabilityPatternTexts, ...patternTexts]);
  const candidateFiles = evidence.workspaceFiles.filter((file) =>
    fileExtensions.includes(path.extname(file.relativePath).toLowerCase()),
  );
  const applicabilityMatches = candidateFiles
    .map((file) => findTextPatternMatch(file, applicabilityPatterns, keepComments))
    .filter((match): match is TextPatternMatch => Boolean(match));

  if (applicabilityPatterns.length > 0 && applicabilityMatches.length === 0) {
    return {
      rule_id: rule.rule_id,
      rule_source: rule.rule_source,
      result: "不涉及",
      conclusion: "未发现该规则的适用场景。",
      matchedFiles: [],
      matchedLocations: [],
      matchedSnippets: [],
    };
  }

  const matches = candidateFiles
    .map((file) => findTextPatternMatch(file, patterns, keepComments))
    .filter((match): match is TextPatternMatch => Boolean(match));
  const matchedFiles = matches.map((match) => match.relativePath);
  const matchedLocations = matches.flatMap((match) => match.lineLocations);
  const matchedSnippets = matches.flatMap((match) => match.lineSnippets);
  const conclusionLocations = matchedLocations.length > 0 ? matchedLocations : matchedFiles;

  return {
    rule_id: rule.rule_id,
    rule_source: rule.rule_source,
    result: matchedFiles.length > 0 ? "不满足" : "满足",
    conclusion:
      matchedFiles.length > 0
        ? `${rule.summary} 检测到规则命中，文件：${conclusionLocations.join(", ")}`
        : applicabilityPatterns.length > 0
          ? "检测到规则适用场景，未发现违规命中。"
          : "未发现该规则的命中证据。",
    matchedFiles,
    matchedLocations,
    matchedSnippets,
  };
}
