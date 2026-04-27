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
  assert.match(templateText, /"agent"\s*:/);
  assert.match(templateText, /"hmos-understanding"\s*:/);
  assert.match(templateText, /"hmos-rubric-scoring"\s*:/);
  assert.match(templateText, /"hmos-rule-assessment"\s*:/);
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

test("task understanding agent can read only through explicit prompt-file flow", async () => {
  const templateText = await readProjectFile(".opencode/opencode.template.json");
  const template = JSON.parse(
    templateText
      .replaceAll('"${HMOS_OPENCODE_PROVIDER_ID}"', '"provider"')
      .replaceAll('"${HMOS_OPENCODE_MODEL_ID}"', '"model"')
      .replaceAll('"${HMOS_OPENCODE_MODEL_NAME}"', '"model name"')
      .replaceAll('"${HMOS_OPENCODE_BASE_URL}"', '"https://example.test"')
      .replaceAll('"${HMOS_OPENCODE_API_KEY}"', '"key-placeholder"')
      .replaceAll('${HMOS_OPENCODE_PORT}', '4096')
      .replaceAll('${HMOS_OPENCODE_TIMEOUT_MS}', '600000'),
  ) as { agent?: Record<string, { permission?: Record<string, string> }> };
  const permission = template.agent?.["hmos-understanding"]?.permission ?? {};

  assert.equal(permission.read, "allow");
  assert.equal(permission.glob, "deny");
  assert.equal(permission.grep, "deny");
  assert.equal(permission.list, "deny");
  assert.deepEqual(permission.edit, {
    "*": "deny",
    "metadata/agent-output/*.json": "allow",
    "**/metadata/agent-output/*.json": "allow",
  });
  assert.equal(permission.bash, "deny");
});

test("task understanding system prompt allows prompt-file reads but forbids business-file reads", async () => {
  const taskPrompt = await readProjectFile(".opencode/prompts/hmos-understanding-system.md");

  assert.match(taskPrompt, /只允许读取用户消息指定的 prompt 文件/);
  assert.match(taskPrompt, /不要读取 generated\//);
  assert.match(taskPrompt, /不要读取 original\//);
  assert.match(taskPrompt, /不要读取 patch\//);
  assert.match(taskPrompt, /不要读取 references\//);
  assert.doesNotMatch(taskPrompt, /禁止读取任何代码文件/);
  assert.doesNotMatch(taskPrompt, /禁止读取任何文件/);
});

test("project opencode template configures json formatter for agent output files", async () => {
  const templateText = await readProjectFile(".opencode/opencode.template.json");

  assert.match(templateText, /"formatter"\s*:/);
  assert.match(templateText, /"agent-json"\s*:/);
  assert.match(templateText, /"extensions"\s*:\s*\[\s*"\.json"\s*\]/);
  assert.match(templateText, /format-json\.mjs/);
  assert.match(templateText, /\$FILE/);
});

test("opencode scoring agents can edit only sandbox agent output files", async () => {
  const templateText = await readProjectFile(".opencode/opencode.template.json");
  const template = JSON.parse(
    templateText
      .replaceAll('"${HMOS_OPENCODE_PROVIDER_ID}"', '"provider"')
      .replaceAll('"${HMOS_OPENCODE_MODEL_ID}"', '"model"')
      .replaceAll('"${HMOS_OPENCODE_MODEL_NAME}"', '"model name"')
      .replaceAll('"${HMOS_OPENCODE_BASE_URL}"', '"https://example.test"')
      .replaceAll('"${HMOS_OPENCODE_API_KEY}"', '"key-placeholder"')
      .replaceAll('${HMOS_OPENCODE_PORT}', '4096')
      .replaceAll('${HMOS_OPENCODE_TIMEOUT_MS}', '600000'),
  ) as { agent?: Record<string, { permission?: Record<string, string> }> };

  for (const agent of ["hmos-understanding", "hmos-rubric-scoring", "hmos-rule-assessment"]) {
    const permission = template.agent?.[agent]?.permission ?? {};
    assert.equal(permission.write, "allow", agent);
    assert.deepEqual(
      permission.edit,
      {
        "*": "deny",
        "metadata/agent-output/*.json": "allow",
        "**/metadata/agent-output/*.json": "allow",
      },
      agent,
    );
    assert.equal(permission.bash, "deny", agent);
  }
});

test("opencode agent system prompts require writing final json to output_file", async () => {
  for (const file of [
    ".opencode/prompts/hmos-understanding-system.md",
    ".opencode/prompts/hmos-rubric-scoring-system.md",
    ".opencode/prompts/hmos-rule-assessment-system.md",
  ]) {
    const prompt = await readProjectFile(file);
    assert.match(prompt, /写入用户消息指定的 output_file/);
    assert.match(prompt, /不要在最终回复中重复完整结果 JSON/);
    assert.match(prompt, /\{"output_file":"<output_file>"\}/);
  }
});

test("project opencode agents put strict output formats in system prompts", async () => {
  const taskPrompt = await readProjectFile(".opencode/prompts/hmos-understanding-system.md");
  const rubricPrompt = await readProjectFile(".opencode/prompts/hmos-rubric-scoring-system.md");
  const rulePrompt = await readProjectFile(".opencode/prompts/hmos-rule-assessment-system.md");

  assert.match(taskPrompt, /你是评分工作流中的任务理解 agent/);
  assert.match(taskPrompt, /强制输出格式/);
  assert.match(taskPrompt, /正确输出格式/);
  assert.match(taskPrompt, /"explicitConstraints"/);
  assert.match(taskPrompt, /"contextualConstraints"/);
  assert.match(taskPrompt, /"implicitConstraints"/);
  assert.match(taskPrompt, /"classificationHints"/);
  assert.match(taskPrompt, /最终答案的第一个非空字符必须是 \{/);
  assert.match(taskPrompt, /最后一个非空字符必须是 \}/);

  assert.match(rubricPrompt, /你是评分流程中的 rubric 评分 agent/);
  assert.match(rubricPrompt, /强制输出格式/);
  assert.match(rubricPrompt, /正确输出格式/);
  assert.match(rubricPrompt, /"item_scores"/);
  assert.match(rubricPrompt, /"deduction_trace"/);
  assert.match(rubricPrompt, /"risks"/);
  assert.match(rubricPrompt, /最终答案的第一个非空字符必须是 \{/);
  assert.match(rubricPrompt, /最后一个非空字符必须是 \}/);

  assert.match(rulePrompt, /你是评分流程中的规则判定 agent/);
  assert.match(rulePrompt, /强制输出格式/);
  assert.match(rulePrompt, /正确输出格式/);
  assert.match(rulePrompt, /"rule_assessments"/);
  assert.match(rulePrompt, /"needs_human_review"/);
  assert.match(rulePrompt, /最终答案的第一个非空字符必须是 \{/);
  assert.match(rulePrompt, /最后一个非空字符必须是 \}/);
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
