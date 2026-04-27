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
  await fs.writeFile(
    path.join(caseDir, "original", "src", "feature.txt"),
    "restaurant-list\n",
    "utf-8",
  );
  await fs.writeFile(
    path.join(caseDir, "workspace", "src", "feature.txt"),
    "restaurant-grid\n",
    "utf-8",
  );
  return caseDir;
}

test("generateCasePatch writes a unified diff between original and workspace", async (t) => {
  const caseDir = await createCaseFixture(t);
  const patchPath = path.join(caseDir, "diff", "changes.patch");

  await generateCasePatch(caseDir, patchPath);

  const patchText = await fs.readFile(patchPath, "utf-8");
  assert.match(
    patchText,
    /diff --git a\/original\/src\/feature\.txt b\/workspace\/src\/feature\.txt/,
  );
  assert.match(patchText, /restaurant-grid/);
});

test("generateCasePatch excludes transient workspace artifacts from the diff", async (t) => {
  const caseDir = await createCaseFixture(t);
  const patchPath = path.join(caseDir, "diff", "changes.patch");

  await fs.mkdir(path.join(caseDir, "workspace", ".agent_bench"), { recursive: true });
  await fs.mkdir(path.join(caseDir, "workspace", ".hvigor"), { recursive: true });
  await fs.mkdir(path.join(caseDir, "workspace", "build"), { recursive: true });
  await fs.writeFile(
    path.join(caseDir, "workspace", ".agent_bench", "noise.patch"),
    "noise\n",
    "utf-8",
  );
  await fs.writeFile(path.join(caseDir, "workspace", ".hvigor", "cache.json"), "noise\n", "utf-8");
  await fs.writeFile(path.join(caseDir, "workspace", "build", "artifact.txt"), "noise\n", "utf-8");

  await generateCasePatch(caseDir, patchPath);

  const patchText = await fs.readFile(patchPath, "utf-8");
  assert.doesNotMatch(patchText, /\.agent_bench/);
  assert.doesNotMatch(patchText, /\.hvigor/);
  assert.doesNotMatch(patchText, /build\/artifact\.txt/);
});

test("generateCasePatch excludes all dot directories and resources directories", async (t) => {
  const caseDir = await createCaseFixture(t);
  const patchPath = path.join(caseDir, "diff", "changes.patch");

  await fs.mkdir(path.join(caseDir, "workspace", "src", ".cache"), { recursive: true });
  await fs.mkdir(path.join(caseDir, "workspace", "entry", "src", "main", "resources"), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(caseDir, "workspace", "src", ".cache", "generated.txt"),
    "generated cache\n",
    "utf-8",
  );
  await fs.writeFile(
    path.join(caseDir, "workspace", "entry", "src", "main", "resources", "string.json"),
    "{\"app_name\":\"Demo\"}\n",
    "utf-8",
  );

  await generateCasePatch(caseDir, patchPath);

  const patchText = await fs.readFile(patchPath, "utf-8");
  assert.doesNotMatch(patchText, /src\/\.cache\/generated\.txt/);
  assert.doesNotMatch(patchText, /entry\/src\/main\/resources\/string\.json/);
  assert.match(patchText, /restaurant-grid/);
});

test("generateCasePatch excludes src test directories", async (t) => {
  const caseDir = await createCaseFixture(t);
  const patchPath = path.join(caseDir, "diff", "changes.patch");

  await fs.mkdir(path.join(caseDir, "workspace", "entry", "src", "test"), {
    recursive: true,
  });
  await fs.mkdir(path.join(caseDir, "workspace", "entry", "src", "ohosTest", "ets", "test"), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(caseDir, "workspace", "entry", "src", "test", "LocalUnit.test.ets"),
    "local unit test\n",
    "utf-8",
  );
  await fs.writeFile(
    path.join(caseDir, "workspace", "entry", "src", "ohosTest", "ets", "test", "Ability.test.ets"),
    "ohos test\n",
    "utf-8",
  );

  await generateCasePatch(caseDir, patchPath);

  const patchText = await fs.readFile(patchPath, "utf-8");
  assert.doesNotMatch(patchText, /entry\/src\/test\/LocalUnit\.test\.ets/);
  assert.doesNotMatch(patchText, /entry\/src\/ohosTest\/ets\/test\/Ability\.test\.ets/);
  assert.match(patchText, /restaurant-grid/);
});

test("generateCasePatch ignores files named BuildProfile.ets", async (t) => {
  const caseDir = await createCaseFixture(t);
  const patchPath = path.join(caseDir, "diff", "changes.patch");

  await fs.writeFile(
    path.join(caseDir, "original", "src", "BuildProfile.ets"),
    "export const arkOptions = { strict: true };\n",
    "utf-8",
  );
  await fs.writeFile(
    path.join(caseDir, "workspace", "src", "BuildProfile.ets"),
    "export const arkOptions = { strict: false };\n",
    "utf-8",
  );
  await fs.mkdir(path.join(caseDir, "workspace", "nested"), { recursive: true });
  await fs.writeFile(
    path.join(caseDir, "workspace", "nested", "BuildProfile.ets"),
    "export const generated = true;\n",
    "utf-8",
  );

  await generateCasePatch(caseDir, patchPath);

  const patchText = await fs.readFile(patchPath, "utf-8");
  assert.doesNotMatch(patchText, /BuildProfile\.ets/);
  assert.match(patchText, /restaurant-grid/);
});

test("generateCasePatch respects original and workspace root gitignore files", async (t) => {
  const caseDir = await createCaseFixture(t);
  const patchPath = path.join(caseDir, "diff", "changes.patch");

  await fs.writeFile(path.join(caseDir, "original", ".gitignore"), "tmp/\n", "utf-8");
  await fs.writeFile(path.join(caseDir, "workspace", ".gitignore"), "generated/\n*.log\n", "utf-8");
  await fs.mkdir(path.join(caseDir, "original", "tmp"), { recursive: true });
  await fs.mkdir(path.join(caseDir, "workspace", "generated"), { recursive: true });
  await fs.writeFile(path.join(caseDir, "original", "tmp", "archived.txt"), "archived\n", "utf-8");
  await fs.writeFile(
    path.join(caseDir, "workspace", "generated", "artifact.txt"),
    "compiled any\n",
    "utf-8",
  );
  await fs.writeFile(path.join(caseDir, "workspace", "trace.log"), "compiled any\n", "utf-8");
  await fs.writeFile(
    path.join(caseDir, "workspace", "src", "feature.txt"),
    "restaurant-grid-updated\n",
    "utf-8",
  );

  await generateCasePatch(caseDir, patchPath);

  const patchText = await fs.readFile(patchPath, "utf-8");
  assert.doesNotMatch(patchText, /original\/tmp\/archived\.txt/);
  assert.doesNotMatch(patchText, /workspace\/generated\/artifact\.txt/);
  assert.doesNotMatch(patchText, /workspace\/trace\.log/);
  assert.match(patchText, /restaurant-grid-updated/);
});

test("README documents directory-based patch generation", async () => {
  const readme = await fs.readFile(path.resolve(process.cwd(), "README.md"), "utf-8");
  assert.match(readme, /git diff --no-index|npm run case:patch/);
  assert.match(readme, /\.gitignore/);
  assert.match(readme, /workspace\/\.gitignore/);
  assert.match(readme, /original\/\.gitignore/);
});
