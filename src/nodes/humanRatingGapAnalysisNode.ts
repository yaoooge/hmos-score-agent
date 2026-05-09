import {
  runOpencodePrompt,
  type OpencodeRunRequest,
  type OpencodeRunResult,
} from "../opencode/opencodeCliRunner.js";
import { createOpencodeRuntimeConfig, type OpencodeRuntimeConfig } from "../opencode/opencodeConfig.js";
import {
  createOpencodeServeManager,
  ensureOpencodeCliAvailable,
  type OpencodeServeManager,
} from "../opencode/opencodeServeManager.js";
import { runOpencodeHumanRatingGapAnalysis } from "../agent/opencodeHumanRatingGapAnalysis.js";
import type { HumanRatingGapAnalysis, HumanRatingRecord } from "../humanRating/humanRatingTypes.js";

export type HumanRatingGapAnalysisNodeInput = {
  caseDir: string;
  manualRatingRecord: HumanRatingRecord;
  resultJson: Record<string, unknown>;
};

export type HumanRatingGapAnalysisNodeDeps = {
  opencodeRuntime?: OpencodeRuntimeConfig;
  opencodeServeManager?: OpencodeServeManager;
  opencodeRunner?: {
    runPrompt(request: OpencodeRunRequest): Promise<OpencodeRunResult>;
  };
  logger?: {
    warn?(message: string): Promise<void> | void;
  };
};

async function createRuntimeDeps(
  deps: HumanRatingGapAnalysisNodeDeps,
): Promise<{
  runPrompt(request: OpencodeRunRequest): Promise<OpencodeRunResult>;
  cleanup(): Promise<void>;
}> {
  if (deps.opencodeRunner) {
    return {
      runPrompt: deps.opencodeRunner.runPrompt,
      cleanup: async () => undefined,
    };
  }

  const runtime = deps.opencodeRuntime ?? (await createOpencodeRuntimeConfig({ repoRoot: process.cwd() }));
  const serveManager = deps.opencodeServeManager ?? createOpencodeServeManager(runtime);
  await ensureOpencodeCliAvailable();
  await serveManager.start();
  return {
    runPrompt: (request) => runOpencodePrompt({ runtime, request }),
    cleanup: async () => {
      if (!deps.opencodeServeManager) {
        await serveManager.stop();
      }
    },
  };
}

export async function humanRatingGapAnalysisNode(
  input: HumanRatingGapAnalysisNodeInput,
  deps: HumanRatingGapAnalysisNodeDeps = {},
): Promise<HumanRatingGapAnalysis> {
  const runtimeDeps = await createRuntimeDeps(deps);
  try {
    const result = await runOpencodeHumanRatingGapAnalysis({
      sandboxRoot: input.caseDir,
      manualRatingRecord: input.manualRatingRecord,
      resultJson: input.resultJson,
      runPrompt: runtimeDeps.runPrompt,
      logger: deps.logger,
    });
    if (result.outcome !== "success" || !result.final_answer) {
      throw new Error(
        `human rating gap analysis failed outcome=${result.outcome} reason=${result.failure_reason ?? "unknown"}`,
      );
    }
    return result.final_answer;
  } finally {
    await runtimeDeps.cleanup();
  }
}
