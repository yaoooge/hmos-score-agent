import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ArtifactStore } from "../src/io/artifactStore.js";
import { taskUnderstandingNode } from "../src/nodes/taskUnderstandingNode.js";

async function makeTempDir(t: test.TestContext): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "hmos-task-understanding-"));
  t.after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });
  return dir;
}

function createTaskUnderstandingOpencodeMock() {
  return {
    async runPrompt(request: { requestTag: string }) {
      return {
        requestTag: request.requestTag,
        rawEvents: "",
        rawText: JSON.stringify({
          explicitConstraints: ["任务类型: full_generation"],
          contextualConstraints: ["保持工程结构"],
          implicitConstraints: ["基于 patch 评估"],
          classificationHints: ["full_generation", "has_patch"],
        }),
        elapsedMs: 1,
      };
    },
  };
}

const referenceRoot = path.resolve(process.cwd(), "references/scoring");

test("taskUnderstandingNode uses agent input from prompt, original structure and patch, then persists summary", async (t) => {
  const rootDir = await makeTempDir(t);
  const originalProjectPath = path.join(rootDir, "original");
  const generatedProjectPath = path.join(rootDir, "workspace");
  const patchPath = path.join(rootDir, "changes.patch");
  const artifactStore = new ArtifactStore(rootDir);
  const caseDir = await artifactStore.ensureCaseDir("case-agent");

  await fs.mkdir(path.join(originalProjectPath, "entry", "src", "main", "ets", "pages"), {
    recursive: true,
  });
  await fs.mkdir(
    path.join(originalProjectPath, "entry", "src", "main", "ets", "restaurant", "viewmodels"),
    {
      recursive: true,
    },
  );
  await fs.mkdir(generatedProjectPath, { recursive: true });
  await fs.mkdir(path.join(generatedProjectPath, "entry", "src", "main", "ets", "pages"), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(originalProjectPath, "entry", "src", "main", "module.json5"),
    "{module:{name:'entry'}}",
  );
  await fs.writeFile(
    path.join(originalProjectPath, "entry", "src", "main", "ets", "pages", "Index.ets"),
    "import { RestaurantListPage } from '../restaurant/pages/RestaurantListPage';\n",
  );
  await fs.writeFile(
    path.join(
      originalProjectPath,
      "entry",
      "src",
      "main",
      "ets",
      "restaurant",
      "viewmodels",
      "RestaurantListVM.ts",
    ),
    "export class RestaurantListVM {}\n",
  );
  await fs.writeFile(
    path.join(generatedProjectPath, "entry", "src", "main", "ets", "pages", "Index.ets"),
    "Text('workspace')\n",
  );
  await fs.writeFile(
    patchPath,
    [
      "diff --git a/entry/src/main/ets/pages/Index.ets b/entry/src/main/ets/pages/Index.ets",
      "@@ -1 +1,2 @@",
      "-Text('old')",
      "+Text('餐厅列表')",
      "+RestaurantListPage()",
      "diff --git a/entry/src/main/ets/restaurant/viewmodels/RestaurantListVM.ts b/entry/src/main/ets/restaurant/viewmodels/RestaurantListVM.ts",
      "@@ -0,0 +1 @@",
      "+export const ratingFilter = 4;",
    ].join("\n"),
    "utf-8",
  );

  const prompts: string[] = [];
  const opencode = {
    async runPrompt(request: { requestTag: string; prompt: string; sandboxRoot: string }) {
      prompts.push(request.prompt);
      return {
        requestTag: request.requestTag,
        rawEvents: "",
        rawText: JSON.stringify({
        explicitConstraints: [
          "任务类型: bug_fix",
          "行业: 餐饮",
          "场景: 餐厅列表页",
          "目标: 修复评分筛选异常",
        ],
        contextualConstraints: ["模块: entry", "实现约束: 保持 restaurant viewmodel 与 pages 分层"],
        implicitConstraints: [
          "修改范围: 2 个 ArkTS/TS 文件",
          "侵入程度: 中等",
          "改动类型: UI 接入与筛选逻辑",
        ],
        classificationHints: ["bug_fix", "has_patch"],
        }),
        elapsedMs: 1,
      };
    },
  };

  const result = await taskUnderstandingNode(
    {
      caseDir,
      caseInput: {
        caseId: "case-agent",
        promptText: "修复餐厅列表页评分筛选 bug",
        originalProjectPath,
        generatedProjectPath,
        patchPath,
      },
    } as never,
    { opencode, referenceRoot, artifactStore },
  );

  assert.equal(prompts.length, 1);
  assert.match(prompts[0] ?? "", /修复餐厅列表页评分筛选 bug/);
  assert.match(prompts[0] ?? "", /entry\/src\/main\/ets\/pages\/Index\.ets/);
  assert.match(prompts[0] ?? "", /entry\/src\/main\/ets\/restaurant\/viewmodels\/RestaurantListVM\.ts/);

  assert.deepEqual(result.constraintSummary?.explicitConstraints, [
    "任务类型: bug_fix",
    "行业: 餐饮",
    "场景: 餐厅列表页",
    "目标: 修复评分筛选异常",
  ]);
  assert.deepEqual(result.constraintSummary?.contextualConstraints, [
    "模块: entry",
    "实现约束: 保持 restaurant viewmodel 与 pages 分层",
  ]);
  assert.deepEqual(result.constraintSummary?.implicitConstraints, [
    "修改范围: 2 个 ArkTS/TS 文件",
    "侵入程度: 中等",
    "改动类型: UI 接入与筛选逻辑",
  ]);
  assert.equal(
    result.workspaceProjectStructure?.representativeFiles.includes(
      "entry/src/main/ets/pages/Index.ets",
    ),
    true,
  );
  assert.equal(typeof result.opencodeSandboxRoot, "string");

  const persisted = JSON.parse(
    await fs.readFile(path.join(caseDir, "intermediate", "constraint-summary.json"), "utf-8"),
  );
  assert.deepEqual(persisted, result.constraintSummary);
});

test("taskUnderstandingNode generates patch when case patch is absent and loads case rules", async (t) => {
  const rootDir = await makeTempDir(t);
  const originalProjectPath = path.join(rootDir, "original");
  const generatedProjectPath = path.join(rootDir, "workspace");
  const expectedConstraintsPath = path.join(rootDir, "expected_constraints.yaml");
  const artifactStore = new ArtifactStore(rootDir);
  const caseDir = await artifactStore.ensureCaseDir("case-agent");

  await fs.mkdir(path.join(originalProjectPath, "entry", "src", "main", "ets"), {
    recursive: true,
  });
  await fs.mkdir(path.join(generatedProjectPath, "entry", "src", "main", "ets"), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(originalProjectPath, "entry", "src", "main", "ets", "Index.ets"),
    "Text('old')\n",
    "utf-8",
  );
  await fs.writeFile(
    path.join(generatedProjectPath, "entry", "src", "main", "ets", "Index.ets"),
    "Text('new')\n",
    "utf-8",
  );
  await fs.writeFile(
    expectedConstraintsPath,
    [
      "constraints:",
      "  - id: HM-REQ-008-01",
      "    name: 登录按钮",
      "    description: 必须存在登录按钮",
      "    priority: P0",
      "    rules:",
      "      - target: '**/pages/*.ets'",
      "        ast:",
      "          - type: call",
      "            name: LoginWithHuaweiIDButton",
      "        llm: 检查登录按钮是否存在",
    ].join("\n"),
    "utf-8",
  );

  const result = await taskUnderstandingNode(
    {
      caseDir,
      caseInput: {
        caseId: "case-agent",
        promptText: "新增登录能力",
        originalProjectPath,
        generatedProjectPath,
        expectedConstraintsPath,
      },
    } as never,
    { artifactStore, referenceRoot, opencode: createTaskUnderstandingOpencodeMock() },
  );

  assert.equal(typeof result.effectivePatchPath, "string");
  assert.equal(result.caseRuleDefinitions?.length, 1);
  const patchText = await fs.readFile(result.effectivePatchPath as string, "utf-8");
  assert.match(patchText, /diff --git/);
  assert.equal(result.caseInput?.patchPath, result.effectivePatchPath);
  assert.equal(
    (result.effectivePatchPath as string).startsWith(path.join(caseDir, "intermediate")),
    true,
  );
  const persistedRules = JSON.parse(
    await fs.readFile(path.join(caseDir, "intermediate", "case-rule-definitions.json"), "utf-8"),
  );
  assert.equal(persistedRules.length, 1);
});

test("taskUnderstandingNode regenerates patch when provided patch file is empty", async (t) => {
  const rootDir = await makeTempDir(t);
  const originalProjectPath = path.join(rootDir, "original");
  const generatedProjectPath = path.join(rootDir, "workspace");
  const patchPath = path.join(rootDir, "diff", "changes.patch");
  const artifactStore = new ArtifactStore(rootDir);
  const caseDir = await artifactStore.ensureCaseDir("case-empty-patch");

  await fs.mkdir(path.join(originalProjectPath, "entry", "src", "main", "ets"), {
    recursive: true,
  });
  await fs.mkdir(path.join(generatedProjectPath, "entry", "src", "main", "ets"), {
    recursive: true,
  });
  await fs.mkdir(path.dirname(patchPath), { recursive: true });
  await fs.writeFile(
    path.join(originalProjectPath, "entry", "src", "main", "ets", "Index.ets"),
    "Text('old')\n",
    "utf-8",
  );
  await fs.writeFile(
    path.join(generatedProjectPath, "entry", "src", "main", "ets", "Index.ets"),
    "Text('new')\n",
    "utf-8",
  );
  await fs.writeFile(patchPath, "", "utf-8");

  const result = await taskUnderstandingNode(
    {
      caseDir,
      caseInput: {
        caseId: "case-empty-patch",
        promptText: "增量修改首页文案",
        originalProjectPath,
        generatedProjectPath,
        patchPath,
      },
    } as never,
    { artifactStore, referenceRoot, opencode: createTaskUnderstandingOpencodeMock() },
  );

  assert.equal(result.caseInput?.patchPath, path.join(caseDir, "intermediate", "effective.patch"));
  const effectivePatchText = await fs.readFile(result.caseInput?.patchPath as string, "utf-8");
  assert.match(effectivePatchText, /diff --git/);
  assert.match(effectivePatchText, /Index\.ets/);
});

test("taskUnderstandingNode creates a workspace-against-empty patch when original project is absent", async (t) => {
  const rootDir = await makeTempDir(t);
  const originalProjectPath = path.join(rootDir, "original");
  const generatedProjectPath = path.join(rootDir, "workspace");
  const artifactStore = new ArtifactStore(rootDir);
  const caseDir = await artifactStore.ensureCaseDir("case-without-original");

  await fs.mkdir(path.join(generatedProjectPath, "entry", "src", "main", "ets"), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(generatedProjectPath, "entry", "src", "main", "ets", "Index.ets"),
    "Text('new')\n",
    "utf-8",
  );

  const result = await taskUnderstandingNode(
    {
      caseDir,
      caseInput: {
        caseId: "case-without-original",
        promptText: "实现一个商城模板首页",
        originalProjectPath,
        generatedProjectPath,
        originalProjectProvided: false,
      },
    } as never,
    { artifactStore, referenceRoot, opencode: createTaskUnderstandingOpencodeMock() },
  );

  assert.equal(result.caseInput?.originalProjectProvided, false);
  assert.equal(typeof result.effectivePatchPath, "string");
  assert.equal(result.caseInput?.patchPath, result.effectivePatchPath);
  assert.deepEqual(result.caseRuleDefinitions, []);
  const patchText = await fs.readFile(result.effectivePatchPath as string, "utf-8");
  assert.match(patchText, /diff --git/);
  assert.match(patchText, /new file mode/);
  assert.match(patchText, /Index\.ets/);
  assert.match(result.constraintSummary?.explicitConstraints[0] ?? "", /full_generation/);
});
