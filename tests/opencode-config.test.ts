import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const repoRoot = process.cwd();

async function readProjectFile(relativePath: string): Promise<string> {
  return fs.readFile(path.join(repoRoot, relativePath), "utf-8");
}

test("project opencode template defines read-only permissions without secrets", async () => {
  const templateText = await readProjectFile(".opencode/opencode.template.json");

  assert.doesNotMatch(templateText, /sk-[A-Za-z0-9_-]+/);
  assert.doesNotMatch(templateText, /default_agent/);
  assert.doesNotMatch(templateText, /"agent"\s*:/);
  assert.match(templateText, /"edit"\s*:\s*"deny"/);
  assert.match(templateText, /"bash"\s*:\s*"deny"/);
  assert.match(templateText, /"external_directory"\s*:\s*"deny"/);
  assert.match(templateText, /"glob"\s*:\s*"allow"/);
  assert.match(templateText, /"grep"\s*:\s*"allow"/);
  assert.match(templateText, /"list"\s*:\s*"allow"/);
  assert.match(templateText, /"webfetch"\s*:\s*"deny"/);
  assert.match(templateText, /"websearch"\s*:\s*"deny"/);
  assert.match(templateText, /"question"\s*:\s*"deny"/);
});

test("project opencode template uses the Bailian Anthropic provider shape", async () => {
  const templateText = await readProjectFile(".opencode/opencode.template.json");

  assert.match(templateText, /"name"\s*:\s*"HMOS Score Bailian Coding Plan"/);
  assert.match(templateText, /"npm"\s*:\s*"@ai-sdk\/anthropic"/);
  assert.doesNotMatch(templateText, /@ai-sdk\/openai-compatible/);
  assert.match(templateText, /"context"\s*:\s*202752/);
  assert.match(templateText, /"output"\s*:\s*16384/);
});

test("project gitignore excludes generated opencode runtime state", async () => {
  const gitignoreText = await readProjectFile(".gitignore");

  assert.match(gitignoreText, /^\.opencode\/runtime\/\s*$/m);
});
