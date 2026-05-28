import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { createAgentTraceRecorder } from "../src/agentTrace/agentTraceRecorder.js";
import { createAgentTraceSqliteStore } from "../src/agentTrace/agentTraceSqliteStore.js";
import { fetchOpencodeSessionSnapshot } from "../src/agentTrace/opencodeSessionClient.js";
import { parseOpencodeSessionEvents } from "../src/agentTrace/opencodePartParser.js";
import type {
  AgentTraceAttempt,
  AgentTraceRun,
  OpencodeSessionSnapshot,
} from "../src/agentTrace/types.js";
import { createScoreDatabase } from "../src/storage/sqliteDatabase.js";
import { enrichAgentTraceRuns } from "../src/workflow/scoreWorkflow.js";

function tokenUsage(total: number) {
  return {
    total,
    input: total - 3,
    output: 1,
    reasoning: 1,
    cacheRead: 1,
    cacheWrite: 0,
  };
}

test("parseOpencodeSessionEvents binds OpenCode events to retry attempts", () => {
  const attempts: AgentTraceAttempt[] = [
    {
      id: "attempt-0",
      sequence: 0,
      retryIndex: 0,
      requestTag: "rubric-case",
      startedAtMs: 1_000,
      endedAtMs: 1_900,
      elapsedMs: 900,
      status: "failed",
      warnings: ["最终输出不是唯一 JSON object"],
    },
    {
      id: "attempt-1",
      sequence: 1,
      retryIndex: 1,
      requestTag: "rubric-case-retry-1",
      startedAtMs: 2_000,
      endedAtMs: 2_900,
      elapsedMs: 900,
      status: "success",
      warnings: [],
    },
  ];
  const snapshot: OpencodeSessionSnapshot = {
    id: "ses_trace",
    title: "rubric-case",
    directory: "/tmp/case/opencode-sandbox",
    source: "api",
    messages: [
      {
        info: {
          id: "msg-1",
          role: "assistant",
          agent: "hmos-rubric-scoring",
          model: "openai/gpt-5",
          created: 1_100,
          completed: 1_800,
          tokens: { input: 10, output: 2, reasoning: 1, cache: { read: 3, write: 0 }, total: 16 },
        },
        parts: [
          { id: "part-1", type: "step-start", created: 1_110 },
          {
            id: "part-2",
            type: "tool",
            tool: "read",
            status: "error",
            title: "Read generated/src/main.ets",
            created: 1_200,
            input: { filePath: "generated/src/main.ets" },
            output: "file not found",
          },
          {
            id: "part-3",
            type: "step-finish",
            reason: "tool-calls",
            created: 1_750,
            tokens: { input: 10, output: 2, reasoning: 1, cache: { read: 3, write: 0 }, total: 16 },
          },
        ],
      },
      {
        info: {
          id: "msg-2",
          role: "assistant",
          agent: "hmos-rubric-scoring",
          model: "openai/gpt-5",
          created: 2_100,
          completed: 2_700,
        },
        parts: [
          {
            id: "part-4",
            type: "tool",
            tool: "write",
            status: "completed",
            title: "Write rubric output",
            created: 2_300,
            input: { filePath: "metadata/agent-output/rubric-scoring.json" },
            output: "{\"ok\":true}",
          },
          {
            id: "part-5",
            type: "text",
            text: "{\"output_file\":\"metadata/agent-output/rubric-scoring.json\"}",
            created: 2_650,
          },
        ],
      },
    ],
  };

  const { events, warnings } = parseOpencodeSessionEvents(snapshot, attempts);

  assert.equal(warnings.length, 0);
  assert.equal(events.filter((event) => event.type === "message").length, 2);
  const readEvent = events.find((event) => event.partId === "part-2");
  assert.equal(readEvent?.attemptId, "attempt-0");
  assert.equal(readEvent?.retryIndex, 0);
  assert.equal(readEvent?.status, "error");
  assert.equal(readEvent?.toolName, "read");
  assert.equal(readEvent?.hasRawPayload, true);
  const writeEvent = events.find((event) => event.partId === "part-4");
  assert.equal(writeEvent?.attemptId, "attempt-1");
  assert.equal(writeEvent?.retryIndex, 1);
  assert.equal(writeEvent?.status, "completed");
});

test("AgentTraceRecorder records successful and failed runPrompt attempts", async (t) => {
  const timestamps = [10_000, 10_250, 11_000, 11_900];
  const recorder = createAgentTraceRecorder({
    taskId: 1747,
    caseId: "case-1747",
    caseDir: "/tmp/case-1747",
    runtime: {
      serverUrl: "http://127.0.0.1:4096",
      runtimeDir: "/tmp/opencode-runtime",
    },
    now: () => timestamps.shift() ?? 99_999,
  });

  await assert.rejects(
    recorder.runPrompt(
      {
        prompt: "bad json",
        sandboxRoot: "/tmp/case-1747/opencode-sandbox",
        requestTag: "rubric-case",
        agent: "hmos-rubric-scoring",
        outputFile: "metadata/agent-output/rubric-scoring.json",
      },
      async () => {
        throw new Error("protocol failed");
      },
    ),
    /protocol failed/,
  );
  const result = await recorder.runPrompt(
    {
      prompt: "retry",
      sandboxRoot: "/tmp/case-1747/opencode-sandbox",
      requestTag: "rubric-case-retry-1",
      title: "rubric-case-retry-1",
      agent: "hmos-rubric-scoring",
      continueSessionId: "ses_retry",
      outputFile: "metadata/agent-output/rubric-scoring.json",
    },
    async () => ({
      requestTag: "rubric-case-retry-1",
      rawText: "{\"ok\":true}",
      rawEvents: "",
      elapsedMs: 850,
      sessionId: "ses_retry",
      tokenUsage: tokenUsage(42),
      assistantText: "{\"output_file\":\"metadata/agent-output/rubric-scoring.json\"}",
      outputFile: "metadata/agent-output/rubric-scoring.json",
      outputFileText: "{\"ok\":true}",
    }),
  );

  assert.equal(result.sessionId, "ses_retry");
  const runs = recorder.drainRuns();
  assert.equal(runs.length, 1);
  assert.equal(runs[0]?.baseRequestTag, "rubric-case");
  assert.equal(runs[0]?.agentName, "hmos-rubric-scoring");
  assert.equal(runs[0]?.attempts.length, 2);
  assert.deepEqual(
    runs[0]?.attempts.map((attempt) => ({
      requestTag: attempt.requestTag,
      retryIndex: attempt.retryIndex,
      status: attempt.status,
      startedAtMs: attempt.startedAtMs,
      endedAtMs: attempt.endedAtMs,
    })),
    [
      {
        requestTag: "rubric-case",
        retryIndex: 0,
        status: "failed",
        startedAtMs: 10_000,
        endedAtMs: 10_250,
      },
      {
        requestTag: "rubric-case-retry-1",
        retryIndex: 1,
        status: "success",
        startedAtMs: 11_000,
        endedAtMs: 11_900,
      },
    ],
  );
  assert.equal(runs[0]?.attempts[0]?.warnings[0], "protocol failed");
  assert.deepEqual(runs[0]?.tokenUsage, tokenUsage(42));
});

test("AgentTraceRecorder parses streamed OpenCode raw events into trace events", async () => {
  const timestamps = [20_000, 20_500];
  const recorder = createAgentTraceRecorder({
    taskId: 1763,
    caseId: "case-1763",
    caseDir: "/tmp/case-1763",
    now: () => timestamps.shift() ?? 20_999,
  });

  await recorder.runPrompt(
    {
      prompt: "score it",
      sandboxRoot: "/tmp/case-1763/opencode-sandbox",
      requestTag: "rule-assessment-case",
      agent: "hmos-rule-assessment",
      outputFile: "metadata/agent-output/rule-assessment.json",
    },
    async () => ({
      requestTag: "rule-assessment-case",
      rawText: "{\"output_file\":\"metadata/agent-output/rule-assessment.json\"}",
      rawEvents: [
        '{"type":"session.updated","properties":{"info":{"id":"ses_raw_events"}}}',
        '{"type":"message.updated","properties":{"info":{"id":"msg-1","role":"assistant","agent":"hmos-rule-assessment","model":"test-model"}}}',
        '{"type":"tool","part":{"id":"tool-1","type":"tool","tool":"read","status":"completed","title":"Read patch","input":{"filePath":"patch/effective.patch"},"output":"diff"}}',
        '{"type":"text","part":{"id":"text-1","type":"text","text":"{\\"output_file\\":\\"metadata/agent-output/rule-assessment.json\\"}"}}',
        '{"type":"step_finish","part":{"id":"finish-1","type":"step-finish","tokens":{"input":10,"output":2,"reasoning":1,"cache":{"read":3,"write":0},"total":16}}}',
      ].join("\n"),
      elapsedMs: 500,
      sessionId: "ses_raw_events",
      tokenUsage: tokenUsage(16),
      assistantText: "{\"output_file\":\"metadata/agent-output/rule-assessment.json\"}",
      outputFile: "metadata/agent-output/rule-assessment.json",
      outputFileText: "{\"ok\":true}",
    }),
  );

  const run = recorder.drainRuns()[0];
  assert.equal(run?.events.length, 4);
  assert.equal(run?.events[0]?.type, "message");
  assert.equal(run?.events[0]?.title, "assistant hmos-rule-assessment test-model");
  const toolEvent = run?.events.find((event) => event.type === "tool");
  assert.equal(toolEvent?.attemptId, run?.attempts[0]?.id);
  assert.equal(toolEvent?.retryIndex, 0);
  assert.equal(toolEvent?.toolName, "read");
  assert.equal(toolEvent?.summary, "patch/effective.patch");
  assert.equal(toolEvent?.hasRawPayload, true);
  assert.equal(run?.events.some((event) => event.type === "text"), true);
  assert.equal(run?.events.some((event) => event.type === "step-finish"), true);
});

test("enrichAgentTraceRuns preserves raw stream events when OpenCode session messages are empty", async (t) => {
  const server = http.createServer((_, response) => {
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ session: { title: "empty-session" }, messages: [] }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const address = server.address();
  assert.equal(typeof address, "object");
  assert.notEqual(address, null);

  const run: AgentTraceRun = {
    id: "run-raw",
    taskId: 1763,
    caseId: "case-1763",
    baseRequestTag: "rule-assessment-case",
    agentName: "hmos-rule-assessment",
    status: "success",
    elapsedMs: 500,
    attempts: [
      {
        id: "attempt-0",
        sequence: 0,
        retryIndex: 0,
        requestTag: "rule-assessment-case",
        elapsedMs: 500,
        status: "success",
        sessionId: "ses_empty",
        warnings: [],
      },
    ],
    opencodeSession: {
      id: "ses_empty",
      title: "rule-assessment-case",
      directory: "",
      source: "api",
    },
    events: [
      {
        id: "attempt-0:tool-1",
        sequence: 0,
        attemptId: "attempt-0",
        retryIndex: 0,
        type: "tool",
        title: "Read patch",
        status: "completed",
        toolName: "read",
        summary: "patch/effective.patch",
        hasRawPayload: true,
      },
    ],
    warnings: [],
  };

  const [enriched] = await enrichAgentTraceRuns({
    runs: [run],
    runtime: {
      host: "127.0.0.1",
      port: address.port,
      serverUrl: `http://127.0.0.1:${String(address.port)}`,
      configPath: "/tmp/opencode.json",
      configDir: "/tmp",
      runtimeDir: "/tmp/opencode-runtime",
      env: {},
      timeoutMs: 1_000,
      maxOutputBytes: 1_000_000,
    },
    logger: { warn() {} },
  });

  assert.equal(enriched?.events.length, 1);
  assert.equal(enriched?.events[0]?.toolName, "read");
  assert.equal(enriched?.warnings.includes("opencode_session_messages_empty"), true);
});

test("fetchOpencodeSessionSnapshot reads OpenCode sqlite message parts", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-session-sqlite-"));
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });
  const dbPath = path.join(root, "xdg-data", "opencode", "opencode.db");
  await fs.mkdir(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE session (
      id text PRIMARY KEY,
      title text NOT NULL,
      directory text NOT NULL,
      time_created integer NOT NULL,
      time_updated integer NOT NULL
    );
    CREATE TABLE message (
      id text PRIMARY KEY,
      session_id text NOT NULL,
      time_created integer NOT NULL,
      time_updated integer NOT NULL,
      data text NOT NULL
    );
    CREATE TABLE part (
      id text PRIMARY KEY,
      message_id text NOT NULL,
      session_id text NOT NULL,
      time_created integer NOT NULL,
      time_updated integer NOT NULL,
      data text NOT NULL
    );
  `);
  db.prepare(
    `INSERT INTO session (id, title, directory, time_created, time_updated) VALUES (?, ?, ?, ?, ?)`,
  ).run("ses_sqlite", "sqlite-session", "/tmp/sandbox", 1_000, 2_000);
  db.prepare(
    `INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)`,
  ).run(
    "msg-1",
    "ses_sqlite",
    1_100,
    1_900,
    JSON.stringify({ role: "assistant", agent: "hmos-rule-assessment", modelID: "glm-5.1" }),
  );
  db.prepare(
    `INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    "part-1",
    "msg-1",
    "ses_sqlite",
    1_200,
    1_250,
    JSON.stringify({
      type: "tool",
      tool: "read",
      state: {
        status: "completed",
        input: { filePath: "patch/effective.patch" },
        output: "diff",
      },
    }),
  );
  db.close();

  const snapshot = await fetchOpencodeSessionSnapshot({
    serverUrl: "http://127.0.0.1:1",
    runtimeDir: root,
    sessionId: "ses_sqlite",
  });

  assert.equal(snapshot?.source, "sqlite");
  assert.equal(snapshot?.title, "sqlite-session");
  assert.equal(snapshot?.messages.length, 1);
  assert.equal(snapshot?.messages[0]?.info?.id, "msg-1");
  assert.equal(snapshot?.messages[0]?.parts?.[0]?.id, "part-1");
  const toolEvent = parseOpencodeSessionEvents(snapshot!, [
    {
      id: "attempt-0",
      sequence: 0,
      retryIndex: 0,
      requestTag: "rule-assessment",
      startedAtMs: 1_000,
      endedAtMs: 2_000,
      elapsedMs: 1_000,
      status: "success",
      warnings: [],
    },
  ]).events.find((event) => event.type === "tool");
  assert.equal(toolEvent?.summary, "patch/effective.patch");
  assert.equal(toolEvent?.status, "completed");
});

test("AgentTraceSqliteStore upserts run, attempt, and event summaries", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agent-trace-db-"));
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });
  const db = createScoreDatabase(path.join(root, "score-index.sqlite3"));
  db.run(
    `INSERT INTO remote_task (task_id, status, created_at_ms, updated_at_ms, result_available)
     VALUES (?, ?, ?, ?, ?)`,
    [1747, "completed", 1_000, 2_000, 1],
  );
  const store = createAgentTraceSqliteStore(db);
  const run: AgentTraceRun = {
    id: "run-1",
    taskId: 1747,
    caseId: "case-1747",
    baseRequestTag: "rubric-case",
    agentName: "hmos-rubric-scoring",
    status: "success",
    startedAtMs: 1_000,
    endedAtMs: 2_900,
    elapsedMs: 1_900,
    tokenUsage: tokenUsage(42),
    opencodeSession: {
      id: "ses_retry",
      title: "rubric-case",
      directory: "/tmp/case/opencode-sandbox",
      source: "api",
    },
    attempts: [
      {
        id: "attempt-0",
        sequence: 0,
        retryIndex: 0,
        requestTag: "rubric-case",
        startedAtMs: 1_000,
        endedAtMs: 1_900,
        elapsedMs: 900,
        status: "failed",
        warnings: ["bad json"],
      },
      {
        id: "attempt-1",
        sequence: 1,
        retryIndex: 1,
        requestTag: "rubric-case-retry-1",
        startedAtMs: 2_000,
        endedAtMs: 2_900,
        elapsedMs: 900,
        status: "success",
        tokenUsage: tokenUsage(42),
        warnings: [],
      },
    ],
    events: [
      {
        id: "event-1",
        sequence: 0,
        attemptId: "attempt-0",
        retryIndex: 0,
        type: "tool",
        title: "Read missing file",
        status: "error",
        timestampMs: 1_200,
        toolName: "read",
        summary: "file not found",
        hasRawPayload: true,
      },
      {
        id: "event-2",
        sequence: 1,
        attemptId: "attempt-1",
        retryIndex: 1,
        type: "tool",
        title: "Write output",
        status: "completed",
        timestampMs: 2_300,
        toolName: "write",
        summary: "metadata/agent-output/rubric-scoring.json",
        hasRawPayload: true,
      },
    ],
    warnings: [],
  };

  await store.upsertRun(run, "outputs/agent-trace.json");

  const runs = await store.listRunsByTaskId(1747);
  assert.equal(runs.length, 1);
  assert.equal(runs[0]?.attemptCount, 2);
  assert.equal(runs[0]?.eventCount, 2);
  assert.equal(runs[0]?.errorCount, 1);
  assert.equal(runs[0]?.artifactPath, "outputs/agent-trace.json");
  const attempts = await store.listAttemptsByRunId("run-1");
  assert.deepEqual(
    attempts.map((attempt) => [attempt.requestTag, attempt.retryIndex, attempt.status]),
    [
      ["rubric-case", 0, "failed"],
      ["rubric-case-retry-1", 1, "success"],
    ],
  );
  const retryEvents = await store.listEventsByRunId("run-1", { retryIndex: 1 });
  assert.equal(retryEvents.length, 1);
  assert.equal(retryEvents[0]?.traceAttemptId, "attempt-1");
  assert.equal(retryEvents[0]?.toolName, "write");
  assert.equal(retryEvents[0]?.hasRawPayload, true);
  db.close();
});
