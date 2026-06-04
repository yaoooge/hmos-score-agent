import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { OpencodeRuntimeConfig } from "../src/agents/opencode/config.js";
import { OpencodeRunError, runOpencodePrompt } from "../src/agents/opencode/cliRunner.js";

function runtimeConfig(
  runtimeDir: string,
  overrides: Partial<OpencodeRuntimeConfig> = {},
): OpencodeRuntimeConfig {
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

test("runOpencodePrompt invokes attached opencode run with the requested custom agent", async () => {
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
      agent: "hmos-rule-assessment",
    },
    deps: {
      spawnProcess: (command, args, options) => {
        spawned.push({ command, args, env: options.env });
        queueMicrotask(() => {
          child.stdout.emit(
            "data",
            Buffer.from('{"type":"text","part":{"type":"text","text":"{\\"ok\\":true}"}}\n'),
          );
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
  assert.equal(spawned[0]?.args.includes("--agent"), true);
  assert.equal(spawned[0]?.args[spawned[0]?.args.indexOf("--agent") + 1], "hmos-rule-assessment");
  assert.equal(spawned[0]?.env?.OPENCODE_CONFIG, path.join(runtimeDir, "opencode.generated.json"));
  const promptPath = path.join(sandboxRoot, "metadata", "opencode-prompts", "rule-assessment.md");
  assert.equal(await fs.readFile(promptPath, "utf-8"), "请评分");
  assert.match(spawned[0]?.args.at(-1) ?? "", /metadata\/opencode-prompts\/rule-assessment\.md/);
});

test("runOpencodePrompt continues an explicit session while preserving the retry request tag", async () => {
  const runtimeDir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-runner-session-"));
  const sandboxRoot = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-sandbox-session-"));
  const child = createFakeChild();
  const spawned: Array<{ args: string[] }> = [];

  const result = await runOpencodePrompt({
    runtime: runtimeConfig(runtimeDir),
    request: {
      prompt: "修复上一轮输出",
      sandboxRoot,
      requestTag: "rubric-scoring-retry-1",
      title: "rubric-scoring-retry-1",
      continueSessionId: "ses_existing123",
    },
    deps: {
      spawnProcess: (_command, args) => {
        spawned.push({ args });
        queueMicrotask(() => {
          child.stdout.emit(
            "data",
            Buffer.from(
              [
                '{"type":"session.updated","properties":{"info":{"id":"ses_existing123"}}}',
                '{"type":"text","part":{"type":"text","text":"{\\"ok\\":true}"}}',
              ].join("\n") + "\n",
            ),
          );
          child.emit("exit", 0);
        });
        return child;
      },
    },
  });

  const args = spawned[0]?.args ?? [];
  assert.equal(result.requestTag, "rubric-scoring-retry-1");
  assert.equal(result.sessionId, "ses_existing123");
  assert.equal(args.includes("--session"), true);
  assert.equal(args[args.indexOf("--session") + 1], "ses_existing123");
  assert.equal(args.includes("--title"), true);
  assert.equal(args[args.indexOf("--title") + 1], "rubric-scoring-retry-1");
});

test("runOpencodePrompt logs actual opencode invocation lifecycle", async () => {
  const runtimeDir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-runner-log-"));
  const sandboxRoot = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-sandbox-log-"));
  const child = createFakeChild();
  const messages: string[] = [];

  const result = await runOpencodePrompt({
    runtime: runtimeConfig(runtimeDir),
    request: {
      prompt: "请评分",
      sandboxRoot,
      requestTag: "rule-assessment",
      agent: "hmos-rule-assessment",
      outputFile: "metadata/agent-output/rule-assessment.json",
      logger: {
        info: (message) => {
          messages.push(message);
        },
      },
    },
    deps: {
      spawnProcess: () => {
        queueMicrotask(async () => {
          await fs.mkdir(path.join(sandboxRoot, "metadata", "agent-output"), { recursive: true });
          await fs.writeFile(
            path.join(sandboxRoot, "metadata", "agent-output", "rule-assessment.json"),
            '{"ok":true}\n',
            "utf-8",
          );
          child.stdout.emit(
            "data",
            Buffer.from(
              '{"type":"text","part":{"type":"text","text":"{\\"output_file\\":\\"metadata/agent-output/rule-assessment.json\\"}"}}\n',
            ),
          );
          child.emit("exit", 0);
        });
        return child;
      },
    },
  });

  assert.equal(result.rawText, '{"ok":true}\n');
  assert.match(
    messages[0] ?? "",
    /opencode 调用开始 request=rule-assessment agent=hmos-rule-assessment prompt=metadata\/opencode-prompts\/rule-assessment\.md outputFile=metadata\/agent-output\/rule-assessment\.json/,
  );
  assert.match(
    messages.at(-1) ?? "",
    /opencode 调用完成 request=rule-assessment elapsedMs=\d+ outputFile=metadata\/agent-output\/rule-assessment\.json/,
  );
});

test("runOpencodePrompt logs token usage when opencode emits token counts", async () => {
  const runtimeDir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-runner-token-"));
  const sandboxRoot = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-sandbox-token-"));
  const child = createFakeChild();
  const messages: string[] = [];

  const result = await runOpencodePrompt({
    runtime: runtimeConfig(runtimeDir),
    request: {
      prompt: "请评分",
      sandboxRoot,
      requestTag: "rule-assessment",
      agent: "hmos-rule-assessment",
      outputFile: "metadata/agent-output/rule-assessment.json",
      logger: {
        info: (message) => {
          messages.push(message);
        },
      },
    },
    deps: {
      spawnProcess: () => {
        queueMicrotask(async () => {
          await fs.mkdir(path.join(sandboxRoot, "metadata", "agent-output"), { recursive: true });
          await fs.writeFile(
            path.join(sandboxRoot, "metadata", "agent-output", "rule-assessment.json"),
            '{"ok":true}\n',
            "utf-8",
          );
          child.stdout.emit(
            "data",
            Buffer.from(
              [
                '{"type":"text","part":{"type":"text","text":"{\\"output_file\\":\\"metadata/agent-output/rule-assessment.json\\"}"}}',
                '{"type":"step_finish","part":{"type":"step-finish","cost":12.5,"tokens":{"input":10,"output":20,"reasoning":3,"cache":{"read":4,"write":5},"total":42}}}',
              ].join("\n") + "\n",
            ),
          );
          child.emit("exit", 0);
        });
        return child;
      },
    },
  });

  assert.deepEqual(result.tokenUsage, {
    total: 42,
    input: 10,
    output: 20,
    reasoning: 3,
    cacheRead: 4,
    cacheWrite: 5,
  });
  assert.match(
    messages.at(-1) ?? "",
    /opencode 调用完成 request=rule-assessment elapsedMs=\d+ tokens=42 inputTokens=10 outputTokens=20 reasoningTokens=3 cacheReadTokens=4 cacheWriteTokens=5 outputFile=metadata\/agent-output\/rule-assessment\.json/,
  );
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

test("runOpencodePrompt reads final JSON from requested output file", async () => {
  const runtimeDir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-runner-file-output-"));
  const sandboxRoot = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-sandbox-file-output-"));
  const child = createFakeChild();

  const result = await runOpencodePrompt({
    runtime: runtimeConfig(runtimeDir),
    request: {
      prompt: "请评分",
      sandboxRoot,
      requestTag: "rule-assessment",
      agent: "hmos-rule-assessment",
      outputFile: "metadata/agent-output/rule-assessment.json",
    },
    deps: {
      spawnProcess: () => {
        queueMicrotask(async () => {
          await fs.mkdir(path.join(sandboxRoot, "metadata", "agent-output"), { recursive: true });
          await fs.writeFile(
            path.join(sandboxRoot, "metadata", "agent-output", "rule-assessment.json"),
            '{"ok":true}\n',
            "utf-8",
          );
          child.stdout.emit(
            "data",
            Buffer.from(
              '{"type":"text","part":{"type":"text","text":"{\\"output_file\\":\\"metadata/agent-output/rule-assessment.json\\"}"}}\n',
            ),
          );
          child.emit("exit", 0);
        });
        return child;
      },
    },
  });

  assert.equal(result.rawText, '{"ok":true}\n');
  assert.equal(result.outputFile, "metadata/agent-output/rule-assessment.json");
  assert.equal(result.outputFileText, '{"ok":true}\n');
  assert.match(result.assistantText ?? "", /output_file/);
});

test("runOpencodePrompt rejects output files outside the agent output directory", async () => {
  const runtimeDir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-runner-bad-output-"));
  const sandboxRoot = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-sandbox-bad-output-"));

  await assert.rejects(
    () =>
      runOpencodePrompt({
        runtime: runtimeConfig(runtimeDir),
        request: {
          prompt: "x",
          sandboxRoot,
          requestTag: "bad-output",
          outputFile: "../result.json",
        },
        deps: { spawnProcess: () => createFakeChild() },
      }),
    (error: unknown) => {
      assert.ok(error instanceof OpencodeRunError);
      assert.match(error.message, /invalid agent output file/);
      return true;
    },
  );
});

test("runOpencodePrompt removes stale output file before invoking opencode", async () => {
  const runtimeDir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-runner-stale-output-"));
  const sandboxRoot = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-sandbox-stale-output-"));
  const outputPath = path.join(sandboxRoot, "metadata", "agent-output", "rule-assessment.json");
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, '{"stale":true}\n', "utf-8");
  const child = createFakeChild();

  await assert.rejects(
    () =>
      runOpencodePrompt({
        runtime: runtimeConfig(runtimeDir),
        request: {
          prompt: "x",
          sandboxRoot,
          requestTag: "missing-output",
          outputFile: "metadata/agent-output/rule-assessment.json",
        },
        deps: {
          spawnProcess: () => {
            queueMicrotask(() => {
              child.stdout.emit(
                "data",
                Buffer.from('{"type":"text","part":{"type":"text","text":"done"}}\n'),
              );
              child.emit("exit", 0);
            });
            return child;
          },
        },
      }),
    (error: unknown) => {
      assert.ok(error instanceof OpencodeRunError);
      assert.match(error.message, /opencode agent output file missing/);
      return true;
    },
  );
  await assert.rejects(() => fs.readFile(outputPath, "utf-8"), /ENOENT/);
});

test("runOpencodePrompt can preserve existing output file for retry repair", async () => {
  const runtimeDir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-runner-preserve-output-"));
  const sandboxRoot = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-sandbox-preserve-output-"));
  const outputPath = path.join(sandboxRoot, "metadata", "agent-output", "rule-assessment.json");
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, '{"existing":true}\n', "utf-8");
  const child = createFakeChild();

  const result = await runOpencodePrompt({
    runtime: runtimeConfig(runtimeDir),
    request: {
      prompt: "repair existing output",
      sandboxRoot,
      requestTag: "missing-output-retry",
      outputFile: "metadata/agent-output/rule-assessment.json",
      preserveOutputFileOnStart: true,
    },
    deps: {
      spawnProcess: () => {
        queueMicrotask(() => {
          child.stdout.emit(
            "data",
            Buffer.from('{"type":"text","part":{"type":"text","text":"done"}}\n'),
          );
          child.emit("exit", 0);
        });
        return child;
      },
    },
  });

  assert.equal(result.rawText, '{"existing":true}\n');
  assert.equal(await fs.readFile(outputPath, "utf-8"), '{"existing":true}\n');
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

test("runOpencodePrompt falls back to the output file when assistant text is missing", async () => {
  const runtimeDir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-runner-fallback-output-"));
  const sandboxRoot = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-sandbox-fallback-output-"));
  const child = createFakeChild();
  const outputPath = path.join(sandboxRoot, "metadata", "agent-output", "rule-assessment.json");

  const result = await runOpencodePrompt({
    runtime: runtimeConfig(runtimeDir),
    request: {
      prompt: "x",
      sandboxRoot,
      requestTag: "fallback-output",
      agent: "hmos-rule-assessment",
      outputFile: "metadata/agent-output/rule-assessment.json",
    },
    deps: {
      spawnProcess: () => {
        queueMicrotask(async () => {
          await fs.mkdir(path.dirname(outputPath), { recursive: true });
          await fs.writeFile(outputPath, '{"ok":true}\n', "utf-8");
          child.stdout.emit(
            "data",
            Buffer.from('{"type":"step_finish","part":{"type":"step-finish"}}\n'),
          );
          child.emit("exit", 0);
        });
        return child;
      },
    },
  });

  assert.equal(result.rawText, '{"ok":true}\n');
  assert.equal(result.outputFileText, '{"ok":true}\n');
  assert.equal(result.assistantText, undefined);
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
