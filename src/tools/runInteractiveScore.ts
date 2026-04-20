import path from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { pathToFileURL } from "node:url";
import { upsertEnvVars } from "../io/envFile.js";
import { resolveDefaultCasePath, runRemoteTask, runSingleCase } from "../service.js";

export type LauncherExecutionMode = "local" | "remote";

type LauncherAnswers = {
  baseURL: string;
  apiKey: string;
};

type RemoteLauncherAnswers = {
  downloadUrl: string;
};

export function normalizeExecutionMode(rawMode: string): LauncherExecutionMode {
  const mode = rawMode.trim().toLowerCase();
  if (!mode) {
    return "local";
  }
  if (mode === "local" || mode === "remote") {
    return mode;
  }
  throw new Error("执行模式仅支持 local 或 remote。");
}

// 交互层只做最小归一化，方便测试，也避免把业务逻辑埋进 readline 里。
export function normalizeLauncherAnswers(answers: LauncherAnswers): LauncherAnswers {
  return {
    baseURL: answers.baseURL.trim(),
    apiKey: answers.apiKey.trim(),
  };
}

export function normalizeRemoteLauncherAnswers(
  answers: RemoteLauncherAnswers,
): RemoteLauncherAnswers {
  return {
    downloadUrl: answers.downloadUrl.trim(),
  };
}

// 解析 CLI 参数，允许通过 `--case` 复用任意输入目录。
export function parseLauncherArgs(argv: string[]): string {
  const caseFlagIndex = argv.findIndex((item) => item === "--case");
  if (caseFlagIndex >= 0 && argv[caseFlagIndex + 1]) {
    return path.resolve(process.cwd(), argv[caseFlagIndex + 1]);
  }
  return resolveDefaultCasePath();
}

export async function runInteractiveScore(argv: string[] = process.argv.slice(2)): Promise<void> {
  const rl = createInterface({ input, output });
  try {
    const executionMode = normalizeExecutionMode(
      await rl.question("执行模式 [local/remote] (default: local): "),
    );
    const rawBaseURL =
      (await rl.question(
        `模型服务 baseURL [${process.env.MODEL_PROVIDER_BASE_URL ?? "https://your-model-provider.example/v1"}]: `,
      )) ||
      process.env.MODEL_PROVIDER_BASE_URL ||
      "https://your-model-provider.example/v1";
    const rawApiKey =
      (await rl.question(
        `模型服务 apiKey${process.env.MODEL_PROVIDER_API_KEY ? " [Press Enter to keep current]" : ""}: `,
      )) ||
      process.env.MODEL_PROVIDER_API_KEY ||
      "";
    const { baseURL, apiKey } = normalizeLauncherAnswers({
      baseURL: rawBaseURL,
      apiKey: rawApiKey,
    });

    if (!baseURL || !apiKey) {
      throw new Error("baseURL 和 apiKey 都不能为空。");
    }

    const envPath = path.resolve(process.cwd(), ".env");
    await upsertEnvVars(envPath, {
      MODEL_PROVIDER_BASE_URL: baseURL,
      MODEL_PROVIDER_API_KEY: apiKey,
    });

    process.env.MODEL_PROVIDER_BASE_URL = baseURL;
    process.env.MODEL_PROVIDER_API_KEY = apiKey;

    if (executionMode === "remote") {
      const { downloadUrl } = normalizeRemoteLauncherAnswers({
        downloadUrl: await rl.question("下载任务 downloadUrl: "),
      });

      if (!downloadUrl) {
        throw new Error("downloadUrl 不能为空。");
      }

      const result = await runRemoteTask(downloadUrl);
      console.log(`评分完成，结果目录：${result.caseDir}`);
      console.log(`远程任务 ID：${result.taskId}`);
      if (result.uploadMessage) {
        console.log(`上传信息：${result.uploadMessage}`);
      }
      return;
    }

    const casePath = parseLauncherArgs(argv);
    const result = await runSingleCase(casePath);
    console.log(`评分完成，结果目录：${result.caseDir}`);
    if (result.uploadMessage) {
      console.log(`上传信息：${result.uploadMessage}`);
    }
  } finally {
    rl.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runInteractiveScore().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
