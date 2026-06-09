import fs from "node:fs/promises";
import path from "node:path";
import { getConfig } from "../../../config.js";
import { findOfficialLinterRuleProfile } from "../../../scoring/officialLinterRuleProfiles.js";
import { runHvigorBuildCheck } from "../../../rules/official-linter/hvigor/buildCheck.js";
import type {
  HvigorBuildCheckSummary,
  OfficialLinterRunStatus,
  OfficialLinterSummary,
} from "../../../types.js";
import type { ScoreGraphState } from "../../graph/state.js";
import type { OfficialCodeLinterNodeDeps } from "./types.js";

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function hasOfficialCodeLinterEntrypoint(runDir: string): Promise<boolean> {
  return (
    (await fileExists(path.join(runDir, "bin", "codelinter"))) ||
    (await fileExists(path.join(runDir, "index.js")))
  );
}

async function writeLinterArtifact(caseDir: string, relativePath: string, content: string) {
  const filePath = path.join(caseDir, "intermediate", "code-linter", relativePath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf-8");
}

/** 写入 official Code Linter 节点的中间产物，便于失败后回看原始诊断。 */
export async function writeSummaryArtifacts(input: {
  caseDir: string;
  summary: OfficialLinterSummary;
  findings: unknown[];
  stdout: string;
  stderr: string;
  exitCode?: number;
}) {
  await writeLinterArtifact(
    input.caseDir,
    "summary.json",
    `${JSON.stringify(input.summary, null, 2)}\n`,
  );
  await writeLinterArtifact(
    input.caseDir,
    "findings.effective.json",
    `${JSON.stringify(input.findings, null, 2)}\n`,
  );
  await writeLinterArtifact(input.caseDir, "stdout.sanitized.txt", input.stdout);
  await writeLinterArtifact(input.caseDir, "stderr.sanitized.txt", input.stderr);
  await writeLinterArtifact(input.caseDir, "exit-code.txt", `${input.exitCode ?? ""}\n`);
}

export async function writeHvigorSummaryArtifact(
  caseDir: string,
  summary: HvigorBuildCheckSummary,
) {
  await writeLinterArtifact(
    caseDir,
    "hvigor-summary.json",
    `${JSON.stringify(summary, null, 2)}\n`,
  );
}

export function makeSummary(input: {
  runStatus: OfficialLinterRunStatus;
  effectiveFindingCount: number;
  durationMs: number;
  configuredRuleSets: string[];
  exitCode?: number;
  diagnostics?: string;
}): OfficialLinterSummary {
  return {
    configuredRuleSets: [...input.configuredRuleSets],
    effectiveFindingCount: input.effectiveFindingCount,
    runStatus: input.runStatus,
    exitCode: input.exitCode,
    durationMs: input.durationMs,
    diagnostics: input.diagnostics,
  };
}

export function appendDiagnostics(...messages: Array<string | undefined>): string | undefined {
  const diagnostics = messages.filter((message): message is string => Boolean(message?.trim()));
  return diagnostics.length > 0 ? diagnostics.join("; ") : undefined;
}

export function summarizeMissingOfficialRuleProfiles(
  ruleResults: Array<{ rule_id: string }>,
): string | undefined {
  const missingCrossDeviceRuleIds = ruleResults
    .map((rule) => rule.rule_id)
    .filter((ruleId) => ruleId.startsWith("OFFICIAL-LINTER:@cross-device-app-dev/"))
    .filter((ruleId) => !findOfficialLinterRuleProfile(ruleId));
  const uniqueRuleIds = Array.from(new Set(missingCrossDeviceRuleIds));
  if (uniqueRuleIds.length === 0) {
    return undefined;
  }
  return `official linter profile missing: ${uniqueRuleIds.join(", ")}`;
}

function makeRemoteBuildCheckSummary(remoteBuildSuccess: boolean): HvigorBuildCheckSummary {
  if (remoteBuildSuccess) {
    return {
      enabled: true,
      status: "success",
      buildCheckSource: "remote",
      checkedModules: [],
      moduleResults: [],
      hardGateTriggered: false,
      diagnostics: "远端平台构建成功，已跳过本地 hvigor 编译复验。",
      durationMs: 0,
      cleanup: {
        attempted: false,
        removedPaths: [],
        failedPaths: [],
      },
    };
  }

  return {
    enabled: true,
    status: "failed",
    buildCheckSource: "remote",
    checkedModules: ["remote"],
    moduleResults: [
      {
        modulePath: ".",
        moduleName: "remote",
        command: "assembleApp",
        status: "failed",
        durationMs: 0,
        diagnostics: "远端平台构建失败。",
      },
    ],
    hardGateTriggered: true,
    scoreCap: 59,
    diagnostics: "远端平台构建失败，已跳过本地 hvigor 编译复验。",
    durationMs: 0,
    cleanup: {
      attempted: false,
      removedPaths: [],
      failedPaths: [],
    },
  };
}

/** 解析节点运行配置：优先使用注入 deps，其次读取全局配置。 */
export function resolveOfficialCodeLinterRuntime(deps: OfficialCodeLinterNodeDeps): {
  enabled: boolean;
  hvigorEnabled: boolean;
  runDir?: string;
  hvigorRunDir?: string;
  timeoutMs: number;
  hvigorTimeoutMs: number;
} {
  const config = getConfig();
  const enabled = deps.enabled ?? config.officialCodeLinterEnabled;
  const hvigorEnabled =
    deps.hvigorEnabled ??
    (deps.enabled === undefined ? config.hvigorBuildCheckEnabled : deps.enabled);
  const runDir = deps.runDir ?? config.officialCodeLinterRunDir;
  const hvigorRunDir =
    deps.hvigorRunDir ??
    config.hvigorBuildCheckRunDir ??
    (runDir ? path.join(path.dirname(runDir), "hvigor") : undefined);
  return {
    enabled,
    hvigorEnabled,
    runDir,
    hvigorRunDir,
    timeoutMs: deps.timeoutMs ?? config.officialCodeLinterTimeoutMs,
    hvigorTimeoutMs: deps.hvigorTimeoutMs ?? config.hvigorBuildCheckTimeoutMs,
  };
}

/** 提取 linter/hvigor 共同依赖的 state 字段，减少节点入口里的重复判空。 */
export function readOfficialCodeLinterState(state: ScoreGraphState) {
  const changedFiles = state.changedFiles ?? state.evidenceSummary?.changedFiles ?? [];
  const changedLineNumbersByFile =
    state.changedLineNumbersByFile ?? state.evidenceSummary?.changedLineNumbersByFile;
  const hasPatch = state.hasPatch ?? state.evidenceSummary?.hasPatch ?? false;
  const crossDeviceAdaptation = state.taskUnderstanding?.crossDeviceAdaptation;
  const crossDeviceMissingDiagnostic =
    state.taskUnderstanding && !crossDeviceAdaptation
      ? "cross-device applicability missing; treated as not_involved"
      : undefined;
  return {
    caseDir: state.caseDir,
    generatedProjectPath: state.caseInput?.generatedProjectPath,
    changedFiles,
    changedLineNumbersByFile,
    hasPatch,
    crossDeviceAdaptation,
    crossDeviceMissingDiagnostic,
  };
}

export async function resolveBuildCheckSummary(input: {
  hvigorEnabled: boolean;
  hvigorRunDir?: string;
  workspaceDir?: string;
  changedFiles: string[];
  changedLineNumbersByFile?: Record<string, number[]>;
  timeoutMs: number;
  remoteBuildSuccess?: boolean;
}): Promise<HvigorBuildCheckSummary> {
  if (!input.hvigorEnabled && typeof input.remoteBuildSuccess === "boolean") {
    return makeRemoteBuildCheckSummary(input.remoteBuildSuccess);
  }

  const summary = await runHvigorBuildCheck({
    enabled: input.hvigorEnabled,
    hvigorRunDir: input.hvigorRunDir,
    workspaceDir: input.workspaceDir,
    changedFiles: input.changedFiles,
    changedLineNumbersByFile: input.changedLineNumbersByFile,
    timeoutMs: input.timeoutMs,
  });
  return { ...summary, buildCheckSource: "hvigor" };
}
