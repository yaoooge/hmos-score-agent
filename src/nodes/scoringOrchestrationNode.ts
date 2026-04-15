import { ScoreGraphState } from "../workflow/state.js";

export async function scoringOrchestrationNode(
  state: ScoreGraphState,
): Promise<Partial<ScoreGraphState>> {
  const hardGateTriggered = false;
  const totalScore = state.taskType === "bug_fix" ? 75 : state.taskType === "continuation" ? 78 : 80;
  return {
    scoreComputation: {
      totalScore,
      hardGateTriggered,
      hardGateReason: hardGateTriggered ? "Skeleton placeholder" : undefined,
    },
  };
}
