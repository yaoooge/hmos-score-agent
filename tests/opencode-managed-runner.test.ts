import assert from "node:assert/strict";
import test from "node:test";
import { createManagedOpencodeRunner } from "../src/agents/opencode/managedRunner.js";
import type { OpencodeRunRequest, OpencodeRunResult } from "../src/agents/opencode/cliRunner.js";
import type { OpencodeRuntimeConfig } from "../src/agents/opencode/config.js";

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

function request(requestTag = "task-understanding"): OpencodeRunRequest {
  return {
    prompt: "x",
    sandboxRoot: "/sandbox",
    requestTag,
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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function deferred<T = void>(): {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
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

test("managed opencode runner allows concurrent prompts on the same serve session pool", async () => {
  let activeRuns = 0;
  let maxActiveRuns = 0;
  const runner = createManagedOpencodeRunner({
    runtime: runtimeConfig(),
    serveManager: {
      start: async () => undefined,
      restart: async () => {
        throw new Error("restart should not be called");
      },
    },
    runPrompt: async ({ request: runRequest }) => {
      activeRuns += 1;
      maxActiveRuns = Math.max(maxActiveRuns, activeRuns);
      await delay(20);
      activeRuns -= 1;
      return result(runRequest);
    },
  });

  const outputs = await Promise.all([
    runner.runPrompt(request("rubric-scoring")),
    runner.runPrompt(request("rule-assessment")),
  ]);

  assert.deepEqual(outputs.map((output) => output.requestTag).sort(), [
    "rubric-scoring",
    "rule-assessment",
  ]);
  assert.equal(maxActiveRuns, 2);
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
  assert.equal(startCount, 2);
  assert.equal(restartCount, 1);
  assert.equal(runCount, 2);
});

test("managed opencode runner waits for active prompts before restarting serve", async () => {
  const slowStarted = deferred();
  const releaseSlow = deferred();
  let slowActive = false;
  let restartCount = 0;
  let restartedWhileSlowActive = false;
  let failedAttemptCount = 0;

  const runner = createManagedOpencodeRunner({
    runtime: runtimeConfig(),
    serveManager: {
      start: async () => undefined,
      restart: async () => {
        restartCount += 1;
        restartedWhileSlowActive = slowActive;
      },
    },
    runPrompt: async ({ request: runRequest }) => {
      if (runRequest.requestTag === "slow-rubric") {
        slowActive = true;
        slowStarted.resolve();
        await releaseSlow.promise;
        slowActive = false;
        return result(runRequest);
      }

      failedAttemptCount += 1;
      if (failedAttemptCount === 1) {
        throw new Error("opencode 调用失败 request=rule exitCode=1 stderr=Session not Found");
      }
      return result(runRequest);
    },
  });

  const slowRun = runner.runPrompt(request("slow-rubric"));
  await slowStarted.promise;
  const recoveredRun = runner.runPrompt(request("rule-assessment"));
  await delay(10);

  assert.equal(restartCount, 0);

  releaseSlow.resolve();
  await Promise.all([slowRun, recoveredRun]);

  assert.equal(restartCount, 1);
  assert.equal(restartedWhileSlowActive, false);
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
