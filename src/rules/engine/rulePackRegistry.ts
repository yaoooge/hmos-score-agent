import path from "node:path";
import type { RegisteredRule, RegisteredRulePack } from "./ruleTypes.js";
import type { CrossDeviceAdaptationUnderstanding } from "../../types.js";
import { loadRegisteredRulePacksFromYamlDirectory } from "./rulePackYamlLoader.js";

const registeredRulePacks: RegisteredRulePack[] = loadRegisteredRulePacksFromYamlDirectory(
  path.resolve(process.cwd(), "references/rules"),
);

export const defaultEnabledRulePackIds = ["arkts-language", "arkts-performance"] as const;
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
  input: RegisteredRule[] | { enabledPackIds?: string[]; runtimeRules?: RegisteredRule[] } = [],
): RegisteredRule[] {
  if (Array.isArray(input)) {
    return [...registeredRulePacks.flatMap((pack) => pack.rules), ...input];
  }

  const packs = input.enabledPackIds
    ? getEnabledRulePacks(input.enabledPackIds)
    : registeredRulePacks;
  return [...packs.flatMap((pack) => pack.rules), ...(input.runtimeRules ?? [])];
}
