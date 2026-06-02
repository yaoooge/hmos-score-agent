import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import express, { type Express } from "express";
import test from "node:test";
import { createRemoteTaskRegistry } from "../src/api/remoteTaskRegistry.js";
import { createRuleViolationStatsStore } from "../src/api/ruleViolationStatsStore.js";
import { createDashboardRouter } from "../src/datasets/dashboard/dashboardHandlers.js";

async function makeTempDir(t: test.TestContext): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-trace-dashboard-"));
  t.after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });
  return dir;
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

async function invokeExpressGet(
  app: Express,
  pathName: string,
): Promise<{ statusCode: number; body: string }> {
  return await new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const req = {
      method: "GET",
      url: pathName,
      headers: {},
      on() {
        return req;
      },
      resume() {},
    };
    const res = {
      statusCode: 200,
      headers: {} as Record<string, string | number | readonly string[]>,
      setHeader(name: string, value: string | number | readonly string[]) {
        res.headers[name.toLowerCase()] = value;
      },
      getHeader(name: string) {
        return res.headers[name.toLowerCase()];
      },
      status(code: number) {
        res.statusCode = code;
        return res;
      },
      json(value: unknown) {
        chunks.push(Buffer.from(JSON.stringify(value), "utf-8"));
        resolve({ statusCode: res.statusCode, body: Buffer.concat(chunks).toString("utf-8") });
        return res;
      },
      send(value: unknown) {
        chunks.push(Buffer.from(typeof value === "string" ? value : JSON.stringify(value), "utf-8"));
        resolve({ statusCode: res.statusCode, body: Buffer.concat(chunks).toString("utf-8") });
        return res;
      },
      end(value?: unknown) {
        if (value !== undefined) {
          chunks.push(Buffer.from(String(value), "utf-8"));
        }
        resolve({ statusCode: res.statusCode, body: Buffer.concat(chunks).toString("utf-8") });
        return res;
      },
    };
    app(req as never, res as never, reject);
  });
}

async function getJson(app: Express, pathName: string): Promise<Record<string, unknown>> {
  const response = await invokeExpressGet(app, pathName);
  if (response.statusCode < 200 || response.statusCode >= 300) {
    assert.fail(response.body);
  }
  return JSON.parse(response.body) as Record<string, unknown>;
}

test("dashboard agent trace returns summary first and raw payloads on demand", async (t) => {
  const root = await makeTempDir(t);
  const registry = createRemoteTaskRegistry(root);
  const ruleStatsStore = createRuleViolationStatsStore(root);
  const caseDir = path.join(root, "case-88");
  await registry.upsert({
    taskId: 88,
    status: "completed",
    caseDir,
  });
  await writeJson(path.join(caseDir, "outputs", "agent-trace.json"), {
    schemaVersion: 1,
    taskId: 88,
    generatedAt: "2026-05-27T00:00:00.000Z",
    traceAvailable: true,
    summary: {
      runCount: 1,
      eventCount: 1,
      toolEventCount: 1,
      errorCount: 0,
      attemptCount: 1,
      totalElapsedMs: 25,
      totalTokens: 42,
    },
    runs: [
      {
        id: "run-1",
        taskId: 88,
        baseRequestTag: "rubric-case",
        agentName: "hmos-rubric-scoring",
        status: "success",
        elapsedMs: 25,
        attempts: [
          {
            id: "attempt-0",
            sequence: 0,
            retryIndex: 0,
            requestTag: "rubric-case",
            elapsedMs: 25,
            status: "success",
            prompt: "attempt prompt should not be in summary",
            assistantText: "attempt assistant raw",
            outputFileText: "{\"attempt\":true}",
            warnings: [],
          },
        ],
        prompt: "full prompt should not be in summary",
        assistantText: "assistant raw",
        outputFileText: "{\"ok\":true}",
        opencodeMessages: [{ info: { id: "msg-1" }, parts: [] }],
        events: [
          {
            id: "event-1",
            sequence: 0,
            attemptId: "attempt-0",
            retryIndex: 0,
            type: "tool",
            title: "Write output",
            status: "completed",
            toolName: "write",
            summary: "metadata/agent-output/rubric-scoring.json",
            rawPayload: {
              timestamp: 1_780_044_437_015,
              tokens: {
                total: 120,
                input: 100,
                output: 10,
                reasoning: 5,
                cache: { read: 5, write: 0 },
              },
              input: { filePath: "metadata/agent-output/rubric-scoring.json" },
            },
          },
        ],
        warnings: [],
      },
    ],
    warnings: [],
  });
  const app = express();
  app.use(
    createDashboardRouter({
      registry,
      ruleViolationStatsStore: ruleStatsStore,
      humanReviewEvidenceRoot: root,
    }),
  );

  const summaryResponse = await getJson(app, "/dashboard/tasks/88/agent-trace");
  assert.equal(summaryResponse.success, true);
  assert.equal(summaryResponse.traceAvailable, true);
  assert.equal(summaryResponse.source, "artifact");
  assert.equal(summaryResponse.rawAvailable, true);
  const report = summaryResponse.report as Record<string, unknown>;
  const runs = report.runs as Array<Record<string, unknown>>;
  assert.equal(runs[0]?.prompt, undefined);
  assert.equal(runs[0]?.outputFileText, undefined);
  const attempts = runs[0]?.attempts as Array<Record<string, unknown>>;
  assert.equal(attempts[0]?.prompt, undefined);
  assert.equal(attempts[0]?.assistantText, undefined);
  assert.equal(attempts[0]?.outputFileText, undefined);
  const events = runs[0]?.events as Array<Record<string, unknown>>;
  assert.equal(events[0]?.rawPayload, undefined);
  assert.equal(events[0]?.hasRawPayload, true);
  assert.equal(events[0]?.timestampMs, 1_780_044_437_015);
  assert.deepEqual(events[0]?.tokenUsage, {
    total: 120,
    input: 100,
    output: 10,
    reasoning: 5,
    cacheRead: 5,
    cacheWrite: 0,
  });

  const runRaw = await getJson(app, "/dashboard/tasks/88/agent-trace/runs/run-1/raw");
  assert.equal(runRaw.prompt, "full prompt should not be in summary");
  assert.deepEqual(runRaw.opencodeMessages, [{ info: { id: "msg-1" }, parts: [] }]);
  const eventRaw = await getJson(app, "/dashboard/tasks/88/agent-trace/events/event-1/raw");
  assert.deepEqual(eventRaw.rawPayload, {
    timestamp: 1_780_044_437_015,
    tokens: {
      total: 120,
      input: 100,
      output: 10,
      reasoning: 5,
      cache: { read: 5, write: 0 },
    },
    input: { filePath: "metadata/agent-output/rubric-scoring.json" },
  });
});
