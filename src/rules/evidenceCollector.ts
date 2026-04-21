import fs from "node:fs/promises";
import path from "node:path";
import { CaseInput, EvidenceSummary, TaskType } from "../types.js";
import { collectVisibleFiles } from "../io/gitignoreMatcher.js";

const RULE_EVALUATION_IGNORED_PATH_PREFIXES = ["entry/src/test", "entry/src/ohosTest"];
const RULE_EVALUATION_IGNORED_PATH_PATTERN = /(?:^|\/)src\/(?:test|ohosTest)(?:\/|$)/;

// 规则引擎只看这个归一化视图，不直接耦合真实目录结构。
export interface WorkspaceFile {
  relativePath: string;
  content: string;
}

export interface CollectedEvidence {
  workspaceFiles: WorkspaceFile[];
  originalFiles: string[];
  patchText?: string;
  changedFiles: string[];
  summary: EvidenceSummary;
}

function normalizeRelativePath(relativePath: string): string {
  return relativePath.replace(/^workspace\//, "").replace(/^original\//, "");
}

function extractChangedFilesFromPatch(patchText: string | undefined): string[] {
  if (!patchText) {
    return [];
  }

  return Array.from(
    new Set(
      Array.from(
        patchText.matchAll(/^(?:diff --git a\/.+? b\/(.+)|\+\+\+ b\/(.+))$/gm),
      )
        .map((match) => match[1] ?? match[2] ?? "")
        .map((relativePath) => normalizeRelativePath(relativePath))
        .filter(Boolean),
    ),
  );
}

export async function collectEvidence(
  caseInput: CaseInput,
  options: { taskType?: TaskType } = {},
): Promise<CollectedEvidence> {
  // 这里同时收集 workspace/original/patch 三类证据，供规则和评分共用。
  const workspaceFilePaths = await collectVisibleFiles(caseInput.generatedProjectPath, {
    extraIgnoredPathPrefixes: RULE_EVALUATION_IGNORED_PATH_PREFIXES,
  }).then((files) => files.filter((relativePath) => !isRuleEvaluationIgnoredPath(relativePath)));
  const originalFiles = await collectVisibleFiles(caseInput.originalProjectPath, {
    extraIgnoredPathPrefixes: RULE_EVALUATION_IGNORED_PATH_PREFIXES,
  })
    .then((files) => files.filter((relativePath) => !isRuleEvaluationIgnoredPath(relativePath)))
    .catch(() => []);
  const workspaceFiles = await Promise.all(
    workspaceFilePaths.map(async (relativePath) => ({
      relativePath,
      content: await fs.readFile(path.join(caseInput.generatedProjectPath, relativePath), "utf-8"),
    })),
  );

  let patchText: string | undefined;
  try {
    patchText = caseInput.patchPath ? await fs.readFile(caseInput.patchPath, "utf-8") : undefined;
  } catch {
    patchText = undefined;
  }

  const changedFiles = extractChangedFilesFromPatch(patchText);
  const shouldLimitToChangedFiles =
    options.taskType !== undefined &&
    options.taskType !== "full_generation" &&
    changedFiles.length > 0;
  const scopedWorkspaceFiles = shouldLimitToChangedFiles
    ? workspaceFiles.filter((file) => changedFiles.includes(file.relativePath))
    : workspaceFiles;

  return {
    workspaceFiles: scopedWorkspaceFiles,
    originalFiles,
    patchText,
    changedFiles,
    summary: {
      workspaceFileCount: scopedWorkspaceFiles.length,
      originalFileCount: originalFiles.length,
      changedFileCount: changedFiles.length,
      changedFiles,
      hasPatch: Boolean(patchText),
    },
  };
}

function isRuleEvaluationIgnoredPath(relativePath: string): boolean {
  return RULE_EVALUATION_IGNORED_PATH_PATTERN.test(relativePath);
}
