import type { RegisteredRule, RegisteredRulePack } from "./ruleTypes.js";
import type { CrossDeviceAdaptationUnderstanding } from "../../types.js";
import { arktsForbiddenRules } from "../packs/arkts-language/forbidden.js";
import { arktsMustRules } from "../packs/arkts-language/must.js";
import { arktsShouldRules } from "../packs/arkts-language/should.js";
import { arktsPerformanceForbiddenRules } from "../packs/arkts-performance/forbidden.js";
import { arktsPerformanceMustRules } from "../packs/arkts-performance/must.js";
import { arktsPerformanceShouldRules } from "../packs/arkts-performance/should.js";
import { crossDeviceAdaptationForbiddenRules } from "../packs/cross-device-adaptation/forbidden.js";
import { crossDeviceAdaptationMustRules } from "../packs/cross-device-adaptation/must.js";
import { crossDeviceAdaptationShouldRules } from "../packs/cross-device-adaptation/should.js";

const registeredRulePacks: RegisteredRulePack[] = [
  {
    packId: "arkts-language",
    displayName: "从 TypeScript 到 ArkTS 的适配规则与 ArkTS 编程规范",
    rules: [...arktsMustRules, ...arktsShouldRules, ...arktsForbiddenRules],
  },
  {
    packId: "arkts-performance",
    displayName: "ArkTS 高性能编程实践",
    rules: [
      ...arktsPerformanceMustRules,
      ...arktsPerformanceShouldRules,
      ...arktsPerformanceForbiddenRules,
    ],
  },
  {
    packId: "cross-device-adaptation",
    displayName: "HarmonyOS 一多适配通用规则",
    rules: [
      ...crossDeviceAdaptationMustRules,
      ...crossDeviceAdaptationShouldRules,
      ...crossDeviceAdaptationForbiddenRules,
    ],
  },
];

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
