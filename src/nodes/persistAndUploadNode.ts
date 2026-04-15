import { ArtifactStore } from "../io/artifactStore.js";
import { uploadResultJson } from "../io/uploader.js";
import { ScoreGraphState } from "../workflow/state.js";

export async function persistAndUploadNode(
  state: ScoreGraphState,
  deps: {
    artifactStore: ArtifactStore;
    uploadEndpoint?: string;
    uploadToken?: string;
  },
): Promise<Partial<ScoreGraphState>> {
  await deps.artifactStore.writeJson(state.caseDir, "intermediate/constraint-summary.json", state.constraintSummary);
  await deps.artifactStore.writeJson(state.caseDir, "intermediate/feature-extraction.json", state.featureExtraction);
  await deps.artifactStore.writeJson(state.caseDir, "intermediate/rule-audit.json", state.ruleAuditResults);
  await deps.artifactStore.writeJson(state.caseDir, "outputs/result.json", state.resultJson);
  await deps.artifactStore.writeText(state.caseDir, "outputs/report.html", state.htmlReport);

  const upload = await uploadResultJson(deps.uploadEndpoint, deps.uploadToken, {
    caseId: state.caseInput.caseId,
    fileName: "result.json",
    content: JSON.stringify(state.resultJson),
  });
  return { uploadMessage: upload.message };
}
