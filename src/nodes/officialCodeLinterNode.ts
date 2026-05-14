import fs from "node:fs/promises";
import path from "node:path";
import { getConfig } from "../config.js";
import { findOfficialLinterRuleProfile } from "../scoring/officialLinterRuleProfiles.js";
import { resolveOfficialCodeLinterRecommendedRuleSets } from "../rules/officialCodeLinter/recommendedRuleSets.js";
import { parseOfficialCodeLinterOutput } from "../rules/officialCodeLinter/parser.js";
import { mapOfficialCodeLinterFindings } from "../rules/officialCodeLinter/resultMapper.js";
import { runOfficialCodeLinter } from "../rules/officialCodeLinter/runner.js";
import { sanitizeOfficialCodeLinterOutput } from "../rules/officialCodeLinter/sanitizer.js";
import { prepareOfficialCodeLinterWorkspace } from "../rules/officialCodeLinter/workspacePreparer.js";
import { runHvigorBuildCheck } from "../rules/officialCodeLinter/hvigorBuildCheck.js";
import type {
  HvigorBuildCheckStatus,
  HvigorBuildCheckSummary,
  OfficialLinterRunStatus,
  OfficialLinterSummary,
} from "../types.js";
import { emitNodeFailed, emitNodeStarted } from "../workflow/observability/nodeCustomEvents.js";
import type { ScoreGraphState } from "../workflow/state.js";

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function hasOfficialCodeLinterEntrypoint(runDir: string): Promise<boolean> {
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

async function writeSummaryArtifacts(input: {
  caseDir: string;
  summary: OfficialLinterSummary;
  findings: unknown[];
  stdout: string;
  stderr: string;
  exitCode?: number;
}) {
  await writeLinterArtifact(input.caseDir, "summary.json", `${JSON.stringify(input.summary, null, 2)}\n`);
  await writeLinterArtifact(
    input.caseDir,
    "findings.effective.json",
    `${JSON.stringify(input.findings, null, 2)}\n`,
  );
  await writeLinterArtifact(input.caseDir, "stdout.sanitized.txt", input.stdout);
  await writeLinterArtifact(input.caseDir, "stderr.sanitized.txt", input.stderr);
  await writeLinterArtifact(input.caseDir, "exit-code.txt", `${input.exitCode ?? ""}\n`);
}

async function writeHvigorSummaryArtifact(caseDir: string, summary: HvigorBuildCheckSummary) {
  await writeLinterArtifact(caseDir, "hvigor-summary.json", `${JSON.stringify(summary, null, 2)}\n`);
}

function makeSummary(input: {
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

function appendDiagnostics(...messages: Array<string | undefined>): string | undefined {
  const diagnostics = messages.filter((message): message is string => Boolean(message?.trim()));
  return diagnostics.length > 0 ? diagnostics.join("; ") : undefined;
}

function summarizeMissingOfficialRuleProfiles(ruleResults: Array<{ rule_id: string }>): string | undefined {
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

async function resolveBuildCheckSummary(input: {
  hvigorEnabled: boolean;
  hvigorRunDir?: string;
  workspaceDir?: string;
  changedFiles: string[];
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
    timeoutMs: input.timeoutMs,
  });
  return { ...summary, buildCheckSource: "hvigor" };
}

export async function officialCodeLinterNode(
  state: ScoreGraphState,
  deps: {
    enabled?: boolean;
    runDir?: string;
    timeoutMs?: number;
    hvigorEnabled?: boolean;
    hvigorRunDir?: string;
    hvigorTimeoutMs?: number;
  } = {},
): Promise<Partial<ScoreGraphState>> {
  emitNodeStarted("officialCodeLinterNode");
  const startedAt = Date.now();
  try {
    const config = getConfig();
    const enabled = deps.enabled ?? config.officialCodeLinterEnabled;
    const hvigorEnabled =
      deps.hvigorEnabled ?? (deps.enabled === undefined ? config.hvigorBuildCheckEnabled : deps.enabled);
    const runDir = deps.runDir ?? config.officialCodeLinterRunDir;
    const hvigorRunDir =
      deps.hvigorRunDir ??
      config.hvigorBuildCheckRunDir ??
      (runDir ? path.join(path.dirname(runDir), "hvigor") : undefined);
    const timeoutMs = deps.timeoutMs ?? config.officialCodeLinterTimeoutMs;
    const hvigorTimeoutMs = deps.hvigorTimeoutMs ?? config.hvigorBuildCheckTimeoutMs;
    const caseDir = state.caseDir;
    const generatedProjectPath = state.caseInput?.generatedProjectPath;
    const crossDeviceAdaptation = state.constraintSummary?.crossDeviceAdaptation;
    const crossDeviceMissingDiagnostic =
      state.constraintSummary && !crossDeviceAdaptation
        ? "cross-device applicability missing; treated as not_involved"
        : undefined;
    const configuredRuleSets = resolveOfficialCodeLinterRecommendedRuleSets({
      crossDeviceAdaptation,
    });

    if (!enabled && !hvigorEnabled) {
      const hvigorSummary = await resolveBuildCheckSummary({
        hvigorEnabled,
        hvigorRunDir,
        changedFiles: [],
        timeoutMs: hvigorTimeoutMs,
        remoteBuildSuccess: state.remoteBuildSuccess,
      });
      const notEnabledSummary = makeSummary({
        runStatus: "not_enabled",
        effectiveFindingCount: 0,
        durationMs: Date.now() - startedAt,
        configuredRuleSets,
        diagnostics: appendDiagnostics(
          "official Code Linter is disabled by HMOS_CODE_LINTER_ENABLED",
          crossDeviceMissingDiagnostic,
        ),
      });
      return {
        officialLinterRunStatus: "not_enabled",
        officialLinterSummary: notEnabledSummary,
        officialLinterFindings: [],
        officialLinterRuleResults: [],
        hvigorBuildCheckStatus: hvigorSummary.status,
        hvigorBuildCheckSummary: hvigorSummary,
      };
    }

    const unavailableRunStatus: OfficialLinterRunStatus = enabled ? "not_installed" : "not_enabled";
    const unavailableDiagnostics = enabled
      ? "official Code Linter run directory or entrypoint is unavailable"
      : "official Code Linter is disabled by HMOS_CODE_LINTER_ENABLED";
    const unavailableSummary = makeSummary({
      runStatus: unavailableRunStatus,
      effectiveFindingCount: 0,
      durationMs: Date.now() - startedAt,
      configuredRuleSets,
      diagnostics: appendDiagnostics(unavailableDiagnostics, crossDeviceMissingDiagnostic),
    });
    if (!caseDir || !generatedProjectPath) {
      const hvigorSummary = await resolveBuildCheckSummary({
        hvigorEnabled,
        hvigorRunDir,
        changedFiles: state.evidenceSummary?.changedFiles ?? [],
        timeoutMs: hvigorTimeoutMs,
        remoteBuildSuccess: state.remoteBuildSuccess,
      });
      if (caseDir) {
        const sanitized = sanitizeOfficialCodeLinterOutput({
          text: unavailableSummary.diagnostics ?? "",
          effectiveFindingCount: 0,
          runStatus: unavailableRunStatus,
        });
        await writeSummaryArtifacts({
          caseDir,
          summary: unavailableSummary,
          findings: [],
          stdout: sanitized,
          stderr: sanitized,
        });
        await writeHvigorSummaryArtifact(caseDir, hvigorSummary);
      }
      return {
        officialLinterRunStatus: unavailableRunStatus,
        officialLinterSummary: unavailableSummary,
        officialLinterFindings: [],
        officialLinterRuleResults: [],
        hvigorBuildCheckStatus: hvigorSummary.status,
        hvigorBuildCheckSummary: hvigorSummary,
      };
    }

    const workspace = await prepareOfficialCodeLinterWorkspace({
      generatedProjectPath,
      caseDir,
      ruleSets: configuredRuleSets,
    });
    const hvigorSummary = await resolveBuildCheckSummary({
      hvigorEnabled,
      hvigorRunDir,
      workspaceDir: workspace.workspaceDir,
      changedFiles: state.evidenceSummary?.changedFiles ?? [],
      timeoutMs: hvigorTimeoutMs,
      remoteBuildSuccess: state.remoteBuildSuccess,
    });

    const linterInstalled = enabled
      ? Boolean(runDir && (await hasOfficialCodeLinterEntrypoint(runDir)))
      : false;
    const runResult = linterInstalled
      ? await runOfficialCodeLinter({
          runDir: runDir as string,
          workspaceDir: workspace.workspaceDir,
          timeoutMs,
        })
      : undefined;
    const parsed = runResult
      ? parseOfficialCodeLinterOutput({
          stdout: runResult.stdout,
          stderr: runResult.stderr,
        })
      : { status: "unparsed" as const, findings: [] };
    const mapped = mapOfficialCodeLinterFindings({
      findings: parsed.findings,
      workspaceDir: workspace.workspaceDir,
      hasPatch: state.evidenceSummary?.hasPatch ?? state.hasPatch ?? false,
      changedFiles: state.evidenceSummary?.changedFiles ?? [],
      changedLineNumbersByFile: state.evidenceSummary?.changedLineNumbersByFile,
    });

    const runStatus: OfficialLinterRunStatus = !linterInstalled
      ? enabled
        ? "not_installed"
        : "not_enabled"
      : runResult?.status === "timeout"
        ? "timeout"
        : parsed.status === "parsed"
          ? "success"
          : runResult?.status === "failed"
            ? "failed"
            : "invalid_output";
    const effectiveFindings = runStatus === "success" ? mapped.effectiveFindings : [];
    const ruleResults = runStatus === "success" ? mapped.ruleResults : [];
    const missingProfileDiagnostics = summarizeMissingOfficialRuleProfiles(ruleResults);
    const summary = makeSummary({
      runStatus,
      effectiveFindingCount: effectiveFindings.length,
      durationMs: runResult?.durationMs ?? Date.now() - startedAt,
      configuredRuleSets,
      exitCode: runResult?.exitCode,
      diagnostics: appendDiagnostics(
        runStatus === "success"
          ? undefined
          : runStatus === "not_enabled"
            ? "official Code Linter is disabled by HMOS_CODE_LINTER_ENABLED"
            : `official Code Linter status=${runStatus}`,
        missingProfileDiagnostics,
        crossDeviceMissingDiagnostic,
      ),
    });
    const sanitizedStdout = sanitizeOfficialCodeLinterOutput({
      text: runResult?.stdout ?? summary.diagnostics ?? "",
      effectiveFindingCount: effectiveFindings.length,
      runStatus,
    });
    const sanitizedStderr = sanitizeOfficialCodeLinterOutput({
      text: runResult?.stderr ?? "",
      effectiveFindingCount: effectiveFindings.length,
      runStatus,
    });
    await writeSummaryArtifacts({
      caseDir,
      summary,
      findings: effectiveFindings,
      stdout: sanitizedStdout,
      stderr: sanitizedStderr,
      exitCode: runResult?.exitCode,
    });
    await writeHvigorSummaryArtifact(caseDir, hvigorSummary);

    return {
      officialLinterRunStatus: runStatus,
      officialLinterSummary: summary,
      officialLinterFindings: effectiveFindings,
      officialLinterRuleResults: ruleResults,
      hvigorBuildCheckStatus: hvigorSummary.status as HvigorBuildCheckStatus,
      hvigorBuildCheckSummary: hvigorSummary,
    };
  } catch (error) {
    emitNodeFailed("officialCodeLinterNode", error);
    throw error;
  }
}
