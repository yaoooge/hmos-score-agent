import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTaskTypeOptions,
  normalizeDashboardTask,
  normalizeDashboardTaskType,
  summarizeTaskTypeCounts,
} from "../web/src/taskTypes.js";

test("dashboard task type helpers merge management console aliases", () => {
  assert.equal(normalizeDashboardTaskType("new_development"), "full_generation");
  assert.equal(normalizeDashboardTaskType("incremental"), "continuation");
  assert.equal(normalizeDashboardTaskType("bugfix"), "bug_fix");
  assert.equal(normalizeDashboardTaskType("full_generation"), "full_generation");
  assert.equal(normalizeDashboardTaskType("custom_type"), "custom_type");
});

test("dashboard task type helpers summarize options after alias merge", () => {
  const counts = summarizeTaskTypeCounts([
    { taskType: "full_generation", count: 2 },
    { taskType: "new_development", count: 3 },
    { taskType: "continuation", count: 5 },
    { taskType: "incremental", count: 7 },
    { taskType: "bug_fix", count: 11 },
    { taskType: "bugfix", count: 13 },
  ]);

  assert.deepEqual(counts, [
    { taskType: "bug_fix", count: 24 },
    { taskType: "continuation", count: 12 },
    { taskType: "full_generation", count: 5 },
  ]);
  assert.deepEqual(buildTaskTypeOptions(counts), [
    "bug_fix",
    "continuation",
    "full_generation",
  ]);
});

test("dashboard task type helpers normalize table rows", () => {
  const task = normalizeDashboardTask({
    taskId: 1,
    name: "task",
    status: "completed",
    statusCategory: "completed",
    taskType: "bugfix",
    score: 88,
    hardGateTriggered: false,
    createdAt: "2026-05-14T00:00:00.000Z",
    updatedAt: "2026-05-14T00:00:00.000Z",
    resultAvailable: true,
  });

  assert.equal(task.taskType, "bug_fix");
});
