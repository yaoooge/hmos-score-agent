import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { collectEvidence } from "../src/rules/evidenceCollector.js";
import { listRegisteredRules } from "../src/rules/engine/rulePackRegistry.js";
import { runRuleEngine } from "../src/rules/ruleEngine.js";
import type { CaseInput, CaseRuleDefinition } from "../src/types.js";

const referenceRoot = path.resolve(process.cwd(), "references/scoring");

// 这组测试验证“真实规则顺序 + 首批支持规则命中”两件事。
async function makeTempDir(t: test.TestContext): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rule-engine-"));
  t.after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });
  return dir;
}

async function createRuleFixture(
  t: test.TestContext,
  files: Record<string, string>,
): Promise<string> {
  const caseDir = await makeTempDir(t);
  await fs.mkdir(path.join(caseDir, "original"), { recursive: true });
  await fs.mkdir(path.join(caseDir, "workspace"), { recursive: true });
  await fs.mkdir(path.join(caseDir, "diff"), { recursive: true });
  await fs.writeFile(path.join(caseDir, "input.txt"), "修复 ArkTS 类型问题", "utf-8");
  await fs.writeFile(
    path.join(caseDir, "diff", "changes.patch"),
    "@@ -0,0 +1,2 @@\n+let x: any = 1;\n+var y = 2;\n",
    "utf-8",
  );

  for (const [relativePath, content] of Object.entries(files)) {
    const targetPath = path.join(caseDir, "workspace", relativePath);
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, content, "utf-8");
  }

  return caseDir;
}

function makeCaseInput(caseDir: string): CaseInput {
  return {
    caseId: path.basename(caseDir),
    promptText: "修复 ArkTS 类型问题",
    originalProjectPath: path.join(caseDir, "original"),
    generatedProjectPath: path.join(caseDir, "workspace"),
    patchPath: path.join(caseDir, "diff", "changes.patch"),
  };
}

test("runRuleEngine keeps source order and flags supported violations", async (t) => {
  const caseDir = await createRuleFixture(t, {
    "entry/src/main/ets/pages/Index.ets": "let x: any = 1;\nvar y = 2;\nclass A { #secret = 1; }\n",
  });

  const result = await runRuleEngine({
    referenceRoot,
    caseInput: makeCaseInput(caseDir),
    taskType: "full_generation",
  });

  assert.equal(result.staticRuleAuditResults[0]?.rule_id, "ARKTS-MUST-001");
  assert.ok(
    result.deterministicRuleResults.some(
      (item) => item.rule_id === "ARKTS-MUST-005" && item.result === "不满足",
    ),
  );
  assert.ok(
    result.deterministicRuleResults.some(
      (item) => item.rule_id === "ARKTS-MUST-006" && item.result === "不满足",
    ),
  );
  assert.ok(
    result.deterministicRuleResults.some(
      (item) => item.rule_id === "ARKTS-MUST-003" && item.result === "不满足",
    ),
  );
  assert.ok(result.ruleViolations.length >= 1);
});

test("runRuleEngine exposes only current rule-audit fields", async (t) => {
  const caseDir = await createRuleFixture(t, {
    "entry/src/main/ets/pages/Index.ets": "let count: number = 1;\n",
  });

  const result = await runRuleEngine({
    referenceRoot,
    caseInput: makeCaseInput(caseDir),
    taskType: "full_generation",
  });

  assert.equal("ruleAuditResults" in result, false);
  assert.equal(
    result.staticRuleAuditResults.some((item) => item.result === "不涉及"),
    true,
  );
});

test("runRuleEngine routes all runtime case rules to agent candidates and keeps static results non-final", async (t) => {
  const caseDir = await createRuleFixture(t, {
    "entry/src/main/ets/pages/Index.ets":
      "import { LoginWithHuaweiIDButton } from '@kit.AccountKit';\nLoginWithHuaweiIDButton()\n",
    "entry/src/main/module.json5": '{ "module": { "name": "entry" } }\n',
  });

  const runtimeRules: CaseRuleDefinition[] = [
    {
      pack_id: "case-requirement_004",
      rule_id: "HM-REQ-008-01",
      rule_name: "必须使用 LoginWithHuaweiIDButton",
      rule_source: "must_rule",
      summary: "登录页必须使用 LoginWithHuaweiIDButton",
      priority: "P0",
      detector_kind: "case_constraint",
      detector_config: {
        targetPatterns: ["**/pages/*.ets"],
        astSignals: [
          { type: "import", module: "@kit.AccountKit" },
          { type: "call", name: "LoginWithHuaweiIDButton" },
        ],
        llmPrompt: "检查是否从 @kit.AccountKit 导入并使用 LoginWithHuaweiIDButton",
      },
      fallback_policy: "agent_assisted",
      is_case_rule: true,
    },
    {
      pack_id: "case-requirement_004",
      rule_id: "HM-REQ-008-06",
      rule_name: "module.json5 需配置 Client ID",
      rule_source: "should_rule",
      summary: "module.json5 需配置 Client ID",
      priority: "P1",
      detector_kind: "case_constraint",
      detector_config: {
        targetPatterns: ["**/module.json5"],
        astSignals: [{ type: "json_key", name: "metadata" }],
        llmPrompt: "检查 module.json5 是否配置 metadata",
      },
      fallback_policy: "agent_assisted",
      is_case_rule: true,
    },
  ];

  const result = await runRuleEngine({
    referenceRoot,
    caseInput: makeCaseInput(caseDir),
    taskType: "full_generation",
    runtimeRules,
  });

  assert.equal(
    result.caseRuleResults.length,
    0,
  );
  assert.equal(
    result.deterministicRuleResults.some((item) => item.rule_id === "HM-REQ-008-01"),
    false,
  );
  assert.equal(
    result.assistedRuleCandidates.some((item) => item.rule_id === "HM-REQ-008-01"),
    true,
  );
  assert.equal(
    result.assistedRuleCandidates.some((item) => item.rule_id === "HM-REQ-008-06"),
    true,
  );
  assert.equal(
    result.staticRuleAuditResults.some(
      (item) => item.rule_id === "HM-REQ-008-01" && item.result === "未接入判定器",
    ),
    true,
  );
});

test("runRuleEngine keeps missing case targets in agent candidates instead of static violations", async (t) => {
  const caseDir = await createRuleFixture(t, {
    "entry/src/main/ets/Index.ets": "Text('plain')\n",
  });

  const result = await runRuleEngine({
    referenceRoot,
    caseInput: makeCaseInput(caseDir),
    taskType: "full_generation",
    runtimeRules: [
      {
        pack_id: "case-requirement_004",
        rule_id: "HM-REQ-008-01",
        rule_name: "必须使用 LoginWithHuaweiIDButton",
        rule_source: "must_rule",
        summary: "登录页必须使用 LoginWithHuaweiIDButton",
        priority: "P0",
        detector_kind: "case_constraint",
        detector_config: {
          targetPatterns: ["**/pages/*.ets"],
          astSignals: [{ type: "call", name: "LoginWithHuaweiIDButton" }],
          llmPrompt: "检查登录页按钮",
        },
        fallback_policy: "agent_assisted",
        is_case_rule: true,
      },
    ],
  });

  assert.equal(
    result.deterministicRuleResults.some((item) => item.rule_id === "HM-REQ-008-01"),
    false,
  );
  assert.equal(
    result.assistedRuleCandidates.some((item) => item.rule_id === "HM-REQ-008-01"),
    true,
  );
  assert.equal(
    result.ruleViolations.some((item) => item.rule_id === "HM-REQ-008-01"),
    false,
  );
});

test("collectEvidence ignores workspace and original files matched by root gitignore", async (t) => {
  const caseDir = await createRuleFixture(t, {
    "entry/src/main/ets/pages/Index.ets": "let count: number = 1;\n",
    "build/cache/compiled.js": "var y = 2;\n",
  });

  await fs.writeFile(path.join(caseDir, "workspace", ".gitignore"), "build/\n*.tmp\n", "utf-8");
  await fs.writeFile(path.join(caseDir, "original", ".gitignore"), "cache/\n", "utf-8");
  await fs.mkdir(path.join(caseDir, "original", "cache"), { recursive: true });
  await fs.writeFile(
    path.join(caseDir, "original", "cache", "archived.txt"),
    "archived\n",
    "utf-8",
  );
  await fs.writeFile(path.join(caseDir, "workspace", "trace.tmp"), "noise\n", "utf-8");

  const evidence = await collectEvidence(makeCaseInput(caseDir));

  assert.deepEqual(
    evidence.workspaceFiles.map((item) => item.relativePath),
    ["entry/src/main/ets/pages/Index.ets"],
  );
  assert.deepEqual(evidence.originalFiles, []);
  assert.equal(evidence.summary.workspaceFileCount, 1);
  assert.equal(evidence.summary.originalFileCount, 0);
});

test("collectEvidence ignores ohosTest and test directories during rule evaluation", async (t) => {
  const caseDir = await createRuleFixture(t, {
    "entry/src/main/ets/pages/Index.ets": "let count: number = 1;\n",
    "entry/src/test/LocalUnit.test.ets": "let x: any = 1;\n",
    "entry/src/ohosTest/ets/test/Ability.test.ets": "var y = 2;\n",
  });

  await fs.mkdir(path.join(caseDir, "original", "entry", "src", "test"), { recursive: true });
  await fs.mkdir(path.join(caseDir, "original", "entry", "src", "ohosTest", "ets"), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(caseDir, "original", "entry", "src", "test", "Sample.test.ets"),
    "archived\n",
    "utf-8",
  );
  await fs.writeFile(
    path.join(caseDir, "original", "entry", "src", "ohosTest", "ets", "Ability.test.ets"),
    "archived\n",
    "utf-8",
  );

  const evidence = await collectEvidence(makeCaseInput(caseDir));

  assert.deepEqual(
    evidence.workspaceFiles.map((item) => item.relativePath),
    ["entry/src/main/ets/pages/Index.ets"],
  );
  assert.deepEqual(evidence.originalFiles, []);
  assert.equal(evidence.summary.workspaceFileCount, 1);
  assert.equal(evidence.summary.originalFileCount, 0);
});

test("collectEvidence ignores module-level ohosTest and test directories during rule evaluation", async (t) => {
  const caseDir = await createRuleFixture(t, {
    "entry/src/main/ets/pages/Index.ets": "let count: number = 1;\n",
    "commons/commonLib/src/test/LocalUnit.test.ets": "let x: any = 1;\n",
    "commons/commonLib/src/ohosTest/ets/test/Ability.test.ets": "var y = 2;\n",
    "features/home/src/test/LocalUnit.test.ets": "let z: any = 1;\n",
    "features/home/src/ohosTest/ets/test/Ability.test.ets": "var w = 2;\n",
  });

  const evidence = await collectEvidence(makeCaseInput(caseDir));

  assert.deepEqual(
    evidence.workspaceFiles.map((item) => item.relativePath),
    ["entry/src/main/ets/pages/Index.ets"],
  );
  assert.equal(evidence.summary.workspaceFileCount, 1);
});

test("collectEvidence ignores files named BuildProfile.ets during scoring", async (t) => {
  const caseDir = await createRuleFixture(t, {
    "entry/src/main/ets/pages/Index.ets": "let count: number = 1;\n",
    "entry/src/main/ets/BuildProfile.ets": "let x: any = 1;\nvar y = 2;\n",
    "features/home/BuildProfile.ets": "let z: any = 1;\n",
  });

  await fs.mkdir(path.join(caseDir, "original", "entry", "src", "main", "ets"), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(caseDir, "original", "entry", "src", "main", "ets", "BuildProfile.ets"),
    "let archived: any = 1;\n",
    "utf-8",
  );
  await fs.writeFile(
    path.join(caseDir, "diff", "changes.patch"),
    [
      "diff --git a/entry/src/main/ets/BuildProfile.ets b/entry/src/main/ets/BuildProfile.ets",
      "@@ -1 +1 @@",
      "-let archived: number = 1;",
      "+let archived: any = 1;",
      "diff --git a/entry/src/main/ets/pages/Index.ets b/entry/src/main/ets/pages/Index.ets",
      "@@ -1 +1 @@",
      "-let count: number = 0;",
      "+let count: number = 1;",
    ].join("\n"),
    "utf-8",
  );

  const evidence = await collectEvidence(makeCaseInput(caseDir), { taskType: "continuation" });

  assert.deepEqual(
    evidence.workspaceFiles.map((item) => item.relativePath),
    ["entry/src/main/ets/pages/Index.ets"],
  );
  assert.deepEqual(evidence.originalFiles, []);
  assert.deepEqual(evidence.changedFiles, ["entry/src/main/ets/pages/Index.ets"]);
  assert.doesNotMatch(evidence.patchText ?? "", /BuildProfile\.ets/);
});

test("runRuleEngine limits incremental rule evaluation to changed files when patch is available", async (t) => {
  const caseDir = await createRuleFixture(t, {
    "entry/src/main/ets/pages/ChangedPage.ets": "let count: number = 1;\n",
    "entry/src/main/ets/pages/LegacyPage.ets": "let risk: any = 1;\nvar count = 2;\n",
  });

  await fs.writeFile(
    path.join(caseDir, "diff", "changes.patch"),
    [
      "diff --git a/entry/src/main/ets/pages/ChangedPage.ets b/entry/src/main/ets/pages/ChangedPage.ets",
      "@@ -1 +1 @@",
      "-let count: number = 0;",
      "+let count: number = 1;",
    ].join("\n"),
    "utf-8",
  );

  const result = await runRuleEngine({
    referenceRoot,
    caseInput: makeCaseInput(caseDir),
    taskType: "continuation",
  });

  assert.equal(result.evidenceSummary.hasPatch, true);
  assert.deepEqual(result.evidenceSummary.changedFiles, ["entry/src/main/ets/pages/ChangedPage.ets"]);
  assert.equal(
    result.deterministicRuleResults.some(
      (item) =>
        ["ARKTS-MUST-005", "ARKTS-MUST-006", "ARKTS-FORBID-001"].includes(item.rule_id) &&
        item.result === "不满足",
    ),
    false,
  );
});

test("runRuleEngine does not report violations from files ignored by workspace gitignore", async (t) => {
  const caseDir = await createRuleFixture(t, {
    "entry/src/main/ets/pages/Index.ets": "let count: number = 1;\n",
    "build/generated.js": "var y = 2;\nlet x: any = 1;\n",
  });

  await fs.writeFile(path.join(caseDir, "workspace", ".gitignore"), "build/\n", "utf-8");

  const result = await runRuleEngine({
    referenceRoot,
    caseInput: makeCaseInput(caseDir),
    taskType: "full_generation",
  });

  assert.equal(
    result.deterministicRuleResults.some(
      (item) => item.rule_id === "ARKTS-MUST-005" && item.result === "不满足",
    ),
    false,
  );
  assert.equal(
    result.deterministicRuleResults.some(
      (item) => item.rule_id === "ARKTS-MUST-006" && item.result === "不满足",
    ),
    false,
  );
});

test("runRuleEngine does not report violations from ohosTest and test directories", async (t) => {
  const caseDir = await createRuleFixture(t, {
    "entry/src/main/ets/pages/Index.ets": "let count: number = 1;\n",
    "entry/src/test/LocalUnit.test.ets": "let x: any = 1;\n",
    "entry/src/ohosTest/ets/test/Ability.test.ets": "var y = 2;\n",
  });

  const result = await runRuleEngine({
    referenceRoot,
    caseInput: makeCaseInput(caseDir),
    taskType: "full_generation",
  });

  assert.equal(
    result.deterministicRuleResults.some(
      (item) => item.rule_id === "ARKTS-MUST-005" && item.result === "不满足",
    ),
    false,
  );
  assert.equal(
    result.deterministicRuleResults.some(
      (item) => item.rule_id === "ARKTS-MUST-006" && item.result === "不满足",
    ),
    false,
  );
  assert.equal(
    result.deterministicRuleResults.some(
      (item) => item.rule_id === "ARKTS-FORBID-001" && item.result === "不满足",
    ),
    false,
  );
});

test("runRuleEngine still evaluates business code under directories named test", async (t) => {
  const caseDir = await createRuleFixture(t, {
    "entry/src/main/ets/pages/test/Index.ets": "var y = 2;\nlet x: any = 1;\n",
    "entry/src/test/LocalUnit.test.ets": "let ignored: any = 1;\n",
  });

  const result = await runRuleEngine({
    referenceRoot,
    caseInput: makeCaseInput(caseDir),
    taskType: "full_generation",
  });

  assert.equal(
    result.deterministicRuleResults.some(
      (item) => item.rule_id === "ARKTS-MUST-005" && item.result === "不满足",
    ),
    true,
  );
  assert.equal(
    result.deterministicRuleResults.some(
      (item) => item.rule_id === "ARKTS-MUST-006" && item.result === "不满足",
    ),
    true,
  );
});

test("runRuleEngine only evaluates code-like files for text syntax rules", async (t) => {
  const caseDir = await createRuleFixture(t, {
    "entry/src/main/ets/pages/Index.ets": "let count: number = 1;\n",
    "entry/src/main/resources/base/element/color.json": '{ "value": "#FFFFFF" }\n',
    "entry/src/main/resources/base/media/background.png": "#private-binary-noise\n",
  });

  const result = await runRuleEngine({
    referenceRoot,
    caseInput: makeCaseInput(caseDir),
    taskType: "full_generation",
  });

  assert.equal(
    result.deterministicRuleResults.some(
      (item) => item.rule_id === "ARKTS-MUST-003" && item.result === "不满足",
    ),
    false,
  );
});

test("runRuleEngine only applies arkts syntax rules to ets files", async (t) => {
  const caseDir = await createRuleFixture(t, {
    "entry/src/main/ets/pages/Index.ets": "let count: number = 1;\n",
    "entry/src/main/js/generated.js": "var y = 2;\nlet x: any = 1;\nclass A { #secret = 1; }\n",
  });

  const result = await runRuleEngine({
    referenceRoot,
    caseInput: makeCaseInput(caseDir),
    taskType: "full_generation",
  });

  assert.equal(
    result.deterministicRuleResults.some(
      (item) => item.rule_id === "ARKTS-MUST-003" && item.result === "不满足",
    ),
    false,
  );
  assert.equal(
    result.deterministicRuleResults.some(
      (item) => item.rule_id === "ARKTS-MUST-005" && item.result === "不满足",
    ),
    false,
  );
  assert.equal(
    result.deterministicRuleResults.some(
      (item) => item.rule_id === "ARKTS-MUST-006" && item.result === "不满足",
    ),
    false,
  );
});

test("runRuleEngine evaluates arkts-performance rules and marks unsupported no-evidence rules as not applicable", async (t) => {
  const caseDir = await createRuleFixture(t, {
    "entry/src/main/ets/pages/Index.ets": `
function add(left?: number, right?: number): number {
  return (left ?? 0) + (right ?? 0);
}

let arrUnion: (number | string)[] = [1, 'hello'];
let arrNum: number[] = [1, 1.1, 2];
let sparse: number[] = [];
sparse[9999] = 0;

function sum(num: number): number {
  for (let t = 1; t < 100; t++) {
    throw new Error('Invalid numbers.');
  }
  return num;
}

let intNum = 1;
intNum = 1.1;
`,
  });

  const result = await runRuleEngine({
    referenceRoot,
    caseInput: makeCaseInput(caseDir),
    taskType: "full_generation",
  });

  for (const ruleId of [
    "ARKTS-PERF-FORBID-001",
    "ARKTS-PERF-FORBID-002",
    "ARKTS-PERF-FORBID-003",
    "ARKTS-PERF-FORBID-004",
    "ARKTS-PERF-FORBID-005",
    "ARKTS-PERF-SHOULD-002",
  ]) {
    assert.equal(
      result.deterministicRuleResults.some(
        (item) => item.rule_id === ruleId && item.result === "不满足",
      ),
      true,
      ruleId,
    );
  }

  for (const ruleId of [
    "ARKTS-PERF-SHOULD-001",
    "ARKTS-PERF-SHOULD-003",
    "ARKTS-PERF-SHOULD-004",
    "ARKTS-PERF-SHOULD-005",
    "ARKTS-PERF-SHOULD-006",
  ]) {
    assert.equal(
      result.staticRuleAuditResults.some(
        (item) => item.rule_id === ruleId && item.result === "不涉及",
      ),
      true,
      ruleId,
    );
  }
});

test("runRuleEngine does not treat hex color literals in ets files as private field syntax", async (t) => {
  const caseDir = await createRuleFixture(t, {
    "entry/src/main/ets/pages/Index.ets": "Text('hello').fontColor('#FF6B35')\n",
  });

  const result = await runRuleEngine({
    referenceRoot,
    caseInput: makeCaseInput(caseDir),
    taskType: "full_generation",
  });

  assert.equal(
    result.deterministicRuleResults.some(
      (item) => item.rule_id === "ARKTS-MUST-003" && item.result === "不满足",
    ),
    false,
  );
});

test("runRuleEngine ignores block comments when evaluating operator line-break style", async (t) => {
  const caseDir = await createRuleFixture(t, {
    "entry/src/main/ets/pages/Index.ets": [
      "/**",
      " * 说明注释",
      " * 使用组件",
      " */",
      "@Entry",
      "@Component",
      "struct Index {",
      "  build() {",
      "    Column() {}",
      "  }",
      "}",
    ].join("\n"),
  });

  const result = await runRuleEngine({
    referenceRoot,
    caseInput: makeCaseInput(caseDir),
    taskType: "full_generation",
  });

  assert.equal(
    result.deterministicRuleResults.some(
      (item) => item.rule_id === "ARKTS-SHOULD-013" && item.result === "不满足",
    ),
    false,
  );
});

test("runRuleEngine ignores block comment numbering when evaluating float literal style", async (t) => {
  const caseDir = await createRuleFixture(t, {
    "entry/src/main/ets/pages/Index.ets": [
      "/**",
      " * 1. 第一条说明",
      " * 2. 第二条说明",
      " */",
      "@Entry",
      "@Component",
      "struct Index {",
      "  build() {",
      "    Column() {}",
      "  }",
      "}",
    ].join("\n"),
  });

  const result = await runRuleEngine({
    referenceRoot,
    caseInput: makeCaseInput(caseDir),
    taskType: "full_generation",
  });

  assert.equal(
    result.deterministicRuleResults.some(
      (item) => item.rule_id === "ARKTS-SHOULD-020" && item.result === "不满足",
    ),
    false,
  );
});

test("runRuleEngine does not treat object property values as this-type usage", async (t) => {
  const caseDir = await createRuleFixture(t, {
    "entry/src/main/ets/pages/Index.ets": [
      "@Entry",
      "@Component",
      "struct Index {",
      "  private scroller: Scroller = new Scroller();",
      "  build() {",
      "    Child({ selectedValue: this.scroller })",
      "  }",
      "}",
    ].join("\n"),
  });

  const result = await runRuleEngine({
    referenceRoot,
    caseInput: makeCaseInput(caseDir),
    taskType: "full_generation",
  });

  assert.equal(
    result.deterministicRuleResults.some(
      (item) => item.rule_id === "ARKTS-MUST-011" && item.result === "不满足",
    ),
    false,
  );
  assert.equal(
    result.deterministicRuleResults.some(
      (item) => item.rule_id === "ARKTS-FORBID-004" && item.result === "不满足",
    ),
    false,
  );
});

test("runRuleEngine avoids known false positives from valid ArkTS syntax", async (t) => {
  const caseDir = await createRuleFixture(t, {
    "entry/src/main/ets/pages/Index.ets": [
      "function helper(): number {",
      "  return 1;",
      "}",
      "function secondHelper(): number {",
      "  return helper();",
      "}",
      "class ViewModel {",
      "  tabList: string[] = [];",
      "}",
      "struct Index {",
      "  private vm: ViewModel = new ViewModel();",
      "  private listeners: string[] = [];",
      "  build() {",
      "    const authRequest = new AuthRequest();",
      "    authRequest.scopes = ['phone'];",
      "    authRequest.permissions = ['serviceauthcode'];",
      "    const resourceName = imageUrl.split('//')[1];",
      "    if (paramsArr.length && paramsArr[0]) {",
      "      console.info(paramsArr[0]);",
      "    }",
      "    if (this.listeners.indexOf(listener) < 0) {",
      "      console.info(listener);",
      "    }",
      "    for (let i = 0; i < paramsArr.length; i++) {",
      "      console.info(paramsArr[i]);",
      "    }",
      "    let pref = dataPreferences.getPreferencesSync(context, { name: CardManager.KEY_CARD_ID });",
      "    let windowModel: WindowModel = AppStorageV2.connect(WindowModel, () => new WindowModel())!;",
      "    Tabs()",
      "      .tabBar(this.tabBarBuilder(this.vm.tabList[0], 0))",
      "      .indicator({",
      "        color: $r('app.color.tab_indicator_color'),",
      "        height: 2,",
      "        width: 20,",
      "        marginTop: 8,",
      "        borderRadius: 2",
      "      })",
      "    const dialogConfig: DialogConfig = {",
      "      onConfirm: (value?: string) => {",
      "        console.info(value);",
      "      }",
      "    };",
      "    this.render(dialogConfig);",
      "  }",
      "  subscribe(eventType: string, callback: (event?: string) => void) {",
      "    callback(eventType);",
      "  }",
      "}",
    ].join("\n"),
  });

  const result = await runRuleEngine({
    referenceRoot,
    caseInput: makeCaseInput(caseDir),
    taskType: "full_generation",
  });

  for (const ruleId of [
    "ARKTS-MUST-001",
    "ARKTS-MUST-022",
    "ARKTS-MUST-028",
    "ARKTS-SHOULD-011",
    "ARKTS-SHOULD-016",
    "ARKTS-FORBID-001",
    "ARKTS-FORBID-005",
    "ARKTS-FORBID-011",
    "ARKTS-PERF-FORBID-001",
  ]) {
    assert.equal(
      result.deterministicRuleResults.some(
        (item) => item.rule_id === ruleId && item.result === "不满足",
      ),
      false,
      ruleId,
    );
  }
});

test("runRuleEngine builds fallback evidence snippets when patch paths include workspace prefix", async (t) => {
  const caseDir = await createRuleFixture(t, {
    ".gitignore": ".hvigor/\n",
    "entry/src/main/ets/common/models/Restaurant.ts":
      "export interface Restaurant { id: string; }\n",
    "entry/src/main/ets/pages/Index.ets": "@Entry\n@Component\nstruct Index {}\n",
  });

  await fs.writeFile(
    path.join(caseDir, "diff", "changes.patch"),
    [
      "diff --git a/workspace/entry/src/main/ets/pages/Index.ets b/workspace/entry/src/main/ets/pages/Index.ets",
      "+++ b/workspace/entry/src/main/ets/pages/Index.ets",
      "@@ -1 +1 @@",
      "-@Entry",
      "+@Entry",
    ].join("\n"),
    "utf-8",
  );

  const result = await runRuleEngine({
    referenceRoot,
    caseInput: makeCaseInput(caseDir),
    taskType: "bug_fix",
  });

  assert.deepEqual(result.ruleEvidenceIndex.__fallback__?.evidenceFiles, [
    "entry/src/main/ets/pages/Index.ets",
  ]);
  assert.equal((result.ruleEvidenceIndex.__fallback__?.evidenceSnippets.length ?? 0) > 0, true);
});

test("runRuleEngine marks unsupported rules without direct evidence as 不涉及", async (t) => {
  const caseDir = await createRuleFixture(t, {
    "entry/src/main/ets/pages/Index.ets": "let count: number = 1;\n",
  });

  const result = await runRuleEngine({
    referenceRoot,
    caseInput: makeCaseInput(caseDir),
    taskType: "full_generation",
  });

  assert.equal(
    result.staticRuleAuditResults.some(
      (item) => item.rule_id === "ARKTS-MUST-004" && item.result === "不涉及",
    ),
    true,
  );
  assert.equal(
    result.staticRuleAuditResults.some(
      (item) =>
        item.rule_id === "ARKTS-MUST-004" &&
        item.conclusion.includes("未发现相关实现证据，当前不涉及。"),
    ),
    true,
  );
});

test("runRuleEngine keeps unsupported no-evidence rules out of agent candidates", async (t) => {
  const caseDir = await createRuleFixture(t, {
    "entry/src/main/ets/pages/Index.ets": "let x: any = 1;\nvar y = 2;\n",
  });

  const result = await runRuleEngine({
    referenceRoot,
    caseInput: makeCaseInput(caseDir),
    taskType: "full_generation",
  });

  assert.equal(
    result.deterministicRuleResults.some((item) => item.rule_id === "ARKTS-MUST-005"),
    true,
  );
  assert.equal(
    result.assistedRuleCandidates.some((item) => item.rule_id === "ARKTS-MUST-004"),
    false,
  );
});

test("runRuleEngine allows Symbol.iterator but rejects Symbol()", async (t) => {
  const caseDir = await createRuleFixture(t, {
    "entry/src/main/ets/pages/Index.ets":
      "const allowed = Symbol.iterator;\nconst bad = Symbol('x');\n",
  });

  const result = await runRuleEngine({
    referenceRoot,
    caseInput: makeCaseInput(caseDir),
    taskType: "full_generation",
  });

  assert.equal(
    result.deterministicRuleResults.some(
      (item) => item.rule_id === "ARKTS-MUST-002" && item.result === "不满足",
    ),
    true,
  );
  assert.equal(
    result.deterministicRuleResults.some(
      (item) =>
        item.rule_id === "ARKTS-MUST-002" && item.conclusion.includes("仅允许使用 Symbol.iterator"),
    ),
    true,
  );
});

test("runRuleEngine classifies every registered rule from rule packs into deterministic or agent-assisted", async (t) => {
  const caseDir = await createRuleFixture(t, {
    "entry/src/main/ets/pages/Index.ets": "let count: number = 1;\n",
  });

  const result = await runRuleEngine({
    referenceRoot,
    caseInput: makeCaseInput(caseDir),
    taskType: "full_generation",
  });

  assert.equal(result.staticRuleAuditResults.length, listRegisteredRules().length);
  assert.equal(
    result.deterministicRuleResults.length + result.assistedRuleCandidates.length,
    listRegisteredRules().length,
  );
});

test("runRuleEngine flags unsupported module system patterns in ets files", async (t) => {
  const caseDir = await createRuleFixture(t, {
    "entry/src/main/ets/pages/Index.ets": "const fs = require('fs')\n// @ts-ignore\n",
  });

  const result = await runRuleEngine({
    referenceRoot,
    caseInput: makeCaseInput(caseDir),
    taskType: "bug_fix",
  });

  assert.equal(
    result.deterministicRuleResults.some(
      (item) => item.rule_id === "ARKTS-MUST-025" && item.result === "不满足",
    ),
    true,
  );
  assert.equal(
    result.deterministicRuleResults.some(
      (item) => item.rule_id === "ARKTS-MUST-026" && item.result === "不满足",
    ),
    true,
  );
});

test("runRuleEngine flags Array<T> style as should-rule violation", async (t) => {
  const caseDir = await createRuleFixture(t, {
    "entry/src/main/ets/pages/Index.ets": "let values: Array<string> = [];\n",
  });

  const result = await runRuleEngine({
    referenceRoot,
    caseInput: makeCaseInput(caseDir),
    taskType: "continuation",
  });

  assert.equal(
    result.deterministicRuleResults.some(
      (item) => item.rule_id === "ARKTS-SHOULD-021" && item.result === "不满足",
    ),
    true,
  );
});

test("runRuleEngine reports text-pattern violations with concrete line locations", async (t) => {
  const caseDir = await createRuleFixture(t, {
    "entry/src/main/ets/pages/Index.ets": [
      "let ok: string[] = [];",
      "let values: Array<string> = [];",
      "let more: Array<number> = [];",
    ].join("\n"),
  });

  const result = await runRuleEngine({
    referenceRoot,
    caseInput: makeCaseInput(caseDir),
    taskType: "continuation",
  });

  const ruleResult = result.deterministicRuleResults.find(
    (item) => item.rule_id === "ARKTS-SHOULD-021",
  );
  const violation = result.ruleViolations.find((item) => item.rule_id === "ARKTS-SHOULD-021");
  const evidence = result.ruleEvidenceIndex["ARKTS-SHOULD-021"];

  assert.equal(ruleResult?.result, "不满足");
  assert.match(
    ruleResult?.conclusion ?? "",
    /entry\/src\/main\/ets\/pages\/Index\.ets:2/,
  );
  assert.match(
    ruleResult?.conclusion ?? "",
    /entry\/src\/main\/ets\/pages\/Index\.ets:3/,
  );
  assert.deepEqual(violation?.affected_items, [
    "entry/src/main/ets/pages/Index.ets:2",
    "entry/src/main/ets/pages/Index.ets:3",
  ]);
  assert.deepEqual(evidence?.evidenceFiles, [
    "entry/src/main/ets/pages/Index.ets:2",
    "entry/src/main/ets/pages/Index.ets:3",
  ]);
  assert.deepEqual(evidence?.evidenceSnippets, [
    "entry/src/main/ets/pages/Index.ets:2: let values: Array<string> = [];",
    "entry/src/main/ets/pages/Index.ets:3: let more: Array<number> = [];",
  ]);
});

test("runRuleEngine flags unsupported type signatures and constructor parameter properties", async (t) => {
  const caseDir = await createRuleFixture(t, {
    "entry/src/main/ets/pages/Index.ets": [
      "interface Callable {",
      "  (value: number): string;",
      "  new (name: string): Callable;",
      "  [key: string]: string;",
      "}",
      "class Demo {",
      "  static {}",
      "  static {}",
      "  constructor(public name: string) {}",
      "}",
      "const value = <number>input;",
      "for (const key in payload) {}",
    ].join("\n"),
  });

  const result = await runRuleEngine({
    referenceRoot,
    caseInput: makeCaseInput(caseDir),
    taskType: "full_generation",
  });

  for (const ruleId of [
    "ARKTS-MUST-007",
    "ARKTS-MUST-008",
    "ARKTS-MUST-009",
    "ARKTS-MUST-010",
    "ARKTS-MUST-012",
    "ARKTS-MUST-018",
    "ARKTS-MUST-020",
  ]) {
    assert.equal(
      result.deterministicRuleResults.some(
        (item) => item.rule_id === ruleId && item.result === "不满足",
      ),
      true,
      ruleId,
    );
  }
});

test("runRuleEngine flags restricted runtime interfaces and NaN comparisons", async (t) => {
  const caseDir = await createRuleFixture(t, {
    "entry/src/main/ets/pages/Index.ets": [
      "eval('doSomething()');",
      "target.__proto__ = source;",
      "const raw = __defineGetter__;",
      "let first = 1, second = 2;",
      "if (value === NaN) {",
      "  console.info(value);",
      "}",
    ].join("\n"),
  });

  const result = await runRuleEngine({
    referenceRoot,
    caseInput: makeCaseInput(caseDir),
    taskType: "bug_fix",
  });

  for (const ruleId of ["ARKTS-MUST-027", "ARKTS-MUST-028", "ARKTS-MUST-029"]) {
    assert.equal(
      result.deterministicRuleResults.some(
        (item) => item.rule_id === ruleId && item.result === "不满足",
      ),
      true,
      ruleId,
    );
  }
});

test("runRuleEngine flags advanced type features and expression-style declarations", async (t) => {
  const caseDir = await createRuleFixture(t, {
    "entry/src/main/ets/pages/Index.ets": [
      "type Pair = Left & Right;",
      "type Result<T> = T extends string ? Success : Failure;",
      "type Capture<T> = T extends infer R ? R : never;",
      "type Self = this;",
      "type Name = User['name'];",
      "const render = function () { return 1; };",
      "const LocalClass = class {};",
    ].join("\n"),
  });

  const result = await runRuleEngine({
    referenceRoot,
    caseInput: makeCaseInput(caseDir),
    taskType: "full_generation",
  });

  for (const ruleId of ["ARKTS-MUST-011", "ARKTS-MUST-015"]) {
    assert.equal(
      result.deterministicRuleResults.some(
        (item) => item.rule_id === ruleId && item.result === "不满足",
      ),
      true,
      ruleId,
    );
  }
});

test("runRuleEngine flags object layout mutation and unsupported exception or function patterns", async (t) => {
  const caseDir = await createRuleFixture(t, {
    "entry/src/main/ets/pages/Index.ets": [
      "delete profile.name;",
      "Demo.prototype = factory();",
      "try {",
      "  throw 'boom';",
      "} catch (error: any) {",
      "  console.info(error);",
      "}",
      "function outer() {",
      "  function inner() { return 1; }",
      "  return inner();",
      "}",
      "function* iterate() {",
      "  yield 1;",
      "}",
      "function badThis() {",
      "  return this;",
      "}",
    ].join("\n"),
  });

  const result = await runRuleEngine({
    referenceRoot,
    caseInput: makeCaseInput(caseDir),
    taskType: "bug_fix",
  });

  for (const ruleId of ["ARKTS-MUST-017", "ARKTS-MUST-021", "ARKTS-MUST-022"]) {
    assert.equal(
      result.deterministicRuleResults.some(
        (item) => item.rule_id === ruleId && item.result === "不满足",
      ),
      true,
      ruleId,
    );
  }
});

test("runRuleEngine flags forbidden weak typing and dynamic syntax patterns", async (t) => {
  const caseDir = await createRuleFixture(t, {
    "entry/src/main/ets/pages/Index.ets": [
      "let value: any = source;",
      "delete profile.name;",
      "const displayName = profile['name'];",
      "type Pair = Left & Right;",
      "const render = function () { return 1; };",
      "for (const key in profile) {",
      "  console.info(key);",
      "}",
    ].join("\n"),
  });

  const result = await runRuleEngine({
    referenceRoot,
    caseInput: makeCaseInput(caseDir),
    taskType: "full_generation",
  });

  for (const ruleId of [
    "ARKTS-FORBID-001",
    "ARKTS-FORBID-002",
    "ARKTS-FORBID-003",
    "ARKTS-FORBID-004",
    "ARKTS-FORBID-005",
    "ARKTS-FORBID-006",
  ]) {
    assert.equal(
      result.deterministicRuleResults.some(
        (item) => item.rule_id === ruleId && item.result === "不满足",
      ),
      true,
      ruleId,
    );
  }
});

test("runRuleEngine flags dynamic property access and common style should-rules", async (t) => {
  const caseDir = await createRuleFixture(t, {
    "entry/src/main/ets/pages/Index.ets": [
      "globalThis.cache = store;",
      'if (ready) console.info("ready");',
      "if (other)",
      "{",
      "\tconsole.info(other);",
      "}",
      "if (failed) {",
      "  console.info(failed);",
      "}",
      "else {",
      "  console.info('retry');",
      "}",
      "const ratio = .5;",
      "const name = user['name'];",
      `const longLine = "${"a".repeat(130)}";`,
    ].join("\n"),
  });

  const result = await runRuleEngine({
    referenceRoot,
    caseInput: makeCaseInput(caseDir),
    taskType: "continuation",
  });

  for (const ruleId of [
    "ARKTS-MUST-001",
    "ARKTS-SHOULD-001",
    "ARKTS-SHOULD-009",
    "ARKTS-SHOULD-010",
    "ARKTS-SHOULD-011",
    "ARKTS-SHOULD-015",
    "ARKTS-SHOULD-017",
    "ARKTS-SHOULD-018",
    "ARKTS-SHOULD-020",
  ]) {
    assert.equal(
      result.deterministicRuleResults.some(
        (item) => item.rule_id === ruleId && item.result === "不满足",
      ),
      true,
      ruleId,
    );
  }
});

test("runRuleEngine flags forbidden risky control-flow and runtime interfaces", async (t) => {
  const caseDir = await createRuleFixture(t, {
    "entry/src/main/ets/pages/Index.ets": [
      "try {",
      "  throw 'boom';",
      "} catch (error: unknown) {",
      "  console.info(error);",
      "}",
      "const dynamicRequire = require('lib');",
      "eval('run()');",
      "if (flag = check()) {",
      "  console.info(flag);",
      "}",
      "try {",
      "  work();",
      "} finally {",
      "  return;",
      "}",
    ].join("\n"),
  });

  const result = await runRuleEngine({
    referenceRoot,
    caseInput: makeCaseInput(caseDir),
    taskType: "bug_fix",
  });

  for (const ruleId of [
    "ARKTS-FORBID-007",
    "ARKTS-FORBID-008",
    "ARKTS-FORBID-010",
    "ARKTS-FORBID-011",
    "ARKTS-FORBID-012",
  ]) {
    assert.equal(
      result.deterministicRuleResults.some(
        (item) => item.rule_id === ruleId && item.result === "不满足",
      ),
      true,
      ruleId,
    );
  }
});

test("runRuleEngine marks AST-related unsupported rules without direct evidence as 不涉及", async (t) => {
  const caseDir = await createRuleFixture(t, {
    "entry/src/main/ets/pages/Index.ets": [
      "class Demo {}",
      "interface Demo { value: number }",
      "let payload: { name: string } = { name: 'demo' };",
      "const rawConfig = { enabled: true, retries: 3 };",
      "const values = [];",
      "const mixed = [1, 'two'];",
      "enum Status {",
      "  Ready = 1,",
      "  Done = 'done',",
      "}",
      "enum Mode {",
      "  Active = getMode(),",
      "}",
      "namespace Utils {",
      "  let active = true;",
      "}",
      "namespace Utils {}",
      "const nsRef = Utils;",
    ].join("\n"),
  });

  const result = await runRuleEngine({
    referenceRoot,
    caseInput: makeCaseInput(caseDir),
    taskType: "full_generation",
  });

  for (const ruleId of [
    "ARKTS-MUST-004",
    "ARKTS-MUST-013",
    "ARKTS-MUST-014",
    "ARKTS-MUST-024",
    "ARKTS-FORBID-009",
  ]) {
    assert.equal(
      result.staticRuleAuditResults.some(
        (item) => item.rule_id === ruleId && item.result === "不涉及",
      ),
      true,
      ruleId,
    );
  }
  assert.equal(result.assistedRuleCandidates.length, 0);
});

test("runRuleEngine flags remaining text-based formatting should-rules", async (t) => {
  const caseDir = await createRuleFixture(t, {
    "entry/src/main/ets/pages/Index.ets": [
      "switch (mode) {",
      "case 'A':",
      "console.info('a');",
      "}",
      "const total = base",
      "  + delta;",
      "const many = { a: 1, b: 2, c: 3, d: 4, e: 5 };",
    ].join("\n"),
  });

  const result = await runRuleEngine({
    referenceRoot,
    caseInput: makeCaseInput(caseDir),
    taskType: "continuation",
  });

  for (const ruleId of ["ARKTS-SHOULD-012", "ARKTS-SHOULD-013", "ARKTS-SHOULD-016"]) {
    assert.equal(
      result.deterministicRuleResults.some(
        (item) => item.rule_id === ruleId && item.result === "不满足",
      ),
      true,
      ruleId,
    );
  }
});
