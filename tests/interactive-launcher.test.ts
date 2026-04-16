import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { upsertEnvVars } from "../src/io/envFile.js";
import { runSingleCase } from "../src/service.js";
import { buildRunCaseId } from "../src/service/runCaseId.js";
import { normalizeLauncherAnswers, parseLauncherArgs } from "../src/tools/runInteractiveScore.js";

async function makeTempDir(t: test.TestContext): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "interactive-launcher-"));
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

// 统一构造 launcher 用例，避免每个测试重复拼装目录结构。
async function createLauncherCaseFixture(
  t: test.TestContext,
): Promise<{ casePath: string; localCaseRoot: string; originalLocalCaseRoot?: string; originalReferenceRoot?: string }> {
  const caseRoot = await makeTempDir(t);
  const localCaseRoot = await makeTempDir(t);
  const casePath = path.join(caseRoot, "sample-case");

  await fs.mkdir(path.join(casePath, "original", "entry", "src", "main", "ets"), { recursive: true });
  await fs.mkdir(path.join(casePath, "workspace", "entry", "src", "main", "ets"), { recursive: true });
  await fs.mkdir(path.join(casePath, "diff"), { recursive: true });
  await fs.writeFile(path.join(casePath, "input.txt"), "请修复页面中的 bug", "utf-8");
  await fs.writeFile(path.join(casePath, "original", "entry", "src", "main", "ets", "Index.ets"), "let x: number = 1;\n", "utf-8");
  await fs.writeFile(path.join(casePath, "workspace", "entry", "src", "main", "ets", "Index.ets"), "let x: any = 1;\n", "utf-8");
  await fs.writeFile(
    path.join(casePath, "diff", "changes.patch"),
    "diff --git a/entry/src/main/ets/Index.ets b/entry/src/main/ets/Index.ets\n@@ -1 +1 @@\n-let x: number = 1;\n+let x: any = 1;\n",
    "utf-8",
  );

  return {
    casePath,
    localCaseRoot,
    originalLocalCaseRoot: process.env.LOCAL_CASE_ROOT,
    originalReferenceRoot: process.env.DEFAULT_REFERENCE_ROOT,
  };
}

test("upsertEnvVars updates existing keys and appends missing ones", async (t) => {
  const envPath = await createTempEnv(t, "OPENAI_BASE_URL=https://old.example/v1\nOPENAI_MODEL=gpt-4o-mini\n");

  await upsertEnvVars(envPath, {
    OPENAI_BASE_URL: "https://new.example/v1",
    OPENAI_API_KEY: "sk-test",
  });

  const text = await fs.readFile(envPath, "utf-8");
  assert.match(text, /OPENAI_BASE_URL=https:\/\/new\.example\/v1/);
  assert.match(text, /OPENAI_API_KEY=sk-test/);
  assert.match(text, /OPENAI_MODEL=gpt-4o-mini/);
});

test("buildRunCaseId formats timestamp, task type and unique id", () => {
  const result = buildRunCaseId({
    now: new Date("2026-04-16T11:22:33.000Z"),
    taskType: "bug_fix",
    uniqueId: "abc12345",
  });

  assert.equal(result, "20260416T112233_bug_fix_abc12345");
});

test("normalizeLauncherAnswers keeps the prompted baseURL and apiKey", () => {
  const result = normalizeLauncherAnswers({
    baseURL: "https://api.example/v1",
    apiKey: "sk-test",
  });

  assert.equal(result.baseURL, "https://api.example/v1");
  assert.equal(result.apiKey, "sk-test");
});

test("parseLauncherArgs resolves explicit --case and falls back to init-input", () => {
  assert.equal(
    parseLauncherArgs(["--case", "examples/custom-case"]),
    path.resolve(process.cwd(), "examples/custom-case"),
  );
  assert.equal(parseLauncherArgs([]), path.resolve(process.cwd(), "init-input"));
});

test("runSingleCase stores artifacts under timestamp_taskType_uniqueId directories", async (t) => {
  const fixture = await createLauncherCaseFixture(t);
  process.env.LOCAL_CASE_ROOT = fixture.localCaseRoot;
  process.env.DEFAULT_REFERENCE_ROOT = path.resolve(process.cwd(), "references/scoring");

  try {
    const result = await runSingleCase(fixture.casePath);
    const baseName = path.basename(result.caseDir);
    assert.match(baseName, /^\d{8}T\d{6}_bug_fix_[a-f0-9]{8}$/);
  } finally {
    if (fixture.originalLocalCaseRoot === undefined) {
      delete process.env.LOCAL_CASE_ROOT;
    } else {
      process.env.LOCAL_CASE_ROOT = fixture.originalLocalCaseRoot;
    }

    if (fixture.originalReferenceRoot === undefined) {
      delete process.env.DEFAULT_REFERENCE_ROOT;
    } else {
      process.env.DEFAULT_REFERENCE_ROOT = fixture.originalReferenceRoot;
    }
  }
});

test("runSingleCase writes prompt snapshot and case-info metadata into inputs", async (t) => {
  const fixture = await createLauncherCaseFixture(t);
  process.env.LOCAL_CASE_ROOT = fixture.localCaseRoot;
  process.env.DEFAULT_REFERENCE_ROOT = path.resolve(process.cwd(), "references/scoring");

  try {
    const result = await runSingleCase(fixture.casePath);
    const promptText = await fs.readFile(path.join(result.caseDir, "inputs", "prompt.txt"), "utf-8");
    const caseInfo = JSON.parse(await fs.readFile(path.join(result.caseDir, "inputs", "case-info.json"), "utf-8"));

    assert.equal(promptText, "请修复页面中的 bug");
    assert.equal(caseInfo.task_type, "bug_fix");
    assert.equal(caseInfo.source_case_path, fixture.casePath);
    assert.equal(caseInfo.patch_path.endsWith("changes.patch"), true);
  } finally {
    if (fixture.originalLocalCaseRoot === undefined) {
      delete process.env.LOCAL_CASE_ROOT;
    } else {
      process.env.LOCAL_CASE_ROOT = fixture.originalLocalCaseRoot;
    }

    if (fixture.originalReferenceRoot === undefined) {
      delete process.env.DEFAULT_REFERENCE_ROOT;
    } else {
      process.env.DEFAULT_REFERENCE_ROOT = fixture.originalReferenceRoot;
    }
  }
});

test("runSingleCase writes key lifecycle events into logs/run.log", async (t) => {
  const fixture = await createLauncherCaseFixture(t);
  process.env.LOCAL_CASE_ROOT = fixture.localCaseRoot;
  process.env.DEFAULT_REFERENCE_ROOT = path.resolve(process.cwd(), "references/scoring");

  try {
    const result = await runSingleCase(fixture.casePath);
    const logText = await fs.readFile(path.join(result.caseDir, "logs", "run.log"), "utf-8");

    assert.match(logText, /启动评分流程/);
    assert.match(logText, /用例加载完成/);
    assert.match(logText, /任务类型判定完成 taskType=bug_fix/);
    assert.match(logText, /工作流执行完成/);
    assert.match(logText, /结果已落盘/);
    assert.match(logText, /上传跳过/);
  } finally {
    if (fixture.originalLocalCaseRoot === undefined) {
      delete process.env.LOCAL_CASE_ROOT;
    } else {
      process.env.LOCAL_CASE_ROOT = fixture.originalLocalCaseRoot;
    }

    if (fixture.originalReferenceRoot === undefined) {
      delete process.env.DEFAULT_REFERENCE_ROOT;
    } else {
      process.env.DEFAULT_REFERENCE_ROOT = fixture.originalReferenceRoot;
    }
  }
});
