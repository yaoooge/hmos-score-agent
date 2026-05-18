import assert from "node:assert/strict";
import test from "node:test";
import { loadTaskDashboardData } from "../web/src/pages/taskDashboardDataLoader.js";

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

test("loadTaskDashboardData fetches summary and tasks in parallel when summary is requested", async () => {
  const events: string[] = [];
  const summary = createDeferred<{ success: true }>();
  const tasks = createDeferred<{ items: unknown[] }>();

  const resultPromise = loadTaskDashboardData({
    includeSummary: true,
    fetchSummary: () => {
      events.push("summary-started");
      return summary.promise;
    },
    fetchTasks: () => {
      events.push("tasks-started");
      return tasks.promise;
    },
  });

  assert.deepEqual(events, ["summary-started", "tasks-started"]);

  tasks.resolve({ items: [] });
  summary.resolve({ success: true });

  assert.deepEqual(await resultPromise, {
    summary: { success: true },
    tasks: { items: [] },
  });
});

test("loadTaskDashboardData skips summary for task-only reloads", async () => {
  const result = await loadTaskDashboardData({
    includeSummary: false,
    fetchSummary: async () => {
      throw new Error("summary should not be fetched");
    },
    fetchTasks: async () => ({ items: ["task"] }),
  });

  assert.equal(result.summary, undefined);
  assert.deepEqual(result.tasks, { items: ["task"] });
});
