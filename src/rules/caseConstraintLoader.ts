import fs from "node:fs/promises";
import { load } from "js-yaml";
import type { CaseConstraintPriority, CaseInput, CaseRuleDefinition } from "../types.js";

type SupportedRuleSource = CaseRuleDefinition["rule_source"];

interface RawCaseConstraintFile {
  constraints: RawConstraint[];
}

interface RawConstraint {
  id: string;
  name: string;
  description?: string;
  priority: CaseConstraintPriority;
  kit?: string[];
  rules: RawConstraintRule[];
}

interface RawConstraintRule {
  target: string;
  ast?: unknown;
  llm?: string;
}

const TOP_LEVEL_KEYS = ["constraints"];
const CONSTRAINT_KEYS = ["id", "name", "description", "priority", "kit", "rules"];
const RULE_KEYS = ["target", "ast", "llm"];

export async function loadCaseConstraintRules(caseInput: CaseInput): Promise<CaseRuleDefinition[]> {
  if (!caseInput.expectedConstraintsPath) {
    return [];
  }

  const rawText = await fs.readFile(caseInput.expectedConstraintsPath, "utf-8");
  const parsed = load(rawText);
  const document = parseConstraintFile(parsed);

  return document.constraints.map((constraint) => {
    const targetChecks = constraint.rules.map((rule) => ({
      target: rule.target,
      astSignals: normalizeAstSignals(rule.ast),
      llmPrompt: rule.llm ?? "",
    }));
    const targetPatterns = constraint.rules.map((rule) => rule.target);
    const astSignals = targetChecks.flatMap((check) => check.astSignals);
    const llmPrompt = formatCombinedLlmPrompt(targetChecks);

    const detectorConfig: CaseRuleDefinition["detector_config"] = {
      targetPatterns,
      astSignals,
      llmPrompt,
      ...(constraint.kit ? { kit: constraint.kit } : {}),
      ...(targetChecks.length > 1 || constraint.kit ? { targetChecks } : {}),
    };

    return {
      pack_id: `case-${caseInput.caseId}`,
      rule_id: constraint.id,
      rule_name: constraint.name,
      rule_source: mapPriorityToRuleSource(constraint.priority),
      summary: constraint.description?.trim() || constraint.name,
      priority: constraint.priority,
      detector_kind: "case_constraint",
      detector_config: detectorConfig,
      fallback_policy: "agent_assisted",
      is_case_rule: true,
    };
  });
}

function parseConstraintFile(value: unknown): RawCaseConstraintFile {
  if (Array.isArray(value)) {
    return {
      constraints: value.map((constraint, index) => parseConstraint(constraint, `[${index}]`)),
    };
  }

  const root = expectRecord(value, "root");
  assertSupportedKeys(root, TOP_LEVEL_KEYS, "root");

  if (!Array.isArray(root.constraints)) {
    throw new Error("constraints must be an array");
  }

  return {
    constraints: root.constraints.map((constraint, index) =>
      parseConstraint(constraint, `constraints[${index}]`),
    ),
  };
}

function parseConstraint(value: unknown, location: string): RawConstraint {
  const constraint = expectRecord(value, location);
  assertSupportedKeys(constraint, CONSTRAINT_KEYS, location);

  const priority = parsePriority(constraint.priority, `${location}.priority`);
  const rules = parseRules(constraint.rules, `${location}.rules`);

  return {
    id: expectString(constraint.id, `${location}.id`),
    name: expectString(constraint.name, `${location}.name`),
    description:
      constraint.description === undefined
        ? undefined
        : expectString(constraint.description, `${location}.description`),
    kit:
      constraint.kit === undefined
        ? undefined
        : parseOptionalStringArray(constraint.kit),
    priority,
    rules,
  };
}

function parseRules(value: unknown, location: string): RawConstraintRule[] {
  if (!Array.isArray(value)) {
    throw new Error(`${location} must be an array`);
  }

  return value.map((rule, index) => parseRule(rule, `${location}[${index}]`));
}

function parseRule(value: unknown, location: string): RawConstraintRule {
  const rule = expectRecord(value, location);
  assertSupportedKeys(rule, RULE_KEYS, location);

  let ast: unknown;
  if (rule.ast !== undefined) {
    if (!Array.isArray(rule.ast)) {
      throw new Error(`${location}.ast must be an array`);
    }
    ast = rule.ast;
  }

  let llm: string | undefined;
  if (rule.llm !== undefined) {
    llm = expectString(rule.llm, `${location}.llm`);
  }

  return {
    target: expectString(rule.target, `${location}.target`),
    ast,
    llm,
  };
}

function normalizeAstSignals(value: unknown): Array<Record<string, string>> {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error("ast must be an array");
  }

  return value.map((entry, index) => {
    const signal = expectRecord(entry, `ast[${index}]`);
    return Object.fromEntries(
      Object.entries(signal).map(([key, fieldValue]) => [
        key,
        expectString(fieldValue, `ast[${index}].${key}`),
      ]),
    );
  });
}

function formatCombinedLlmPrompt(
  targetChecks: Array<{ target: string; llmPrompt: string }>,
): string {
  const checksWithPrompt = targetChecks.filter((check) => check.llmPrompt.length > 0);
  if (checksWithPrompt.length === 0) {
    return "";
  }
  if (checksWithPrompt.length === 1) {
    return checksWithPrompt[0]?.llmPrompt ?? "";
  }
  return checksWithPrompt
    .map((check) => `${check.target}: ${check.llmPrompt}`)
    .join("\n");
}

function parsePriority(value: unknown, location: string): CaseConstraintPriority {
  const priority = expectString(value, location);
  if (priority !== "P0" && priority !== "P1") {
    throw new Error(`${location} must be P0 or P1`);
  }
  return priority;
}

function mapPriorityToRuleSource(priority: CaseConstraintPriority): SupportedRuleSource {
  return priority === "P0" ? "must_rule" : "should_rule";
}

function assertSupportedKeys(
  record: Record<string, unknown>,
  supportedKeys: string[],
  location: string,
): void {
  for (const key of Object.keys(record)) {
    if (!supportedKeys.includes(key)) {
      throw new Error(`Unsupported field at ${location}: ${key}`);
    }
  }
}

function expectRecord(value: unknown, location: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${location} must be an object`);
  }
  return value as Record<string, unknown>;
}

function expectString(value: unknown, location: string): string {
  if (typeof value !== "string") {
    throw new Error(`${location} must be a string`);
  }
  return value;
}

function parseOptionalStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const strings = value.filter((entry): entry is string => typeof entry === "string");
  return strings.length > 0 ? strings : undefined;
}
