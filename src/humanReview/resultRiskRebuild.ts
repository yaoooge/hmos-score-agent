import fs from "node:fs/promises";
import path from "node:path";
import { createHumanReviewEvidenceStore } from "./humanReviewEvidenceStore.js";
import { buildResultRiskReviewId, runResultRiskIngestionNode } from "./resultRiskIngestionNode.js";

export type ResultRiskRebuildSummary = {
  scannedResultFiles: number;
  rebuiltRuns: number;
  riskCount: number;
  eligibleRiskCount: number;
  datasetItemCount: number;
  skippedFiles: number;
};

type CaseInfo = {
  case_id?: unknown;
  remote_task_id?: unknown;
  remote_test_case_id?: unknown;
  started_at?: unknown;
  original_prompt_summary?: unknown;
};

type ResultJson = Record<string, unknown> & {
  basic_info?: { task_type?: unknown };
  report_meta?: { unit_name?: unknown; generated_at?: unknown };
};

export async function rebuildResultRiskEvidenceFromLocalCases(input: {
  localCaseRoot: string;
  evidenceRoot: string;
}): Promise<ResultRiskRebuildSummary> {
  const resultPaths = await collectResultJsonPaths(input.localCaseRoot);
  const store = createHumanReviewEvidenceStore(input.evidenceRoot);
  const existingDatasetEvidenceIds = await readExistingDatasetEvidenceIds(input.evidenceRoot);
  const summary: ResultRiskRebuildSummary = {
    scannedResultFiles: resultPaths.length,
    rebuiltRuns: 0,
    riskCount: 0,
    eligibleRiskCount: 0,
    datasetItemCount: 0,
    skippedFiles: 0,
  };

  for (const resultPath of resultPaths) {
    try {
      const resultJson = await readJsonFile<ResultJson>(resultPath);
      if (!resultJson) {
        summary.skippedFiles += 1;
        continue;
      }
      const caseDir = path.dirname(path.dirname(resultPath));
      const caseInfo = await readJsonFile<CaseInfo>(path.join(caseDir, "inputs", "case-info.json"));
      const completedAt =
        readString(resultJson.report_meta?.generated_at) ??
        readString(caseInfo?.started_at) ??
        new Date().toISOString();
      const taskId = inferTaskId({
        localCaseRoot: input.localCaseRoot,
        resultPath,
        resultJson,
        caseInfo,
      });
      const output = await runResultRiskIngestionNode(
        {
          taskId,
          testCaseId: readNumber(caseInfo?.remote_test_case_id) ?? taskId,
          reviewId: buildResultRiskReviewId(taskId, completedAt),
          receivedAt: completedAt,
          resultJson,
          caseContext: {
            caseId: inferCaseId(input.localCaseRoot, resultPath, resultJson, caseInfo),
            taskType:
              typeof resultJson.basic_info === "object" && resultJson.basic_info !== null
                ? readString(resultJson.basic_info.task_type)
                : undefined,
            prompt: readString(caseInfo?.original_prompt_summary),
          },
          datasetEvidenceIdsToSkip: existingDatasetEvidenceIds,
        },
        { store },
      );

      summary.riskCount += output.summary.riskCount;
      summary.eligibleRiskCount += output.summary.eligibleRiskCount;
      summary.datasetItemCount += output.summary.datasetItemCount;
      if (output.summary.riskCount > 0) {
        summary.rebuiltRuns += 1;
      }
      for (const evidenceId of output.evidenceIds) {
        existingDatasetEvidenceIds.add(evidenceId);
      }
    } catch (error) {
      summary.skippedFiles += 1;
      console.warn(
        `result_risk_rebuild_skip resultPath=${resultPath} error=${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return summary;
}

async function collectResultJsonPaths(rootDir: string): Promise<string[]> {
  const resultPaths: string[] = [];

  async function walk(currentDir: string): Promise<void> {
    let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>;
    try {
      entries = await fs.readdir(currentDir, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return;
      }
      throw error;
    }

    for (const entry of entries) {
      const entryPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(entryPath);
        continue;
      }
      if (
        entry.isFile() &&
        entry.name === "result.json" &&
        path.basename(path.dirname(entryPath)) === "outputs"
      ) {
        resultPaths.push(entryPath);
      }
    }
  }

  await walk(rootDir);
  return resultPaths.sort((left, right) => left.localeCompare(right));
}

async function readJsonFile<T>(filePath: string): Promise<T | undefined> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf-8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

async function readExistingDatasetEvidenceIds(evidenceRoot: string): Promise<Set<string>> {
  const evidenceIds = new Set<string>();
  try {
    const text = await fs.readFile(
      path.join(evidenceRoot, "datasets", "negative_diagnostics.jsonl"),
      "utf-8",
    );
    for (const line of text.split("\n")) {
      if (line.trim().length === 0) {
        continue;
      }
      const parsed = JSON.parse(line) as { evidenceId?: unknown };
      if (typeof parsed.evidenceId === "string" && parsed.evidenceId.length > 0) {
        evidenceIds.add(parsed.evidenceId);
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
  return evidenceIds;
}

function inferTaskId(input: {
  localCaseRoot: string;
  resultPath: string;
  resultJson: ResultJson;
  caseInfo?: CaseInfo;
}): number {
  return (
    readNumber(input.caseInfo?.remote_task_id) ??
    parseRemoteTaskId(readString(input.resultJson.report_meta?.unit_name)) ??
    stableNumericId(relativeCaseDir(input.localCaseRoot, input.resultPath))
  );
}

function inferCaseId(
  localCaseRoot: string,
  resultPath: string,
  resultJson: ResultJson,
  caseInfo?: CaseInfo,
): string {
  return (
    readString(resultJson.report_meta?.unit_name) ??
    readString(caseInfo?.case_id) ??
    relativeCaseDir(localCaseRoot, resultPath)
  );
}

function relativeCaseDir(localCaseRoot: string, resultPath: string): string {
  const caseDir = path.dirname(path.dirname(resultPath));
  return path.relative(localCaseRoot, caseDir) || path.basename(caseDir);
}

function stableNumericId(value: string): number {
  let hash = 0;
  for (const char of value) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return 1_000_000_000 + (hash % 1_000_000_000);
}

function parseRemoteTaskId(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const match = /^remote-task-(\d+)$/.exec(value);
  return match ? Number(match[1]) : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
