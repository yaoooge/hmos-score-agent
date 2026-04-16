import fs from "node:fs/promises";
import path from "node:path";
import { collectEvidence } from "./evidenceCollector.js";
import { evaluateTextRule } from "./textRuleEvaluator.js";
import { CaseInput, RuleAuditResult, RuleEvidenceIndex, RuleViolation, TaskType } from "../types.js";

type RuleDocEntry = {
  id: string;
};

type RulesDoc = {
  must_rules: RuleDocEntry[];
  should_rules: RuleDocEntry[];
  forbidden_patterns: RuleDocEntry[];
};

// Rule engine 的输出会被 workflow 直接写盘并送入 scoring engine。
export interface RuleEngineOutput {
  ruleAuditResults: RuleAuditResult[];
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
  // 这里故意不做完整 YAML 反序列化，只抽取我们当前真正需要的 rule id 顺序。
  const yamlPath = path.join(input.referenceRoot, "arkts_internal_rules.yaml");
  const text = await fs.readFile(yamlPath, "utf-8");
  const doc = parseRulesDoc(text);
  const evidence = await collectEvidence(input.caseInput);

  const evaluateGroup = (
    ruleSource: RuleAuditResult["rule_source"],
    rules: RuleDocEntry[] | undefined,
  ) =>
    (rules ?? []).map((rule) => evaluateTextRule(rule.id, ruleSource, evidence));

  const evaluatedRules = [
    ...evaluateGroup("must_rule", doc.must_rules),
    ...evaluateGroup("should_rule", doc.should_rules),
    ...evaluateGroup("forbidden_pattern", doc.forbidden_patterns),
  ];

  // 违反规则时同步生成更适合 report schema 的 violation 结构。
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

  return {
    ruleAuditResults: evaluatedRules.map(({ supported: _supported, matchedFiles: _matchedFiles, ...rule }) => rule),
    ruleViolations,
    ruleEvidenceIndex,
    evidenceSummary: evidence.summary,
  };
}

function normalizeWorkspaceRelativePath(relativePath: string): string {
  return relativePath.replace(/^workspace\//, "").replace(/^original\//, "");
}

function parseRulesDoc(text: string): RulesDoc {
  // 源规则文件里存在部分对通用 YAML parser 不友好的文本内容，这里走稳妥的分组扫描。
  const doc: RulesDoc = {
    must_rules: [],
    should_rules: [],
    forbidden_patterns: [],
  };
  let currentSection: keyof RulesDoc | null = null;

  for (const line of text.split(/\r?\n/)) {
    if (/^must_rules:\s*$/.test(line)) {
      currentSection = "must_rules";
      continue;
    }
    if (/^should_rules:\s*$/.test(line)) {
      currentSection = "should_rules";
      continue;
    }
    if (/^forbidden_patterns:\s*$/.test(line)) {
      currentSection = "forbidden_patterns";
      continue;
    }

    const match = line.match(/^\s*-\s+id:\s+([A-Z0-9-]+)/);
    if (currentSection && match) {
      doc[currentSection].push({ id: match[1] });
    }
  }

  return doc;
}
