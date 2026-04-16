import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { generateCasePatch } from "../src/io/patchGenerator.js";

async function makeTempDir(t: test.TestContext): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "patch-generator-"));
  t.after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });
  return dir;
}

async function createCaseFixture(t: test.TestContext): Promise<string> {
  const caseDir = await makeTempDir(t);
  await fs.mkdir(path.join(caseDir, "original", "src"), { recursive: true });
  await fs.mkdir(path.join(caseDir, "workspace", "src"), { recursive: true });
  await fs.mkdir(path.join(caseDir, "diff"), { recursive: true });
  await fs.writeFile(path.join(caseDir, "original", "src", "feature.txt"), "restaurant-list\n", "utf-8");
  await fs.writeFile(path.join(caseDir, "workspace", "src", "feature.txt"), "restaurant-grid\n", "utf-8");
  return caseDir;
}

test("generateCasePatch writes a unified diff between original and workspace", async (t) => {
  const caseDir = await createCaseFixture(t);
  const patchPath = path.join(caseDir, "diff", "changes.patch");

  await generateCasePatch(caseDir, patchPath);

  const patchText = await fs.readFile(patchPath, "utf-8");
  assert.match(patchText, /diff --git a\/original\/src\/feature\.txt b\/workspace\/src\/feature\.txt/);
  assert.match(patchText, /restaurant-grid/);
});

test("generateCasePatch excludes transient workspace artifacts from the diff", async (t) => {
  const caseDir = await createCaseFixture(t);
  const patchPath = path.join(caseDir, "diff", "changes.patch");

  await fs.mkdir(path.join(caseDir, "workspace", ".agent_bench"), { recursive: true });
  await fs.mkdir(path.join(caseDir, "workspace", ".hvigor"), { recursive: true });
  await fs.mkdir(path.join(caseDir, "workspace", "build"), { recursive: true });
  await fs.writeFile(path.join(caseDir, "workspace", ".agent_bench", "noise.patch"), "noise\n", "utf-8");
  await fs.writeFile(path.join(caseDir, "workspace", ".hvigor", "cache.json"), "noise\n", "utf-8");
  await fs.writeFile(path.join(caseDir, "workspace", "build", "artifact.txt"), "noise\n", "utf-8");

  await generateCasePatch(caseDir, patchPath);

  const patchText = await fs.readFile(patchPath, "utf-8");
  assert.doesNotMatch(patchText, /\.agent_bench/);
  assert.doesNotMatch(patchText, /\.hvigor/);
  assert.doesNotMatch(patchText, /build\/artifact\.txt/);
});

test("README documents directory-based patch generation", async () => {
  const readme = await fs.readFile(path.resolve(process.cwd(), "README.md"), "utf-8");
  assert.match(readme, /git diff --no-index|npm run case:patch/);
});
