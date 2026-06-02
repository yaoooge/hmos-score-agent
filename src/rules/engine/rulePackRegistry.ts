import path from "node:path";
import type { RegisteredRule, RegisteredRulePack } from "./ruleTypes.js";
import type { CaseRuleDefinition, CrossDeviceAdaptationUnderstanding } from "../../types.js";
import { loadRegisteredRulePacksFromYamlDirectory } from "./rulePackYamlLoader.js";

const registeredRulePacks: RegisteredRulePack[] = loadRegisteredRulePacksFromYamlDirectory(
  path.resolve(process.cwd(), "references/rules"),
);

export const defaultEnabledRulePackIds = ["arkts-language", "arkts-performance", "arkui-extra"] as const;
export const crossDeviceAdaptationRulePackId = "cross-device-adaptation";

export function resolveEnabledRulePackIds(input: {
  crossDeviceAdaptation?: CrossDeviceAdaptationUnderstanding;
}): string[] {
  const packIds: string[] = [...defaultEnabledRulePackIds];
  if (input.crossDeviceAdaptation?.applicability === "involved") {
    packIds.push(crossDeviceAdaptationRulePackId);
  }
  return packIds;
}

export function getRegisteredRulePacks(): RegisteredRulePack[] {
  return registeredRulePacks;
}

export function getEnabledRulePacks(enabledPackIds: string[]): RegisteredRulePack[] {
  const enabledSet = new Set(enabledPackIds);
  return registeredRulePacks.filter((pack) => enabledSet.has(pack.packId));
}

export function listRegisteredRules(
  input: Array<RegisteredRule | CaseRuleDefinition> | { enabledPackIds?: string[]; runtimeRules?: CaseRuleDefinition[] } = [],
): RegisteredRule[] {
  if (Array.isArray(input)) {
    return [...registeredRulePacks.flatMap((pack) => pack.rules), ...input.map(normalizeRuntimeRule)];
  }

  const packs = input.enabledPackIds
    ? getEnabledRulePacks(input.enabledPackIds)
    : registeredRulePacks;
  return [...packs.flatMap((pack) => pack.rules), ...(input.runtimeRules ?? []).map(normalizeRuntimeRule)];
}

function normalizeRuntimeRule(rule: RegisteredRule | CaseRuleDefinition): RegisteredRule {
  if ("detector" in rule) {
    return rule;
  }

  return {
    pack_id: rule.pack_id,
    rule_id: rule.rule_id,
    rule_source: rule.rule_source,
    summary: rule.summary,
    detector: {
      kind: "static",
      mode: "case_constraint_precheck",
      config: rule.detector_config,
    },
    fallback: {
      policy: rule.fallback_policy,
    },
    rule_name: rule.rule_name,
    priority: rule.priority,
    is_case_rule: rule.is_case_rule,
  };
}
