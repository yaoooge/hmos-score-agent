import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { RemoteEvaluationTask, RemoteTaskFileManifest } from "../types.js";

const execFileAsync = promisify(execFile);

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

function parseManifest(url: string, sourceText: string): RemoteTaskFileManifest {
  const manifest = JSON.parse(sourceText) as RemoteTaskFileManifest;
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
    throw new Error(`Invalid remote manifest from ${url}: files must be a non-empty array`);
  }
  return manifest;
}

async function writeManifestToDirectory(
  url: string,
  outputDir: string,
  manifest: RemoteTaskFileManifest,
): Promise<string[]> {
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

function isZipPayload(url: string, contentType: string | null, bytes: Uint8Array): boolean {
  const loweredType = contentType?.toLowerCase() ?? "";
  const lowerUrl = url.toLowerCase();
  const hasZipMagic =
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    [0x03, 0x05, 0x07].includes(bytes[2] ?? -1) &&
    [0x04, 0x06, 0x08].includes(bytes[3] ?? -1);

  return loweredType.includes("zip") || lowerUrl.endsWith(".zip") || hasZipMagic;
}

function validateZipEntries(url: string, entries: string[]): string[] {
  const fileEntries = entries.filter((entry) => entry.length > 0 && !entry.endsWith("/"));
  if (fileEntries.length === 0) {
    throw new Error(`Remote archive from ${url} does not contain any files`);
  }

  for (const entry of fileEntries) {
    const normalized = path.posix.normalize(entry.replace(/\\/g, "/"));
    if (
      normalized.length === 0 ||
      normalized === "." ||
      path.posix.isAbsolute(normalized) ||
      normalized === ".." ||
      normalized.startsWith("../")
    ) {
      throw new Error(`Remote archive from ${url} contains an unsafe entry: ${entry}`);
    }
  }

  return fileEntries;
}

async function extractZipToDirectory(
  url: string,
  outputDir: string,
  archiveBytes: Uint8Array,
): Promise<string[]> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "hmos-remote-archive-"));
  const archivePath = path.join(tempDir, "bundle.zip");

  try {
    await fs.writeFile(archivePath, archiveBytes);
    const listing = await execFileAsync("unzip", ["-Z1", archivePath]);
    const entries = validateZipEntries(
      url,
      listing.stdout
        .split(/\r?\n/)
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0),
    );

    await fs.mkdir(outputDir, { recursive: true });
    await execFileAsync("unzip", ["-qq", archivePath, "-d", outputDir]);
    return entries.map((entry) => path.join(outputDir, ...entry.split("/")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
      throw new Error(`Failed to extract remote archive from ${url}: unzip command is unavailable`);
    }
    throw error;
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

export async function downloadManifestToDirectory(
  url: string,
  outputDir: string,
): Promise<string[]> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download remote project ${url}: ${response.status}`);
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (isZipPayload(url, response.headers.get("Content-Type"), bytes)) {
    return extractZipToDirectory(url, outputDir, bytes);
  }

  const sourceText = new TextDecoder("utf-8").decode(bytes);
  return writeManifestToDirectory(url, outputDir, parseManifest(url, sourceText));
}
