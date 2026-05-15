import assert from "node:assert/strict";
import test from "node:test";
import {
  selectNegativeTaskList,
  type NegativeTaskSelectionKey,
} from "../web/src/pages/resultAnalysisNegativeTaskSelection.js";
import type { NegativeResults } from "../web/src/api/dashboard.js";

function task(taskId: number, overrides: Partial<NegativeResults["failedTasks"][number]> = {}) {
  return {
    taskId,
    name: `任务 ${String(taskId)}`,
    status: "completed",
    statusCategory: "completed" as const,
    taskType: "ArkTS",
    score: 80,
    hardGateTriggered: false,
    createdAt: `2026-05-14T0${String(taskId)}:00:00.000Z`,
    updatedAt: `2026-05-14T0${String(taskId)}:10:00.000Z`,
    resultAvailable: true,
    ...overrides,
  };
}

function negativeResults(): NegativeResults {
  return {
    success: true,
    summary: {
      failedTaskCount: 1,
      lowScoreTaskCount: 2,
      hardGateTaskCount: 1,
      highRiskTaskCount: 0,
      violatedRuleCount: 0,
    },
    failedTasks: [task(1, { status: "failed", statusCategory: "failed", error: "workflow failed" })],
    lowScoreTasks: [task(2, { score: 55 }), task(3, { score: 62 })],
    hardGateTasks: [task(4, { hardGateTriggered: true })],
    riskLevelCounts: [],
    topRuleViolations: [],
  };
}

test("selectNegativeTaskList returns the failed task list for the failed card", () => {
  const selection = selectNegativeTaskList(negativeResults(), "failed");

  assert.equal(selection.title, "失败任务列表");
  assert.deepEqual(
    selection.rows.map((row) => row.taskId),
    [1],
  );
});

test("selectNegativeTaskList returns the low score task list for the low score card", () => {
  const selected: NegativeTaskSelectionKey = "lowScore";
  const selection = selectNegativeTaskList(negativeResults(), selected);

  assert.equal(selection.title, "低分任务列表");
  assert.deepEqual(
    selection.rows.map((row) => row.taskId),
    [2, 3],
  );
});
