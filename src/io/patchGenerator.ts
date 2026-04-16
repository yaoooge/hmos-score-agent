import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function generateCasePatch(caseDir: string, outputPath: string): Promise<string> {
  const resolvedCaseDir = path.resolve(caseDir);
  const originalDir = path.join(resolvedCaseDir, "original");
  const workspaceDir = path.join(resolvedCaseDir, "workspace");

  await fs.mkdir(path.dirname(outputPath), { recursive: true });

  let patchText = "";
  try {
    const result = await execFileAsync(
      "git",
      ["diff", "--no-index", "--no-ext-diff", "--", "original", "workspace"],
      {
        cwd: resolvedCaseDir,
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

  await Promise.all([
    fs.access(originalDir),
    fs.access(workspaceDir),
  ]);
  await fs.writeFile(outputPath, patchText, "utf-8");
  return outputPath;
}
