import { ArtifactStore } from "../io/artifactStore.js";
import { emitNodeFailed, emitNodeStarted } from "../workflow/observability/nodeCustomEvents.js";
import { ScoreGraphState } from "../workflow/state.js";

export async function persistAndUploadNode(
  state: ScoreGraphState,
  deps: {
    artifactStore: ArtifactStore;
  },
): Promise<Partial<ScoreGraphState>> {
  emitNodeStarted("persistAndUploadNode");
  try {
    await deps.artifactStore.writeText(
      state.caseDir,
      "inputs/rubric-scoring-prompt.txt",
      state.rubricScoringPromptText ?? "",
    );
    await deps.artifactStore.writeJson(
      state.caseDir,
      "inputs/rubric-scoring-payload.json",
      state.rubricScoringPayload ?? {},
    );
    await deps.artifactStore.writeText(
      state.caseDir,
      "inputs/rule-agent-prompt.txt",
      state.ruleAgentPromptText ?? "",
    );
    await deps.artifactStore.writeJson(
      state.caseDir,
      "inputs/rule-agent-bootstrap-payload.json",
      state.ruleAgentBootstrapPayload ?? {},
    );
    await deps.artifactStore.writeJson(
      state.caseDir,
      "intermediate/constraint-summary.json",
      state.constraintSummary,
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
      "intermediate/rubric-agent-result.json",
      {
        status: state.rubricAgentRunStatus ?? "skipped",
        raw_text: state.rubricAgentRawText ?? "",
        parsed_result: state.rubricScoringResult ?? null,
        runner_result:
          state.rubricAgentRunnerResult ?? {
            outcome:
              state.rubricAgentRunStatus === "skipped" || state.rubricAgentRunStatus === "not_enabled"
                ? state.rubricAgentRunStatus
                : "protocol_error",
            turns: state.rubricAgentTurns ?? [],
            tool_trace: state.rubricAgentToolTrace ?? [],
        },
      },
    );
    await deps.artifactStore.writeJson(
      state.caseDir,
      "intermediate/rule-agent-result.json",
      state.ruleAgentRunnerResult ?? {
        outcome:
          state.ruleAgentRunStatus === "skipped" || state.ruleAgentRunStatus === "not_enabled"
            ? state.ruleAgentRunStatus
            : "protocol_error",
        turns: state.ruleAgentTurns ?? [],
        tool_trace: state.ruleAgentToolTrace ?? [],
      },
    );
    await deps.artifactStore.writeJson(
      state.caseDir,
      "intermediate/rule-audit-merged.json",
      state.mergedRuleAuditResults ?? state.deterministicRuleResults ?? [],
    );
    await deps.artifactStore.writeJson(
      state.caseDir,
      "intermediate/score-fusion.json",
      state.scoreComputation?.scoreFusionDetails ?? [],
    );
    await deps.artifactStore.writeJson(state.caseDir, "intermediate/report-schema-version.json", {
      schema_version: "v1",
      result_schema: "report_result_schema.json",
    });
    await deps.artifactStore.writeJson(state.caseDir, "outputs/result.json", state.resultJson);
    await deps.artifactStore.writeText(state.caseDir, "outputs/report.html", state.htmlReport);

    return {
      resultJson: state.resultJson,
      htmlReport: state.htmlReport,
    };
  } catch (error) {
    emitNodeFailed("persistAndUploadNode", error);
    throw error;
  }
}
