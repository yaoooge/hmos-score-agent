import { runRuleEngine } from "../rules/ruleEngine.js";
import { ScoreGraphState } from "../workflow/state.js";

export async function ruleAuditNode(
  state: ScoreGraphState,
  config: { referenceRoot: string },
): Promise<Partial<ScoreGraphState>> {
  const result = await runRuleEngine({
    referenceRoot: config.referenceRoot,
    caseInput: state.caseInput,
    taskType: state.taskType,
  });

  return {
    ruleAuditResults: result.ruleAuditResults,
    ruleEvidenceIndex: result.ruleEvidenceIndex,
    ruleViolations: result.ruleViolations,
    evidenceSummary: result.evidenceSummary,
  };
}
