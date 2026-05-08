import fs from "node:fs/promises";
import path from "node:path";
import { getConfig } from "../config.js";
import { officialCodeLinterRecommendedRuleSets } from "../rules/officialCodeLinter/recommendedRuleSets.js";
import { parseOfficialCodeLinterOutput } from "../rules/officialCodeLinter/parser.js";
import { mapOfficialCodeLinterFindings } from "../rules/officialCodeLinter/resultMapper.js";
import { runOfficialCodeLinter } from "../rules/officialCodeLinter/runner.js";
import { sanitizeOfficialCodeLinterOutput } from "../rules/officialCodeLinter/sanitizer.js";
import { prepareOfficialCodeLinterWorkspace } from "../rules/officialCodeLinter/workspacePreparer.js";
import type { OfficialLinterRunStatus, OfficialLinterSummary } from "../types.js";
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

function makeSummary(input: {
  runStatus: OfficialLinterRunStatus;
  effectiveFindingCount: number;
  durationMs: number;
  exitCode?: number;
  diagnostics?: string;
}): OfficialLinterSummary {
  return {
    configuredRuleSets: [...officialCodeLinterRecommendedRuleSets],
    effectiveFindingCount: input.effectiveFindingCount,
    runStatus: input.runStatus,
    exitCode: input.exitCode,
    durationMs: input.durationMs,
    diagnostics: input.diagnostics,
  };
}

export async function officialCodeLinterNode(
  state: ScoreGraphState,
  deps: { runDir?: string; timeoutMs?: number } = {},
): Promise<Partial<ScoreGraphState>> {
  emitNodeStarted("officialCodeLinterNode");
  const startedAt = Date.now();
  try {
    const config = getConfig();
    const runDir = deps.runDir ?? config.officialCodeLinterRunDir;
    const timeoutMs = deps.timeoutMs ?? config.officialCodeLinterTimeoutMs;
    const caseDir = state.caseDir;
    const generatedProjectPath = state.caseInput?.generatedProjectPath;

    const notInstalledSummary = makeSummary({
      runStatus: "not_installed",
      effectiveFindingCount: 0,
      durationMs: Date.now() - startedAt,
      diagnostics: "official Code Linter run directory or entrypoint is unavailable",
    });
    if (!runDir || !(await hasOfficialCodeLinterEntrypoint(runDir)) || !caseDir || !generatedProjectPath) {
      if (caseDir) {
        const sanitized = sanitizeOfficialCodeLinterOutput({
          text: notInstalledSummary.diagnostics ?? "",
          effectiveFindingCount: 0,
          runStatus: "not_installed",
        });
        await writeSummaryArtifacts({
          caseDir,
          summary: notInstalledSummary,
          findings: [],
          stdout: sanitized,
          stderr: sanitized,
        });
      }
      return {
        officialLinterRunStatus: "not_installed",
        officialLinterSummary: notInstalledSummary,
        officialLinterFindings: [],
        officialLinterRuleResults: [],
      };
    }

    const workspace = await prepareOfficialCodeLinterWorkspace({ generatedProjectPath, caseDir });
    const runResult = await runOfficialCodeLinter({
      runDir,
      workspaceDir: workspace.workspaceDir,
      timeoutMs,
    });
    const parsed = parseOfficialCodeLinterOutput({
      stdout: runResult.stdout,
      stderr: runResult.stderr,
    });
    const mapped = mapOfficialCodeLinterFindings({
      findings: parsed.findings,
      workspaceDir: workspace.workspaceDir,
      hasPatch: state.evidenceSummary?.hasPatch ?? state.hasPatch ?? false,
      changedFiles: state.evidenceSummary?.changedFiles ?? [],
    });

    const runStatus: OfficialLinterRunStatus =
      runResult.status === "timeout"
        ? "timeout"
        : parsed.status === "parsed"
          ? "success"
          : runResult.status === "failed"
            ? "failed"
            : "invalid_output";
    const effectiveFindings = runStatus === "success" ? mapped.effectiveFindings : [];
    const ruleResults = runStatus === "success" ? mapped.ruleResults : [];
    const summary = makeSummary({
      runStatus,
      effectiveFindingCount: effectiveFindings.length,
      durationMs: runResult.durationMs,
      exitCode: runResult.exitCode,
      diagnostics: runStatus === "success" ? undefined : `official Code Linter status=${runStatus}`,
    });
    const sanitizedStdout = sanitizeOfficialCodeLinterOutput({
      text: runResult.stdout,
      effectiveFindingCount: effectiveFindings.length,
      runStatus,
    });
    const sanitizedStderr = sanitizeOfficialCodeLinterOutput({
      text: runResult.stderr,
      effectiveFindingCount: effectiveFindings.length,
      runStatus,
    });
    await writeSummaryArtifacts({
      caseDir,
      summary,
      findings: effectiveFindings,
      stdout: sanitizedStdout,
      stderr: sanitizedStderr,
      exitCode: runResult.exitCode,
    });

    return {
      officialLinterRunStatus: runStatus,
      officialLinterSummary: summary,
      officialLinterFindings: effectiveFindings,
      officialLinterRuleResults: ruleResults,
    };
  } catch (error) {
    emitNodeFailed("officialCodeLinterNode", error);
    throw error;
  }
}
