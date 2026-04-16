import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
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
