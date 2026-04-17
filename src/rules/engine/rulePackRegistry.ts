import type { RegisteredRule, RegisteredRulePack } from "./ruleTypes.js";
import { arktsForbiddenRules } from "../packs/arkts-language/forbidden.js";
import { arktsMustRules } from "../packs/arkts-language/must.js";
import { arktsShouldRules } from "../packs/arkts-language/should.js";
import { arktsPerformanceForbiddenRules } from "../packs/arkts-performance/forbidden.js";
import { arktsPerformanceMustRules } from "../packs/arkts-performance/must.js";
import { arktsPerformanceShouldRules } from "../packs/arkts-performance/should.js";

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
];

export function getRegisteredRulePacks(): RegisteredRulePack[] {
  return registeredRulePacks;
}

export function listRegisteredRules(): RegisteredRule[] {
  return registeredRulePacks.flatMap((pack) => pack.rules);
}
