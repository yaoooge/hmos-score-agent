import fs from "node:fs/promises";
import path from "node:path";

export interface OpencodeRuntimeConfig {
  host: string;
  port: number;
  serverUrl: string;
  configPath: string;
  configDir: string;
  runtimeDir: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
  maxOutputBytes: number;
}

export class OpencodeConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpencodeConfigError";
  }
}

const REQUIRED_ENV_KEYS = [
  "HMOS_OPENCODE_PORT",
  "HMOS_OPENCODE_HOST",
  "HMOS_OPENCODE_PROVIDER_ID",
  "HMOS_OPENCODE_MODEL_ID",
  "HMOS_OPENCODE_MODEL_NAME",
  "HMOS_OPENCODE_BASE_URL",
  "HMOS_OPENCODE_API_KEY",
  "HMOS_OPENCODE_TIMEOUT_MS",
  "HMOS_OPENCODE_MAX_OUTPUT_BYTES",
] as const;

type RequiredEnvKey = (typeof REQUIRED_ENV_KEYS)[number];

function requiredEnv(env: NodeJS.ProcessEnv): Record<RequiredEnvKey, string> {
  const missing = REQUIRED_ENV_KEYS.filter((key) => !env[key]?.trim());
  if (missing.length > 0) {
    throw new OpencodeConfigError(`缺少 opencode 环境变量：${missing.join(", ")}`);
  }

  return Object.fromEntries(REQUIRED_ENV_KEYS.map((key) => [key, env[key]!.trim()])) as Record<
    RequiredEnvKey,
    string
  >;
}

function rejectPlaceholderValue(value: string, key: RequiredEnvKey): void {
  const placeholders: Partial<Record<RequiredEnvKey, Set<string>>> = {
    HMOS_OPENCODE_MODEL_ID: new Set(["score-model", "replace_me", "your-model-id"]),
    HMOS_OPENCODE_MODEL_NAME: new Set(["Score Model", "replace_me", "your-model-name"]),
    HMOS_OPENCODE_BASE_URL: new Set(["https://example.test/v1", "replace_me"]),
    HMOS_OPENCODE_API_KEY: new Set(["replace_me", "your-api-key", "sk-test", "test-key"]),
  };
  if (placeholders[key]?.has(value)) {
    throw new OpencodeConfigError(`${key} 仍是示例占位值，请在 .env 中配置真实 opencode 模型服务参数`);
  }
}

function parsePositiveInteger(value: string, key: RequiredEnvKey): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new OpencodeConfigError(`${key} 必须是正整数`);
  }
  return parsed;
}

function replaceTemplateVariables(
  template: string,
  values: Record<RequiredEnvKey, string>,
): string {
  return template.replace(/\$\{([A-Z0-9_]+)\}/g, (match, key: string) => {
    if (!Object.prototype.hasOwnProperty.call(values, key)) {
      throw new OpencodeConfigError(`opencode 配置模板包含未知占位符：${match}`);
    }
    return values[key as RequiredEnvKey];
  });
}

async function ensureRuntimeDirectories(runtimeDir: string): Promise<void> {
  await Promise.all(
    [
      runtimeDir,
      path.join(runtimeDir, "home"),
      path.join(runtimeDir, "xdg-config"),
      path.join(runtimeDir, "xdg-config", "opencode"),
      path.join(runtimeDir, "xdg-state"),
      path.join(runtimeDir, "xdg-data"),
      path.join(runtimeDir, "xdg-cache"),
      path.join(runtimeDir, "prompts"),
    ].map((dirPath) => fs.mkdir(dirPath, { recursive: true })),
  );
}

async function copyPromptFiles(input: { sourceDir: string; targetDir: string }): Promise<void> {
  await fs.mkdir(input.targetDir, { recursive: true });
  const entries = await fs.readdir(input.sourceDir, { withFileTypes: true }).catch((error: unknown) => {
    throw new OpencodeConfigError(
      `无法读取 opencode system prompt 目录：${error instanceof Error ? error.message : String(error)}`,
    );
  });

  await Promise.all(
    entries
      .filter((entry) => entry.isFile())
      .map(async (entry) => {
        const sourcePath = path.join(input.sourceDir, entry.name);
        const targetPath = path.join(input.targetDir, entry.name);
        await fs.copyFile(sourcePath, targetPath);
      }),
  );
}

export async function createOpencodeRuntimeConfig(input: {
  repoRoot: string;
  env?: NodeJS.ProcessEnv;
}): Promise<OpencodeRuntimeConfig> {
  const env = input.env ?? process.env;
  const values = requiredEnv(env);
  for (const key of REQUIRED_ENV_KEYS) {
    rejectPlaceholderValue(values[key], key);
  }
  const port = parsePositiveInteger(values.HMOS_OPENCODE_PORT, "HMOS_OPENCODE_PORT");
  const timeoutMs = parsePositiveInteger(
    values.HMOS_OPENCODE_TIMEOUT_MS,
    "HMOS_OPENCODE_TIMEOUT_MS",
  );
  const maxOutputBytes = parsePositiveInteger(
    values.HMOS_OPENCODE_MAX_OUTPUT_BYTES,
    "HMOS_OPENCODE_MAX_OUTPUT_BYTES",
  );

  const repoRoot = path.resolve(input.repoRoot);
  const configDir = path.join(repoRoot, ".opencode");
  const runtimeDir = path.join(configDir, "runtime");
  const configPath = path.join(runtimeDir, "opencode.generated.json");
  const templatePath = path.join(configDir, "opencode.template.json");
  const promptsDir = path.join(configDir, "prompts");

  const template = await fs.readFile(templatePath, "utf-8").catch((error: unknown) => {
    throw new OpencodeConfigError(
      `无法读取 opencode 配置模板：${error instanceof Error ? error.message : String(error)}`,
    );
  });
  const generatedText = replaceTemplateVariables(template, values);

  try {
    JSON.parse(generatedText) as unknown;
  } catch (error) {
    throw new OpencodeConfigError(
      `生成的 opencode 配置不是合法 JSON：${error instanceof Error ? error.message : String(error)}`,
    );
  }

  await ensureRuntimeDirectories(runtimeDir);
  await copyPromptFiles({
    sourceDir: promptsDir,
    targetDir: path.join(runtimeDir, "prompts"),
  });
  await copyPromptFiles({
    sourceDir: promptsDir,
    targetDir: path.join(runtimeDir, "xdg-config", "opencode", "prompts"),
  });
  const generatedConfigText = `${generatedText.trim()}\n`;
  await fs.writeFile(configPath, generatedConfigText, "utf-8");
  await fs.writeFile(
    path.join(runtimeDir, "xdg-config", "opencode", "opencode.json"),
    generatedConfigText,
    "utf-8",
  );

  const isolatedEnv: NodeJS.ProcessEnv = {
    ...process.env,
    ...env,
    HOME: path.join(runtimeDir, "home"),
    XDG_CONFIG_HOME: path.join(runtimeDir, "xdg-config"),
    XDG_STATE_HOME: path.join(runtimeDir, "xdg-state"),
    XDG_DATA_HOME: path.join(runtimeDir, "xdg-data"),
    XDG_CACHE_HOME: path.join(runtimeDir, "xdg-cache"),
    OPENCODE_CONFIG: configPath,
    OPENCODE_CONFIG_DIR: configDir,
  };

  return {
    host: values.HMOS_OPENCODE_HOST,
    port,
    serverUrl: `http://${values.HMOS_OPENCODE_HOST}:${port}`,
    configPath,
    configDir,
    runtimeDir,
    env: isolatedEnv,
    timeoutMs,
    maxOutputBytes,
  };
}
