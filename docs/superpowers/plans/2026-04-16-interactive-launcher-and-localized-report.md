# Interactive Launcher And Localized Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `launch:score -- --case <path>` bootstrap flow that persists OpenAI config into `.env`, runs scoring on a chosen case, writes prompt and case metadata into `inputs/`, appends key lifecycle logs into `logs/run.log`, and ensures all descriptive report/log text is Chinese.

**Architecture:** Keep the interactive launcher thin by pushing case selection, prompt snapshot writing, case-info writing, and logging orchestration into `runSingleCase()`. Introduce a small `CaseLogger` for append-only log writing, extend service orchestration to persist `inputs/prompt.txt` and `inputs/case-info.json`, and localize report/scoring/rule-engine template strings so both local debugging and deployed execution share the same Chinese output path.

**Tech Stack:** TypeScript, Node.js built-in test runner, Node.js readline/promises, LangGraph

---

### Task 1: Support `--case` In Interactive Launcher

**Files:**
- Modify: `/Users/guoyutong/MyWorkSpace/hmos-score-agent/src/tools/runInteractiveScore.ts`
- Modify: `/Users/guoyutong/MyWorkSpace/hmos-score-agent/package.json`
- Modify: `/Users/guoyutong/MyWorkSpace/hmos-score-agent/README.md`
- Test: `/Users/guoyutong/MyWorkSpace/hmos-score-agent/tests/interactive-launcher.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
test("parseLauncherArgs resolves explicit --case and falls back to init-input", () => {
  assert.equal(
    parseLauncherArgs(["--case", "examples/custom-case"]),
    path.resolve(process.cwd(), "examples/custom-case"),
  );
  assert.equal(
    parseLauncherArgs([]),
    path.resolve(process.cwd(), "init-input"),
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/interactive-launcher.test.ts`
Expected: FAIL because `parseLauncherArgs` does not exist.

- [ ] **Step 3: Write minimal implementation**

```ts
export function parseLauncherArgs(argv: string[]): string {
  const index = argv.findIndex((item) => item === "--case");
  if (index >= 0 && argv[index + 1]) {
    return path.resolve(process.cwd(), argv[index + 1]);
  }
  return resolveDefaultCasePath();
}

export async function runInteractiveScore(argv: string[] = process.argv.slice(2)): Promise<void> {
  const casePath = parseLauncherArgs(argv);
  // existing prompt + env persistence logic
  const result = await runSingleCase(casePath);
}
```

Update `README.md` to document `npm run launch:score -- --case <path>` and keep `package.json` script as:

```json
"launch:score": "node --import tsx src/tools/runInteractiveScore.ts"
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/interactive-launcher.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add /Users/guoyutong/MyWorkSpace/hmos-score-agent/src/tools/runInteractiveScore.ts /Users/guoyutong/MyWorkSpace/hmos-score-agent/package.json /Users/guoyutong/MyWorkSpace/hmos-score-agent/README.md /Users/guoyutong/MyWorkSpace/hmos-score-agent/tests/interactive-launcher.test.ts
git commit -m "feat: support custom case paths in interactive launcher"
```

### Task 2: Persist Prompt And Case Metadata Into `inputs/`

**Files:**
- Modify: `/Users/guoyutong/MyWorkSpace/hmos-score-agent/src/service.ts`
- Modify: `/Users/guoyutong/MyWorkSpace/hmos-score-agent/src/io/artifactStore.ts`
- Test: `/Users/guoyutong/MyWorkSpace/hmos-score-agent/tests/interactive-launcher.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
test("runSingleCase writes prompt snapshot and case-info metadata into inputs", async (t) => {
  const { casePath, localCaseRoot } = await createLauncherCaseFixture(t);
  process.env.LOCAL_CASE_ROOT = localCaseRoot;
  process.env.DEFAULT_REFERENCE_ROOT = path.resolve(process.cwd(), "references/scoring");

  const result = await runSingleCase(casePath);
  const promptText = await fs.readFile(path.join(result.caseDir, "inputs", "prompt.txt"), "utf-8");
  const caseInfo = JSON.parse(await fs.readFile(path.join(result.caseDir, "inputs", "case-info.json"), "utf-8"));

  assert.equal(promptText, "请修复页面中的 bug");
  assert.equal(caseInfo.task_type, "bug_fix");
  assert.equal(caseInfo.source_case_path, casePath);
  assert.equal(caseInfo.patch_path.endsWith("changes.patch"), true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/interactive-launcher.test.ts`
Expected: FAIL because `inputs/prompt.txt` and `inputs/case-info.json` are not written.

- [ ] **Step 3: Write minimal implementation**

```ts
await artifactStore.writeText(caseDir, "inputs/prompt.txt", caseInput.promptText);
await artifactStore.writeJson(caseDir, "inputs/case-info.json", {
  case_id: path.basename(caseDir),
  source_case_path: path.resolve(casePath),
  task_type: taskType,
  original_project_path: caseInput.originalProjectPath,
  generated_project_path: caseInput.generatedProjectPath,
  patch_path: caseInput.patchPath ?? null,
  started_at: startedAt,
});
```

Keep `ArtifactStore` generic; if needed, only add a small helper for appending text.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/interactive-launcher.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add /Users/guoyutong/MyWorkSpace/hmos-score-agent/src/service.ts /Users/guoyutong/MyWorkSpace/hmos-score-agent/src/io/artifactStore.ts /Users/guoyutong/MyWorkSpace/hmos-score-agent/tests/interactive-launcher.test.ts
git commit -m "feat: persist prompt and case metadata snapshots"
```

### Task 3: Add Case Logger And Key Lifecycle Logs

**Files:**
- Create: `/Users/guoyutong/MyWorkSpace/hmos-score-agent/src/io/caseLogger.ts`
- Modify: `/Users/guoyutong/MyWorkSpace/hmos-score-agent/src/service.ts`
- Modify: `/Users/guoyutong/MyWorkSpace/hmos-score-agent/src/nodes/persistAndUploadNode.ts`
- Test: `/Users/guoyutong/MyWorkSpace/hmos-score-agent/tests/interactive-launcher.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
test("runSingleCase writes key lifecycle events into logs/run.log", async (t) => {
  const { casePath, localCaseRoot } = await createLauncherCaseFixture(t);
  process.env.LOCAL_CASE_ROOT = localCaseRoot;
  process.env.DEFAULT_REFERENCE_ROOT = path.resolve(process.cwd(), "references/scoring");

  const result = await runSingleCase(casePath);
  const logText = await fs.readFile(path.join(result.caseDir, "logs", "run.log"), "utf-8");

  assert.match(logText, /启动评分流程/);
  assert.match(logText, /任务类型判定完成 taskType=bug_fix/);
  assert.match(logText, /工作流执行完成/);
  assert.match(logText, /结果已落盘/);
  assert.match(logText, /上传跳过/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/interactive-launcher.test.ts`
Expected: FAIL because `logs/run.log` does not exist or lacks the required lines.

- [ ] **Step 3: Write minimal implementation**

```ts
export class CaseLogger {
  constructor(private readonly artifactStore: ArtifactStore, private readonly caseDir: string) {}

  async info(message: string): Promise<void> {
    await this.append("INFO", message);
  }

  async error(message: string): Promise<void> {
    await this.append("ERROR", message);
  }

  private async append(level: "INFO" | "ERROR", message: string): Promise<void> {
    const line = `[${new Date().toISOString()}] [${level}] ${message}\n`;
    await this.artifactStore.appendText(this.caseDir, "logs/run.log", line);
  }
}
```

Then in `runSingleCase()` add logs for:
- 启动评分流程
- 用例加载完成
- 任务类型判定完成
- 输入快照写入完成
- 工作流开始执行
- 工作流执行完成
- 结果已落盘
- 上传结果 / 上传跳过
- 执行失败

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/interactive-launcher.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add /Users/guoyutong/MyWorkSpace/hmos-score-agent/src/io/caseLogger.ts /Users/guoyutong/MyWorkSpace/hmos-score-agent/src/service.ts /Users/guoyutong/MyWorkSpace/hmos-score-agent/src/nodes/persistAndUploadNode.ts /Users/guoyutong/MyWorkSpace/hmos-score-agent/tests/interactive-launcher.test.ts
git commit -m "feat: add case lifecycle logging"
```

### Task 4: Localize Descriptive Report And Rule Text To Chinese

**Files:**
- Modify: `/Users/guoyutong/MyWorkSpace/hmos-score-agent/src/scoring/scoringEngine.ts`
- Modify: `/Users/guoyutong/MyWorkSpace/hmos-score-agent/src/rules/ruleEngine.ts`
- Modify: `/Users/guoyutong/MyWorkSpace/hmos-score-agent/src/rules/textRuleEvaluator.ts`
- Modify: `/Users/guoyutong/MyWorkSpace/hmos-score-agent/src/nodes/reportGenerationNode.ts`
- Modify: `/Users/guoyutong/MyWorkSpace/hmos-score-agent/tests/score-agent.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
test("runScoreWorkflow emits Chinese descriptive text in result.json and report.html", async (t) => {
  const { caseInput, caseDir, artifactStore } = await createWorkflowFixture(t);
  const result = await runScoreWorkflow({
    caseInput,
    caseDir,
    referenceRoot: path.resolve(process.cwd(), "references/scoring"),
    artifactStore,
  });

  const resultJson = JSON.parse(await fs.readFile(path.join(caseDir, "outputs", "result.json"), "utf-8"));
  const reportHtml = await fs.readFile(path.join(caseDir, "outputs", "report.html"), "utf-8");

  assert.equal(resultJson.basic_info.target_description, "HarmonyOS 生成工程评分");
  assert.match(resultJson.overall_conclusion.summary, /触发|未触发|评分/);
  assert.equal(resultJson.rule_audit_results.some((item: { conclusion: string }) => /当前版本未接入对应判定器。|未发现该规则的命中证据。|检测到/.test(item.conclusion)), true);
  assert.match(reportHtml, /评分报告/);
  assert.doesNotMatch(reportHtml, /Score Report/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/score-agent.test.ts`
Expected: FAIL because report and scoring templates still contain English text.

- [ ] **Step 3: Write minimal implementation**

Replace English templates with Chinese equivalents, for example:

```ts
target_description: "HarmonyOS 生成工程评分"
comment: "包含需人工复核的扣分项。"
rationale: `${rule.rule_id} 触发了 ${rule.rule_source} 扣分规则。`
summary: triggeredGates.length > 0 ? ... : "未触发硬门槛。"
conclusion: matchedFiles.length > 0 ? `检测到规则命中，文件：${matchedFiles.join(", ")}` : "未发现该规则的命中证据。"
html title: "评分报告"
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/score-agent.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add /Users/guoyutong/MyWorkSpace/hmos-score-agent/src/scoring/scoringEngine.ts /Users/guoyutong/MyWorkSpace/hmos-score-agent/src/rules/ruleEngine.ts /Users/guoyutong/MyWorkSpace/hmos-score-agent/src/rules/textRuleEvaluator.ts /Users/guoyutong/MyWorkSpace/hmos-score-agent/src/nodes/reportGenerationNode.ts /Users/guoyutong/MyWorkSpace/hmos-score-agent/tests/score-agent.test.ts
git commit -m "feat: localize report and rule descriptions"
```

### Task 5: Full Verification

**Files:**
- Test: `/Users/guoyutong/MyWorkSpace/hmos-score-agent/tests/interactive-launcher.test.ts`
- Test: `/Users/guoyutong/MyWorkSpace/hmos-score-agent/tests/score-agent.test.ts`

- [ ] **Step 1: Run targeted tests**

Run: `node --import tsx --test tests/interactive-launcher.test.ts tests/score-agent.test.ts`
Expected: PASS

- [ ] **Step 2: Run the full test suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 3: Run build**

Run: `npm run build`
Expected: PASS

- [ ] **Step 4: Verify manual launcher flow**

Run: `npm run launch:score -- --case init-input`
Expected: prompts for `baseURL` and `apiKey`, updates `.env`, creates `.local-cases/<timestamp>_<task_type>_<unique_id>/`, writes `inputs/prompt.txt`, `inputs/case-info.json`, and `logs/run.log`

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: enhance interactive scoring bootstrap and localized outputs"
```
