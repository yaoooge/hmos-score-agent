import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createCaseToolExecutor } from "../src/agent/caseTools.js";

async function makeCaseRoot(t: test.TestContext): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "case-tools-"));
  await fs.mkdir(path.join(dir, "workspace", "entry", "src", "main", "ets", "home"), {
    recursive: true,
  });
  await fs.mkdir(path.join(dir, "intermediate"), { recursive: true });
  await fs.writeFile(
    path.join(dir, "workspace", "entry", "src", "main", "ets", "home", "HomePageVM.ets"),
    "export class HomePageVM { refreshLocalNews(): void {} }\n",
    "utf-8",
  );
  await fs.writeFile(
    path.join(dir, "intermediate", "effective.patch"),
    "diff --git a/entry/src/main/ets/home/HomePageVM.ets b/entry/src/main/ets/home/HomePageVM.ets\n",
    "utf-8",
  );
  await fs.writeFile(
    path.join(dir, "workspace", "config.json"),
    JSON.stringify({ feature: "local-news", enabled: true }, null, 2),
    "utf-8",
  );
  t.after(async () => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

test("read_file stays inside caseRoot and returns content", async (t) => {
  const caseRoot = await makeCaseRoot(t);
  const executor = createCaseToolExecutor({
    caseRoot,
    maxToolCalls: 6,
    maxTotalBytes: 61440,
    maxFiles: 20,
  });

  const result = await executor.execute({
    tool: "read_file",
    args: { path: "workspace/entry/src/main/ets/home/HomePageVM.ets" },
  });

  assert.equal(result.ok, true);
  assert.match(String(result.result?.content ?? ""), /refreshLocalNews/);
});

test("read_file rejects path traversal", async (t) => {
  const caseRoot = await makeCaseRoot(t);
  const executor = createCaseToolExecutor({
    caseRoot,
    maxToolCalls: 6,
    maxTotalBytes: 61440,
    maxFiles: 20,
  });

  const result = await executor.execute({
    tool: "read_file",
    args: { path: "../outside.txt" },
  });

  assert.equal(result.ok, false);
  assert.equal(result.error?.code, "path_out_of_scope");
});

test("read_patch returns effective patch content", async (t) => {
  const caseRoot = await makeCaseRoot(t);
  const executor = createCaseToolExecutor({
    caseRoot,
    maxToolCalls: 6,
    maxTotalBytes: 61440,
    maxFiles: 20,
  });

  const result = await executor.execute({
    tool: "read_patch",
    args: {},
  });

  assert.equal(result.ok, true);
  assert.match(String(result.result?.content ?? ""), /diff --git/);
});

test("list_dir returns directory entries inside caseRoot", async (t) => {
  const caseRoot = await makeCaseRoot(t);
  const executor = createCaseToolExecutor({
    caseRoot,
    maxToolCalls: 6,
    maxTotalBytes: 61440,
    maxFiles: 20,
  });

  const result = await executor.execute({
    tool: "list_dir",
    args: { path: "workspace" },
  });

  assert.equal(result.ok, true);
  assert.equal(
    Array.isArray((result.result?.entries as Array<{ name: string }>) ?? []),
    true,
  );
  assert.equal(
    ((result.result?.entries as Array<{ name: string }>) ?? []).some(
      (entry) => entry.name === "entry",
    ),
    true,
  );
});

test("grep_in_files finds matching lines in scoped files", async (t) => {
  const caseRoot = await makeCaseRoot(t);
  const executor = createCaseToolExecutor({
    caseRoot,
    maxToolCalls: 6,
    maxTotalBytes: 61440,
    maxFiles: 20,
  });

  const result = await executor.execute({
    tool: "grep_in_files",
    args: { path: "workspace", pattern: "refreshLocalNews" },
  });

  assert.equal(result.ok, true);
  assert.equal(Array.isArray(result.result?.matches), true);
  assert.equal(((result.result?.matches as Array<unknown>) ?? []).length > 0, true);
});

test("read_json parses json files inside caseRoot", async (t) => {
  const caseRoot = await makeCaseRoot(t);
  const executor = createCaseToolExecutor({
    caseRoot,
    maxToolCalls: 6,
    maxTotalBytes: 61440,
    maxFiles: 20,
  });

  const result = await executor.execute({
    tool: "read_json",
    args: { path: "workspace/config.json" },
  });

  assert.equal(result.ok, true);
  assert.equal(result.result?.value?.feature, "local-news");
});

test("executor rejects calls after tool budget is exhausted", async (t) => {
  const caseRoot = await makeCaseRoot(t);
  const executor = createCaseToolExecutor({
    caseRoot,
    maxToolCalls: 1,
    maxTotalBytes: 61440,
    maxFiles: 20,
  });

  const first = await executor.execute({
    tool: "read_patch",
    args: {},
  });
  const second = await executor.execute({
    tool: "read_file",
    args: { path: "workspace/entry/src/main/ets/home/HomePageVM.ets" },
  });

  assert.equal(first.ok, true);
  assert.equal(second.ok, false);
  assert.equal(second.error?.code, "tool_budget_exceeded");
});
