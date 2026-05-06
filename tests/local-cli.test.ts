import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { upsertEnvVars } from "../src/io/envFile.js";
import { resolveDefaultCasePath } from "../src/service.js";
import { buildRunCaseId } from "../src/service/runCaseId.js";

const repoRoot = process.cwd();

async function makeTempDir(t: test.TestContext): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "local-cli-"));
  t.after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });
  return dir;
}

async function createTempEnv(t: test.TestContext, content: string): Promise<string> {
  const dir = await makeTempDir(t);
  const envPath = path.join(dir, ".env");
  await fs.writeFile(envPath, content, "utf-8");
  return envPath;
}

async function createCaseDirectory(rootDir: string, caseName: string): Promise<string> {
  const casePath = path.join(rootDir, "cases", caseName);
  await fs.mkdir(path.join(casePath, "original"), { recursive: true });
  await fs.mkdir(path.join(casePath, "workspace"), { recursive: true });
  await fs.writeFile(path.join(casePath, "input.txt"), `case ${caseName}\n`, "utf-8");
  return casePath;
}

test("package scripts expose score but not the removed launcher entry", async () => {
  const packageJson = JSON.parse(
    await fs.readFile(path.join(repoRoot, "package.json"), "utf-8"),
  ) as { scripts?: Record<string, string> };
  const removedScript = ["launch", "score"].join(":");

  assert.equal(typeof packageJson.scripts?.score, "string");
  assert.equal(removedScript in (packageJson.scripts ?? {}), false);
});

test("upsertEnvVars updates existing keys and appends missing ones", async (t) => {
  const envPath = await createTempEnv(
    t,
    "HMOS_OPENCODE_HOST=127.0.0.1\nHMOS_OPENCODE_MODEL_ID=old-model\n",
  );

  await upsertEnvVars(envPath, {
    HMOS_OPENCODE_HOST: "0.0.0.0",
    HMOS_OPENCODE_API_KEY: "test-key",
  });

  const text = await fs.readFile(envPath, "utf-8");
  assert.match(text, /HMOS_OPENCODE_HOST=0\.0\.0\.0/);
  assert.match(text, /HMOS_OPENCODE_API_KEY=test-key/);
  assert.match(text, /HMOS_OPENCODE_MODEL_ID=old-model/);
});

test("buildRunCaseId formats timestamp, task type and unique id", () => {
  const result = buildRunCaseId({
    now: new Date("2026-04-16T11:22:33.000Z"),
    taskType: "bug_fix",
    uniqueId: "abc12345",
  });

  assert.equal(result, "20260416T112233_bug_fix_abc12345");
});

test("resolveDefaultCasePath picks the first case directory under cases", async (t) => {
  const originalCwd = process.cwd();
  const tempRoot = await makeTempDir(t);
  t.after(() => {
    process.chdir(originalCwd);
  });

  await createCaseDirectory(tempRoot, "z_last_case");
  await createCaseDirectory(tempRoot, "a_first_case");
  process.chdir(tempRoot);

  assert.equal(resolveDefaultCasePath(), path.resolve(process.cwd(), "cases", "a_first_case"));
});
