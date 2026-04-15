import fs from "node:fs/promises";
import path from "node:path";
import { CaseInput } from "../types.js";

export async function loadCaseFromPath(casePath: string): Promise<CaseInput> {
  const resolved = path.resolve(casePath);
  const stat = await fs.stat(resolved);
  if (!stat.isDirectory()) {
    throw new Error(`Case path is not a directory: ${resolved}`);
  }

  const promptFile = path.join(resolved, "input.txt");
  const promptText = await fs.readFile(promptFile, "utf-8");

  const originalProjectPath = path.join(resolved, "original");
  const generatedProjectPath = path.join(resolved, "workspace");
  const patchCandidate = path.join(resolved, "diff", "changes.patch");

  let patchPath: string | undefined;
  try {
    await fs.access(patchCandidate);
    patchPath = patchCandidate;
  } catch {
    patchPath = undefined;
  }

  return {
    caseId: path.basename(resolved),
    promptText,
    originalProjectPath,
    generatedProjectPath,
    patchPath,
  };
}
