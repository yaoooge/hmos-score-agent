import type { RegisteredRule } from "../../engine/ruleTypes.js";
import { createAgentAssistedTargetRule } from "../shared/ruleFactories.js";
import { crossDeviceAdaptationRuleData } from "./ruleData.js";

const packId = "cross-device-adaptation";

export const crossDeviceAdaptationMustRules: RegisteredRule[] = crossDeviceAdaptationRuleData
  .filter((rule) => rule.priority === "P0")
  .map((rule) =>
    createAgentAssistedTargetRule({
      packId,
      ruleSource: "must_rule",
      ruleId: rule.id,
      ruleName: rule.name,
      summary: `${rule.name}。${rule.rules.map((check) => check.llmPrompt).join(" ")}`,
      priority: rule.priority,
      kit: rule.kit,
      targetChecks: rule.rules,
    }),
  );
