import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const repoRoot = process.cwd();

async function readProjectFile(relativePath: string): Promise<string> {
  return fs.readFile(path.join(repoRoot, relativePath), "utf-8");
}

async function parseTemplateConfig(): Promise<unknown> {
  const templateText = await readProjectFile(".opencode/opencode.template.json");
  return JSON.parse(
    templateText
      .replaceAll('"${HMOS_OPENCODE_PROVIDER_ID}"', '"provider"')
      .replaceAll('"${HMOS_OPENCODE_MODEL_ID}"', '"model"')
      .replaceAll('"${HMOS_OPENCODE_MODEL_NAME}"', '"model name"')
      .replaceAll('"${HMOS_OPENCODE_BASE_URL}"', '"https://example.test"')
      .replaceAll('"${HMOS_OPENCODE_API_KEY}"', '"key-placeholder"')
      .replaceAll("${HMOS_OPENCODE_PORT}", "4096")
      .replaceAll("${HMOS_OPENCODE_TIMEOUT_MS}", "600000"),
  ) as unknown;
}

test("project opencode template defines read-only permissions without secrets", async () => {
  const templateText = await readProjectFile(".opencode/opencode.template.json");

  assert.doesNotMatch(templateText, /sk-[A-Za-z0-9_-]+/);
  assert.doesNotMatch(templateText, /default_agent/);
  assert.match(templateText, /"agent"\s*:/);
  assert.match(templateText, /"hmos-understanding"\s*:/);
  assert.match(templateText, /"hmos-rubric-scoring"\s*:/);
  assert.match(templateText, /"hmos-rule-assessment"\s*:/);
  assert.match(templateText, /"hmos-human-rating-gap-analysis"\s*:/);
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

test("opencode agents can only use their matching project skill", async () => {
  const template = (await parseTemplateConfig()) as {
    permission?: { skill?: unknown };
    agent?: Record<string, { permission?: { skill?: unknown } }>;
  };

  assert.equal(template.permission?.skill, "deny");
  assert.deepEqual(template.agent?.["hmos-understanding"]?.permission?.skill, {
    "*": "deny",
    "hmos-understanding": "allow",
  });
  assert.deepEqual(template.agent?.["hmos-rubric-scoring"]?.permission?.skill, {
    "*": "deny",
    "hmos-rubric-scoring": "allow",
  });
  assert.deepEqual(template.agent?.["hmos-rule-assessment"]?.permission?.skill, {
    "*": "deny",
    "hmos-rule-assessment": "allow",
  });
  assert.deepEqual(template.agent?.["hmos-human-rating-gap-analysis"]?.permission?.skill, {
    "*": "deny",
    "hmos-human-rating-gap-analysis": "allow",
  });
});

test("task understanding agent can read only through explicit prompt-file flow", async () => {
  const template = (await parseTemplateConfig()) as { agent?: Record<string, { permission?: Record<string, unknown> }> };
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

  assert.match(taskPrompt, /只能读取用户消息指定的 prompt 文件/);
  assert.match(taskPrompt, /不能读取 generated\//);
  assert.match(taskPrompt, /original\//);
  assert.match(taskPrompt, /patch\//);
  assert.match(taskPrompt, /references\//);
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
  const template = (await parseTemplateConfig()) as { agent?: Record<string, { permission?: Record<string, unknown> }> };

  for (const agent of [
    "hmos-understanding",
    "hmos-rubric-scoring",
    "hmos-rule-assessment",
    "hmos-human-rating-gap-analysis",
  ]) {
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

test("project opencode skills define agent contracts", async () => {
  const expectations = [
    {
      skill: "hmos-understanding",
      outputFile: "metadata/agent-output/task-understanding.json",
    },
    {
      skill: "hmos-rubric-scoring",
      outputFile: "metadata/agent-output/rubric-scoring.json",
    },
    {
      skill: "hmos-rule-assessment",
      outputFile: "metadata/agent-output/rule-assessment.json",
    },
    {
      skill: "hmos-human-rating-gap-analysis",
      outputFile: "metadata/agent-output/human-rating-gap-analysis.json",
    },
  ];

  for (const expectation of expectations) {
    const skillPath = `.opencode/skills/${expectation.skill}/SKILL.md`;
    const skillText = await readProjectFile(skillPath);
    assert.match(skillText, /^---\nname:/);
    assert.match(skillText, new RegExp(`name: ${expectation.skill}`));
    assert.match(skillText, /输出|output/i);
    assert.match(skillText, /JSON/);
    assert.match(skillText, /output_file/);
    assert.match(skillText, new RegExp(expectation.outputFile.replaceAll("/", "\\/")));
  }
});

test("project opencode skills avoid unnecessary scoped references", async () => {
  await assert.rejects(
    () => fs.access(path.join(repoRoot, ".opencode", "skills", "hmos-understanding", "references")),
    /ENOENT/,
  );
  await assert.rejects(
    () =>
      fs.access(
        path.join(
          repoRoot,
          ".opencode",
          "skills",
          "hmos-rubric-scoring",
          "references",
          "scoring",
          "rules_application.md",
        ),
      ),
    /ENOENT/,
  );
  await assert.rejects(
    () =>
      fs.access(
        path.join(repoRoot, ".opencode", "skills", "hmos-rubric-scoring", "references", "risk-taxonomy.md"),
      ),
    /ENOENT/,
  );
  await assert.rejects(
    () =>
      fs.access(
        path.join(repoRoot, ".opencode", "skills", "hmos-rubric-scoring", "references", "risk-taxonomy.yaml"),
      ),
    /ENOENT/,
  );
  await assert.rejects(
    () => fs.access(path.join(repoRoot, ".opencode", "skills", "hmos-rule-assessment", "references")),
    /ENOENT/,
  );
  await assert.rejects(
    () =>
      fs.access(
        path.join(
          repoRoot,
          ".opencode",
          "skills",
          "hmos-rule-assessment",
          "references",
          "scoring",
          "rules_application.md",
        ),
      ),
    /ENOENT/,
  );
});

test("opencode agent system prompts require writing final json to output_file", async () => {
  for (const file of [
    ".opencode/prompts/hmos-understanding-system.md",
    ".opencode/prompts/hmos-rubric-scoring-system.md",
    ".opencode/prompts/hmos-rule-assessment-system.md",
    ".opencode/prompts/hmos-human-rating-gap-analysis-system.md",
  ]) {
    const prompt = await readProjectFile(file);
    assert.match(prompt, /写入用户消息指定的 output_file/);
    assert.match(prompt, /不要在最终回复中重复完整结果 JSON/);
    assert.match(prompt, /\{"output_file":"<output_file>"\}/);
  }
});

test("project opencode agent system prompts require matching skills", async () => {
  const taskPrompt = await readProjectFile(".opencode/prompts/hmos-understanding-system.md");
  const rubricPrompt = await readProjectFile(".opencode/prompts/hmos-rubric-scoring-system.md");
  const rulePrompt = await readProjectFile(".opencode/prompts/hmos-rule-assessment-system.md");
  const humanRatingPrompt = await readProjectFile(".opencode/prompts/hmos-human-rating-gap-analysis-system.md");
  const taskSkill = await readProjectFile(".opencode/skills/hmos-understanding/SKILL.md");
  const rubricSkill = await readProjectFile(".opencode/skills/hmos-rubric-scoring/SKILL.md");
  const ruleSkill = await readProjectFile(".opencode/skills/hmos-rule-assessment/SKILL.md");

  assert.match(taskPrompt, /你是评分工作流中的任务理解 agent/);
  assert.match(taskPrompt, /必须使用 hmos-understanding skill/);
  assert.match(taskPrompt, /职责边界、JSON 输出契约和写入 output_file 协议/);
  assert.match(taskPrompt, /JSON 字符串中的英文双引号必须转义/);
  assert.match(taskSkill, /JSON 字符串中的英文双引号必须转义/);

  assert.match(rubricPrompt, /你是评分流程中的 rubric 评分 agent/);
  assert.match(rubricPrompt, /必须使用 hmos-rubric-scoring skill/);
  assert.match(rubricPrompt, /职责边界、证据边界、JSON 输出契约和写入 output_file 协议/);
  assert.doesNotMatch(rubricPrompt, /JSON 字符串中的英文双引号必须转义/);
  assert.doesNotMatch(rubricPrompt, /deduction_trace/);
  assert.match(rubricSkill, /JSON 字符串中的英文双引号必须转义/);

  assert.match(rulePrompt, /你是评分流程中的规则判定 agent/);
  assert.match(rulePrompt, /必须使用 hmos-rule-assessment skill/);
  assert.match(rulePrompt, /职责边界、证据边界、JSON 输出契约和写入 output_file 协议/);
  assert.doesNotMatch(rulePrompt, /JSON 字符串中的英文双引号必须转义/);
  assert.doesNotMatch(rulePrompt, /未接入静态判定器本身不是人工复核理由/);
  assert.match(ruleSkill, /JSON 字符串中的英文双引号必须转义/);
  assert.match(ruleSkill, /none_matched[\s\S]*必须复核目标文件和相关调用链是否存在真实 kit 来源证据/);

  assert.match(humanRatingPrompt, /你是评分流程中的人工评级差异分析 agent/);
  assert.match(humanRatingPrompt, /必须使用 hmos-human-rating-gap-analysis skill/);
  assert.match(humanRatingPrompt, /职责边界、证据边界、JSON 输出契约和写入 output_file 协议/);
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
