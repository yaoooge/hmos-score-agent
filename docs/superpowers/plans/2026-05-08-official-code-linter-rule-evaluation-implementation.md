# Official Code Linter Rule Evaluation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate HarmonyOS official Code Linter CLI into the rule evaluation phase with four v1 recommended rule sets, changed-file-only enforcement, safe degradation, and no leakage of unchanged-file findings.

**Architecture:** Add an `officialCodeLinterNode` after `ruleAuditNode` and before rule merge so it can reuse `evidenceSummary.changedFiles` for filtering. Keep the linter integration in focused modules for config generation, workspace preparation, CLI running, parsing, sanitizing, and mapping; only effective findings are written to business state or artifacts. Merge official linter rule results with deterministic static results before score fusion and report generation.

**Tech Stack:** TypeScript, Node.js built-in `fs/path/child_process`, LangGraph state nodes, existing `ArtifactStore`, existing Node test runner with `tsx`.

---

## File Structure

- Create: `src/rules/officialCodeLinter/recommendedRuleSets.ts`
  - Owns the four v1 rule set constants.
- Create: `src/rules/officialCodeLinter/configWriter.ts`
  - Builds and writes deterministic `code-linter.json5`.
- Create: `src/rules/officialCodeLinter/workspacePreparer.ts`
  - Copies only necessary generated project files and `code-linter.json5` into `intermediate/code-linter/workspace`.
- Create: `src/rules/officialCodeLinter/parser.ts`
  - Parses JSON and text CLI output into normalized in-memory findings.
- Create: `src/rules/officialCodeLinter/resultMapper.ts`
  - Normalizes paths, filters unchanged-file findings, deduplicates findings, aggregates `RuleAuditResult`s, and maps rule source.
- Create: `src/rules/officialCodeLinter/sanitizer.ts`
  - Produces diagnostics text without finding detail lines, filtered counts, or unchanged-file data.
- Create: `src/rules/officialCodeLinter/runner.ts`
  - Runs `node ./index.js <workspace>` with timeout and returns raw process result.
- Create: `src/nodes/officialCodeLinterNode.ts`
  - Orchestrates availability checks, workspace creation, CLI execution, parsing, filtering, artifact writes, and state updates.
- Modify: `src/config.ts`
  - Add `HMOS_CODE_LINTER_RUN_DIR` and `HMOS_CODE_LINTER_TIMEOUT_MS`.
- Modify: `src/types.ts`
  - Add official linter status, finding, and summary types.
- Modify: `src/workflow/state.ts`
  - Add official linter state annotations.
- Modify: `src/workflow/scoreWorkflow.ts`
  - Insert `officialCodeLinterNode` after `ruleAuditNode` in normal and prepared workflows.
- Modify: `src/nodes/ruleMergeNode.ts`
  - Merge `officialLinterRuleResults` into the deterministic side for every branch.
- Modify: `src/scoring/scoreFusion.ts`
  - Recognize `OFFICIAL-LINTER:` rule IDs and map them to rubric penalty metrics.
- Modify: `src/report/renderer/buildHtmlReportViewModel.ts`
  - Expose official linter summary from `resultJson`.
- Modify: `src/report/renderer/renderHtmlReport.ts`
  - Render status, configured rule sets, and effective finding count only.
- Modify: `src/nodes/reportGenerationNode.ts`
  - Add `official_linter_summary` to `resultJson`.
- Modify: `src/workflow/observability/types.ts`, `src/workflow/observability/nodeLabels.ts`, `src/workflow/observability/nodeSummaries.ts`
  - Add workflow observability for the new node.
- Modify: `src/io/artifactStore.ts`
  - Ensure nested artifact parent directories are created before writes.

## Task 1: Config, Types, And Rule Sets

**Files:**
- Create: `src/rules/officialCodeLinter/recommendedRuleSets.ts`
- Modify: `src/config.ts`
- Modify: `src/types.ts`
- Modify: `src/workflow/state.ts`
- Test: `tests/official-code-linter-config.test.ts`
- Test: `tests/config-reference.test.ts`

- [ ] **Step 1: Write failing tests for v1 rule sets and config**

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { getConfig } from "../src/config.js";
import {
  buildOfficialCodeLinterConfig,
  serializeOfficialCodeLinterConfig,
} from "../src/rules/officialCodeLinter/configWriter.js";
import { officialCodeLinterRecommendedRuleSets } from "../src/rules/officialCodeLinter/recommendedRuleSets.js";

test("official Code Linter v1 uses exactly four recommended rule sets", () => {
  assert.deepEqual(officialCodeLinterRecommendedRuleSets, [
    "plugin:@typescript-eslint/recommended",
    "plugin:@security/recommended",
    "plugin:@performance/recommended",
    "plugin:@hw-stylistic/recommended",
  ]);
  assert.equal(officialCodeLinterRecommendedRuleSets.includes("plugin:@previewer/recommended"), false);
  assert.equal(
    officialCodeLinterRecommendedRuleSets.includes("plugin:@cross-device-app-dev/recommended"),
    false,
  );
});

test("generated code-linter config explicitly includes the four v1 recommended rule sets", () => {
  const config = buildOfficialCodeLinterConfig();
  assert.deepEqual(config.ruleSet, officialCodeLinterRecommendedRuleSets);
  assert.ok(config.files.includes("**/*.ets"));
  assert.ok(config.ignore.includes("node_modules/**/*"));

  const text = serializeOfficialCodeLinterConfig(config);
  assert.match(text, /plugin:@typescript-eslint\/recommended/);
  assert.match(text, /plugin:@security\/recommended/);
  assert.match(text, /plugin:@performance\/recommended/);
  assert.match(text, /plugin:@hw-stylistic\/recommended/);
});

test("official Code Linter config defaults to global node with optional run dir", () => {
  const previousRunDir = process.env.HMOS_CODE_LINTER_RUN_DIR;
  const previousTimeout = process.env.HMOS_CODE_LINTER_TIMEOUT_MS;
  delete process.env.HMOS_CODE_LINTER_RUN_DIR;
  delete process.env.HMOS_CODE_LINTER_TIMEOUT_MS;
  try {
    const config = getConfig();
    assert.equal(config.officialCodeLinterRunDir, undefined);
    assert.equal(config.officialCodeLinterTimeoutMs, 120000);
    assert.equal(Object.hasOwn(config, "officialCodeLinterNode"), false);
  } finally {
    if (previousRunDir === undefined) delete process.env.HMOS_CODE_LINTER_RUN_DIR;
    else process.env.HMOS_CODE_LINTER_RUN_DIR = previousRunDir;
    if (previousTimeout === undefined) delete process.env.HMOS_CODE_LINTER_TIMEOUT_MS;
    else process.env.HMOS_CODE_LINTER_TIMEOUT_MS = previousTimeout;
  }
});
```

- [ ] **Step 2: Run tests to verify RED**

Run: `node --import tsx --test tests/official-code-linter-config.test.ts tests/config-reference.test.ts`

Expected: FAIL because `configWriter.ts` and `recommendedRuleSets.ts` do not exist and config fields are missing.

- [ ] **Step 3: Add minimal types, config, and rule constants**

Add the four rule set constants. Add `OfficialLinterRunStatus`, `OfficialLinterFinding`, `OfficialLinterSummary` to `src/types.ts`. Add `officialCodeLinterRunDir?: string` and `officialCodeLinterTimeoutMs: number` to `AppConfig`, reading only `HMOS_CODE_LINTER_RUN_DIR` and `HMOS_CODE_LINTER_TIMEOUT_MS`. Add official linter annotations to `ScoreState`.

- [ ] **Step 4: Run tests to verify GREEN**

Run: `node --import tsx --test tests/official-code-linter-config.test.ts tests/config-reference.test.ts`

Expected: PASS.

## Task 2: Artifact Writes And Workspace Preparation

**Files:**
- Create: `src/rules/officialCodeLinter/configWriter.ts`
- Create: `src/rules/officialCodeLinter/workspacePreparer.ts`
- Modify: `src/io/artifactStore.ts`
- Test: `tests/official-code-linter-config.test.ts`
- Test: `tests/official-code-linter-node.test.ts`

- [ ] **Step 1: Write failing tests for config writes and minimal workspace contents**

```ts
test("official linter workspace only contains copied project files and code-linter config", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "official-linter-workspace-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const generated = path.join(root, "generated");
  const caseDir = path.join(root, "case-1");
  await fs.mkdir(path.join(generated, "entry", "src", "main", "ets", "pages"), { recursive: true });
  await fs.mkdir(path.join(generated, "node_modules", "left-pad"), { recursive: true });
  await fs.mkdir(path.join(caseDir, "inputs"), { recursive: true });
  await fs.writeFile(path.join(generated, "entry", "src", "main", "ets", "pages", "Index.ets"), "let a = 1;\n");
  await fs.writeFile(path.join(generated, "node_modules", "left-pad", "index.js"), "module.exports = 1;\n");
  await fs.writeFile(path.join(caseDir, "inputs", "secret.txt"), "must not copy\n");

  const result = await prepareOfficialCodeLinterWorkspace({ generatedProjectPath: generated, caseDir });
  const workspaceFiles = await collectWorkspaceFiles(result.workspaceDir);

  assert.deepEqual(workspaceFiles.sort(), [
    "code-linter.json5",
    "entry/src/main/ets/pages/Index.ets",
  ]);
  assert.equal(workspaceFiles.includes("summary.json"), false);
  assert.equal(workspaceFiles.includes("findings.effective.json"), false);
  assert.equal(workspaceFiles.some((item) => item.startsWith("inputs/")), false);
});
```

- [ ] **Step 2: Run tests to verify RED**

Run: `node --import tsx --test tests/official-code-linter-config.test.ts tests/official-code-linter-node.test.ts`

Expected: FAIL because workspace preparation is missing or nested artifact directories cannot be written.

- [ ] **Step 3: Implement config writing and workspace copy**

Implement `prepareOfficialCodeLinterWorkspace()` to:

- Create `caseDir/intermediate/code-linter/workspace`.
- Remove only that workspace directory before rebuilding it.
- Use `collectVisibleFiles(generatedProjectPath, { extraIgnoredPathPrefixes: ["node_modules", "oh_modules", "build", ".preview", ".git", "src/ohosTest", "src/test"] })`.
- Copy files only from `generatedProjectPath`.
- Write `intermediate/code-linter/code-linter.json5`.
- Copy the generated config into `workspace/code-linter.json5`.
- Never write diagnostics into `workspace/`.

Update `ArtifactStore.writeJson`, `writeText`, and `appendText` to create the target parent directory with `fs.mkdir(path.dirname(filePath), { recursive: true })`.

- [ ] **Step 4: Run tests to verify GREEN**

Run: `node --import tsx --test tests/official-code-linter-config.test.ts tests/official-code-linter-node.test.ts`

Expected: PASS.

## Task 3: Parser, Filtering, Mapping, And Sanitizer

**Files:**
- Create: `src/rules/officialCodeLinter/parser.ts`
- Create: `src/rules/officialCodeLinter/resultMapper.ts`
- Create: `src/rules/officialCodeLinter/sanitizer.ts`
- Test: `tests/official-code-linter-parser.test.ts`
- Test: `tests/official-code-linter-filtering.test.ts`

- [ ] **Step 1: Write failing parser and filtering tests**

```ts
test("parseOfficialCodeLinterOutput parses ESLint-like JSON", () => {
  const findings = parseOfficialCodeLinterOutput({
    stdout: JSON.stringify([
      {
        filePath: "/tmp/workspace/entry/src/main/ets/pages/Index.ets",
        messages: [
          {
            ruleId: "@performance/foreach-args-check",
            message: "Avoid unnecessary foreach argument.",
            severity: 2,
            line: 12,
            column: 4,
          },
        ],
      },
    ]),
    stderr: "",
  });

  assert.equal(findings.status, "parsed");
  assert.equal(findings.findings[0]?.rule_id, "@performance/foreach-args-check");
  assert.equal(findings.findings[0]?.severity, "error");
});

test("parseOfficialCodeLinterOutput parses common text output", () => {
  const findings = parseOfficialCodeLinterOutput({
    stdout:
      "/tmp/workspace/entry/src/main/ets/pages/Index.ets:12:4 error Avoid unnecessary foreach argument @performance/foreach-args-check\n",
    stderr: "",
  });

  assert.equal(findings.status, "parsed");
  assert.equal(findings.findings[0]?.file, "/tmp/workspace/entry/src/main/ets/pages/Index.ets");
  assert.equal(findings.findings[0]?.rule_id, "@performance/foreach-args-check");
});

test("changed-file filtering drops unchanged findings before artifacts and rule results", () => {
  const mapped = mapOfficialCodeLinterFindings({
    findings: [
      {
        rule_id: "@security/no-http",
        message: "use https",
        severity: "error",
        file: "/tmp/workspace/entry/src/main/ets/pages/Changed.ets",
        line: 2,
        column: 1,
        source_rule_set: "plugin:@security/recommended",
      },
      {
        rule_id: "@security/no-http",
        message: "legacy issue",
        severity: "error",
        file: "/tmp/workspace/entry/src/main/ets/pages/Legacy.ets",
        line: 9,
        column: 1,
        source_rule_set: "plugin:@security/recommended",
      },
    ],
    workspaceDir: "/tmp/workspace",
    hasPatch: true,
    changedFiles: ["entry/src/main/ets/pages/Changed.ets"],
  });

  assert.deepEqual(mapped.effectiveFindings.map((item) => item.file), [
    "entry/src/main/ets/pages/Changed.ets",
  ]);
  assert.equal(mapped.ruleResults.length, 1);
  assert.equal(mapped.ruleResults[0]?.rule_id, "OFFICIAL-LINTER:@security/no-http");
  assert.equal(mapped.ruleResults[0]?.rule_source, "forbidden_pattern");
  assert.doesNotMatch(JSON.stringify(mapped), /Legacy\.ets|legacy issue|filtered/i);
});

test("sanitized diagnostics do not include finding detail lines or filtered counts", () => {
  const sanitized = sanitizeOfficialCodeLinterOutput({
    text:
      "/tmp/workspace/entry/src/main/ets/pages/Legacy.ets:9:1 error legacy issue @security/no-http\nfinished\n",
    effectiveFindingCount: 1,
    runStatus: "success",
  });
  assert.doesNotMatch(sanitized, /Legacy\.ets|legacy issue|@security\/no-http|filtered|dropped|unchanged/i);
  assert.match(sanitized, /runStatus=success/);
  assert.match(sanitized, /effectiveFindingCount=1/);
});
```

- [ ] **Step 2: Run tests to verify RED**

Run: `node --import tsx --test tests/official-code-linter-parser.test.ts tests/official-code-linter-filtering.test.ts`

Expected: FAIL because parser, mapper, and sanitizer do not exist.

- [ ] **Step 3: Implement parser, mapper, and sanitizer**

Implement:

- JSON parsing for arrays of `{ filePath, messages }` and objects with `results`.
- Text parsing for `file:line:column severity message ruleId`.
- Path normalization: POSIX separators, strip workspace absolute prefix, strip `workspace/`, strip `generated/`, strip `./`.
- Changed-file filtering only when `hasPatch === true && changedFiles.length > 0`.
- Dedup key: `rule_id + file + line + column + message`.
- Rule source mapping:
  - `@security/*` -> `forbidden_pattern`
  - `@performance/*`, `@hw-stylistic/*`, `@typescript-eslint/*` -> `should_rule`
- Aggregation by rule id with at most five locations in the conclusion.
- Sanitizer output that includes only run status and effective finding count, not filtered counts or raw finding lines.

- [ ] **Step 4: Run tests to verify GREEN**

Run: `node --import tsx --test tests/official-code-linter-parser.test.ts tests/official-code-linter-filtering.test.ts`

Expected: PASS.

## Task 4: Runner And Node Orchestration

**Files:**
- Create: `src/rules/officialCodeLinter/runner.ts`
- Create: `src/nodes/officialCodeLinterNode.ts`
- Modify: `src/workflow/observability/types.ts`
- Modify: `src/workflow/observability/nodeLabels.ts`
- Modify: `src/workflow/observability/nodeSummaries.ts`
- Test: `tests/official-code-linter-node.test.ts`
- Test: `tests/workflow-node-summary.test.ts`

- [ ] **Step 1: Write failing tests for degraded and successful node paths**

```ts
test("officialCodeLinterNode returns not_installed without rule results when run dir is absent", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "official-linter-node-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const caseDir = path.join(root, "case-1");
  const generated = path.join(root, "generated");
  await fs.mkdir(path.join(generated, "entry", "src", "main", "ets", "pages"), { recursive: true });

  const result = await officialCodeLinterNode(
    {
      caseDir,
      caseInput: {
        caseId: "case-1",
        promptText: "",
        originalProjectPath: generated,
        generatedProjectPath: generated,
      },
      hasPatch: true,
      evidenceSummary: { workspaceFileCount: 1, originalFileCount: 0, changedFileCount: 1, changedFiles: ["entry/src/main/ets/pages/Index.ets"], hasPatch: true },
    } as ScoreGraphState,
    { runDir: undefined, timeoutMs: 120000 },
  );

  assert.equal(result.officialLinterRunStatus, "not_installed");
  assert.deepEqual(result.officialLinterFindings, []);
  assert.deepEqual(result.officialLinterRuleResults, []);
});

test("officialCodeLinterNode writes only effective findings and diagnostics outside workspace", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "official-linter-node-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const caseDir = path.join(root, "case-1");
  const generated = path.join(root, "generated");
  const runDir = path.join(root, "run");
  await fs.mkdir(path.join(generated, "entry", "src", "main", "ets", "pages"), { recursive: true });
  await fs.mkdir(runDir, { recursive: true });
  await fs.writeFile(path.join(generated, "entry", "src", "main", "ets", "pages", "Changed.ets"), "let a = 1;\n");
  await fs.writeFile(path.join(generated, "entry", "src", "main", "ets", "pages", "Legacy.ets"), "let b = 1;\n");
  await fs.writeFile(path.join(runDir, "index.js"), "console.log(JSON.stringify([{filePath: process.argv[2] + '/entry/src/main/ets/pages/Changed.ets', messages: [{ ruleId: '@performance/foreach-args-check', message: 'changed issue', severity: 2, line: 1, column: 1 }]}, {filePath: process.argv[2] + '/entry/src/main/ets/pages/Legacy.ets', messages: [{ ruleId: '@security/no-http', message: 'legacy issue', severity: 2, line: 2, column: 1 }]}]));");

  const result = await officialCodeLinterNode(
    {
      caseDir,
      caseInput: {
        caseId: "case-1",
        promptText: "",
        originalProjectPath: generated,
        generatedProjectPath: generated,
      },
      hasPatch: true,
      evidenceSummary: { workspaceFileCount: 2, originalFileCount: 0, changedFileCount: 1, changedFiles: ["entry/src/main/ets/pages/Changed.ets"], hasPatch: true },
    } as ScoreGraphState,
    { runDir, timeoutMs: 120000 },
  );

  assert.equal(result.officialLinterRunStatus, "success");
  assert.deepEqual(result.officialLinterFindings?.map((item) => item.file), [
    "entry/src/main/ets/pages/Changed.ets",
  ]);
  const effectivePath = path.join(caseDir, "intermediate", "code-linter", "findings.effective.json");
  const effective = await fs.readFile(effectivePath, "utf-8");
  assert.match(effective, /Changed\.ets/);
  assert.doesNotMatch(effective, /Legacy\.ets|legacy issue|@security\/no-http/);

  const workspaceFiles = await collectWorkspaceFiles(path.join(caseDir, "intermediate", "code-linter", "workspace"));
  assert.equal(workspaceFiles.includes("summary.json"), false);
  assert.equal(workspaceFiles.includes("findings.effective.json"), false);
  assert.equal(workspaceFiles.includes("stdout.sanitized.txt"), false);
  assert.equal(workspaceFiles.includes("stderr.sanitized.txt"), false);
  assert.equal(workspaceFiles.includes("exit-code.txt"), false);
});
```

- [ ] **Step 2: Run tests to verify RED**

Run: `node --import tsx --test tests/official-code-linter-node.test.ts tests/workflow-node-summary.test.ts`

Expected: FAIL because the node, runner, and observability entries do not exist.

- [ ] **Step 3: Implement runner and node**

Implement:

- Availability checks for run dir and `index.js`; missing is `not_installed`.
- `spawn("node", ["./index.js", workspaceDir], { cwd: runDir, env: process.env })`.
- Timeout kills the child and returns `timeout`.
- Non-zero exit with parsed findings is still `success`.
- Failed process with no parsed findings is `failed`.
- Unparseable output after a successful process is `invalid_output` unless no findings and empty output, which is `success`.
- Artifact writes under `intermediate/code-linter/` only:
  - `summary.json`
  - `findings.effective.json`
  - `stdout.sanitized.txt`
  - `stderr.sanitized.txt`
  - `exit-code.txt`
- No `findings.raw.json`.
- No human review item generation.

- [ ] **Step 4: Run tests to verify GREEN**

Run: `node --import tsx --test tests/official-code-linter-node.test.ts tests/workflow-node-summary.test.ts`

Expected: PASS.

## Task 5: Workflow And Merge Integration

**Files:**
- Modify: `src/workflow/scoreWorkflow.ts`
- Modify: `src/nodes/ruleMergeNode.ts`
- Test: `tests/score-agent.test.ts`

- [ ] **Step 1: Write failing tests for merge and workflow state**

```ts
test("ruleMergeNode merges official linter rule results with deterministic results", async () => {
  const result = await ruleMergeNode(
    {
      deterministicRuleResults: [
        { rule_id: "ARKTS-SHOULD-001", rule_source: "should_rule", result: "不满足", conclusion: "internal" },
      ],
      officialLinterRuleResults: [
        { rule_id: "OFFICIAL-LINTER:@performance/foreach-args-check", rule_source: "should_rule", result: "不满足", conclusion: "official" },
      ],
      assistedRuleCandidates: [],
    } as ScoreGraphState,
    {},
  );

  assert.deepEqual(result.mergedRuleAuditResults?.map((item) => item.rule_id), [
    "ARKTS-SHOULD-001",
    "OFFICIAL-LINTER:@performance/foreach-args-check",
  ]);
});
```

- [ ] **Step 2: Run tests to verify RED**

Run: `node --import tsx --test tests/score-agent.test.ts`

Expected: FAIL because `ruleMergeNode` ignores official linter results.

- [ ] **Step 3: Integrate node into workflows and merge**

Update both graph builders:

- Normal path: `inputClassificationNode -> ruleAuditNode -> officialCodeLinterNode -> rubricPreparationNode`.
- Prepared path: `opencodeSandboxPreparationNode -> ruleAuditNode -> officialCodeLinterNode -> rubricPreparationNode`.
- Pass run dir and timeout from `getConfig()`.
- In `ruleMergeNode`, compute `deterministicWithOfficial = [...deterministicRuleResults, ...officialLinterRuleResults]` and use it in every merge branch.

- [ ] **Step 4: Run tests to verify GREEN**

Run: `node --import tsx --test tests/score-agent.test.ts`

Expected: PASS.

## Task 6: Score Fusion And Report Summary

**Files:**
- Modify: `src/scoring/scoreFusion.ts`
- Modify: `src/nodes/reportGenerationNode.ts`
- Modify: `src/report/renderer/buildHtmlReportViewModel.ts`
- Modify: `src/report/renderer/renderHtmlReport.ts`
- Test: `tests/score-fusion.test.ts`
- Test: `tests/report-renderer.test.ts`

- [ ] **Step 1: Write failing score fusion and report tests**

```ts
test("official security linter rule maps to security boundary penalty", () => {
  const result = fuseRubricScoreWithRules({
    taskType: "bug_fix",
    rubric,
    rubricSnapshot,
    rubricScoringResult,
    rubricAgentRunStatus: "success",
    ruleAuditResults: [
      {
        rule_id: "OFFICIAL-LINTER:@security/no-http",
        rule_source: "forbidden_pattern",
        result: "不满足",
        conclusion: "entry/src/main/ets/pages/Index.ets:1:1 @security/no-http use https",
      },
    ],
    ruleViolations: [],
    evidenceSummary,
  });

  assert.ok(
    result.scoreFusionDetails.some((detail) =>
      detail.ruleImpactDetails.some((impact) => impact.rule_id === "OFFICIAL-LINTER:@security/no-http"),
    ),
  );
});

test("report view model exposes official linter summary without raw finding details", () => {
  const viewModel = buildHtmlReportViewModel({
    official_linter_summary: {
      configuredRuleSets: ["plugin:@typescript-eslint/recommended"],
      effectiveFindingCount: 1,
      runStatus: "success",
      durationMs: 50,
    },
    rule_audit_results: [],
    human_review_items: [],
  });

  assert.equal(viewModel.officialLinter.runStatus, "success");
  assert.equal(viewModel.officialLinter.effectiveFindingCount, 1);
  assert.doesNotMatch(JSON.stringify(viewModel.officialLinter), /Legacy\.ets|legacy issue|filtered/i);
});
```

- [ ] **Step 2: Run tests to verify RED**

Run: `node --import tsx --test tests/score-fusion.test.ts tests/report-renderer.test.ts`

Expected: FAIL because score fusion and report view model do not handle official linter summary.

- [ ] **Step 3: Implement score and report behavior**

Implement:

- `OFFICIAL-LINTER:@security/*` -> `securityBoundaryMetrics`, heavy severity, ratio `0.2`.
- `OFFICIAL-LINTER:@performance/*` -> `performanceRiskMetrics`, medium severity, ratio `0.12`.
- `OFFICIAL-LINTER:@hw-stylistic/*` -> `staticQualityMetrics` and `namingMetrics`, light severity, ratio `0.08`.
- `OFFICIAL-LINTER:@typescript-eslint/*` -> `typeSafetyMetrics` and `staticQualityMetrics`, medium severity, ratio `0.1`.
- Keep aggregation by official rule id so repeated findings do not apply repeated penalties.
- Add `official_linter_summary` to `resultJson` with status, rule sets, effective count, exit code, duration, diagnostics.
- Add a compact report section that displays only summary fields and rule set names; no raw or filtered finding details.

- [ ] **Step 4: Run tests to verify GREEN**

Run: `node --import tsx --test tests/score-fusion.test.ts tests/report-renderer.test.ts`

Expected: PASS.

## Task 7: End-To-End Verification

**Files:**
- All touched production and test files.

- [ ] **Step 1: Run focused test suite**

Run:

```bash
node --import tsx --test \
  tests/official-code-linter-config.test.ts \
  tests/official-code-linter-parser.test.ts \
  tests/official-code-linter-filtering.test.ts \
  tests/official-code-linter-node.test.ts \
  tests/workflow-node-summary.test.ts \
  tests/score-fusion.test.ts \
  tests/report-renderer.test.ts \
  tests/score-agent.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run full test suite**

Run: `npm test`

Expected: PASS.

- [ ] **Step 3: Run build**

Run: `npm run build`

Expected: PASS.

- [ ] **Step 4: Scan for forbidden v1 config and leakage terms**

Run: `rg -n "strict|HMOS_CODE_LINTER_ENABLED|HMOS_CODE_LINTER_NODE|not_enabled|findings.raw|@previewer/recommended|@cross-device-app-dev/recommended|filteredFinding|droppedFinding|unchangedFinding" src tests docs/superpowers/plans/2026-05-08-official-code-linter-rule-evaluation-implementation.md`

Expected: no production code references to removed v1 config, no raw findings artifact, no filtered-finding details in official linter artifacts. The plan may mention non-goal rule sets only in negative assertions.

- [ ] **Step 5: Inspect temporary workspace write boundary**

Run: `rg -n "workspace.*summary|workspace.*findings|workspace.*stdout|workspace.*stderr|workspace.*exit-code|findings.raw|caseDir.*inputs|caseDir.*outputs|caseDir.*logs" src/rules/officialCodeLinter src/nodes/officialCodeLinterNode.ts tests/official-code-linter-node.test.ts`

Expected: no implementation path writes diagnostics or case input/output/log files into the linter workspace.

