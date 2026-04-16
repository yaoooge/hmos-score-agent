import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const IGNORED_NAMES = new Set([
  ".git",
  ".agent_bench",
  ".hvigor",
  "build",
  "node_modules",
  "oh_modules",
  "oh-package-lock.json5",
]);

async function copyFilteredTree(sourceDir: string, targetDir: string): Promise<void> {
  await fs.mkdir(targetDir, { recursive: true });
  const entries = await fs.readdir(sourceDir, { withFileTypes: true });

  for (const entry of entries) {
    if (IGNORED_NAMES.has(entry.name) || entry.name.endsWith(".log")) {
      continue;
    }

    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      await copyFilteredTree(sourcePath, targetPath);
    } else if (entry.isFile()) {
      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.copyFile(sourcePath, targetPath);
    }
  }
}

export async function generateCasePatch(caseDir: string, outputPath: string): Promise<string> {
  const resolvedCaseDir = path.resolve(caseDir);
  const originalDir = path.join(resolvedCaseDir, "original");
  const workspaceDir = path.join(resolvedCaseDir, "workspace");

  await Promise.all([
    fs.access(originalDir),
    fs.access(workspaceDir),
  ]);

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "case-patch-"));
  const tempOriginalDir = path.join(tempRoot, "original");
  const tempWorkspaceDir = path.join(tempRoot, "workspace");

  await Promise.all([
    copyFilteredTree(originalDir, tempOriginalDir),
    copyFilteredTree(workspaceDir, tempWorkspaceDir),
  ]);

  let patchText = "";
  try {
    const result = await execFileAsync(
      "git",
      ["diff", "--no-index", "--no-ext-diff", "--", "original", "workspace"],
      {
        cwd: tempRoot,
        maxBuffer: 10 * 1024 * 1024,
      },
    );
    patchText = result.stdout;
  } catch (error) {
    const execError = error as NodeJS.ErrnoException & { code?: number; stdout?: string; stderr?: string };
    if (execError.code === 1 && typeof execError.stdout === "string") {
      patchText = execError.stdout;
    } else {
      const reason = execError.stderr ?? execError.message;
      throw new Error(`Failed to generate patch for ${resolvedCaseDir}: ${reason}`);
    }
  }

  try {
    await fs.writeFile(outputPath, patchText, "utf-8");
    return outputPath;
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}
