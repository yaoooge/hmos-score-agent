import { buildHtmlReportViewModel } from "../report/renderer/buildHtmlReportViewModel.js";
import { renderHtmlReport } from "../report/renderer/renderHtmlReport.js";
import { emitNodeFailed, emitNodeStarted } from "../workflow/observability/nodeCustomEvents.js";
import { ScoreGraphState } from "../workflow/state.js";

export async function artifactPostProcessNode(state: ScoreGraphState): Promise<Partial<ScoreGraphState>> {
  emitNodeStarted("artifactPostProcessNode");
  try {
    const resultJson =
      typeof state.resultJson === "object" && state.resultJson !== null ? state.resultJson : {};
    const htmlReport = renderHtmlReport(buildHtmlReportViewModel(resultJson));
    return { htmlReport };
  } catch (error) {
    emitNodeFailed("artifactPostProcessNode", error);
    throw error;
  }
}
