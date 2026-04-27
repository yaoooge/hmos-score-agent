import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { setTimeout as sleepTimer } from "node:timers/promises";
import type { OpencodeRuntimeConfig } from "./opencodeConfig.js";

export class OpencodeServeError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "OpencodeServeError";
  }
}

export interface OpencodeServeManager {
  start(): Promise<void>;
  stop(): Promise<void>;
  health(): Promise<boolean>;
  serverUrl(): string;
}

type SpawnedProcess = Pick<ChildProcess, "stdout" | "stderr" | "on" | "kill">;

type ServeManagerDeps = {
  checkHealth?: (serverUrl: string) => Promise<boolean>;
  spawnProcess?: (
    command: string,
    args: string[],
    options: { env: NodeJS.ProcessEnv; stdio: ["ignore", "pipe", "pipe"] },
  ) => SpawnedProcess;
  sleep?: (ms: number) => Promise<void>;
};

export async function ensureOpencodeCliAvailable(deps: {
  commandExists?: () => Promise<boolean>;
} = {}): Promise<void> {
  const commandExists = deps.commandExists ?? defaultCommandExists;
  if (!(await commandExists())) {
    throw new OpencodeServeError("opencode CLI 不存在，请先安装 opencode 并确保它在 PATH 中");
  }
}

async function defaultCommandExists(): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn("opencode", ["--version"], {
      stdio: "ignore",
    });
    child.on("exit", (code) => resolve(code === 0));
    child.on("error", () => resolve(false));
  });
}

async function defaultCheckHealth(serverUrl: string): Promise<boolean> {
  try {
    const response = await fetch(`${serverUrl.replace(/\/$/, "")}/global/health`);
    if (!response.ok) {
      return false;
    }
    const data = (await response.json().catch(() => undefined)) as { healthy?: unknown } | undefined;
    return data?.healthy === true;
  } catch {
    return false;
  }
}

function streamSnippet(chunks: Buffer[]): string {
  return Buffer.concat(chunks).toString("utf-8").trim().slice(0, 1000);
}

function defaultSpawnProcess(
  command: string,
  args: string[],
  options: { env: NodeJS.ProcessEnv; stdio: ["ignore", "pipe", "pipe"] },
): SpawnedProcess {
  return spawn(command, args, options);
}

export function createOpencodeServeManager(
  config: OpencodeRuntimeConfig,
  deps: ServeManagerDeps = {},
): OpencodeServeManager {
  const checkHealth = deps.checkHealth ?? defaultCheckHealth;
  const spawnProcess = deps.spawnProcess ?? defaultSpawnProcess;
  const sleep = deps.sleep ?? sleepTimer;
  let child: SpawnedProcess | undefined;

  async function health(): Promise<boolean> {
    return checkHealth(config.serverUrl);
  }

  async function waitForHealthy(shouldStop: () => boolean = () => false): Promise<void> {
    const startedAt = Date.now();
    const timeoutMs = Math.min(config.timeoutMs, 30000);
    while (!shouldStop() && Date.now() - startedAt < timeoutMs) {
      if (await health()) {
        return;
      }
      await sleep(250);
    }
    if (shouldStop()) {
      return;
    }
    throw new OpencodeServeError(`opencode serve 健康检查超时：${config.serverUrl}`);
  }

  function buildServeFailureMessage(input: {
    code: number | null;
    signal: NodeJS.Signals | null;
    stdout: Buffer[];
    stderr: Buffer[];
  }): string {
    const stdout = streamSnippet(input.stdout);
    const stderr = streamSnippet(input.stderr);
    const details = [
      `serverUrl=${config.serverUrl}`,
      `exitCode=${String(input.code)}`,
      `signal=${String(input.signal)}`,
      stdout ? `stdout=${stdout}` : undefined,
      stderr ? `stderr=${stderr}` : undefined,
    ].filter((part): part is string => typeof part === "string");

    return `opencode serve 提前退出 ${details.join(" ")}`;
  }

  return {
    async start(): Promise<void> {
      if (child && (await health())) {
        return;
      }
      if (!child && (await health())) {
        throw new OpencodeServeError(
          `opencode serve 端口已被外部进程占用，无法保证使用工程级配置：${config.serverUrl}`,
        );
      }

      const args = [
        "serve",
        "--hostname",
        config.host,
        "--port",
        String(config.port),
        "--print-logs",
        "--log-level",
        "INFO",
      ];
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let childExited = false;

      child = spawnProcess(
        "opencode",
        args,
        { env: config.env, stdio: ["ignore", "pipe", "pipe"] },
      );

      child.stdout?.on("data", (chunk: Buffer) => stdout.push(chunk));
      child.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk));

      const childFailure = new Promise<never>((_, reject) => {
        child?.on("error", (error) => {
          reject(
            new OpencodeServeError(
              `opencode serve 启动失败 serverUrl=${config.serverUrl} command=opencode ${args.join(" ")}`,
              { cause: error },
            ),
          );
        });
        child?.on("exit", (code: number | null, signal: NodeJS.Signals | null) => {
          childExited = true;
          child = undefined;
          reject(new OpencodeServeError(buildServeFailureMessage({ code, signal, stdout, stderr })));
        });
      });
      childFailure.catch(() => undefined);

      await Promise.race([waitForHealthy(() => childExited), childFailure]);
    },

    async stop(): Promise<void> {
      if (child) {
        child.kill("SIGTERM");
        child = undefined;
      }
    },

    health,

    serverUrl(): string {
      return config.serverUrl;
    },
  };
}
