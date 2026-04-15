import path from "node:path";
import { getConfig } from "./config.js";
import { ArtifactStore } from "./io/artifactStore.js";
import { loadCaseFromPath } from "./io/caseLoader.js";
import { runScoreWorkflow } from "./workflow/scoreWorkflow.js";

export async function runSingleCase(casePath: string): Promise<{ caseDir: string; uploadMessage?: string }> {
  const config = getConfig();
  const artifactStore = new ArtifactStore(config.localCaseRoot);
  const caseInput = await loadCaseFromPath(casePath);
  const caseDir = await artifactStore.ensureCaseDir(caseInput.caseId);

  const result = await runScoreWorkflow({
    caseInput,
    caseDir,
    referenceRoot: config.referenceRoot,
    artifactStore,
    uploadEndpoint: config.uploadEndpoint,
    uploadToken: config.uploadToken,
  });

  return {
    caseDir,
    uploadMessage: typeof result.uploadMessage === "string" ? result.uploadMessage : undefined,
  };
}

export function resolveDefaultCasePath(): string {
  return path.resolve(process.cwd(), "init-input");
}
