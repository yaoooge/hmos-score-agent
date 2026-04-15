import fs from "node:fs/promises";
import path from "node:path";

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
