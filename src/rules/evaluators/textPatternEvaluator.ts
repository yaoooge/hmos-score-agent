import path from "node:path";
import type { RegisteredRule } from "../engine/ruleTypes.js";
import type { CollectedEvidence } from "../evidenceCollector.js";
import type { EvaluatedRule } from "./shared.js";

function compilePatterns(patterns: string[]): RegExp[] {
  return patterns.map((pattern) => new RegExp(pattern, "m"));
}

function shouldKeepComments(patterns: string[]): boolean {
  return patterns.some((pattern) => pattern.includes("@ts-ignore") || pattern.includes("@ts-nocheck"));
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
      } else if ((inSingleQuote && current === "'") || (inDoubleQuote && current === "\"") || (inTemplateString && current === "`")) {
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

    if (current === "\"") {
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

// 文本规则完全由规则包中的 detector_config 驱动。
export function runTextPatternRule(rule: RegisteredRule, evidence: CollectedEvidence): EvaluatedRule {
  const fileExtensions = ((rule.detector_config.fileExtensions as string[] | undefined) ?? []).map((item) =>
    item.toLowerCase(),
  );
  const patternTexts = ((rule.detector_config.patterns as string[] | undefined) ?? []).filter(Boolean);
  const patterns = compilePatterns(patternTexts);
  const keepComments = shouldKeepComments(patternTexts);

  const matchedFiles = evidence.workspaceFiles
    .filter((file) => fileExtensions.includes(path.extname(file.relativePath).toLowerCase()))
    .filter((file) => {
      const normalizedContent = keepComments ? file.content : stripCommentsPreserveLayout(file.content);
      return patterns.some((pattern) => pattern.test(normalizedContent));
    })
    .map((file) => file.relativePath);

  return {
    rule_id: rule.rule_id,
    rule_source: rule.rule_source,
    result: matchedFiles.length > 0 ? "不满足" : "满足",
    conclusion: matchedFiles.length > 0 ? `${rule.summary} 检测到规则命中，文件：${matchedFiles.join(", ")}` : "未发现该规则的命中证据。",
    matchedFiles,
  };
}
