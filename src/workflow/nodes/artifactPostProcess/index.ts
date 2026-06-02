import { buildHtmlReportViewModel } from "../../../report/html/buildHtmlReportViewModel.js";
import { renderHtmlReport } from "../../../report/html/renderHtmlReport.js";
import { emitNodeFailed, emitNodeStarted } from "../../observability/nodeCustomEvents.js";
import { ScoreGraphState } from "../../graph/state.js";

export async function artifactPostProcessNode(
  state: ScoreGraphState,
): Promise<Partial<ScoreGraphState>> {
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
