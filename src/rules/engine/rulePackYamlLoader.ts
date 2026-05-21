import fs from "node:fs";
import path from "node:path";
import { load } from "js-yaml";
import type {
  DetectorKind,
  RegisteredRule,
  RegisteredRulePack,
  RuleDecisionCriteria,
  RuleSource,
} from "./ruleTypes.js";

const RULE_PACK_FILE_ORDER = [
  "arkts-language.yaml",
  "arkts-performance.yaml",
  "cross-device-adaptation.yaml",
];

const ROOT_KEYS = ["name", "version", "summary", "rule_pack_meta", "must_rules", "should_rules", "forbidden_patterns"];
const RULE_PACK_META_KEYS = ["pack_id", "source_name", "source_version"];
const RULE_KEYS = ["id", "rule", "detector_kind", "detector_config", "fallback_policy", "rule_name", "priority", "decision_criteria"];
const DECISION_CRITERIA_KEYS = ["pass", "fail", "not_applicable", "review"];
const ALLOWED_DETECTOR_KINDS: DetectorKind[] = [
  "text_pattern",
  "project_structure",
  "case_constraint",
  "not_implemented",
];
const ALLOWED_FALLBACK_POLICIES = ["agent_assisted", "not_applicable"] as const;

type RawRulePackDoc = Record<string, unknown>;

export function loadRegisteredRulePacksFromYamlDirectory(directoryPath: string): RegisteredRulePack[] {
  if (!fs.existsSync(directoryPath)) {
    return [];
  }

  const files = fs
    .readdirSync(directoryPath)
    .filter((fileName) => fileName.endsWith(".yaml"))
    .sort((left, right) => {
      const leftIndex = RULE_PACK_FILE_ORDER.indexOf(left);
      const rightIndex = RULE_PACK_FILE_ORDER.indexOf(right);
      if (leftIndex !== -1 || rightIndex !== -1) {
        return (leftIndex === -1 ? Number.POSITIVE_INFINITY : leftIndex) - (rightIndex === -1 ? Number.POSITIVE_INFINITY : rightIndex);
      }
      return left.localeCompare(right);
    });

  return files.flatMap((fileName) => loadRegisteredRulePackFromYamlFile(path.join(directoryPath, fileName)));
}

function loadRegisteredRulePackFromYamlFile(filePath: string): RegisteredRulePack[] {
  const rawText = fs.readFileSync(filePath, "utf-8");
  const parsed = load(rawText);
  const document = parseRulePackDocument(parsed, filePath);
  return [document];
}

function parseRulePackDocument(value: unknown, location: string): RegisteredRulePack {
  const root = expectRecord(value, location);
  assertSupportedKeys(root, ROOT_KEYS, location);

  const meta = expectRecord(root.rule_pack_meta, `${location}.rule_pack_meta`);
  assertSupportedKeys(meta, RULE_PACK_META_KEYS, `${location}.rule_pack_meta`);

  const packId = expectString(meta.pack_id, `${location}.rule_pack_meta.pack_id`);
  const name = expectString(root.name, `${location}.name`);

  return {
    packId,
    displayName: name,
    rules: [
      ...parseRuleGroup(root.must_rules, "must_rule", packId, `${location}.must_rules`),
      ...parseRuleGroup(root.should_rules, "should_rule", packId, `${location}.should_rules`),
      ...parseRuleGroup(root.forbidden_patterns, "forbidden_pattern", packId, `${location}.forbidden_patterns`),
    ],
  };
}

function parseRuleGroup(
  value: unknown,
  ruleSource: RuleSource,
  packId: string,
  location: string,
): RegisteredRule[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error(`${location} must be an array`);
  }

  return value.map((rule, index) => parseRule(rule, ruleSource, packId, `${location}[${index}]`));
}

function parseRule(
  value: unknown,
  ruleSource: RuleSource,
  packId: string,
  location: string,
): RegisteredRule {
  const rule = expectRecord(value, location);
  assertSupportedKeys(rule, RULE_KEYS, location);

  const detectorKind = expectDetectorKind(rule.detector_kind, `${location}.detector_kind`);
  const fallbackPolicy = expectFallbackPolicy(rule.fallback_policy, `${location}.fallback_policy`);
  const detectorConfig = expectRecord(rule.detector_config, `${location}.detector_config`);
  const ruleSummary = expectString(rule.rule, `${location}.rule`);
  const normalizedDetectorConfig = normalizeDetectorConfig(detectorConfig);
  const inferredRuleName =
    rule.rule_name === undefined && detectorKind === "case_constraint"
      ? inferRuleName(ruleSummary)
      : undefined;
  const inferredPriority =
    rule.priority === undefined && detectorKind === "case_constraint"
      ? inferPriority(ruleSource)
      : undefined;

  return {
    pack_id: packId,
    rule_id: expectString(rule.id, `${location}.id`),
    rule_source: ruleSource,
    summary: ruleSummary,
    detector_kind: detectorKind,
    detector_config: normalizedDetectorConfig,
    fallback_policy: fallbackPolicy,
    ...(rule.rule_name === undefined
      ? inferredRuleName === undefined
        ? {}
        : { rule_name: inferredRuleName }
      : { rule_name: expectString(rule.rule_name, `${location}.rule_name`) }),
    ...(rule.priority === undefined
      ? inferredPriority === undefined
        ? {}
        : { priority: inferredPriority }
      : { priority: expectPriority(rule.priority, `${location}.priority`) }),
    ...(rule.decision_criteria === undefined
      ? {}
      : { decision_criteria: parseDecisionCriteria(rule.decision_criteria, `${location}.decision_criteria`) }),
  };
}

function normalizeDetectorConfig(record: Record<string, unknown>): Record<string, unknown> {
  return { ...record };
}

function inferRuleName(summary: string): string {
  return summary.split("。", 1)[0]?.trim() || summary;
}

function inferPriority(ruleSource: RuleSource): "P0" | "P1" | undefined {
  if (ruleSource === "must_rule") {
    return "P0";
  }
  if (ruleSource === "should_rule") {
    return "P1";
  }
  return undefined;
}

function parseDecisionCriteria(value: unknown, location: string): RuleDecisionCriteria {
  const record = expectRecord(value, location);
  assertSupportedKeys(record, DECISION_CRITERIA_KEYS, location);

  return {
    ...(record.pass === undefined ? {} : { pass: expectStringArray(record.pass, `${location}.pass`) }),
    ...(record.fail === undefined ? {} : { fail: expectStringArray(record.fail, `${location}.fail`) }),
    ...(record.not_applicable === undefined
      ? {}
      : { not_applicable: expectStringArray(record.not_applicable, `${location}.not_applicable`) }),
    ...(record.review === undefined
      ? {}
      : { review: expectStringArray(record.review, `${location}.review`) }),
  };
}

function expectDetectorKind(value: unknown, location: string): DetectorKind {
  const detectorKind = expectString(value, location);
  if (!ALLOWED_DETECTOR_KINDS.includes(detectorKind as DetectorKind)) {
    throw new Error(`${location} must be one of ${ALLOWED_DETECTOR_KINDS.join(", ")}`);
  }
  return detectorKind as DetectorKind;
}

function expectFallbackPolicy(value: unknown, location: string): "agent_assisted" | "not_applicable" {
  const fallbackPolicy = expectString(value, location);
  if (!ALLOWED_FALLBACK_POLICIES.includes(fallbackPolicy as "agent_assisted" | "not_applicable")) {
    throw new Error(`${location} must be agent_assisted or not_applicable`);
  }
  return fallbackPolicy as "agent_assisted" | "not_applicable";
}

function expectPriority(value: unknown, location: string): "P0" | "P1" {
  const priority = expectString(value, location);
  if (priority !== "P0" && priority !== "P1") {
    throw new Error(`${location} must be P0 or P1`);
  }
  return priority;
}

function expectStringArray(value: unknown, location: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`${location} must be an array`);
  }
  const entries = value.filter((item): item is string => typeof item === "string");
  if (entries.length !== value.length) {
    throw new Error(`${location} must only contain strings`);
  }
  return entries;
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
