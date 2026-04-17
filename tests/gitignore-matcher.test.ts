import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { collectVisibleFiles, loadIgnoreFilter } from "../src/io/gitignoreMatcher.js";

async function makeTempDir(t: test.TestContext): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "gitignore-matcher-"));
  t.after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });
  return dir;
}

test("loadIgnoreFilter applies root gitignore patterns and built-in fallback ignores", async (t) => {
  const rootDir = await makeTempDir(t);
  await fs.mkdir(path.join(rootDir, "src"), { recursive: true });
  await fs.mkdir(path.join(rootDir, "build"), { recursive: true });
  await fs.mkdir(path.join(rootDir, "foo-build"), { recursive: true });
  await fs.mkdir(path.join(rootDir, ".git"), { recursive: true });
  await fs.writeFile(
    path.join(rootDir, ".gitignore"),
    "dist/\n*.cache\nentry/build\nbar*\nfoo*/\n",
    "utf-8",
  );
  await fs.writeFile(path.join(rootDir, "src", "Index.ets"), "let value = 1;\n", "utf-8");
  await fs.writeFile(path.join(rootDir, "build", "artifact.txt"), "noise\n", "utf-8");
  await fs.writeFile(path.join(rootDir, "foo-build", "artifact.txt"), "noise\n", "utf-8");
  await fs.writeFile(path.join(rootDir, "trace.cache"), "noise\n", "utf-8");
  await fs.writeFile(path.join(rootDir, "bar-artifact.txt"), "noise\n", "utf-8");

  const filter = await loadIgnoreFilter(rootDir);

  assert.equal(filter.isIgnored("build", "directory"), true);
  assert.equal(filter.isIgnored("dist", "directory"), true);
  assert.equal(filter.isIgnored("trace.cache", "file"), true);
  assert.equal(filter.isIgnored("entry/build", "directory"), true);
  assert.equal(filter.isIgnored("foo-build", "directory"), true);
  assert.equal(filter.isIgnored("bar-artifact.txt", "file"), true);
  assert.equal(filter.isIgnored("src/Index.ets", "file"), false);
});

test("collectVisibleFiles returns only non-ignored relative paths", async (t) => {
  const rootDir = await makeTempDir(t);
  await fs.mkdir(path.join(rootDir, "src"), { recursive: true });
  await fs.mkdir(path.join(rootDir, "generated"), { recursive: true });
  await fs.mkdir(path.join(rootDir, "build"), { recursive: true });
  await fs.mkdir(path.join(rootDir, "foo-build"), { recursive: true });
  await fs.writeFile(path.join(rootDir, ".gitignore"), "generated/\nfoo*/\n", "utf-8");
  await fs.writeFile(path.join(rootDir, "src", "Index.ets"), "let value = 1;\n", "utf-8");
  await fs.writeFile(path.join(rootDir, "generated", "artifact.txt"), "noise\n", "utf-8");
  await fs.writeFile(path.join(rootDir, "foo-build", "artifact.txt"), "noise\n", "utf-8");
  await fs.writeFile(path.join(rootDir, "foo-build.txt"), "noise\n", "utf-8");
  await fs.writeFile(path.join(rootDir, "build", "artifact.txt"), "noise\n", "utf-8");

  const files = await collectVisibleFiles(rootDir);

  assert.deepEqual(files, ["foo-build.txt", "src/Index.ets"]);
});

test("collectVisibleFiles supports evaluation-only ignored path prefixes without hiding business paths", async (t) => {
  const rootDir = await makeTempDir(t);
  await fs.mkdir(path.join(rootDir, "entry", "src", "main", "ets"), { recursive: true });
  await fs.mkdir(path.join(rootDir, "entry", "src", "main", "ets", "pages", "test"), {
    recursive: true,
  });
  await fs.mkdir(path.join(rootDir, "entry", "src", "test"), { recursive: true });
  await fs.mkdir(path.join(rootDir, "entry", "src", "ohosTest", "ets"), { recursive: true });
  await fs.writeFile(
    path.join(rootDir, "entry", "src", "main", "ets", "Index.ets"),
    "let value = 1;\n",
    "utf-8",
  );
  await fs.writeFile(
    path.join(rootDir, "entry", "src", "main", "ets", "pages", "test", "Index.ets"),
    "var y = 2;\n",
    "utf-8",
  );
  await fs.writeFile(
    path.join(rootDir, "entry", "src", "test", "LocalUnit.test.ets"),
    "let x: any = 1;\n",
    "utf-8",
  );
  await fs.writeFile(
    path.join(rootDir, "entry", "src", "ohosTest", "ets", "Ability.test.ets"),
    "var y = 2;\n",
    "utf-8",
  );

  const files = await collectVisibleFiles(rootDir, {
    extraIgnoredPathPrefixes: ["entry/src/test", "entry/src/ohosTest"],
  });

  assert.deepEqual(files, [
    "entry/src/main/ets/Index.ets",
    "entry/src/main/ets/pages/test/Index.ets",
  ]);
});
