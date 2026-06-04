import fs from "node:fs/promises";
import path from "node:path";
import type { CaseInput, TaskType } from "../../types.js";
import { collectVisibleFiles } from "../../commons/utils/gitignoreMatcher.js";
import { filterPatchTextForIgnoredFiles } from "../../commons/utils/ignoredFiles.js";
import { parsePatchScope } from "./patchScope.js";
import {
  RULE_EVALUATION_IGNORED_PATH_PREFIXES,
  isRuleEvaluationIgnoredPath,
} from "./pathPolicy.js";
import type { CollectedEvidence } from "./types.js";

export async function collectEvidence(
  caseInput: CaseInput,
  options: { taskType?: TaskType } = {},
): Promise<CollectedEvidence> {
  void options;
  // 这里同时收集 workspace/original/patch 三类证据，供规则和评分共用。
  const workspaceFilePaths = await collectVisibleFiles(caseInput.generatedProjectPath, {
    extraIgnoredPathPrefixes: RULE_EVALUATION_IGNORED_PATH_PREFIXES,
  }).then((files) => files.filter((relativePath) => !isRuleEvaluationIgnoredPath(relativePath)));
  const originalFiles = await collectVisibleFiles(caseInput.originalProjectPath, {
    extraIgnoredPathPrefixes: RULE_EVALUATION_IGNORED_PATH_PREFIXES,
  })
    .then((files) => files.filter((relativePath) => !isRuleEvaluationIgnoredPath(relativePath)))
    .catch(() => []);
  let patchText: string | undefined;
  try {
    patchText = caseInput.patchPath
      ? filterPatchTextForIgnoredFiles(await fs.readFile(caseInput.patchPath, "utf-8"))
      : undefined;
  } catch {
    patchText = undefined;
  }

  const patchScope = parsePatchScope(patchText);
  const changedFiles = patchScope.changedFiles;
  const patchScopedFileSet = new Set(changedFiles);
  const shouldLimitToPatchFiles = changedFiles.length > 0;
  const workspaceFiles = await Promise.all(
    workspaceFilePaths.map(async (relativePath) => ({
      relativePath,
      content: await fs.readFile(path.join(caseInput.generatedProjectPath, relativePath), "utf-8"),
      patchLineNumbers: shouldLimitToPatchFiles
        ? (patchScope.addedLineNumbersByFile.get(relativePath) ?? [])
        : undefined,
    })),
  );

  const scopedWorkspaceFiles = shouldLimitToPatchFiles
    ? workspaceFiles.filter((file) => patchScopedFileSet.has(file.relativePath))
    : workspaceFiles;

  return {
    workspaceFiles: scopedWorkspaceFiles,
    allWorkspaceFiles: workspaceFiles,
    originalFiles,
    patchText,
    changedFiles,
    caseDir: deriveCaseDir(caseInput),
    summary: {
      workspaceFileCount: scopedWorkspaceFiles.length,
      originalFileCount: originalFiles.length,
      changedFileCount: changedFiles.length,
      changedFiles,
      changedLineNumbersByFile: Object.fromEntries(patchScope.addedLineNumbersByFile),
      hasPatch: Boolean(patchText),
    },
  };
}

function deriveCaseDir(caseInput: CaseInput): string | undefined {
  if (caseInput.patchPath && path.basename(path.dirname(caseInput.patchPath)) === "diff") {
    return path.dirname(path.dirname(caseInput.patchPath));
  }
  if (caseInput.patchPath && path.basename(path.dirname(caseInput.patchPath)) === "intermediate") {
    return path.dirname(path.dirname(caseInput.patchPath));
  }
  if (
    caseInput.patchPath &&
    path.basename(path.dirname(caseInput.patchPath)) === "patch" &&
    path.basename(path.dirname(path.dirname(caseInput.patchPath))) === "opencode-sandbox"
  ) {
    return path.dirname(path.dirname(path.dirname(caseInput.patchPath)));
  }
  if (path.basename(caseInput.generatedProjectPath) === "workspace") {
    return path.dirname(caseInput.generatedProjectPath);
  }
  if (
    path.basename(caseInput.generatedProjectPath) === "generated" &&
    path.basename(path.dirname(caseInput.generatedProjectPath)) === "opencode-sandbox"
  ) {
    return path.dirname(path.dirname(caseInput.generatedProjectPath));
  }
  return undefined;
}
