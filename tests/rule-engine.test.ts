import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { collectEvidence } from "../src/rules/evidenceCollector.js";
import { runRuleEngine } from "../src/rules/ruleEngine.js";
import type { CaseInput } from "../src/types.js";

const referenceRoot = path.resolve(process.cwd(), "references/scoring");

// 这组测试验证“真实规则顺序 + 首批支持规则命中”两件事。
async function makeTempDir(t: test.TestContext): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rule-engine-"));
  t.after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });
  return dir;
}

async function createRuleFixture(t: test.TestContext, files: Record<string, string>): Promise<string> {
  const caseDir = await makeTempDir(t);
  await fs.mkdir(path.join(caseDir, "original"), { recursive: true });
  await fs.mkdir(path.join(caseDir, "workspace"), { recursive: true });
  await fs.mkdir(path.join(caseDir, "diff"), { recursive: true });
  await fs.writeFile(path.join(caseDir, "input.txt"), "修复 ArkTS 类型问题", "utf-8");
  await fs.writeFile(path.join(caseDir, "diff", "changes.patch"), "@@ -0,0 +1,2 @@\n+let x: any = 1;\n+var y = 2;\n", "utf-8");

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

  assert.equal(result.ruleAuditResults[0]?.rule_id, "ARKTS-MUST-001");
  assert.ok(result.ruleAuditResults.some((item) => item.rule_id === "ARKTS-MUST-005" && item.result === "不满足"));
  assert.ok(result.ruleAuditResults.some((item) => item.rule_id === "ARKTS-MUST-006" && item.result === "不满足"));
  assert.ok(result.ruleAuditResults.some((item) => item.rule_id === "ARKTS-MUST-003" && item.result === "不满足"));
  assert.ok(result.ruleViolations.length >= 1);
});

test("collectEvidence ignores workspace and original files matched by root gitignore", async (t) => {
  const caseDir = await createRuleFixture(t, {
    "entry/src/main/ets/pages/Index.ets": "let count: number = 1;\n",
    "build/cache/compiled.js": "var y = 2;\n",
  });

  await fs.writeFile(path.join(caseDir, "workspace", ".gitignore"), "build/\n*.tmp\n", "utf-8");
  await fs.writeFile(path.join(caseDir, "original", ".gitignore"), "cache/\n", "utf-8");
  await fs.mkdir(path.join(caseDir, "original", "cache"), { recursive: true });
  await fs.writeFile(path.join(caseDir, "original", "cache", "legacy.txt"), "legacy\n", "utf-8");
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

  assert.equal(result.ruleAuditResults.some((item) => item.rule_id === "ARKTS-MUST-005" && item.result === "不满足"), false);
  assert.equal(result.ruleAuditResults.some((item) => item.rule_id === "ARKTS-MUST-006" && item.result === "不满足"), false);
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

  assert.equal(result.ruleAuditResults.some((item) => item.rule_id === "ARKTS-MUST-003" && item.result === "不满足"), false);
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

  assert.equal(result.ruleAuditResults.some((item) => item.rule_id === "ARKTS-MUST-003" && item.result === "不满足"), false);
  assert.equal(result.ruleAuditResults.some((item) => item.rule_id === "ARKTS-MUST-005" && item.result === "不满足"), false);
  assert.equal(result.ruleAuditResults.some((item) => item.rule_id === "ARKTS-MUST-006" && item.result === "不满足"), false);
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

  assert.equal(result.ruleAuditResults.some((item) => item.rule_id === "ARKTS-MUST-003" && item.result === "不满足"), false);
});

test("runRuleEngine builds fallback evidence snippets when patch paths include workspace prefix", async (t) => {
  const caseDir = await createRuleFixture(t, {
    ".gitignore": ".hvigor/\n",
    "entry/src/main/ets/common/models/Restaurant.ts": "export interface Restaurant { id: string; }\n",
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

  assert.deepEqual(result.ruleEvidenceIndex.__fallback__?.evidenceFiles, ["workspace/entry/src/main/ets/pages/Index.ets"]);
  assert.equal((result.ruleEvidenceIndex.__fallback__?.evidenceSnippets.length ?? 0) > 0, true);
});
