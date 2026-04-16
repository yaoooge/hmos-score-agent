import fs from "node:fs/promises";
import path from "node:path";
import { CaseInput, EvidenceSummary } from "../types.js";

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

async function collectFiles(rootDir: string, currentDir = rootDir): Promise<string[]> {
  // 先做纯文件清单收集，后续切到 AST 时也可以复用这层遍历。
  const entries = await fs.readdir(currentDir, { withFileTypes: true });
  const results: string[] = [];

  for (const entry of entries) {
    const nextPath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await collectFiles(rootDir, nextPath)));
    } else if (entry.isFile()) {
      results.push(path.relative(rootDir, nextPath));
    }
  }

  return results.sort();
}

export async function collectEvidence(caseInput: CaseInput): Promise<CollectedEvidence> {
  // 这里同时收集 workspace/original/patch 三类证据，供规则和评分共用。
  const workspaceFilePaths = await collectFiles(caseInput.generatedProjectPath);
  const originalFiles = await collectFiles(caseInput.originalProjectPath).catch(() => []);
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

  const changedFiles = patchText
    ? Array.from(
        new Set(
          // 目前只从 unified diff 中提取 `+++ b/...` 作为变更文件来源。
          Array.from(patchText.matchAll(/^\+\+\+ b\/(.+)$/gm)).map((match) => match[1]).filter(Boolean),
        ),
      )
    : [];

  return {
    workspaceFiles,
    originalFiles,
    patchText,
    changedFiles,
    summary: {
      workspaceFileCount: workspaceFiles.length,
      originalFileCount: originalFiles.length,
      changedFileCount: changedFiles.length,
      changedFiles,
      hasPatch: Boolean(patchText),
    },
  };
}
