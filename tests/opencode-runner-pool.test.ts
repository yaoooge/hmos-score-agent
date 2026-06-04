import assert from "node:assert/strict";
import test from "node:test";
import type { OpencodeRuntimeConfig } from "../src/agents/opencode/config.js";
import type { OpencodeServeManager } from "../src/agents/opencode/serveManager.js";
import type { OpencodeRunRequest, OpencodeRunResult } from "../src/agents/opencode/cliRunner.js";
import { createOpencodeRunnerPool } from "../src/agents/opencode/runnerPool.js";

function runtimeConfig(port: number, slotId: number): OpencodeRuntimeConfig {
  return {
    host: "127.0.0.1",
    port,
    serverUrl: `http://127.0.0.1:${String(port)}`,
    configPath: `/repo/.opencode/runtime/worker-${String(slotId)}/opencode.generated.json`,
    configDir: "/repo/.opencode",
    runtimeDir: `/repo/.opencode/runtime/worker-${String(slotId)}`,
    env: {
      OPENCODE_CONFIG: `/repo/.opencode/runtime/worker-${String(slotId)}/opencode.generated.json`,
    },
    timeoutMs: 600000,
    maxOutputBytes: 1048576,
  };
}

function request(tag: string): OpencodeRunRequest {
  return {
    prompt: "x",
    sandboxRoot: "/sandbox",
    requestTag: tag,
  };
}

function result(input: OpencodeRunRequest, serverUrl: string): OpencodeRunResult {
  return {
    requestTag: input.requestTag,
    rawText: JSON.stringify({ serverUrl }),
    rawEvents: "",
    elapsedMs: 1,
  };
}

test("opencode runner pool leases three isolated runners and waits for release", async () => {
  const createdRuntimes: OpencodeRuntimeConfig[] = [];
  const startedPorts: number[] = [];
  const stoppedPorts: number[] = [];
  const runServerUrls: string[] = [];
  const pool = createOpencodeRunnerPool({
    size: 3,
    basePort: 4096,
    createRuntimeConfig: async ({ port, slotId }) => {
      const runtime = runtimeConfig(port, slotId);
      createdRuntimes.push(runtime);
      return runtime;
    },
    createServeManager: (runtime): OpencodeServeManager => ({
      start: async () => {
        startedPorts.push(runtime.port);
      },
      restart: async () => {
        throw new Error(`unexpected restart ${String(runtime.port)}`);
      },
      stop: async () => {
        stoppedPorts.push(runtime.port);
      },
      health: async () => true,
      serverUrl: () => runtime.serverUrl,
    }),
    runPrompt: async ({ runtime, request: runRequest }) => {
      runServerUrls.push(runtime.serverUrl);
      return result(runRequest, runtime.serverUrl);
    },
  });

  const leases = await Promise.all([pool.acquire(), pool.acquire(), pool.acquire()]);
  const fourthLease = pool.acquire();
  let fourthResolved = false;
  fourthLease.then(() => {
    fourthResolved = true;
  });
  await Promise.resolve();

  assert.equal(fourthResolved, false);
  assert.deepEqual(
    createdRuntimes.map((runtime) => runtime.port),
    [4096, 4097, 4098],
  );
  assert.deepEqual(
    createdRuntimes.map((runtime) => runtime.runtimeDir),
    [
      "/repo/.opencode/runtime/worker-0",
      "/repo/.opencode/runtime/worker-1",
      "/repo/.opencode/runtime/worker-2",
    ],
  );

  await Promise.all(
    leases.map((lease, index) => lease.runner.runPrompt(request(`task-${String(index)}`))),
  );
  assert.deepEqual(runServerUrls.sort(), [
    "http://127.0.0.1:4096",
    "http://127.0.0.1:4097",
    "http://127.0.0.1:4098",
  ]);
  assert.deepEqual(
    [...new Set(startedPorts)].sort((left, right) => left - right),
    [4096, 4097, 4098],
  );

  leases[1]?.release();
  const fourth = await fourthLease;
  assert.equal(fourthResolved, true);
  await fourth.runner.runPrompt(request("task-4"));
  assert.equal(runServerUrls.at(-1), "http://127.0.0.1:4097");

  leases[0]?.release();
  leases[2]?.release();
  fourth.release();
  await pool.stopAll();

  assert.deepEqual(
    stoppedPorts.sort((left, right) => left - right),
    [4096, 4097, 4098],
  );
});

test("opencode runner pool cleans up partially started slots when initialization fails", async () => {
  const startedPorts: number[] = [];
  const stoppedPorts: number[] = [];
  let shouldFailSecondSlot = true;
  const pool = createOpencodeRunnerPool({
    size: 3,
    basePort: 4096,
    createRuntimeConfig: async ({ port, slotId }) => runtimeConfig(port, slotId),
    createServeManager: (runtime): OpencodeServeManager => ({
      start: async () => {
        if (runtime.port === 4097 && shouldFailSecondSlot) {
          throw new Error("worker-1 failed to start");
        }
        startedPorts.push(runtime.port);
      },
      restart: async () => undefined,
      stop: async () => {
        stoppedPorts.push(runtime.port);
      },
      health: async () => true,
      serverUrl: () => runtime.serverUrl,
    }),
    runPrompt: async ({ runtime, request: runRequest }) => result(runRequest, runtime.serverUrl),
  });

  await assert.rejects(() => pool.acquire(), /worker-1 failed to start/);
  assert.deepEqual(startedPorts, [4096]);
  assert.deepEqual(stoppedPorts, [4096]);

  shouldFailSecondSlot = false;
  const leases = await Promise.all([pool.acquire(), pool.acquire(), pool.acquire()]);

  assert.deepEqual(
    leases.map((lease) => lease.slotId),
    [0, 1, 2],
  );
  assert.deepEqual(startedPorts, [4096, 4096, 4097, 4098]);

  leases.forEach((lease) => lease.release());
});
