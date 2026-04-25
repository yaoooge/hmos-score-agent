import path from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { pathToFileURL } from "node:url";
import { upsertEnvVars } from "../io/envFile.js";
import { resolveDefaultCasePath, runSingleCase } from "../service.js";

type LauncherAnswers = {
  baseURL: string;
  apiKey: string;
  model: string;
};

// 交互层只做最小归一化，方便测试，也避免把业务逻辑埋进 readline 里。
export function normalizeLauncherAnswers(answers: LauncherAnswers): LauncherAnswers {
  return {
    baseURL: answers.baseURL.trim(),
    apiKey: answers.apiKey.trim(),
    model: answers.model.trim(),
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
    const rawModel =
      (await rl.question(`模型服务 model [${process.env.MODEL_PROVIDER_MODEL ?? "gpt-5.4"}]: `)) ||
      process.env.MODEL_PROVIDER_MODEL ||
      "gpt-5.4";
    const { baseURL, apiKey, model } = normalizeLauncherAnswers({
      baseURL: rawBaseURL,
      apiKey: rawApiKey,
      model: rawModel,
    });

    if (!baseURL || !apiKey || !model) {
      throw new Error("baseURL、apiKey 和 model 都不能为空。");
    }

    const envPath = path.resolve(process.cwd(), ".env");
    await upsertEnvVars(envPath, {
      MODEL_PROVIDER_BASE_URL: baseURL,
      MODEL_PROVIDER_API_KEY: apiKey,
      MODEL_PROVIDER_MODEL: model,
    });

    process.env.MODEL_PROVIDER_BASE_URL = baseURL;
    process.env.MODEL_PROVIDER_API_KEY = apiKey;
    process.env.MODEL_PROVIDER_MODEL = model;

    const casePath = parseLauncherArgs(argv);
    const result = await runSingleCase(casePath);
    console.log(`评分完成，结果目录：${result.caseDir}`);
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
