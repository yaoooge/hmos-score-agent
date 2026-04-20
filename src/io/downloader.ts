import fs from "node:fs/promises";
import path from "node:path";
import { RemoteEvaluationTask, RemoteTaskFileManifest } from "../types.js";

export async function downloadToFile(url: string, outputPath: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to download ${url}: ${res.status}`);
  }
  const text = await res.text();
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, text, "utf-8");
  return outputPath;
}

export async function downloadJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download JSON ${url}: ${response.status}`);
  }

  return (await response.json()) as T;
}

export async function downloadRemoteTask(url: string): Promise<RemoteEvaluationTask> {
  return downloadJson<RemoteEvaluationTask>(url);
}

export async function downloadManifestToDirectory(
  url: string,
  outputDir: string,
): Promise<string[]> {
  const manifest = await downloadJson<RemoteTaskFileManifest>(url);
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
    throw new Error(`Invalid remote manifest from ${url}: files must be a non-empty array`);
  }

  const writtenFiles: string[] = [];
  for (const file of manifest.files) {
    if (typeof file?.path !== "string" || file.path.length === 0) {
      throw new Error(`Invalid remote manifest from ${url}: file.path is required`);
    }
    if (typeof file?.content !== "string") {
      throw new Error(`Invalid remote manifest from ${url}: file.content must be a string`);
    }

    const targetPath = path.join(outputDir, file.path);
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, file.content, "utf-8");
    writtenFiles.push(targetPath);
  }

  return writtenFiles;
}
