import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import type { OpencodeRuntimeConfig } from "./opencodeConfig.js";

export interface OpencodeRunRequest {
  prompt: string;
  sandboxRoot: string;
  requestTag: string;
  title?: string;
}

export interface OpencodeRunResult {
  requestTag: string;
  rawText: string;
  rawEvents: string;
  elapsedMs: number;
}

export class OpencodeRunError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "OpencodeRunError";
  }
}

type SpawnedProcess = Pick<ChildProcess, "stdout" | "stderr" | "on" | "kill">;

type RunnerDeps = {
  spawnProcess?: (
    command: string,
    args: string[],
    options: { env: NodeJS.ProcessEnv; stdio: ["ignore", "pipe", "pipe"] },
  ) => SpawnedProcess;
  setTimer?: (callback: () => void, ms: number) => NodeJS.Timeout | undefined;
  clearTimer?: (timer: NodeJS.Timeout | undefined) => void;
};

type RunInput = {
  runtime: OpencodeRuntimeConfig;
  request: OpencodeRunRequest;
  deps?: RunnerDeps;
};

function defaultSpawnProcess(
  command: string,
  args: string[],
  options: { env: NodeJS.ProcessEnv; stdio: ["ignore", "pipe", "pipe"] },
): SpawnedProcess {
  return spawn(command, args, options);
}

function safeFileName(value: string): string {
  return value.replace(/[^A-Za-z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "") || "opencode";
}

function stderrSnippet(stderr: Buffer[]): string {
  return Buffer.concat(stderr).toString("utf-8").slice(0, 1000);
}

function stdoutTail(rawEvents: string): string {
  return rawEvents.trim().slice(-1000);
}

function summarizeEventTypes(rawEvents: string): string {
  const types: string[] = [];
  for (const line of rawEvents.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }
    try {
      const event = JSON.parse(line) as unknown;
      if (!event || typeof event !== "object") {
        continue;
      }
      const type = (event as Record<string, unknown>).type;
      types.push(typeof type === "string" ? type : "unknown");
    } catch {
      types.push("unparseable");
    }
  }
  return types.slice(-20).join(",") || "none";
}

function extractAssistantText(rawEvents: string): string {
  const streamedTextParts: string[] = [];
  for (const line of rawEvents.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }
    let event: unknown;
    try {
      event = JSON.parse(line) as unknown;
    } catch {
      continue;
    }
    if (!event || typeof event !== "object") {
      continue;
    }
    const record = event as Record<string, unknown>;
    const part = record.part;
    if (part && typeof part === "object") {
      const partRecord = part as Record<string, unknown>;
      if (partRecord.type === "text" && typeof partRecord.text === "string") {
        streamedTextParts.push(partRecord.text);
        continue;
      }
    }
  }
  const text = streamedTextParts.join("");
  if (!text.trim()) {
    throw new OpencodeRunError(
      `opencode 输出中缺少 assistant 最终文本 stdoutBytes=${Buffer.byteLength(rawEvents, "utf-8")} eventTypes=${summarizeEventTypes(rawEvents)} stdoutTail=${stdoutTail(rawEvents)}`,
    );
  }
  return text;
}

export async function runOpencodePrompt(input: RunInput): Promise<OpencodeRunResult> {
  const startedAt = Date.now();
  const spawnProcess = input.deps?.spawnProcess ?? defaultSpawnProcess;
  const setTimer = input.deps?.setTimer ?? setTimeout;
  const clearTimer = input.deps?.clearTimer ?? clearTimeout;
  const promptDir = path.join(input.request.sandboxRoot, "metadata", "opencode-prompts");
  await fs.mkdir(promptDir, { recursive: true });
  const promptFileName = `${safeFileName(input.request.requestTag)}.md`;
  const promptPath = path.join(promptDir, promptFileName);
  const promptRelativePath = path.posix.join("metadata", "opencode-prompts", promptFileName);
  await fs.writeFile(promptPath, input.request.prompt, "utf-8");

  const args = [
    "run",
    "--attach",
    input.runtime.serverUrl,
    "--dir",
    input.request.sandboxRoot,
    "--format",
    "json",
    "--title",
    input.request.title ?? input.request.requestTag,
    `Read and follow the prompt file at ${promptRelativePath}. Return only the requested final JSON object.`,
  ];

  return new Promise<OpencodeRunResult>((resolve, reject) => {
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let settled = false;
    let child: SpawnedProcess;
    let timer: NodeJS.Timeout | undefined;

    function fail(error: Error): void {
      if (settled) {
        return;
      }
      settled = true;
      clearTimer(timer);
      reject(error);
    }

    function succeed(result: OpencodeRunResult): void {
      if (settled) {
        return;
      }
      settled = true;
      clearTimer(timer);
      resolve(result);
    }

    child = spawnProcess("opencode", args, { env: input.runtime.env, stdio: ["ignore", "pipe", "pipe"] });

    timer = setTimer(() => {
      child?.kill("SIGTERM");
      fail(new OpencodeRunError(`opencode 调用超时 request=${input.request.requestTag}`));
    }, input.runtime.timeoutMs);

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout.push(chunk);
      const bytes = stdout.reduce((sum, item) => sum + item.byteLength, 0);
      if (bytes > input.runtime.maxOutputBytes) {
        child.kill("SIGTERM");
        fail(
          new OpencodeRunError(
            `opencode 输出超过限制 request=${input.request.requestTag} maxOutputBytes=${input.runtime.maxOutputBytes}`,
          ),
        );
      }
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr.push(chunk);
    });
    child.on("error", (error: Error) => {
      fail(new OpencodeRunError(`opencode 进程启动失败 request=${input.request.requestTag}`, { cause: error }));
    });
    child.on("exit", (code: number | null) => {
      if (settled) {
        return;
      }
      if (code !== 0) {
        fail(
          new OpencodeRunError(
            `opencode 调用失败 request=${input.request.requestTag} exitCode=${code} stderr=${stderrSnippet(stderr)}`,
          ),
        );
        return;
      }

      const rawEvents = Buffer.concat(stdout).toString("utf-8");
      try {
        const rawText = extractAssistantText(rawEvents);
        succeed({
          requestTag: input.request.requestTag,
          rawText,
          rawEvents,
          elapsedMs: Date.now() - startedAt,
        });
      } catch (error) {
        fail(error instanceof Error ? error : new OpencodeRunError(String(error)));
      }
    });
  });
}
