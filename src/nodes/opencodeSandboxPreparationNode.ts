import { buildOpencodeSandbox } from "../opencode/sandboxBuilder.js";
import { ScoreGraphState } from "../workflow/state.js";

export async function opencodeSandboxPreparationNode(
  state: ScoreGraphState,
  deps: {
    referenceRoot: string;
  },
): Promise<Partial<ScoreGraphState>> {
  if (state.opencodeSandboxRoot) {
    return {};
  }

  const sandbox = await buildOpencodeSandbox({
    caseDir: state.caseDir,
    generatedProjectPath: state.caseInput.generatedProjectPath,
    originalProjectPath: state.caseInput.originalProjectPath,
    originalProjectProvided: state.caseInput.originalProjectProvided,
    effectivePatchPath: state.effectivePatchPath ?? state.caseInput.patchPath,
    referenceRoot: deps.referenceRoot,
    metadata: {
      case_id: state.caseInput.caseId,
      prompt_text: state.caseInput.promptText,
      original_project_provided: state.caseInput.originalProjectProvided ?? true,
      constraint_summary: state.constraintSummary,
      task_type: state.taskType,
      input_mode: state.inputMode,
    },
  });

  return {
    opencodeSandboxRoot: sandbox.root,
  };
}
