import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const resultAnalysisVue = fs.readFileSync(
  path.join(process.cwd(), "web", "src", "pages", "ResultAnalysis.vue"),
  "utf-8",
);

function firstIndexAfter(text: string, pattern: string, start: number): number {
  const index = text.indexOf(pattern, start);
  assert.notEqual(index, -1, `expected to find ${pattern}`);
  return index;
}

test("result analysis third tab only presents violated rule list", () => {
  assert.match(resultAnalysisVue, /<el-tab-pane label="违反规则列表" name="negative">/);
  assert.doesNotMatch(resultAnalysisVue, /失败任务/);
  assert.doesNotMatch(resultAnalysisVue, /低分任务/);
  assert.doesNotMatch(resultAnalysisVue, /硬门槛/);
  assert.doesNotMatch(resultAnalysisVue, /高风险/);
});

test("manual analysis status defaults to pending and appears after selection column", () => {
  assert.match(resultAnalysisVue, /manualAnalysisStatus: "pending" as "" \| ManualAnalysisStatus/);

  for (const tableName of ["gap", "risk"]) {
    const selectionIndex = firstIndexAfter(
      resultAnalysisVue,
      '<el-table-column type="selection" width="48" />',
      tableName === "gap" ? 0 : resultAnalysisVue.indexOf('<el-tab-pane label="风险项分析"'),
    );
    const statusIndex = firstIndexAfter(
      resultAnalysisVue,
      '<el-table-column label="分析状态" width="110">',
      selectionIndex,
    );
    const taskIdIndex = firstIndexAfter(
      resultAnalysisVue,
      '<el-table-column prop="taskId"',
      selectionIndex,
    );

    assert.ok(statusIndex < taskIdIndex, `${tableName} status column should be first after selection`);
  }
});

test("risk analysis keyword input advertises risk title filtering", () => {
  const riskTabIndex = firstIndexAfter(
    resultAnalysisVue,
    '<el-tab-pane label="风险项分析"',
    0,
  );
  const placeholderIndex = firstIndexAfter(
    resultAnalysisVue,
    'placeholder="名称 / taskId / 风险标题"',
    riskTabIndex,
  );
  const tableIndex = firstIndexAfter(resultAnalysisVue, "<el-table", riskTabIndex);

  assert.ok(placeholderIndex < tableIndex, "risk title filter should be in the risk toolbar");
});
