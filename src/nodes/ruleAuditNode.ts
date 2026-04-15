import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import { ScoreGraphState } from "../workflow/state.js";
import { RuleAuditResult } from "../types.js";

type RulesDoc = {
  must_rules?: Array<{ id: string }>;
  should_rules?: Array<{ id: string }>;
  forbidden_patterns?: Array<{ id: string }>;
};

export async function ruleAuditNode(
  state: ScoreGraphState,
  config: { referenceRoot: string },
): Promise<Partial<ScoreGraphState>> {
  const yamlPath = path.join(config.referenceRoot, "arkts_internal_rules.yaml");
  const text = await fs.readFile(yamlPath, "utf-8");
  let doc: RulesDoc = {};
  try {
    doc = (yaml.load(text) as RulesDoc) ?? {};
  } catch {
    // Keep workflow runnable even if upstream YAML contains edge-case syntax.
    doc = {};
  }

  const toResult = (
    source: RuleAuditResult["rule_source"],
    rules: Array<{ id: string }> | undefined,
  ): RuleAuditResult[] =>
    (rules ?? []).map((r) => ({
      rule_id: r.id,
      rule_source: source,
      result: "不涉及",
      conclusion: "骨架阶段默认不涉及，待静态证据引擎接入。",
    }));

  return {
    ruleAuditResults: [
      ...toResult("must_rule", doc.must_rules),
      ...toResult("should_rule", doc.should_rules),
      ...toResult("forbidden_pattern", doc.forbidden_patterns),
    ],
    ruleViolations: [],
  };
}
