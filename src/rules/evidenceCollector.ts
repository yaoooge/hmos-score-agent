import fs from "node:fs/promises";
import path from "node:path";
import { CaseInput, EvidenceSummary, TaskType } from "../types.js";
import { collectVisibleFiles } from "../commons/utils/gitignoreMatcher.js";
import { filterPatchTextForIgnoredFiles, isIgnoredCaseFilePath } from "../commons/utils/ignoredFiles.js";

const RULE_EVALUATION_IGNORED_PATH_PREFIXES = ["entry/src/test", "entry/src/ohosTest"];
const RULE_EVALUATION_IGNORED_PATH_PATTERN = /(?:^|\/)src\/(?:test|ohosTest)(?:\/|$)/;

// 规则引擎只看这个归一化视图，不直接耦合真实目录结构。
export interface WorkspaceFile {
  relativePath: string;
  content: string;
  patchLineNumbers?: number[];
}

export interface CollectedEvidence {
  workspaceFiles: WorkspaceFile[];
  allWorkspaceFiles?: WorkspaceFile[];
  originalFiles: string[];
  patchText?: string;
  changedFiles: string[];
  caseDir?: string;
  summary: EvidenceSummary;
}

function normalizeRelativePath(relativePath: string): string {
  return relativePath.replace(/^workspace\//, "").replace(/^original\//, "");
}

interface PatchScope {
  changedFiles: string[];
  addedLineNumbersByFile: Map<string, number[]>;
}

function parsePatchScope(patchText: string | undefined): PatchScope {
  if (!patchText) {
    return {
      changedFiles: [],
      addedLineNumbersByFile: new Map(),
    };
  }

  const changedFiles = new Set<string>();
  const addedLineNumbersByFile = new Map<string, number[]>();
  let currentFile: string | undefined;
  let nextNewLineNumber: number | undefined;

  function registerFile(relativePath: string): void {
    if (!relativePath || relativePath === "/dev/null") {
      return;
    }

    const normalizedPath = normalizeRelativePath(relativePath);
    if (!normalizedPath || isIgnoredCaseFilePath(normalizedPath)) {
      currentFile = undefined;
      return;
    }

    currentFile = normalizedPath;
    changedFiles.add(normalizedPath);
    if (!addedLineNumbersByFile.has(normalizedPath)) {
      addedLineNumbersByFile.set(normalizedPath, []);
    }
  }

  for (const line of patchText.split(/\r?\n/)) {
    const diffMatch = /^diff --git a\/.+? b\/(.+)$/.exec(line);
    if (diffMatch?.[1]) {
      registerFile(diffMatch[1]);
      nextNewLineNumber = undefined;
      continue;
    }

    const newFileMatch = /^\+\+\+ b\/(.+)$/.exec(line);
    if (newFileMatch?.[1]) {
      registerFile(newFileMatch[1]);
      continue;
    }

    const hunkMatch = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunkMatch?.[1]) {
      nextNewLineNumber = Number(hunkMatch[1]);
      continue;
    }

    if (!currentFile || nextNewLineNumber === undefined) {
      continue;
    }

    if (line.startsWith("+") && !line.startsWith("+++")) {
      addedLineNumbersByFile.get(currentFile)?.push(nextNewLineNumber);
      nextNewLineNumber += 1;
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      continue;
    } else if (!line.startsWith("\\")) {
      nextNewLineNumber += 1;
    }
  }

  return {
    changedFiles: [...changedFiles],
    addedLineNumbersByFile,
  };
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

function isRuleEvaluationIgnoredPath(relativePath: string): boolean {
  return RULE_EVALUATION_IGNORED_PATH_PATTERN.test(relativePath);
}
