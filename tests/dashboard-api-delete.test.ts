import assert from "node:assert/strict";
import test from "node:test";
import { deleteDashboardTask } from "../web/src/api/dashboard.ts";

test("deleteDashboardTask deletes one remote task by id", async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = "";
  let requestedMethod = "";

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requestedUrl = String(input);
    requestedMethod = String(init?.method ?? "GET");
    return new Response(JSON.stringify({ success: true, deletedTaskIds: [1234] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  try {
    const response = await deleteDashboardTask(1234);

    assert.equal(requestedUrl, "/score/remote-tasks?taskIds=1234");
    assert.equal(requestedMethod, "DELETE");
    assert.deepEqual(response, { success: true, deletedTaskIds: [1234] });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
