import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { OpencodeRuntimeConfig } from "../src/opencode/opencodeConfig.js";
import { OpencodeRunError, runOpencodePrompt } from "../src/opencode/opencodeCliRunner.js";

function runtimeConfig(runtimeDir: string, overrides: Partial<OpencodeRuntimeConfig> = {}): OpencodeRuntimeConfig {
  return {
    host: "127.0.0.1",
    port: 4096,
    serverUrl: "http://127.0.0.1:4096",
    configPath: path.join(runtimeDir, "opencode.generated.json"),
    configDir: path.dirname(runtimeDir),
    runtimeDir,
    env: { OPENCODE_CONFIG: path.join(runtimeDir, "opencode.generated.json") },
    timeoutMs: 600000,
    maxOutputBytes: 1048576,
    ...overrides,
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

test("runOpencodePrompt invokes attached opencode run without a custom agent", async () => {
  const runtimeDir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-runner-"));
  const sandboxRoot = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-sandbox-"));
  const child = createFakeChild();
  const spawned: Array<{ command: string; args: string[]; env?: NodeJS.ProcessEnv }> = [];
  const promise = runOpencodePrompt({
    runtime: runtimeConfig(runtimeDir),
    request: {
      prompt: "请评分",
      sandboxRoot,
      requestTag: "rule-assessment",
    },
    deps: {
      spawnProcess: (command, args, options) => {
        spawned.push({ command, args, env: options.env });
        queueMicrotask(() => {
          child.stdout.emit("data", Buffer.from('{"type":"text","part":{"type":"text","text":"{\\"ok\\":true}"}}\n'));
          child.emit("exit", 0);
        });
        return child;
      },
    },
  });

  const result = await promise;

  assert.equal(result.rawText, '{"ok":true}');
  assert.equal(spawned[0]?.command, "opencode");
  assert.deepEqual(spawned[0]?.args.slice(0, 8), [
    "run",
    "--attach",
    "http://127.0.0.1:4096",
    "--dir",
    sandboxRoot,
    "--format",
    "json",
    "--title",
  ]);
  assert.equal(spawned[0]?.args.includes("--agent"), false);
  assert.equal(spawned[0]?.env?.OPENCODE_CONFIG, path.join(runtimeDir, "opencode.generated.json"));
  const promptPath = path.join(sandboxRoot, "metadata", "opencode-prompts", "rule-assessment.md");
  assert.equal(await fs.readFile(promptPath, "utf-8"), "请评分");
  assert.match(spawned[0]?.args.at(-1) ?? "", /metadata\/opencode-prompts\/rule-assessment\.md/);
});

test("runOpencodePrompt concatenates streamed opencode text part events", async () => {
  const runtimeDir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-runner-stream-text-"));
  const sandboxRoot = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-sandbox-stream-text-"));
  const child = createFakeChild();

  const result = await runOpencodePrompt({
    runtime: runtimeConfig(runtimeDir),
    request: {
      prompt: "return json",
      sandboxRoot,
      requestTag: "stream-text-event",
    },
    deps: {
      spawnProcess: () => {
        queueMicrotask(() => {
          child.stdout.emit(
            "data",
            Buffer.from(
              [
                '{"type":"text","part":{"type":"text","text":"{\\"ok\\":"}}',
                '{"type":"text","part":{"type":"text","text":"true}"}}',
              ].join("\n") + "\n",
            ),
          );
          child.emit("exit", 0);
        });
        return child;
      },
    },
  });

  assert.equal(result.rawText, '{"ok":true}');
});

test("runOpencodePrompt reports non-zero exits with stderr snippets", async () => {
  const runtimeDir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-runner-exit-"));
  const sandboxRoot = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-sandbox-exit-"));
  const child = createFakeChild();

  await assert.rejects(
    () =>
      runOpencodePrompt({
        runtime: runtimeConfig(runtimeDir),
        request: { prompt: "x", sandboxRoot, requestTag: "rubric" },
        deps: {
          spawnProcess: () => {
            queueMicrotask(() => {
              child.stderr.emit("data", Buffer.from("failed because provider rejected request"));
              child.emit("exit", 2);
            });
            return child;
          },
        },
      }),
    (error: unknown) => {
      assert.ok(error instanceof OpencodeRunError);
      assert.match(error.message, /rubric/);
      assert.match(error.message, /provider rejected/);
      return true;
    },
  );
});

test("runOpencodePrompt reports event diagnostics when final text is missing", async () => {
  const runtimeDir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-runner-missing-text-"));
  const sandboxRoot = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-sandbox-missing-text-"));
  const child = createFakeChild();

  await assert.rejects(
    () =>
      runOpencodePrompt({
        runtime: runtimeConfig(runtimeDir),
        request: { prompt: "x", sandboxRoot, requestTag: "missing-text" },
        deps: {
          spawnProcess: () => {
            queueMicrotask(() => {
              child.stdout.emit(
                "data",
                Buffer.from('{"type":"step_finish","part":{"type":"step-finish"}}\n'),
              );
              child.emit("exit", 0);
            });
            return child;
          },
        },
      }),
    (error: unknown) => {
      assert.ok(error instanceof OpencodeRunError);
      assert.match(error.message, /缺少 assistant 最终文本/);
      assert.match(error.message, /stdoutBytes=/);
      assert.match(error.message, /eventTypes=step_finish/);
      assert.match(error.message, /stdoutTail=/);
      return true;
    },
  );
});

test("runOpencodePrompt kills the child when output exceeds the configured limit", async () => {
  const runtimeDir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-runner-output-"));
  const sandboxRoot = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-sandbox-output-"));
  const child = createFakeChild();

  await assert.rejects(
    () =>
      runOpencodePrompt({
        runtime: runtimeConfig(runtimeDir, { maxOutputBytes: 8 }),
        request: { prompt: "x", sandboxRoot, requestTag: "large-output" },
        deps: {
          spawnProcess: () => {
            queueMicrotask(() => child.stdout.emit("data", Buffer.from("0123456789")));
            return child;
          },
        },
      }),
    OpencodeRunError,
  );
  assert.equal(child.killedWith, "SIGTERM");
});

test("runOpencodePrompt kills the child on timeout", async () => {
  const runtimeDir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-runner-timeout-"));
  const sandboxRoot = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-sandbox-timeout-"));
  const child = createFakeChild();

  await assert.rejects(
    () =>
      runOpencodePrompt({
        runtime: runtimeConfig(runtimeDir, { timeoutMs: 1 }),
        request: { prompt: "x", sandboxRoot, requestTag: "timeout" },
        deps: {
          spawnProcess: () => child,
          setTimer: (callback) => {
            callback();
            return undefined;
          },
          clearTimer: () => undefined,
        },
      }),
    OpencodeRunError,
  );
  assert.equal(child.killedWith, "SIGTERM");
});
