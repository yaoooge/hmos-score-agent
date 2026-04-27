# OpenCode File Output And Formatters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 OpenCode agent 的最终长 JSON 迁移为 sandbox 内文件输出，并用 formatter、本地解析、schema 校验和 skeleton normalize 替代 stdout JSON-only 主路径。

**Architecture:** Runner 增加 `outputFile` 协议，调用前清理约定文件，调用后优先读取 `metadata/agent-output/*.json`。OpenCode agent 通过 `write` 写最终 JSON，formatter 对 JSON 文件做语法校验和格式化，本地 zod/schema 继续负责业务结构校验。迁移期保留 stdout fallback，后续任务再收敛 prompt 和 raw text 命名。

**Tech Stack:** TypeScript, Node.js test runner, zod, OpenCode config/agent permissions, OpenCode formatter command, local sandbox filesystem.

---

## Scope And File Map

**Spec:** `docs/superpowers/specs/2026-04-27-opencode-file-output-and-formatters-design.md`

**Create:**
- `.opencode/formatters/format-json.mjs`：OpenCode formatter 命令，对 agent 写入的 JSON 文件做 `JSON.parse` 和 pretty print。

**Modify:**
- `.opencode/opencode.template.json`：新增 formatter 配置；给 task/rubric/rule agent 增加 `write: "allow"`；保留 `edit/bash` deny。
- `src/opencode/opencodeCliRunner.ts`：扩展 `OpencodeRunRequest.outputFile`；校验 output file 路径；调用前删除旧文件；调用后优先读取文件。
- `src/opencode/opencodeConfig.ts`：复制 `.opencode/formatters` 到 runtime 与 `xdg-config/opencode` 目录。
- `.opencode/prompts/hmos-understanding-system.md`：修正文案，不再说“禁止读取任何文件”，改为“只允许读取 prompt 文件，不读取业务文件”；加入 output file 写入协议。
- `.opencode/prompts/hmos-rubric-scoring-system.md`：加入 output file 写入协议。
- `.opencode/prompts/hmos-rule-assessment-system.md`：加入 output file 写入协议。
- `src/agent/opencodeTaskUnderstanding.ts`：传入 `outputFile`，prompt 加 `output_file`。
- `src/agent/opencodeRubricScoring.ts`：传入 `outputFile`，prompt/retry prompt 加 `output_file`，后续清理重复格式样例。
- `src/agent/opencodeRuleAssessment.ts`：传入 `outputFile`，prompt/retry prompt 加 `output_file`，精简 retry payload。
- `src/nodes/persistAndUploadNode.ts`：中间产物记录 output file 路径和文本来源，保留 runner diagnostics。

**Tests:**
- `tests/opencode-cli-runner.test.ts`
- `tests/opencode-config.test.ts`
- `tests/opencode-config-generation.test.ts`
- `tests/opencode-task-understanding.test.ts`
- `tests/opencode-rubric-scoring.test.ts`
- `tests/opencode-rule-assessment.test.ts`
- `tests/score-agent.test.ts` 或新增 `tests/opencode-file-output-workflow.test.ts` 用于端到端-ish stub。

---

### Task 1: Fix Understanding Permission Wording And Preserve Prompt Read

**Files:**
- Modify: `.opencode/prompts/hmos-understanding-system.md`
- Modify: `tests/opencode-config.test.ts`

- [ ] **Step 1: Write the failing test for prompt wording**

Add to `tests/opencode-config.test.ts` inside `project opencode agents put strict output formats in system prompts` or as a new test:

```ts
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
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
node --import tsx --test tests/opencode-config.test.ts
```

Expected: FAIL because the current prompt still contains an absolute no-read wording or does not explicitly say prompt-file reads are allowed.

- [ ] **Step 3: Update the system prompt wording**

In `.opencode/prompts/hmos-understanding-system.md`, replace the read boundary section with:

```markdown
职责边界:
- 只允许读取用户消息指定的 prompt 文件。
- 只能基于 prompt 文件中的 agent_input 或 constraint_draft 完成任务理解。
- 不要读取 generated/、original/、patch/、metadata/metadata.json 或 references/ 下的任何业务文件。
- 不要调用 glob、grep、list 或任何用于探索工程文件的工具。
- 不要尝试补充读取缺失信息；如果输入不足，基于已有 promptText、projectStructure、patchSummary 给出低置信度约束。
```

Keep the existing output schema section intact.

- [ ] **Step 4: Run the focused test and verify it passes**

Run:

```bash
node --import tsx --test tests/opencode-config.test.ts
```

Expected: PASS.

---

### Task 2: Add Formatter Config And Runtime Copy Support

**Files:**
- Create: `.opencode/formatters/format-json.mjs`
- Modify: `.opencode/opencode.template.json`
- Modify: `src/opencode/opencodeConfig.ts`
- Modify: `tests/opencode-config.test.ts`
- Modify: `tests/opencode-config-generation.test.ts`

- [ ] **Step 1: Write failing config tests**

Add to `tests/opencode-config.test.ts`:

```ts
test("project opencode template configures json formatter for agent output files", async () => {
  const templateText = await readProjectFile(".opencode/opencode.template.json");

  assert.match(templateText, /"formatter"\s*:/);
  assert.match(templateText, /"agent-json"\s*:/);
  assert.match(templateText, /"extensions"\s*:\s*\[\s*"\.json"\s*\]/);
  assert.match(templateText, /format-json\.mjs/);
  assert.match(templateText, /\$FILE/);
});
```

Add to `tests/opencode-config-generation.test.ts` in `createOpencodeRuntimeConfig writes generated config and isolated environment` after prompt-copy assertions:

```ts
assert.match(
  await fs.readFile(path.join(repoRoot, ".opencode", "runtime", "formatters", "format-json.mjs"), "utf-8"),
  /JSON\.parse/,
);
assert.match(
  await fs.readFile(
    path.join(repoRoot, ".opencode", "runtime", "xdg-config", "opencode", "formatters", "format-json.mjs"),
    "utf-8",
  ),
  /JSON\.stringify/,
);
```

- [ ] **Step 2: Run config tests and verify they fail**

Run:

```bash
node --import tsx --test tests/opencode-config.test.ts tests/opencode-config-generation.test.ts
```

Expected: FAIL because formatter config and formatter script do not exist.

- [ ] **Step 3: Create formatter script**

Create `.opencode/formatters/format-json.mjs`:

```js
import fs from "node:fs";

const file = process.argv[2];
if (!file) {
  process.exit(0);
}

const text = fs.readFileSync(file, "utf8");
const parsed = JSON.parse(text);
fs.writeFileSync(file, `${JSON.stringify(parsed, null, 2)}\n`);
```

- [ ] **Step 4: Add formatter config**

In `.opencode/opencode.template.json`, add a top-level `formatter` block after `agent` and before `permission`:

```json
"formatter": {
  "agent-json": {
    "command": ["node", "./formatters/format-json.mjs", "$FILE"],
    "extensions": [".json"]
  }
},
```

Use `./formatters/format-json.mjs` because runtime config is loaded from `runtime/xdg-config/opencode/opencode.json`; Task 2 copies the script under both runtime roots.

- [ ] **Step 5: Copy formatter files in runtime config generation**

In `src/opencode/opencodeConfig.ts`, generalize `copyPromptFiles` to `copyFilesFromDirectory` or add `copyFormatterFiles`:

```ts
async function copyFilesFromDirectory(input: {
  sourceDir: string;
  targetDir: string;
  label: string;
}): Promise<void> {
  await fs.mkdir(input.targetDir, { recursive: true });
  const entries = await fs.readdir(input.sourceDir, { withFileTypes: true }).catch((error: unknown) => {
    throw new OpencodeConfigError(
      `无法读取 opencode ${input.label} 目录：${error instanceof Error ? error.message : String(error)}`,
    );
  });

  await Promise.all(
    entries
      .filter((entry) => entry.isFile())
      .map(async (entry) => {
        await fs.copyFile(path.join(input.sourceDir, entry.name), path.join(input.targetDir, entry.name));
      }),
  );
}
```

Then copy formatters in `createOpencodeRuntimeConfig`:

```ts
const formattersDir = path.join(configDir, "formatters");

await copyFilesFromDirectory({
  sourceDir: formattersDir,
  targetDir: path.join(runtimeDir, "formatters"),
  label: "formatter",
});
await copyFilesFromDirectory({
  sourceDir: formattersDir,
  targetDir: path.join(runtimeDir, "xdg-config", "opencode", "formatters"),
  label: "formatter",
});
```

Keep prompt copying behavior identical.

- [ ] **Step 6: Run config tests and verify they pass**

Run:

```bash
node --import tsx --test tests/opencode-config.test.ts tests/opencode-config-generation.test.ts
```

Expected: PASS.

---

### Task 3: Add Output File Support To The OpenCode Runner

**Files:**
- Modify: `src/opencode/opencodeCliRunner.ts`
- Modify: `tests/opencode-cli-runner.test.ts`

- [ ] **Step 1: Write failing runner tests for output file success**

Add to `tests/opencode-cli-runner.test.ts`:

```ts
test("runOpencodePrompt reads final JSON from requested output file", async () => {
  const runtimeDir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-runner-file-output-"));
  const sandboxRoot = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-sandbox-file-output-"));
  const child = createFakeChild();

  const result = await runOpencodePrompt({
    runtime: runtimeConfig(runtimeDir),
    request: {
      prompt: "请评分",
      sandboxRoot,
      requestTag: "rule-assessment",
      agent: "hmos-rule-assessment",
      outputFile: "metadata/agent-output/rule-assessment.json",
    },
    deps: {
      spawnProcess: () => {
        queueMicrotask(async () => {
          await fs.mkdir(path.join(sandboxRoot, "metadata", "agent-output"), { recursive: true });
          await fs.writeFile(
            path.join(sandboxRoot, "metadata", "agent-output", "rule-assessment.json"),
            '{"ok":true}\n',
            "utf-8",
          );
          child.stdout.emit(
            "data",
            Buffer.from(
              '{"type":"text","part":{"type":"text","text":"{\\"output_file\\":\\"metadata/agent-output/rule-assessment.json\\"}"}}\n',
            ),
          );
          child.emit("exit", 0);
        });
        return child;
      },
    },
  });

  assert.equal(result.rawText, '{"ok":true}\n');
  assert.equal(result.outputFile, "metadata/agent-output/rule-assessment.json");
  assert.equal(result.outputFileText, '{"ok":true}\n');
  assert.match(result.assistantText ?? "", /output_file/);
});
```

- [ ] **Step 2: Write failing runner tests for path rejection and stale file cleanup**

Add:

```ts
test("runOpencodePrompt rejects output files outside the agent output directory", async () => {
  const runtimeDir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-runner-bad-output-"));
  const sandboxRoot = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-sandbox-bad-output-"));

  await assert.rejects(
    () =>
      runOpencodePrompt({
        runtime: runtimeConfig(runtimeDir),
        request: {
          prompt: "x",
          sandboxRoot,
          requestTag: "bad-output",
          outputFile: "../result.json",
        },
        deps: { spawnProcess: () => createFakeChild() },
      }),
    (error: unknown) => {
      assert.ok(error instanceof OpencodeRunError);
      assert.match(error.message, /invalid agent output file/);
      return true;
    },
  );
});

test("runOpencodePrompt removes stale output file before invoking opencode", async () => {
  const runtimeDir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-runner-stale-output-"));
  const sandboxRoot = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-sandbox-stale-output-"));
  const outputPath = path.join(sandboxRoot, "metadata", "agent-output", "rule-assessment.json");
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, '{"stale":true}\n', "utf-8");
  const child = createFakeChild();

  await assert.rejects(
    () =>
      runOpencodePrompt({
        runtime: runtimeConfig(runtimeDir),
        request: {
          prompt: "x",
          sandboxRoot,
          requestTag: "missing-output",
          outputFile: "metadata/agent-output/rule-assessment.json",
        },
        deps: {
          spawnProcess: () => {
            queueMicrotask(() => {
              child.stdout.emit("data", Buffer.from('{"type":"text","part":{"type":"text","text":"done"}}\n'));
              child.emit("exit", 0);
            });
            return child;
          },
        },
      }),
    (error: unknown) => {
      assert.ok(error instanceof OpencodeRunError);
      assert.match(error.message, /opencode agent output file missing/);
      return true;
    },
  );
  await assert.rejects(() => fs.readFile(outputPath, "utf-8"), /ENOENT/);
});
```

- [ ] **Step 3: Run runner tests and verify they fail**

Run:

```bash
node --import tsx --test tests/opencode-cli-runner.test.ts
```

Expected: FAIL because `outputFile`, `outputFileText`, and `assistantText` do not exist.

- [ ] **Step 4: Implement output file fields and path resolver**

In `src/opencode/opencodeCliRunner.ts`, extend interfaces:

```ts
export interface OpencodeRunRequest {
  prompt: string;
  sandboxRoot: string;
  requestTag: string;
  title?: string;
  agent?: string;
  outputFile?: string;
}

export interface OpencodeRunResult {
  requestTag: string;
  rawText: string;
  rawEvents: string;
  elapsedMs: number;
  assistantText?: string;
  outputFile?: string;
  outputFileText?: string;
}
```

Add:

```ts
function resolveAgentOutputPath(sandboxRoot: string, outputFile: string): string {
  if (!/^metadata\/agent-output\/[a-z-]+\.json$/.test(outputFile)) {
    throw new OpencodeRunError(`invalid agent output file: ${outputFile}`);
  }

  const root = path.resolve(sandboxRoot);
  const resolved = path.resolve(root, outputFile);
  if (!resolved.startsWith(`${root}${path.sep}`)) {
    throw new OpencodeRunError(`agent output file escapes sandbox: ${outputFile}`);
  }
  return resolved;
}
```

- [ ] **Step 5: Implement pre-run cleanup and prompt message branch**

Before building args:

```ts
const outputPath = input.request.outputFile
  ? resolveAgentOutputPath(input.request.sandboxRoot, input.request.outputFile)
  : undefined;
if (outputPath) {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.rm(outputPath, { force: true });
}
```

Replace the final user message construction with:

```ts
const runMessage = input.request.outputFile
  ? `Read and follow the prompt file at ${promptRelativePath}. Write the final JSON object to ${input.request.outputFile}. After writing the file, reply only with {"output_file":"${input.request.outputFile}"}.`
  : `Read and follow the prompt file at ${promptRelativePath}. Return only the requested final JSON object.`;
args.push(runMessage);
```

- [ ] **Step 6: Implement output file read after process exit**

In the successful exit branch, after `extractAssistantText(rawEvents)`:

```ts
const assistantText = extractAssistantText(rawEvents);
let rawText = assistantText;
let outputFileText: string | undefined;
if (input.request.outputFile && outputPath) {
  try {
    outputFileText = await fs.readFile(outputPath, "utf-8");
    rawText = outputFileText;
  } catch (error) {
    throw new OpencodeRunError(
      `opencode agent output file missing request=${input.request.requestTag} outputFile=${input.request.outputFile}`,
      { cause: error },
    );
  }
}
succeed({
  requestTag: input.request.requestTag,
  rawText,
  rawEvents,
  elapsedMs: Date.now() - startedAt,
  assistantText,
  outputFile: input.request.outputFile,
  outputFileText,
});
```

Because this code is inside the child exit callback, make the callback async and handle rejection:

```ts
child.on("exit", (code: number | null) => {
  void (async () => {
    // existing logic
  })().catch((error: unknown) => fail(error instanceof Error ? error : new OpencodeRunError(String(error))));
});
```

- [ ] **Step 7: Run runner tests and verify they pass**

Run:

```bash
node --import tsx --test tests/opencode-cli-runner.test.ts
```

Expected: PASS.

---

### Task 4: Configure Agent Write Permissions And Output File Protocol

**Files:**
- Modify: `.opencode/opencode.template.json`
- Modify: `.opencode/prompts/hmos-understanding-system.md`
- Modify: `.opencode/prompts/hmos-rubric-scoring-system.md`
- Modify: `.opencode/prompts/hmos-rule-assessment-system.md`
- Modify: `tests/opencode-config.test.ts`

- [ ] **Step 1: Write failing permission tests**

Update `tests/opencode-config.test.ts` to assert agent write permissions:

```ts
test("opencode scoring agents can write only through sandbox output files", async () => {
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
    assert.equal(permission.edit, "deny", agent);
    assert.equal(permission.bash, "deny", agent);
  }
});
```

Add prompt protocol assertions:

```ts
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
```

- [ ] **Step 2: Run config tests and verify they fail**

Run:

```bash
node --import tsx --test tests/opencode-config.test.ts
```

Expected: FAIL because `write` permissions and output file prompt protocol are missing.

- [ ] **Step 3: Add `write: allow` permissions**

In `.opencode/opencode.template.json`, add to each agent permission block:

```json
"write": "allow",
```

Keep:

```json
"edit": "deny",
"bash": "deny"
```

- [ ] **Step 4: Add output file protocol to system prompts**

Append to each `.opencode/prompts/hmos-*-system.md`:

```markdown
文件输出协议:
- 你必须将最终 JSON object 写入用户消息指定的 output_file。
- 写入 output_file 的内容必须是完整 JSON object。
- 不要把 Markdown、解释文字或代码块写入 output_file。
- 写入文件后，assistant 最终回复只能是：{"output_file":"<output_file>"}
- 不要在最终回复中重复完整结果 JSON。
```

- [ ] **Step 5: Run config tests and verify they pass**

Run:

```bash
node --import tsx --test tests/opencode-config.test.ts
```

Expected: PASS.

---

### Task 5: Wire Output Files Into Task, Rubric, And Rule Agent Calls

**Files:**
- Modify: `src/agent/opencodeTaskUnderstanding.ts`
- Modify: `src/agent/opencodeRubricScoring.ts`
- Modify: `src/agent/opencodeRuleAssessment.ts`
- Modify: `tests/opencode-task-understanding.test.ts`
- Modify: `tests/opencode-rubric-scoring.test.ts`
- Modify: `tests/opencode-rule-assessment.test.ts`

- [ ] **Step 1: Write failing outputFile request assertions**

In `tests/opencode-task-understanding.test.ts`, capture outputFile in the first test:

```ts
let outputFile = "";
// inside runPrompt
outputFile = request.outputFile ?? "";
// after title assertion
assert.equal(outputFile, "metadata/agent-output/task-understanding.json");
assert.match(prompt, /output_file: metadata\/agent-output\/task-understanding\.json/);
```

In `tests/opencode-rubric-scoring.test.ts`, capture outputFile in the first test:

```ts
let outputFile = "";
// inside runPrompt
outputFile = request.outputFile ?? "";
// after agent assertion
assert.equal(outputFile, "metadata/agent-output/rubric-scoring.json");
assert.match(prompt, /output_file: metadata\/agent-output\/rubric-scoring\.json/);
```

In `tests/opencode-rule-assessment.test.ts`, capture outputFile in the first test:

```ts
let outputFile = "";
// inside runPrompt
outputFile = request.outputFile ?? "";
// after agent assertion
assert.equal(outputFile, "metadata/agent-output/rule-assessment.json");
assert.match(prompt, /output_file: metadata\/agent-output\/rule-assessment\.json/);
```

- [ ] **Step 2: Run agent tests and verify they fail**

Run:

```bash
node --import tsx --test tests/opencode-task-understanding.test.ts tests/opencode-rubric-scoring.test.ts tests/opencode-rule-assessment.test.ts
```

Expected: FAIL because `outputFile` is not passed and prompts do not include `output_file`.

- [ ] **Step 3: Add outputFile constants and prompt lines**

In each agent module, add a local constant:

```ts
const TASK_UNDERSTANDING_OUTPUT_FILE = "metadata/agent-output/task-understanding.json";
const RUBRIC_SCORING_OUTPUT_FILE = "metadata/agent-output/rubric-scoring.json";
const RULE_ASSESSMENT_OUTPUT_FILE = "metadata/agent-output/rule-assessment.json";
```

Use the relevant constant in prompt render arrays before payload sections:

```ts
"output_file: metadata/agent-output/rubric-scoring.json",
"",
```

For retry prompts, add:

```ts
"覆盖写入 output_file，不要沿用旧文件内容。",
"output_file: metadata/agent-output/rubric-scoring.json",
"",
```

- [ ] **Step 4: Pass outputFile to runner requests**

In each `runOnce` request object, add:

```ts
outputFile: RUBRIC_SCORING_OUTPUT_FILE,
```

Use the matching constant in task and rule modules.

- [ ] **Step 5: Run agent tests and verify they pass**

Run:

```bash
node --import tsx --test tests/opencode-task-understanding.test.ts tests/opencode-rubric-scoring.test.ts tests/opencode-rule-assessment.test.ts
```

Expected: PASS.

---

### Task 6: Persist Output File Diagnostics

**Files:**
- Modify: `src/nodes/persistAndUploadNode.ts`
- Modify: `tests/score-agent.test.ts`

- [ ] **Step 1: Write failing persistence assertion**

Find the test in `tests/score-agent.test.ts` that reads `intermediate/rubric-agent-result.json` around existing assertions near `rubric-agent-result.json`. Add assertions that runner result includes output file fields:

```ts
const rubricAgentResult = JSON.parse(
  await fs.readFile(path.join(caseDir, "intermediate", "rubric-agent-result.json"), "utf-8"),
) as {
  runner_result?: { outputFile?: string; outputFileText?: string; assistantText?: string };
};
assert.equal(rubricAgentResult.runner_result?.outputFile, "metadata/agent-output/rubric-scoring.json");
assert.match(rubricAgentResult.runner_result?.outputFileText ?? "", /"summary"/);
```

If the existing fixture uses stubbed runner results, update the stub to include:

```ts
outputFile: "metadata/agent-output/rubric-scoring.json",
outputFileText: JSON.stringify(buildRubricFinalAnswer(payload.rubric_summary)),
assistantText: '{"output_file":"metadata/agent-output/rubric-scoring.json"}',
```

- [ ] **Step 2: Run the focused score-agent test and verify it fails**

Run the exact test containing this assertion. If the test name is hard to isolate, run:

```bash
node --import tsx --test tests/score-agent.test.ts
```

Expected: FAIL because persisted runner result lacks output file fields or stubs lack them.

- [ ] **Step 3: Ensure persist node preserves runner result fields**

`src/nodes/persistAndUploadNode.ts` already writes `state.rubricAgentRunnerResult` and `state.ruleAgentRunnerResult`. If it serializes the whole object, no code change may be needed; update test stubs and types instead.

If the node strips fields, preserve them:

```ts
runner_result: state.rubricAgentRunnerResult ?? { ... }
```

must include the full runner result object with `outputFile`, `outputFileText`, and `assistantText`.

- [ ] **Step 4: Run the persistence test and verify it passes**

Run:

```bash
node --import tsx --test tests/score-agent.test.ts
```

Expected: PASS or only unrelated pre-existing failures. If unrelated failures appear, document them and run the narrower affected tests.

---

### Task 7: Clean Duplicate Runtime Output Format Prompts

**Files:**
- Modify: `src/agent/opencodeRubricScoring.ts`
- Modify: `src/agent/opencodeRuleAssessment.ts`
- Modify: `tests/opencode-rubric-scoring.test.ts`
- Modify: `tests/opencode-rule-assessment.test.ts`

- [ ] **Step 1: Write failing tests that runtime prompts no longer inline full schema samples**

In `tests/opencode-rubric-scoring.test.ts`, update first prompt test:

```ts
assert.doesNotMatch(prompt, /正确输出格式:/);
assert.doesNotMatch(prompt, /"deduction_trace"\s*:/);
assert.match(prompt, /严格遵守 system prompt 中的正确输出格式/);
```

In `tests/opencode-rule-assessment.test.ts`, update first prompt test:

```ts
assert.doesNotMatch(prompt, /正确输出格式:/);
assert.doesNotMatch(prompt, /"rule_assessments"\s*:/);
assert.match(prompt, /严格遵守 system prompt 中的正确输出格式/);
```

Also update retry tests to assert no `正确输出格式:` in retry prompts.

- [ ] **Step 2: Run rubric/rule tests and verify they fail**

Run:

```bash
node --import tsx --test tests/opencode-rubric-scoring.test.ts tests/opencode-rule-assessment.test.ts
```

Expected: FAIL because runtime prompts still inline schema samples.

- [ ] **Step 3: Remove runtime schema sample functions**

In `src/agent/opencodeRubricScoring.ts`, remove:

```ts
function rubricOutputFormat(): Record<string, unknown> { ... }
function strictOutputInstructions(): string[] { ... }
```

Replace prompt output sections with concise lines:

```ts
"最终输出要求:",
"- 将最终 JSON object 写入 output_file。",
"- 严格遵守 system prompt 中的正确输出格式。",
"- assistant 最终回复只输出 {\"output_file\":\"metadata/agent-output/rubric-scoring.json\"}。",
```

In `src/agent/opencodeRuleAssessment.ts`, remove:

```ts
function ruleAssessmentOutputFormat(): Record<string, unknown> { ... }
```

Replace rule output sections with analogous concise lines.

- [ ] **Step 4: Run rubric/rule tests and verify they pass**

Run:

```bash
node --import tsx --test tests/opencode-rubric-scoring.test.ts tests/opencode-rule-assessment.test.ts
```

Expected: PASS.

---

### Task 8: Compact Rule Retry Payload

**Files:**
- Modify: `src/agent/opencodeRuleAssessment.ts`
- Modify: `tests/opencode-rule-assessment.test.ts`

- [ ] **Step 1: Write failing test for compact retry payload**

In `tests/opencode-rule-assessment.test.ts`, update retry tests:

```ts
assert.match(calls[1]?.prompt ?? "", /candidate_rule_ids/);
assert.doesNotMatch(calls[1]?.prompt ?? "", /rule_retry_payload/);
assert.doesNotMatch(calls[1]?.prompt ?? "", /task_understanding/);
assert.doesNotMatch(calls[1]?.prompt ?? "", /why_uncertain/);
```

- [ ] **Step 2: Run rule tests and verify they fail**

Run:

```bash
node --import tsx --test tests/opencode-rule-assessment.test.ts
```

Expected: FAIL because retry still includes `rule_retry_payload`.

- [ ] **Step 3: Replace compact retry payload builder**

Replace `compactRuleRetryPayload` with:

```ts
function compactRuleRetryPayload(payload: AgentBootstrapPayload): Record<string, unknown> {
  return {
    candidate_rule_ids: payload.assisted_rule_candidates.map((candidate) => candidate.rule_id),
    output_file: RULE_ASSESSMENT_OUTPUT_FILE,
  };
}
```

Update retry prompt text:

```ts
"- 只根据 candidate_rule_ids 覆盖所有候选 rule_id。",
"2. rule_assessments 必须覆盖 candidate_rule_ids 中每个 rule_id，不能新增、遗漏或重复。",
"candidate_rule_ids:",
stringifyForPrompt(compactRuleRetryPayload(input.bootstrapPayload)),
```

- [ ] **Step 4: Run rule tests and verify they pass**

Run:

```bash
node --import tsx --test tests/opencode-rule-assessment.test.ts
```

Expected: PASS.

---

### Task 9: End-To-End Verification With Simple Cases

**Files:**
- No source edits unless failures reveal implementation bugs.

- [ ] **Step 1: Run targeted unit tests**

Run:

```bash
node --import tsx --test tests/opencode-cli-runner.test.ts tests/opencode-config.test.ts tests/opencode-config-generation.test.ts tests/opencode-task-understanding.test.ts tests/opencode-rubric-scoring.test.ts tests/opencode-rule-assessment.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run build**

Run:

```bash
npm run build
```

Expected: PASS with `tsc -p tsconfig.json`.

- [ ] **Step 3: Run `simple_test`**

Run:

```bash
npm run score -- --case cases/simple_test
```

Expected: workflow completes and prints a result directory. Verify:

```bash
find <result-dir>/opencode-sandbox/metadata/agent-output -maxdepth 1 -type f -print
test -f <result-dir>/outputs/result.json
```

Expected files:

```text
metadata/agent-output/task-understanding.json
metadata/agent-output/rubric-scoring.json
metadata/agent-output/rule-assessment.json
outputs/result.json
```

- [ ] **Step 4: Run `glm_test1`**

Run:

```bash
npm run score -- --case cases/glm_test1
```

Expected: workflow completes and writes the same three agent output files plus `outputs/result.json`.

- [ ] **Step 5: Document residual risks**

If either case fails, capture:

```bash
tail -n 120 <result-dir>/logs/run.log
find <result-dir>/opencode-sandbox/metadata -maxdepth 3 -type f | sort
```

Classify the failure as one of:

- `output_file_missing`
- `output_file_invalid_json`
- schema validation failure
- model/tool permission failure
- unrelated workflow failure

Then fix with a new failing test before changing implementation.

---

## Self-Review Notes

- Spec coverage: The plan covers understanding read permission wording, formatter config, runtime copying, output file runner support, all three agent integrations, retry payload compaction, prompt cleanup, persistence diagnostics, and end-to-end verification.
- Placeholder scan: The plan contains no TODO/TBD placeholders. Steps include concrete files, code snippets, commands, and expected outcomes.
- Type consistency: `outputFile`, `outputFileText`, and `assistantText` are introduced on `OpencodeRunRequest`/`OpencodeRunResult` before agent modules depend on them. Agent output files use the spec paths exactly: `metadata/agent-output/task-understanding.json`, `metadata/agent-output/rubric-scoring.json`, `metadata/agent-output/rule-assessment.json`.

