import fs from "node:fs/promises";
import path from "node:path";
import type { RemoteTaskRecord, RemoteTaskRegistry } from "../api/remoteTaskRegistry.js";
import { statusCategory, readRiskReviewCalibrationDataset } from "./dashboardDataStore.js";
import type { CrossDeviceRelatedTask, CrossDeviceRiskReviewItem } from "./crossDeviceTypes.js";

const CROSS_DEVICE_RULE_SET = "plugin:@cross-device-app-dev/recommended";

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function toIso(value: number): string {
  return new Date(value).toISOString();
}

async function readJsonFile(filePath: string): Promise<Record<string, unknown> | undefined> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf-8")) as Record<string, unknown>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    return undefined;
  }
}

function readString(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function readScore(resultJson: Record<string, unknown> | undefined): number | null {
  const overall = asRecord(resultJson?.overall_conclusion);
  const score = overall?.total_score;
  return typeof score === "number" && Number.isFinite(score) ? score : null;
}

function readHardGate(resultJson: Record<string, unknown> | undefined): boolean | null {
  const overall = asRecord(resultJson?.overall_conclusion);
  return typeof overall?.hard_gate_triggered === "boolean" ? overall.hard_gate_triggered : null;
}

function readCaseName(resultJson: Record<string, unknown> | undefined): string | undefined {
  const basicInfo = asRecord(resultJson?.basic_info);
  return readString(basicInfo, "case_name") ?? readString(basicInfo, "name");
}

function readTaskType(resultJson: Record<string, unknown> | undefined): string | undefined {
  const basicInfo = asRecord(resultJson?.basic_info);
  return readString(basicInfo, "task_type");
}

function readTaskTypeBasis(resultJson: Record<string, unknown> | undefined): string | undefined {
  const basicInfo = asRecord(resultJson?.basic_info);
  return readString(basicInfo, "task_type_basis");
}

function readCrossDeviceReasons(
  constraintSummary: Record<string, unknown> | undefined,
): string[] | undefined {
  const crossDeviceAdaptation = asRecord(constraintSummary?.crossDeviceAdaptation);
  if (crossDeviceAdaptation?.applicability !== "involved") {
    return undefined;
  }
  const reasons = crossDeviceAdaptation.reasons;
  return Array.isArray(reasons)
    ? reasons.filter((reason): reason is string => typeof reason === "string" && reason.length > 0)
    : [];
}

function readCrossDeviceFallbackReasons(
  resultJson: Record<string, unknown> | undefined,
): string[] | undefined {
  const taskTypeBasis = readTaskTypeBasis(resultJson)?.toLowerCase();
  if (!taskTypeBasis) {
    return undefined;
  }
  const hasMultiDeviceBasis =
    taskTypeBasis.includes("multi_device_adaptation") ||
    taskTypeBasis.includes("responsive_layout");
  return hasMultiDeviceBasis
    ? ["评分结果标记 task_type_basis 包含 multi_device_adaptation/responsive_layout"]
    : undefined;
}

function readRisks(resultJson: Record<string, unknown> | undefined) {
  const risks = resultJson?.risks;
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
        level: readString(record, "level"),
        title: readString(record, "title"),
      };
    })
    .filter((risk): risk is { level?: string; title?: string } => Boolean(risk));
}

function readOfficialLinterRunStatus(resultJson: Record<string, unknown> | undefined): string | undefined {
  return readString(asRecord(resultJson?.official_linter_summary), "runStatus");
}

function readCrossDeviceRuleSetApplied(resultJson: Record<string, unknown> | undefined): boolean {
  const configuredRuleSets = asRecord(resultJson?.official_linter_summary)?.configuredRuleSets;
  return Array.isArray(configuredRuleSets) && configuredRuleSets.includes(CROSS_DEVICE_RULE_SET);
}

function readOfficialLinterResults(resultJson: Record<string, unknown> | undefined) {
  const results = resultJson?.official_linter_results;
  if (!Array.isArray(results)) {
    return [];
  }
  return results
    .map((item) => {
      const record = asRecord(item);
      const ruleId = readString(record, "rule_id");
      if (!record || !ruleId) {
        return undefined;
      }
      const findingCount = record.finding_count;
      return {
        ruleId,
        ruleResultId: readString(record, "rule_result_id"),
        sourceRuleSet: readString(record, "source_rule_set"),
        severity: readString(record, "severity"),
        findingCount: typeof findingCount === "number" && Number.isFinite(findingCount) ? findingCount : 1,
        conclusion: readString(record, "conclusion"),
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
}

function readRuleAuditResults(resultJson: Record<string, unknown> | undefined) {
  const results = resultJson?.rule_audit_results;
  if (!Array.isArray(results)) {
    return [];
  }
  return results
    .map((item) => {
      const record = asRecord(item);
      const ruleId = readString(record, "rule_id");
      if (!record || !ruleId) {
        return undefined;
      }
      return {
        ruleId,
        ruleSummary: readString(record, "rule_summary"),
        ruleSource: readString(record, "rule_source"),
        result: readString(record, "result"),
        conclusion: readString(record, "conclusion"),
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
}

function buildTopCrossDeviceRules(officialLinterResults: ReturnType<typeof readOfficialLinterResults>) {
  return officialLinterResults
    .filter(
      (result) =>
        result.sourceRuleSet === CROSS_DEVICE_RULE_SET ||
        result.ruleId.startsWith("@cross-device-app-dev/"),
    )
    .map((result) => ({
      ruleId: result.ruleId,
      sourceRuleSet: result.sourceRuleSet ?? "",
      findingCount: result.findingCount,
    }))
    .sort((left, right) => right.findingCount - left.findingCount)
    .slice(0, 5);
}

function buildRiskLevelCounts(risks: Array<{ level?: string }>) {
  const counts = new Map<string, number>();
  for (const risk of risks) {
    if (risk.level) {
      counts.set(risk.level, (counts.get(risk.level) ?? 0) + 1);
    }
  }
  return Array.from(counts.entries()).map(([level, count]) => ({ level, count }));
}

async function readCrossDeviceTask(record: RemoteTaskRecord): Promise<CrossDeviceRelatedTask | undefined> {
  if (!record.caseDir) {
    return undefined;
  }
  const constraintSummary = await readJsonFile(
    path.join(record.caseDir, "intermediate", "constraint-summary.json"),
  );
  const resultJson = await readJsonFile(path.join(record.caseDir, "outputs", "result.json"));
  const reasons = readCrossDeviceReasons(constraintSummary) ?? readCrossDeviceFallbackReasons(resultJson);
  if (!reasons) {
    return undefined;
  }

  const caseInfo = await readJsonFile(path.join(record.caseDir, "inputs", "case-info.json"));
  const name =
    readCaseName(resultJson) ??
    readString(caseInfo, "remote_test_case_name") ??
    readString(caseInfo, "test_case_name") ??
    readString(caseInfo, "case_name") ??
    record.testCaseName ??
    `Task ${String(record.taskId)}`;
  const taskType =
    readTaskType(resultJson) ??
    readString(caseInfo, "remote_test_case_type") ??
    readString(caseInfo, "task_type") ??
    record.testCaseType ??
    "unknown";
  const risks = readRisks(resultJson);
  const officialLinterResults = readOfficialLinterResults(resultJson);
  const topRuleViolations = buildTopCrossDeviceRules(officialLinterResults);

  return {
    taskId: record.taskId,
    testCaseId: record.testCaseId,
    name,
    status: record.status,
    statusCategory: statusCategory(record.status),
    taskType,
    score: readScore(resultJson),
    hardGateTriggered: readHardGate(resultJson),
    createdAt: toIso(record.createdAt),
    updatedAt: toIso(record.updatedAt),
    resultAvailable: Boolean(resultJson),
    reasons,
    officialLinterRunStatus: readOfficialLinterRunStatus(resultJson),
    crossDeviceRuleSetApplied: readCrossDeviceRuleSetApplied(resultJson),
    crossDeviceFindingCount: topRuleViolations.reduce((sum, rule) => sum + rule.findingCount, 0),
    riskCount: risks.length,
    topRuleViolations,
    riskLevelCounts: buildRiskLevelCounts(risks),
    risks,
    officialLinterResults,
    ruleAuditResults: readRuleAuditResults(resultJson),
  };
}

export async function listCrossDeviceRelatedTasks(
  registry: RemoteTaskRegistry,
): Promise<CrossDeviceRelatedTask[]> {
  const records = await registry.list();
  const tasks = await Promise.all(records.map((record) => readCrossDeviceTask(record)));
  return tasks.filter((task): task is CrossDeviceRelatedTask => Boolean(task));
}

export async function readCrossDeviceRiskReviewDataset(input: {
  root: string;
  relatedTaskIds: Set<number>;
  taskNames: Map<number, string>;
}): Promise<{ items: CrossDeviceRiskReviewItem[]; skippedRows: number }> {
  const dataset = await readRiskReviewCalibrationDataset(input.root, input.taskNames);
  return {
    skippedRows: dataset.skippedRows,
    items: dataset.items.filter((item) => input.relatedTaskIds.has(item.taskId)),
  };
}
