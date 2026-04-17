import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ArtifactStore } from "../src/io/artifactStore.js";
import { taskUnderstandingNode } from "../src/nodes/taskUnderstandingNode.js";
import type { TaskUnderstandingAgentInput } from "../src/types.js";

async function makeTempDir(t: test.TestContext): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "hmos-task-understanding-"));
  t.after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });
  return dir;
}

test("taskUnderstandingNode uses agent input from prompt, original structure and patch, then persists summary", async (t) => {
  const rootDir = await makeTempDir(t);
  const originalProjectPath = path.join(rootDir, "original");
  const generatedProjectPath = path.join(rootDir, "workspace");
  const patchPath = path.join(rootDir, "changes.patch");
  const artifactStore = new ArtifactStore(rootDir);
  const caseDir = await artifactStore.ensureCaseDir("case-agent");

  await fs.mkdir(path.join(originalProjectPath, "entry", "src", "main", "ets", "pages"), { recursive: true });
  await fs.mkdir(path.join(originalProjectPath, "entry", "src", "main", "ets", "restaurant", "viewmodels"), {
    recursive: true,
  });
  await fs.mkdir(generatedProjectPath, { recursive: true });
  await fs.writeFile(path.join(originalProjectPath, "entry", "src", "main", "module.json5"), "{module:{name:'entry'}}");
  await fs.writeFile(
    path.join(originalProjectPath, "entry", "src", "main", "ets", "pages", "Index.ets"),
    "import { RestaurantListPage } from '../restaurant/pages/RestaurantListPage';\n",
  );
  await fs.writeFile(
    path.join(originalProjectPath, "entry", "src", "main", "ets", "restaurant", "viewmodels", "RestaurantListVM.ts"),
    "export class RestaurantListVM {}\n",
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

  const calls: TaskUnderstandingAgentInput[] = [];
  const agentClient = {
    async understandTask(input: TaskUnderstandingAgentInput): Promise<string> {
      calls.push(input);
      return JSON.stringify({
        explicitConstraints: ["任务类型: bug_fix", "行业: 餐饮", "场景: 餐厅列表页", "目标: 修复评分筛选异常"],
        contextualConstraints: ["模块: entry", "实现约束: 保持 restaurant viewmodel 与 pages 分层"],
        implicitConstraints: ["修改范围: 2 个 ArkTS/TS 文件", "侵入程度: 中等", "改动类型: UI 接入与筛选逻辑"],
        classificationHints: ["bug_fix", "has_patch"],
      });
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
    { agentClient, artifactStore },
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.promptText, "修复餐厅列表页评分筛选 bug");
  assert.equal(calls[0]?.projectStructure.modulePaths.includes("entry"), true);
  assert.equal(calls[0]?.projectStructure.representativeFiles.includes("entry/src/main/ets/pages/Index.ets"), true);
  assert.deepEqual(calls[0]?.patchSummary.changedFiles, [
    "entry/src/main/ets/pages/Index.ets",
    "entry/src/main/ets/restaurant/viewmodels/RestaurantListVM.ts",
  ]);

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

  const persisted = JSON.parse(
    await fs.readFile(path.join(caseDir, "intermediate", "constraint-summary.json"), "utf-8"),
  );
  assert.deepEqual(persisted, result.constraintSummary);
});
