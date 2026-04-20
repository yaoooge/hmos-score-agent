import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { upsertEnvVars } from "../src/io/envFile.js";
import { resolveDefaultCasePath, runSingleCase } from "../src/service.js";
import { buildRunCaseId } from "../src/service/runCaseId.js";
import {
  normalizeExecutionMode,
  normalizeLauncherAnswers,
  parseLauncherArgs,
} from "../src/tools/runInteractiveScore.js";

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

async function createCaseDirectory(rootDir: string, caseName: string): Promise<string> {
  const casePath = path.join(rootDir, "cases", caseName);
  await fs.mkdir(path.join(casePath, "original"), { recursive: true });
  await fs.mkdir(path.join(casePath, "workspace"), { recursive: true });
  await fs.writeFile(path.join(casePath, "input.txt"), `case ${caseName}\n`, "utf-8");
  return casePath;
}

// 统一构造 launcher 用例，避免每个测试重复拼装目录结构。
async function createLauncherCaseFixture(t: test.TestContext): Promise<{
  casePath: string;
  localCaseRoot: string;
  originalLocalCaseRoot?: string;
  originalReferenceRoot?: string;
}> {
  const caseRoot = await makeTempDir(t);
  const localCaseRoot = await makeTempDir(t);
  const casePath = path.join(caseRoot, "sample-case");

  await fs.mkdir(path.join(casePath, "original", "entry", "src", "main", "ets"), {
    recursive: true,
  });
  await fs.mkdir(path.join(casePath, "workspace", "entry", "src", "main", "ets"), {
    recursive: true,
  });
  await fs.mkdir(path.join(casePath, "diff"), { recursive: true });
  await fs.writeFile(path.join(casePath, "input.txt"), "请修复页面中的 bug", "utf-8");
  await fs.writeFile(
    path.join(casePath, "original", "entry", "src", "main", "ets", "Index.ets"),
    "let x: number = 1;\n",
    "utf-8",
  );
  await fs.writeFile(
    path.join(casePath, "workspace", "entry", "src", "main", "ets", "Index.ets"),
    "let x: any = 1;\n",
    "utf-8",
  );
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
  const envPath = await createTempEnv(
    t,
    "MODEL_PROVIDER_BASE_URL=https://old.example/v1\nMODEL_PROVIDER_MODEL=gpt-4o-mini\n",
  );

  await upsertEnvVars(envPath, {
    MODEL_PROVIDER_BASE_URL: "https://new.example/v1",
    MODEL_PROVIDER_API_KEY: "sk-test",
  });

  const text = await fs.readFile(envPath, "utf-8");
  assert.match(text, /MODEL_PROVIDER_BASE_URL=https:\/\/new\.example\/v1/);
  assert.match(text, /MODEL_PROVIDER_API_KEY=sk-test/);
  assert.match(text, /MODEL_PROVIDER_MODEL=gpt-4o-mini/);
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

test("normalizeExecutionMode defaults blank input to local", () => {
  assert.equal(normalizeExecutionMode(""), "local");
  assert.equal(normalizeExecutionMode("  "), "local");
});

test("normalizeExecutionMode rejects removed remote launcher mode", () => {
  assert.throws(
    () => normalizeExecutionMode("remote"),
    /执行模式仅支持 local。远端任务请直接调用 \/score\/run-remote-task 接口。/,
  );
  assert.throws(
    () => normalizeExecutionMode("network"),
    /执行模式仅支持 local。远端任务请直接调用 \/score\/run-remote-task 接口。/,
  );
});

test("launcher source uses provider-neutral env names and prompts", async () => {
  const source = await fs.readFile(
    path.resolve(process.cwd(), "src/tools/runInteractiveScore.ts"),
    "utf-8",
  );
  assert.match(source, /执行模式/);
  assert.equal(/downloadUrl/.test(source), false);
  assert.equal(/runRemoteTask/.test(source), false);
  assert.match(source, /run-remote-task/);
  assert.match(source, /模型服务 baseURL|MODEL_PROVIDER_BASE_URL/);
  assert.match(source, /模型服务 apiKey|MODEL_PROVIDER_API_KEY/);
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

test("parseLauncherArgs resolves explicit --case and falls back to the first case under cases", async (t) => {
  const originalCwd = process.cwd();
  const tempRoot = await makeTempDir(t);
  t.after(() => {
    process.chdir(originalCwd);
  });

  await createCaseDirectory(tempRoot, "bug_fix_001");
  await createCaseDirectory(tempRoot, "requirement_004");
  process.chdir(tempRoot);

  assert.equal(
    parseLauncherArgs(["--case", "examples/custom-case"]),
    path.resolve(process.cwd(), "examples/custom-case"),
  );
  assert.equal(parseLauncherArgs([]), path.resolve(process.cwd(), "cases", "bug_fix_001"));
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

test("runSingleCase omits prompt snapshots and writes updated case-info metadata into inputs", async (t) => {
  const fixture = await createLauncherCaseFixture(t);
  process.env.LOCAL_CASE_ROOT = fixture.localCaseRoot;
  process.env.DEFAULT_REFERENCE_ROOT = path.resolve(process.cwd(), "references/scoring");

  try {
    const result = await runSingleCase(fixture.casePath);
    await assert.rejects(fs.readFile(path.join(result.caseDir, "inputs", "prompt.txt"), "utf-8"));
    await assert.rejects(
      fs.readFile(path.join(result.caseDir, "inputs", "original-prompt.txt"), "utf-8"),
    );
    const caseInfo = JSON.parse(
      await fs.readFile(path.join(result.caseDir, "inputs", "case-info.json"), "utf-8"),
    );

    assert.equal(caseInfo.task_type, "bug_fix");
    assert.equal(caseInfo.source_case_path, fixture.casePath);
    assert.equal(caseInfo.patch_path.endsWith("changes.patch"), true);
    assert.equal("original_prompt_file" in caseInfo, false);
    assert.equal(caseInfo.agent_prompt_file, "inputs/agent-prompt.txt");
    assert.equal(typeof caseInfo.agent_assistance_enabled, "boolean");
    assert.equal(typeof caseInfo.agent_model, "string");
    assert.match(caseInfo.agent_run_status, /not_enabled|success|failed|invalid_output|skipped/);
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
