import assert from "node:assert/strict";
import test from "node:test";
import { createManagedOpencodeRunner } from "../src/opencode/managedOpencodeRunner.js";
import type { OpencodeRunRequest, OpencodeRunResult } from "../src/opencode/opencodeCliRunner.js";
import type { OpencodeRuntimeConfig } from "../src/opencode/opencodeConfig.js";

function runtimeConfig(): OpencodeRuntimeConfig {
  return {
    host: "127.0.0.1",
    port: 4096,
    serverUrl: "http://127.0.0.1:4096",
    configPath: "/repo/.opencode/runtime/opencode.generated.json",
    configDir: "/repo/.opencode",
    runtimeDir: "/repo/.opencode/runtime",
    env: { OPENCODE_CONFIG: "/repo/.opencode/runtime/opencode.generated.json" },
    timeoutMs: 600000,
    maxOutputBytes: 1048576,
  };
}

function request(): OpencodeRunRequest {
  return {
    prompt: "x",
    sandboxRoot: "/sandbox",
    requestTag: "task-understanding",
  };
}

function result(input: OpencodeRunRequest): OpencodeRunResult {
  return {
    requestTag: input.requestTag,
    rawText: '{"ok":true}',
    rawEvents: "",
    elapsedMs: 1,
  };
}

test("managed opencode runner verifies serve health before each prompt", async () => {
  let startCount = 0;
  let runCount = 0;
  const runner = createManagedOpencodeRunner({
    runtime: runtimeConfig(),
    serveManager: {
      start: async () => {
        startCount += 1;
      },
      restart: async () => {
        throw new Error("restart should not be called");
      },
    },
    runPrompt: async ({ request: runRequest }) => {
      runCount += 1;
      return result(runRequest);
    },
  });

  await runner.runPrompt(request());
  await runner.runPrompt(request());

  assert.equal(startCount, 2);
  assert.equal(runCount, 2);
});

test("managed opencode runner restarts serve and retries Session not Found once", async () => {
  let startCount = 0;
  let restartCount = 0;
  let runCount = 0;
  const runner = createManagedOpencodeRunner({
    runtime: runtimeConfig(),
    serveManager: {
      start: async () => {
        startCount += 1;
      },
      restart: async () => {
        restartCount += 1;
      },
    },
    runPrompt: async ({ request: runRequest }) => {
      runCount += 1;
      if (runCount === 1) {
        throw new Error("opencode 调用失败 request=x exitCode=1 stderr=Session not Found");
      }
      return result(runRequest);
    },
  });

  const output = await runner.runPrompt(request());

  assert.equal(output.rawText, '{"ok":true}');
  assert.equal(startCount, 1);
  assert.equal(restartCount, 1);
  assert.equal(runCount, 2);
});

test("managed opencode runner does not retry non-runtime output errors", async () => {
  let restartCount = 0;
  let runCount = 0;
  const runner = createManagedOpencodeRunner({
    runtime: runtimeConfig(),
    serveManager: {
      start: async () => undefined,
      restart: async () => {
        restartCount += 1;
      },
    },
    runPrompt: async () => {
      runCount += 1;
      throw new Error("opencode 最终 JSON 解析失败");
    },
  });

  await assert.rejects(() => runner.runPrompt(request()), /JSON/);
  assert.equal(restartCount, 0);
  assert.equal(runCount, 1);
});
