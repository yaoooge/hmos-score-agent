import { getConfig } from "../config.js";
import { rebuildResultRiskEvidenceFromLocalCases } from "../humanReview/resultRiskRebuild.js";

async function main(): Promise<void> {
  const config = getConfig();
  const summary = await rebuildResultRiskEvidenceFromLocalCases({
    localCaseRoot: config.localCaseRoot,
    evidenceRoot: config.humanReviewEvidenceRoot,
  });
  console.info(
    `result_risk_rebuild_completed localCaseRoot=${config.localCaseRoot} evidenceRoot=${config.humanReviewEvidenceRoot} scannedResultFiles=${String(summary.scannedResultFiles)} rebuiltRuns=${String(summary.rebuiltRuns)} riskCount=${String(summary.riskCount)} eligibleRiskCount=${String(summary.eligibleRiskCount)} datasetItemCount=${String(summary.datasetItemCount)} skippedFiles=${String(summary.skippedFiles)}`,
  );
}

main().catch((error) => {
  console.error(
    `result_risk_rebuild_failed error=${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
  );
  process.exitCode = 1;
});
