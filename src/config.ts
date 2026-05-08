import "dotenv/config";
import os from "node:os";
import path from "node:path";

export interface AppConfig {
  port: number;
  localCaseRoot: string;
  referenceRoot: string;
  humanReviewEvidenceRoot: string;
  remoteTaskAcceptTimeoutMs: number;
  officialCodeLinterEnabled: boolean;
  officialCodeLinterRunDir?: string;
  officialCodeLinterTimeoutMs: number;
}

export function getConfig(): AppConfig {
  return {
    port: Number(process.env.PORT ?? 3000),
    localCaseRoot: path.resolve(process.cwd(), process.env.LOCAL_CASE_ROOT ?? ".local-cases"),
    referenceRoot:
      process.env.DEFAULT_REFERENCE_ROOT ?? path.resolve(process.cwd(), "references/scoring"),
    humanReviewEvidenceRoot: process.env.HUMAN_REVIEW_EVIDENCE_ROOT
      ? path.resolve(process.env.HUMAN_REVIEW_EVIDENCE_ROOT)
      : path.resolve(os.homedir(), ".hmos-score-agent", "human-review-evidences"),
    remoteTaskAcceptTimeoutMs: Number(process.env.REMOTE_TASK_ACCEPT_TIMEOUT_MS ?? 300000),
    officialCodeLinterEnabled:
      process.env.HMOS_CODE_LINTER_ENABLED?.trim().toLowerCase() === "true",
    officialCodeLinterRunDir: process.env.HMOS_CODE_LINTER_RUN_DIR
      ? path.resolve(process.env.HMOS_CODE_LINTER_RUN_DIR)
      : undefined,
    officialCodeLinterTimeoutMs: Number(process.env.HMOS_CODE_LINTER_TIMEOUT_MS ?? 120000),
  };
}
