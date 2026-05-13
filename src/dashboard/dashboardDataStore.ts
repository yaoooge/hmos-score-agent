import fs from "node:fs/promises";
import path from "node:path";
import type { RemoteTaskRecord, RemoteTaskRegistry } from "../api/remoteTaskRegistry.js";
import type {
  DashboardStatusCategory,
  DashboardTaskRecordWithResult,
  DashboardTaskSummary,
  HumanRatingGapDashboardItem,
  HumanRatingGapReadResult,
  RiskReviewCalibrationDashboardItem,
  RiskReviewCalibrationReadResult,
} from "./dashboardTypes.js";

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function toIso(value: number): string {
  return new Date(value).toISOString();
}

export function statusCategory(status: RemoteTaskRecord["status"]): DashboardStatusCategory {
  switch (status) {
    case "preparing":
      return "received";
    case "queued":
      return "queued";
    case "running":
      return "running";
    case "completed":
      return "completed";
    case "failed":
    case "timed_out":
      return "failed";
  }
}

function readScore(resultJson: Record<string, unknown>): number | null {
  const overall = asRecord(resultJson.overall_conclusion);
  const score = overall?.total_score;
  return typeof score === "number" && Number.isFinite(score) ? score : null;
}

function readHardGate(resultJson: Record<string, unknown>): boolean | null {
  const overall = asRecord(resultJson.overall_conclusion);
  const hardGate = overall?.hard_gate_triggered;
  return typeof hardGate === "boolean" ? hardGate : null;
}

function readCaseName(resultJson: Record<string, unknown>): string | undefined {
  const basicInfo = asRecord(resultJson.basic_info);
  const caseName = basicInfo?.case_name ?? basicInfo?.name;
  return typeof caseName === "string" && caseName.trim().length > 0 ? caseName : undefined;
}

function readTaskType(resultJson: Record<string, unknown>): string | undefined {
  const basicInfo = asRecord(resultJson.basic_info);
  const taskType = basicInfo?.task_type;
  return typeof taskType === "string" && taskType.trim().length > 0 ? taskType : undefined;
}

function readRemoteCaseName(caseInfo: Record<string, unknown> | undefined): string | undefined {
  const caseName = caseInfo?.remote_test_case_name ?? caseInfo?.test_case_name ?? caseInfo?.case_name;
  return typeof caseName === "string" && caseName.trim().length > 0 ? caseName : undefined;
}

function readRemoteTaskType(caseInfo: Record<string, unknown> | undefined): string | undefined {
  const taskType = caseInfo?.remote_test_case_type ?? caseInfo?.task_type;
  return typeof taskType === "string" && taskType.trim().length > 0 ? taskType : undefined;
}

function readRisks(resultJson: Record<string, unknown>): Array<{ level?: string; title?: string }> {
  const risks = resultJson.risks;
  if (!Array.isArray(risks)) {
    return [];
  }
  return risks
    .map((risk): { level?: string; title?: string } | undefined => {
      const record = asRecord(risk);
      if (!record) {
        return undefined;
      }
      return {
        level: typeof record.level === "string" ? record.level : undefined,
        title: typeof record.title === "string" ? record.title : undefined,
      };
    })
    .filter((risk): risk is { level?: string; title?: string } => Boolean(risk));
}

async function readResultJson(
  record: RemoteTaskRecord,
): Promise<Record<string, unknown> | undefined> {
  if (!record.caseDir) {
    return undefined;
  }
  const text = await fs.readFile(path.join(record.caseDir, "outputs", "result.json"), "utf-8");
  return JSON.parse(text) as Record<string, unknown>;
}

async function readCaseInfo(
  record: RemoteTaskRecord,
): Promise<Record<string, unknown> | undefined> {
  if (!record.caseDir) {
    return undefined;
  }
  const text = await fs.readFile(path.join(record.caseDir, "inputs", "case-info.json"), "utf-8");
  return JSON.parse(text) as Record<string, unknown>;
}

export async function listDashboardTasks(
  registry: RemoteTaskRegistry,
): Promise<DashboardTaskRecordWithResult[]> {
  const records = await registry.list();
  return await Promise.all(
    records.map(async (record) => {
      let resultJson: Record<string, unknown> | undefined;
      let resultError: string | undefined;
      let caseInfo: Record<string, unknown> | undefined;
      try {
        resultJson = await readResultJson(record);
      } catch (error) {
        resultError = error instanceof Error ? error.message : String(error);
      }
      try {
        caseInfo = await readCaseInfo(record);
      } catch {
        caseInfo = undefined;
      }

      const name =
        (resultJson ? readCaseName(resultJson) : undefined) ??
        readRemoteCaseName(caseInfo) ??
        record.testCaseName ??
        `Task ${String(record.taskId)}`;
      const taskType =
        (resultJson ? readTaskType(resultJson) : undefined) ??
        readRemoteTaskType(caseInfo) ??
        record.testCaseType ??
        "unknown";
      const summary: DashboardTaskSummary = {
        taskId: record.taskId,
        testCaseId: record.testCaseId,
        name,
        status: record.status,
        statusCategory: statusCategory(record.status),
        taskType,
        score: resultJson ? readScore(resultJson) : null,
        hardGateTriggered: resultJson ? readHardGate(resultJson) : null,
        createdAt: toIso(record.createdAt),
        updatedAt: toIso(record.updatedAt),
        resultAvailable: Boolean(resultJson),
        resultError,
        error: record.error,
        risks: resultJson ? readRisks(resultJson) : [],
      };
      return { record, summary };
    }),
  );
}

export async function readTaskLog(input: {
  registry: RemoteTaskRegistry;
  taskId: number;
  tailBytes: number;
}): Promise<
  | { found: false }
  | {
      found: true;
      status: RemoteTaskRecord["status"];
      available: boolean;
      truncated: boolean;
      content: string;
      tailBytes: number;
    }
> {
  const record = await input.registry.get(input.taskId);
  if (!record) {
    return { found: false };
  }
  if (!record.caseDir) {
    return {
      found: true,
      status: record.status,
      available: false,
      truncated: false,
      content: "",
      tailBytes: input.tailBytes,
    };
  }
  try {
    const logPath = path.join(record.caseDir, "logs", "run.log");
    const stat = await fs.stat(logPath);
    const start = Math.max(0, stat.size - input.tailBytes);
    const file = await fs.open(logPath, "r");
    try {
      const length = stat.size - start;
      const buffer = Buffer.alloc(length);
      await file.read(buffer, 0, length, start);
      return {
        found: true,
        status: record.status,
        available: true,
        truncated: start > 0,
        content: buffer.toString("utf-8"),
        tailBytes: input.tailBytes,
      };
    } finally {
      await file.close();
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        found: true,
        status: record.status,
        available: false,
        truncated: false,
        content: "",
        tailBytes: input.tailBytes,
      };
    }
    throw error;
  }
}

export async function readHumanRatingGapDataset(
  root: string,
  taskNames: Map<number, string> = new Map(),
): Promise<HumanRatingGapReadResult> {
  const filePath = path.join(root, "datasets", "human_rating_gap_analyses.jsonl");
  let text: string;
  try {
    text = await fs.readFile(filePath, "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { items: [], skippedRows: 0 };
    }
    throw error;
  }

  const items: HumanRatingGapDashboardItem[] = [];
  let skippedRows = 0;
  for (const line of text.split("\n")) {
    if (line.trim().length === 0) {
      continue;
    }
    try {
      const parsed = JSON.parse(line) as unknown;
      const record = asRecord(parsed);
      if (!record || record.type !== "human_rating_gap_analysis") {
        skippedRows += 1;
        continue;
      }
      const item = record as HumanRatingGapDashboardItem;
      const hasCaseName = typeof item.caseName === "string" && item.caseName.trim().length > 0;
      items.push({
        ...item,
        caseName: hasCaseName
          ? item.caseName
          : (taskNames.get(item.taskId) ?? `Task ${String(item.taskId)}`),
      });
    } catch {
      skippedRows += 1;
    }
  }
  return { items, skippedRows };
}

export async function readRiskReviewCalibrationDataset(
  root: string,
  taskNames: Map<number, string>,
): Promise<RiskReviewCalibrationReadResult> {
  const filePath = path.join(root, "datasets", "risk_review_calibrations.jsonl");
  let text: string;
  try {
    text = await fs.readFile(filePath, "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { items: [], skippedRows: 0 };
    }
    throw error;
  }

  const items: RiskReviewCalibrationDashboardItem[] = [];
  let skippedRows = 0;
  for (const line of text.split("\n")) {
    if (line.trim().length === 0) {
      continue;
    }
    try {
      const parsed = JSON.parse(line) as unknown;
      const record = asRecord(parsed);
      if (!record || record.type !== "risk_review_calibration") {
        skippedRows += 1;
        continue;
      }
      const taskId = record.taskId;
      if (typeof taskId !== "number") {
        skippedRows += 1;
        continue;
      }
      const hasCaseName = typeof record.caseName === "string" && record.caseName.trim().length > 0;
      items.push({
        ...(record as RiskReviewCalibrationDashboardItem),
        caseName: hasCaseName
          ? (record.caseName as string)
          : (taskNames.get(taskId) ?? `Task ${String(taskId)}`),
      });
    } catch {
      skippedRows += 1;
    }
  }
  return { items, skippedRows };
}
