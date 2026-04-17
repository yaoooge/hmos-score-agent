import { ArtifactStore } from "../io/artifactStore.js";
import { uploadResultJson } from "../io/uploader.js";
import { emitNodeFailed, emitNodeStarted } from "../workflow/observability/nodeCustomEvents.js";
import { ScoreGraphState } from "../workflow/state.js";

export async function persistAndUploadNode(
  state: ScoreGraphState,
  deps: {
    artifactStore: ArtifactStore;
    uploadEndpoint?: string;
    uploadToken?: string;
  },
): Promise<Partial<ScoreGraphState>> {
  emitNodeStarted("persistAndUploadNode");
  try {
    await deps.artifactStore.writeText(
      state.caseDir,
      "inputs/agent-prompt.txt",
      state.agentPromptText ?? "",
    );
    await deps.artifactStore.writeJson(
      state.caseDir,
      "inputs/agent-prompt-payload.json",
      state.agentPromptPayload ?? {},
    );
    await deps.artifactStore.writeJson(
      state.caseDir,
      "intermediate/constraint-summary.json",
      state.constraintSummary,
    );
    await deps.artifactStore.writeJson(
      state.caseDir,
      "intermediate/feature-extraction.json",
      state.featureExtraction,
    );
    await deps.artifactStore.writeJson(
      state.caseDir,
      "intermediate/rule-audit.json",
      state.deterministicRuleResults ?? [],
    );
    await deps.artifactStore.writeJson(
      state.caseDir,
      "intermediate/rubric-snapshot.json",
      state.rubricSnapshot ?? {},
    );
    await deps.artifactStore.writeJson(
      state.caseDir,
      "intermediate/agent-assisted-rule-candidates.json",
      state.assistedRuleCandidates ?? [],
    );
    await deps.artifactStore.writeJson(
      state.caseDir,
      "intermediate/agent-assisted-rule-result.json",
      {
        status: state.agentRunStatus ?? "not_enabled",
        raw_output_text: state.agentRawOutputText ?? "",
        parsed_result: state.agentAssistedRuleResults ?? null,
      },
    );
    await deps.artifactStore.writeJson(
      state.caseDir,
      "intermediate/rule-audit-merged.json",
      state.mergedRuleAuditResults ?? state.deterministicRuleResults ?? [],
    );
    await deps.artifactStore.writeJson(state.caseDir, "outputs/result.json", state.resultJson);
    await deps.artifactStore.writeText(state.caseDir, "outputs/report.html", state.htmlReport);

    const upload = await uploadResultJson(deps.uploadEndpoint, deps.uploadToken, {
      caseId: state.caseInput.caseId,
      fileName: "result.json",
      content: JSON.stringify(state.resultJson),
    });
    return { uploadMessage: upload.message };
  } catch (error) {
    emitNodeFailed("persistAndUploadNode", error);
    throw error;
  }
}
