import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { upsertEnvVars } from "../src/io/envFile.js";
import { resolveDefaultCasePath } from "../src/service.js";
import { buildRunCaseId } from "../src/service/runCaseId.js";
import { parseLauncherArgs } from "../src/tools/runInteractiveScore.js";

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

test("launcher source does not configure direct model provider credentials", async () => {
  const source = await fs.readFile(
    path.resolve(process.cwd(), "src/tools/runInteractiveScore.ts"),
    "utf-8",
  );
  assert.equal(/执行模式/.test(source), false);
  assert.equal(/downloadUrl/.test(source), false);
  assert.equal(/runRemoteTask/.test(source), false);
  assert.doesNotMatch(source, new RegExp(["MODEL" + "_PROVIDER", "模型服务", "api" + "Key"].join("|")));
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
