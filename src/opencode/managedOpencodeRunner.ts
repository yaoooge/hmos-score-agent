import type { OpencodeRunRequest, OpencodeRunResult } from "./opencodeCliRunner.js";
import { runOpencodePrompt } from "./opencodeCliRunner.js";
import type { OpencodeRuntimeConfig } from "./opencodeConfig.js";
import type { OpencodeServeManager } from "./opencodeServeManager.js";

export type ManagedOpencodeRunner = {
  runPrompt(request: OpencodeRunRequest): Promise<OpencodeRunResult>;
};

type ManagedOpencodeRunnerInput = {
  runtime: OpencodeRuntimeConfig;
  serveManager: Pick<OpencodeServeManager, "start" | "restart">;
  runPrompt?: (input: {
    runtime: OpencodeRuntimeConfig;
    request: OpencodeRunRequest;
  }) => Promise<OpencodeRunResult>;
};

function isRecoverableOpencodeRuntimeError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    /session\s+not\s+found/i.test(message) ||
    /ECONNREFUSED|ECONNRESET|socket hang up|fetch failed/i.test(message) ||
    /opencode serve 提前退出|opencode serve 健康检查超时/.test(message)
  );
}

export function createManagedOpencodeRunner(input: ManagedOpencodeRunnerInput): ManagedOpencodeRunner {
  const runPrompt = input.runPrompt ?? runOpencodePrompt;
  return {
    async runPrompt(request: OpencodeRunRequest): Promise<OpencodeRunResult> {
      await input.serveManager.start();
      try {
        return await runPrompt({ runtime: input.runtime, request });
      } catch (error) {
        if (!isRecoverableOpencodeRuntimeError(error)) {
          throw error;
        }
        await input.serveManager.restart();
        return await runPrompt({ runtime: input.runtime, request });
      }
    },
  };
}
