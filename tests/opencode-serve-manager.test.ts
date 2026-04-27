import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import type { OpencodeRuntimeConfig } from "../src/opencode/opencodeConfig.js";
import {
  OpencodeServeError,
  createOpencodeServeManager,
  ensureOpencodeCliAvailable,
} from "../src/opencode/opencodeServeManager.js";

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

function createFakeChild(): EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
  killedWith?: NodeJS.Signals | number;
  kill(signal?: NodeJS.Signals | number): boolean;
} {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    killedWith?: NodeJS.Signals | number;
    kill(signal?: NodeJS.Signals | number): boolean;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = (signal?: NodeJS.Signals | number) => {
    child.killedWith = signal ?? "SIGTERM";
    return true;
  };
  return child;
}

test("ensureOpencodeCliAvailable fails when opencode cannot be resolved", async () => {
  await assert.rejects(
    () =>
      ensureOpencodeCliAvailable({
        commandExists: async () => false,
      }),
    (error: unknown) => {
      assert.ok(error instanceof OpencodeServeError);
      assert.match(error.message, /opencode CLI/);
      return true;
    },
  );
});

test("serve manager rejects an already healthy external server", async () => {
  let spawnCount = 0;
  const manager = createOpencodeServeManager(runtimeConfig(), {
    checkHealth: async () => true,
    spawnProcess: () => {
      spawnCount += 1;
      return createFakeChild();
    },
  });

  await assert.rejects(
    () => manager.start(),
    /端口已被外部进程占用/,
  );

  assert.equal(spawnCount, 0);
  assert.equal(manager.serverUrl(), "http://127.0.0.1:4096");
});

test("serve manager starts opencode serve and waits for health", async () => {
  const healthResults = [false, false, true];
  const spawned: Array<{ command: string; args: string[]; env?: NodeJS.ProcessEnv }> = [];
  const child = createFakeChild();
  const manager = createOpencodeServeManager(runtimeConfig(), {
    checkHealth: async () => healthResults.shift() ?? true,
    spawnProcess: (command, args, options) => {
      spawned.push({ command, args, env: options.env });
      return child;
    },
    sleep: async () => undefined,
  });

  await manager.start();

  assert.equal(spawned.length, 1);
  assert.equal(spawned[0]?.command, "opencode");
  assert.deepEqual(spawned[0]?.args, [
    "serve",
    "--hostname",
    "127.0.0.1",
    "--port",
    "4096",
    "--print-logs",
    "--log-level",
    "INFO",
  ]);
  assert.ok(!spawned[0]?.args.includes("--pure"));
  assert.equal(spawned[0]?.env?.OPENCODE_CONFIG, "/repo/.opencode/runtime/opencode.generated.json");
});

test("serve manager reports early opencode serve exit with stderr", async () => {
  const child = createFakeChild();
  const manager = createOpencodeServeManager(runtimeConfig(), {
    checkHealth: async () => false,
    spawnProcess: () => {
      queueMicrotask(() => {
        child.stderr.emit("data", Buffer.from("Failed to start server on port 4096"));
        child.emit("exit", 1, null);
      });
      return child;
    },
    sleep: async () => undefined,
  });

  await assert.rejects(
    () => manager.start(),
    (error: unknown) => {
      assert.ok(error instanceof OpencodeServeError);
      assert.match(error.message, /exitCode=1/);
      assert.match(error.message, /Failed to start server on port 4096/);
      return true;
    },
  );
});

test("serve manager stop kills only the child process it started", async () => {
  const child = createFakeChild();
  const healthResults = [false, true];
  const manager = createOpencodeServeManager(runtimeConfig(), {
    checkHealth: async () => healthResults.shift() ?? true,
    spawnProcess: () => child,
    sleep: async () => undefined,
  });

  await manager.start();
  await manager.stop();

  assert.equal(child.killedWith, "SIGTERM");
});
