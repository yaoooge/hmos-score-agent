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

test("read_files returns multiple files in request order", async (t) => {
  const caseRoot = await makeCaseRoot(t);
  const executor = createCaseToolExecutor({
    caseRoot,
    maxToolCalls: 6,
    maxTotalBytes: 61440,
    maxFiles: 20,
  });

  const result = await executor.execute({
    tool: "read_files" as never,
    args: {
      paths: [
        "workspace/entry/src/main/ets/home/HomePageVM.ets",
        "workspace/config.json",
      ],
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(
    ((result.result?.files as Array<{ path: string }>) ?? []).map((file) => file.path),
    [
      "workspace/entry/src/main/ets/home/HomePageVM.ets",
      "workspace/config.json",
    ],
  );
  assert.match(
    String((result.result?.files as Array<{ content: string }>)?.[0]?.content ?? ""),
    /refreshLocalNews/,
  );
  assert.match(
    String((result.result?.files as Array<{ content: string }>)?.[1]?.content ?? ""),
    /local-news/,
  );
});

test("read_files rejects path traversal when any requested file is out of scope", async (t) => {
  const caseRoot = await makeCaseRoot(t);
  const executor = createCaseToolExecutor({
    caseRoot,
    maxToolCalls: 6,
    maxTotalBytes: 61440,
    maxFiles: 20,
  });

  const result = await executor.execute({
    tool: "read_files" as never,
    args: {
      paths: [
        "workspace/entry/src/main/ets/home/HomePageVM.ets",
        "../outside.txt",
      ],
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.error?.code, "path_out_of_scope");
});

test("read_files spends file budget per unique requested file and omits overflow paths", async (t) => {
  const caseRoot = await makeCaseRoot(t);
  const executor = createCaseToolExecutor({
    caseRoot,
    maxToolCalls: 6,
    maxTotalBytes: 61440,
    maxFiles: 1,
  });

  const result = await executor.execute({
    tool: "read_files" as never,
    args: {
      paths: [
        "workspace/entry/src/main/ets/home/HomePageVM.ets",
        "workspace/config.json",
      ],
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(
    ((result.result?.files as Array<{ path: string }>) ?? []).map((file) => file.path),
    ["workspace/entry/src/main/ets/home/HomePageVM.ets"],
  );
  assert.equal(result.result?.truncated, true);
  assert.deepEqual(
    (result.result?.omitted_paths as string[] | undefined) ?? [],
    ["workspace/config.json"],
  );
  assert.equal(result.budget.readFileCount, 1);
});

test("read_files returns the remaining files that fit file budget instead of failing mid-batch", async (t) => {
  const caseRoot = await makeCaseRoot(t);
  await fs.writeFile(path.join(caseRoot, "workspace", "a.txt"), "a".repeat(16), "utf-8");
  await fs.writeFile(path.join(caseRoot, "workspace", "b.txt"), "b".repeat(16), "utf-8");
  await fs.writeFile(path.join(caseRoot, "workspace", "c.txt"), "c".repeat(16), "utf-8");
  const executor = createCaseToolExecutor({
    caseRoot,
    maxToolCalls: 6,
    maxTotalBytes: 61440,
    maxFiles: 2,
  });

  const result = await executor.execute({
    tool: "read_files" as never,
    args: {
      paths: ["workspace/a.txt", "workspace/b.txt", "workspace/c.txt"],
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(
    ((result.result?.files as Array<{ path: string }>) ?? []).map((file) => file.path),
    ["workspace/a.txt", "workspace/b.txt"],
  );
  assert.equal(result.result?.truncated, true);
  assert.deepEqual(
    (result.result?.omitted_paths as string[] | undefined) ?? [],
    ["workspace/c.txt"],
  );
  assert.deepEqual(result.pathsRead, ["workspace/a.txt", "workspace/b.txt"]);
  assert.equal(result.budget.readFileCount, 2);
  assert.equal(result.budget.remainingFileSlots, 0);
});

test("read_files truncates later files to preserve shared byte budget", async (t) => {
  const caseRoot = await makeCaseRoot(t);
  const largeFile = "x".repeat(2048);
  await fs.writeFile(path.join(caseRoot, "workspace", "large-a.txt"), largeFile, "utf-8");
  await fs.writeFile(path.join(caseRoot, "workspace", "large-b.txt"), largeFile, "utf-8");
  const executor = createCaseToolExecutor({
    caseRoot,
    maxToolCalls: 6,
    maxTotalBytes: 3000,
    maxFiles: 20,
  });

  const result = await executor.execute({
    tool: "read_files" as never,
    args: {
      paths: ["workspace/large-a.txt", "workspace/large-b.txt"],
    },
  });

  assert.equal(result.ok, true);
  const files = (result.result?.files as Array<{ truncated: boolean; content: string }>) ?? [];
  assert.equal(files.length, 2);
  assert.equal(files[0]?.truncated, false);
  assert.equal(files[1]?.truncated, true);
  assert.equal(files[1]?.content.length < largeFile.length, true);
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

test("read_patch filters patch sections for files named BuildProfile.ets", async (t) => {
  const caseRoot = await makeCaseRoot(t);
  await fs.writeFile(
    path.join(caseRoot, "intermediate", "effective.patch"),
    [
      "diff --git a/entry/src/main/ets/BuildProfile.ets b/entry/src/main/ets/BuildProfile.ets",
      "@@ -1 +1 @@",
      "-let x: number = 1;",
      "+let x: any = 1;",
      "diff --git a/entry/src/main/ets/home/HomePageVM.ets b/entry/src/main/ets/home/HomePageVM.ets",
      "@@ -1 +1 @@",
      "-export class HomePageVM {}",
      "+export class HomePageVM { refreshLocalNews(): void {} }",
    ].join("\n"),
    "utf-8",
  );
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
  assert.doesNotMatch(String(result.result?.content ?? ""), /BuildProfile\.ets/);
  assert.match(String(result.result?.content ?? ""), /HomePageVM\.ets/);
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

test("read_patch accepts patch_path alias from model output", async (t) => {
  const caseRoot = await makeCaseRoot(t);
  const executor = createCaseToolExecutor({
    caseRoot,
    maxToolCalls: 6,
    maxTotalBytes: 61440,
    maxFiles: 20,
  });

  const result = await executor.execute({
    tool: "read_patch",
    args: { patch_path: "intermediate/effective.patch" },
  });

  assert.equal(result.ok, true);
  assert.match(String(result.result?.content ?? ""), /diff --git/);
});

test("grep_in_files accepts root and files aliases from model output", async (t) => {
  const caseRoot = await makeCaseRoot(t);
  const executor = createCaseToolExecutor({
    caseRoot,
    maxToolCalls: 6,
    maxTotalBytes: 61440,
    maxFiles: 20,
  });

  const result = await executor.execute({
    tool: "grep_in_files",
    args: {
      root: path.join(caseRoot, "workspace"),
      files: ["entry/src/main/ets/home/HomePageVM.ets"],
      pattern: "refreshLocalNews",
    },
  });

  assert.equal(result.ok, true);
  assert.equal(Array.isArray(result.result?.matches), true);
  assert.equal(((result.result?.matches as Array<unknown>) ?? []).length > 0, true);
});

test("grep_in_files accepts paths alias from model output", async (t) => {
  const caseRoot = await makeCaseRoot(t);
  const executor = createCaseToolExecutor({
    caseRoot,
    maxToolCalls: 6,
    maxTotalBytes: 61440,
    maxFiles: 20,
  });

  const result = await executor.execute({
    tool: "grep_in_files",
    args: {
      root: path.join(caseRoot, "workspace"),
      paths: ["entry/src/main/ets/home/HomePageVM.ets"],
      pattern: "refreshLocalNews",
    },
  });

  assert.equal(result.ok, true);
  assert.equal(Array.isArray(result.result?.matches), true);
  assert.equal(((result.result?.matches as Array<unknown>) ?? []).length > 0, true);
});

test("grep_in_files accepts patterns array from current model output", async (t) => {
  const caseRoot = await makeCaseRoot(t);
  const executor = createCaseToolExecutor({
    caseRoot,
    maxToolCalls: 6,
    maxTotalBytes: 61440,
    maxFiles: 20,
  });

  const result = await executor.execute({
    tool: "grep_in_files",
    args: {
      root: path.join(caseRoot, "workspace"),
      paths: ["entry/src/main/ets/home/HomePageVM.ets"],
      patterns: ["missingToken", "refreshLocalNews"],
    },
  });

  assert.equal(result.ok, true);
  assert.equal(Array.isArray(result.result?.matches), true);
  assert.equal(((result.result?.matches as Array<unknown>) ?? []).length > 0, true);
});

test("grep_in_files does not spend file budget on non-matching scanned files", async (t) => {
  const caseRoot = await makeCaseRoot(t);
  const noiseDir = path.join(caseRoot, "workspace", "noise");
  await fs.mkdir(noiseDir, { recursive: true });
  for (let index = 0; index < 25; index += 1) {
    await fs.writeFile(path.join(noiseDir, `Noise${index}.ets`), "export const noop = true;\n", "utf-8");
  }
  await fs.writeFile(path.join(noiseDir, "Needle.ets"), "const token = 'LocationKit';\n", "utf-8");

  const executor = createCaseToolExecutor({
    caseRoot,
    maxToolCalls: 6,
    maxTotalBytes: 61440,
    maxFiles: 2,
  });

  const result = await executor.execute({
    tool: "grep_in_files",
    args: {
      path: "workspace",
      patterns: ["LocationKit"],
      limit: 5,
    },
  });

  assert.equal(result.ok, true);
  assert.equal(((result.result?.matches as Array<unknown>) ?? []).length, 1);
  assert.equal(result.budget.readFileCount, 1);
});

test("read_patch allows configured effective patch path outside caseRoot", async (t) => {
  const caseRoot = await makeCaseRoot(t);
  const externalPatchDir = await fs.mkdtemp(path.join(os.tmpdir(), "external-patch-"));
  const externalPatchPath = path.join(externalPatchDir, "generated.patch");
  await fs.writeFile(externalPatchPath, "diff --git a/a b/b\n", "utf-8");
  t.after(async () => fs.rm(externalPatchDir, { recursive: true, force: true }));

  const executor = createCaseToolExecutor({
    caseRoot,
    effectivePatchPath: externalPatchPath,
    maxToolCalls: 6,
    maxTotalBytes: 61440,
    maxFiles: 20,
  });

  const result = await executor.execute({
    tool: "read_patch",
    args: { path: externalPatchPath },
  });

  assert.equal(result.ok, true);
  assert.match(String(result.result?.content ?? ""), /diff --git/);
});

test("read_patch keeps byte budget for follow-up reads by truncating large patches", async (t) => {
  const caseRoot = await makeCaseRoot(t);
  const largePatch = `${"diff --git a/a b/b\n+line\n".repeat(8000)}`;
  await fs.writeFile(path.join(caseRoot, "intermediate", "effective.patch"), largePatch, "utf-8");
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
  assert.equal(result.bytesReturned < 61440, true);
  assert.equal(result.budget.remainingBytes > 0, true);
  assert.equal(result.result?.truncated, true);
});
