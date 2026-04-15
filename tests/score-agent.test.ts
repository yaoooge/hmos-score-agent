import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import { ArtifactStore } from "../src/io/artifactStore.js";
import { loadCaseFromPath } from "../src/io/caseLoader.js";
import { inputClassificationNode } from "../src/nodes/inputClassificationNode.js";
import { ruleAuditNode } from "../src/nodes/ruleAuditNode.js";
import { runScoreWorkflow } from "../src/workflow/scoreWorkflow.js";
import type { CaseInput } from "../src/types.js";

const fixtureRoot = path.resolve(process.cwd(), "tests/fixtures");
const schemaPath = path.join(fixtureRoot, "report_result_schema.json");
const ruleFixturePath = path.join(fixtureRoot, "arkts_internal_rules.yaml");

async function makeTempDir(t: test.TestContext): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "hmos-score-agent-"));
  t.after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });
  return dir;
}

async function writeCaseFixture(
  rootDir: string,
  options: { promptText?: string; withPatch?: boolean } = {},
): Promise<string> {
  const caseDir = path.join(rootDir, "sample-case");
  await fs.mkdir(path.join(caseDir, "original"), { recursive: true });
  await fs.mkdir(path.join(caseDir, "workspace"), { recursive: true });
  await fs.writeFile(path.join(caseDir, "input.txt"), options.promptText ?? "新增餐厅列表页面", "utf-8");
  if (options.withPatch) {
    await fs.mkdir(path.join(caseDir, "diff"), { recursive: true });
    await fs.writeFile(path.join(caseDir, "diff", "changes.patch"), "@@ -1 +1 @@\n-fixme\n+fixed\n", "utf-8");
  }
  return caseDir;
}

async function createReferenceRoot(t: test.TestContext): Promise<string> {
  const referenceRoot = await makeTempDir(t);
  await fs.copyFile(schemaPath, path.join(referenceRoot, "report_result_schema.json"));
  await fs.copyFile(ruleFixturePath, path.join(referenceRoot, "arkts_internal_rules.yaml"));
  return referenceRoot;
}

function makeState(input: Partial<CaseInput> = {}): {
  caseInput: CaseInput;
} {
  return {
    caseInput: {
      caseId: "case-1",
      promptText: "新增餐厅列表页面",
      originalProjectPath: "/tmp/original",
      generatedProjectPath: "/tmp/workspace",
      ...input,
    },
  };
}

test("loadCaseFromPath loads prompt and optional patch path", async (t) => {
  const rootDir = await makeTempDir(t);
  const caseDir = await writeCaseFixture(rootDir, { withPatch: true, promptText: "修复餐厅页面 bug" });

  const caseInput = await loadCaseFromPath(caseDir);

  assert.equal(caseInput.caseId, "sample-case");
  assert.equal(caseInput.promptText, "修复餐厅页面 bug");
  assert.equal(caseInput.originalProjectPath, path.join(caseDir, "original"));
  assert.equal(caseInput.generatedProjectPath, path.join(caseDir, "workspace"));
  assert.equal(caseInput.patchPath, path.join(caseDir, "diff", "changes.patch"));
});

test("loadCaseFromPath leaves patch undefined when diff file is absent", async (t) => {
  const rootDir = await makeTempDir(t);
  const caseDir = await writeCaseFixture(rootDir);

  const caseInput = await loadCaseFromPath(caseDir);

  assert.equal(caseInput.patchPath, undefined);
});

test("ArtifactStore creates case directories and persists json/text artifacts", async (t) => {
  const rootDir = await makeTempDir(t);
  const store = new ArtifactStore(rootDir);

  const caseDir = await store.ensureCaseDir("case-1");
  await store.writeJson(caseDir, "outputs/result.json", { ok: true });
  await store.writeText(caseDir, "logs/run.log", "hello");

  await Promise.all(
    ["inputs", "intermediate", "outputs", "logs"].map(async (dirName) => {
      const stat = await fs.stat(path.join(caseDir, dirName));
      assert.equal(stat.isDirectory(), true);
    }),
  );

  const resultJson = JSON.parse(await fs.readFile(path.join(caseDir, "outputs", "result.json"), "utf-8"));
  const logText = await fs.readFile(path.join(caseDir, "logs", "run.log"), "utf-8");
  assert.deepEqual(resultJson, { ok: true });
  assert.equal(logText, "hello");
});

test("inputClassificationNode prioritizes bug_fix over patch-based continuation", async () => {
  const bugResult = await inputClassificationNode(
    makeState({
      promptText: "请修复餐厅列表页面 bug",
      patchPath: "/tmp/changes.patch",
    }) as never,
  );
  const continuationResult = await inputClassificationNode(
    makeState({
      promptText: "继续完善餐厅列表页面",
      patchPath: "/tmp/changes.patch",
    }) as never,
  );
  const fullGenerationResult = await inputClassificationNode(makeState() as never);

  assert.equal(bugResult.taskType, "bug_fix");
  assert.equal(continuationResult.taskType, "continuation");
  assert.equal(fullGenerationResult.taskType, "full_generation");
});

test("ruleAuditNode emits one ledger item per rule and preserves source ordering", async (t) => {
  const referenceRoot = await createReferenceRoot(t);

  const result = await ruleAuditNode(makeState() as never, { referenceRoot });

  assert.deepEqual(result.ruleViolations, []);
  assert.deepEqual(result.ruleAuditResults?.map((item) => item.rule_id), [
    "MUST-001",
    "MUST-002",
    "SHOULD-001",
    "FORBIDDEN-001",
  ]);
  assert.deepEqual(result.ruleAuditResults?.map((item) => item.rule_source), [
    "must_rule",
    "must_rule",
    "should_rule",
    "forbidden_pattern",
  ]);
  assert.equal(result.ruleAuditResults?.every((item) => item.result === "不涉及"), true);
});

test("runScoreWorkflow writes artifacts and produces schema-valid result json", async (t) => {
  const referenceRoot = await createReferenceRoot(t);
  const localCaseRoot = await makeTempDir(t);
  const artifactStore = new ArtifactStore(localCaseRoot);
  const caseDir = await artifactStore.ensureCaseDir("case-1");

  const result = await runScoreWorkflow({
    caseInput: {
      caseId: "case-1",
      promptText: "请修复餐厅列表页中的 bug",
      originalProjectPath: "/tmp/original",
      generatedProjectPath: "/tmp/workspace",
      patchPath: "/tmp/changes.patch",
    },
    caseDir,
    referenceRoot,
    artifactStore,
  });

  const resultJsonPath = path.join(caseDir, "outputs", "result.json");
  const reportHtmlPath = path.join(caseDir, "outputs", "report.html");
  const storedRuleAuditPath = path.join(caseDir, "intermediate", "rule-audit.json");
  const resultJson = JSON.parse(await fs.readFile(resultJsonPath, "utf-8"));
  const ruleAuditJson = JSON.parse(await fs.readFile(storedRuleAuditPath, "utf-8"));
  const reportHtml = await fs.readFile(reportHtmlPath, "utf-8");
  const schema = JSON.parse(await fs.readFile(schemaPath, "utf-8"));
  const ajv = new Ajv2020({ strict: false });
  const validate = ajv.compile(schema);

  assert.equal(validate(resultJson), true, ajv.errorsText(validate.errors));
  assert.equal(result.uploadMessage, "UPLOAD_ENDPOINT is empty; skipped upload.");
  assert.equal(resultJson.basic_info.task_type, "bug_fix");
  assert.equal(resultJson.overall_conclusion.total_score, 75);
  assert.equal(ruleAuditJson.length, 4);
  assert.match(reportHtml, /Case case-1/);
});

test.todo("taskUnderstandingNode should load configurable extractors instead of fixed keyword heuristics");
test.todo("scoringOrchestrationNode should compute weighted dimension scores and apply hard gates from rubric.yaml");
test.todo("reportGenerationNode should validate result.json against the schema before persisting it");
test.todo("persistAndUploadNode should write enough evidence for retryable upload failures and failed workflows");
