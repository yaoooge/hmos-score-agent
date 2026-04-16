import path from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { pathToFileURL } from "node:url";
import { upsertEnvVars } from "../io/envFile.js";
import { resolveDefaultCasePath, runSingleCase } from "../service.js";

type LauncherAnswers = {
  baseURL: string;
  apiKey: string;
};

// 交互层只做最小归一化，方便测试，也避免把业务逻辑埋进 readline 里。
export function normalizeLauncherAnswers(answers: LauncherAnswers): LauncherAnswers {
  return {
    baseURL: answers.baseURL.trim(),
    apiKey: answers.apiKey.trim(),
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
      (await rl.question(`OpenAI baseURL [${process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1"}]: `)) ||
      process.env.OPENAI_BASE_URL ||
      "https://api.openai.com/v1";
    const rawApiKey =
      (await rl.question(`OpenAI apiKey${process.env.OPENAI_API_KEY ? " [Press Enter to keep current]" : ""}: `)) ||
      process.env.OPENAI_API_KEY ||
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
      OPENAI_BASE_URL: baseURL,
      OPENAI_API_KEY: apiKey,
    });

    process.env.OPENAI_BASE_URL = baseURL;
    process.env.OPENAI_API_KEY = apiKey;

    const casePath = parseLauncherArgs(argv);
    const result = await runSingleCase(casePath);
    // eslint-disable-next-line no-console
    console.log(`评分完成，结果目录：${result.caseDir}`);
    if (result.uploadMessage) {
      // eslint-disable-next-line no-console
      console.log(`上传信息：${result.uploadMessage}`);
    }
  } finally {
    rl.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runInteractiveScore().catch((error: unknown) => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exit(1);
  });
}
