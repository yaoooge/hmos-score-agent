import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { upsertEnvVars } from "../src/io/envFile.js";
import { resolveDefaultCasePath } from "../src/service.js";
import { buildRunCaseId } from "../src/service/runCaseId.js";

const repoRoot = process.cwd();
const execFileAsync = promisify(execFile);

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
  assert.equal(
    packageJson.scripts?.["db:generate"],
    "node --import tsx scripts/generateSqliteDatabase.ts",
  );
  assert.equal(removedScript in (packageJson.scripts ?? {}), false);
});

test("database generation script backfills and validates sqlite before deploy", async (t) => {
  const root = await makeTempDir(t);
  const caseDir = path.join(root, "case-801");
  const envPath = path.join(root, ".env");
  await fs.mkdir(path.join(caseDir, "outputs"), { recursive: true });
  await fs.writeFile(
    path.join(caseDir, "outputs", "result.json"),
    JSON.stringify({
      basic_info: { case_name: "迁移验证用例", task_type: "bug_fix" },
      overall_conclusion: { total_score: 91, hard_gate_triggered: false },
      risks: [{ level: "low", title: "迁移风险样例" }],
    }),
    "utf-8",
  );
  await fs.writeFile(
    path.join(root, "remote-task-index.json"),
    JSON.stringify({
      records: [
        {
          taskId: 801,
          status: "completed",
          createdAt: 1000,
          updatedAt: 2000,
          caseDir,
          testCaseId: 1801,
          testCaseName: "迁移任务",
          testCaseType: "bug_fix",
        },
      ],
    }),
    "utf-8",
  );
  await fs.writeFile(
    path.join(root, "rule-violation-stats.json"),
    JSON.stringify({
      schemaVersion: 1,
      runs: [
        {
          taskId: 801,
          caseId: "case-801",
          testCaseId: 1801,
          caseName: "迁移验证用例",
          completedAt: "2026-05-20T01:00:00.000Z",
          boundRulePacks: [{ pack_id: "arkts-language", display_name: "ArkTS 语言规则" }],
          rules: [
            {
              pack_id: "arkts-language",
              rule_id: "ARKTS-MUST-001",
              rule_summary: "必须遵循 ArkTS 语言约束",
              rule_source: "must_rule",
              result: "不满足",
              conclusion: "发现违反 ArkTS 语言约束。",
            },
          ],
        },
      ],
    }),
    "utf-8",
  );
  await fs.writeFile(envPath, `LOCAL_CASE_ROOT=${root}\n`, "utf-8");

  const { stdout } = await execFileAsync(
    process.execPath,
    ["--import", "tsx", "scripts/generateSqliteDatabase.ts", "--env-file", envPath],
    { cwd: repoRoot },
  );

  assert.match(stdout, /SQLite database is ready/);
  assert.match(stdout, /remote_task: 1/);
  assert.match(stdout, /dashboard task summaries: 1/);
  assert.ok(await fs.stat(path.join(root, "score-index.sqlite3")));
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

test("buildRunCaseId includes task id when provided", () => {
  const result = buildRunCaseId({
    now: new Date("2026-04-16T11:22:33.000Z"),
    taskType: "case",
    taskId: 1628,
    uniqueId: "abc12345",
  });

  assert.equal(result, "20260416T112233_case_1628_abc12345");
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
