import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  OpencodeConfigError,
  createOpencodeRuntimeConfig,
} from "../src/opencode/opencodeConfig.js";

const requiredEnv = {
  HMOS_OPENCODE_PORT: "4096",
  HMOS_OPENCODE_HOST: "127.0.0.1",
  HMOS_OPENCODE_PROVIDER_ID: "bailian-coding-plan",
  HMOS_OPENCODE_MODEL_ID: "glm-5",
  HMOS_OPENCODE_MODEL_NAME: "GLM-5",
  HMOS_OPENCODE_BASE_URL: "https://coding.dashscope.aliyuncs.com/apps/anthropic/v1",
  HMOS_OPENCODE_API_KEY: "real-api-key",
  HMOS_OPENCODE_TIMEOUT_MS: "600000",
  HMOS_OPENCODE_MAX_OUTPUT_BYTES: "1048576",
};

async function copyOpencodeTemplate(repoRoot: string): Promise<void> {
  const sourceRoot = process.cwd();
  await fs.mkdir(path.join(repoRoot, ".opencode"), { recursive: true });
  await fs.copyFile(
    path.join(sourceRoot, ".opencode", "opencode.template.json"),
    path.join(repoRoot, ".opencode", "opencode.template.json"),
  );
  await fs.cp(
    path.join(sourceRoot, ".opencode", "prompts"),
    path.join(repoRoot, ".opencode", "prompts"),
    { recursive: true },
  );
  await fs.cp(
    path.join(sourceRoot, ".opencode", "formatters"),
    path.join(repoRoot, ".opencode", "formatters"),
    { recursive: true },
  );
}

test("createOpencodeRuntimeConfig reports missing required environment variables", async () => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-config-missing-"));
  await copyOpencodeTemplate(repoRoot);

  await assert.rejects(
    () =>
      createOpencodeRuntimeConfig({
        repoRoot,
        env: {
          ...requiredEnv,
          HMOS_OPENCODE_API_KEY: "",
        },
      }),
    (error: unknown) => {
      assert.ok(error instanceof OpencodeConfigError);
      assert.match(error.message, /HMOS_OPENCODE_API_KEY/);
      return true;
    },
  );
});

test("createOpencodeRuntimeConfig rejects placeholder opencode model settings", async () => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-config-placeholder-"));
  await copyOpencodeTemplate(repoRoot);

  await assert.rejects(
    () =>
      createOpencodeRuntimeConfig({
        repoRoot,
        env: {
          ...requiredEnv,
          HMOS_OPENCODE_MODEL_ID: "score-model",
        },
      }),
    (error: unknown) => {
      assert.ok(error instanceof OpencodeConfigError);
      assert.match(error.message, /HMOS_OPENCODE_MODEL_ID/);
      assert.match(error.message, /示例占位值/);
      return true;
    },
  );
});

test("createOpencodeRuntimeConfig writes generated config and isolated environment", async () => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-config-runtime-"));
  await copyOpencodeTemplate(repoRoot);

  const runtime = await createOpencodeRuntimeConfig({ repoRoot, env: requiredEnv });

  assert.equal(runtime.host, "127.0.0.1");
  assert.equal(runtime.port, 4096);
  assert.equal(runtime.serverUrl, "http://127.0.0.1:4096");
  assert.equal(runtime.timeoutMs, 600000);
  assert.equal(runtime.maxOutputBytes, 1048576);
  assert.equal(runtime.configDir, path.join(repoRoot, ".opencode"));
  assert.equal(runtime.configPath, path.join(repoRoot, ".opencode", "runtime", "opencode.generated.json"));

  const generatedText = await fs.readFile(runtime.configPath, "utf-8");
  assert.doesNotMatch(generatedText, /\$\{/);
  assert.doesNotMatch(generatedText, /default_agent/);
  assert.match(generatedText, /"agent"\s*:/);
  assert.match(generatedText, /"hmos-understanding"\s*:/);
  assert.match(generatedText, /"hmos-rubric-scoring"\s*:/);
  assert.match(generatedText, /"hmos-rule-assessment"\s*:/);

  const generated = JSON.parse(generatedText) as {
    model?: string;
    provider?: Record<string, { models?: Record<string, unknown>; options?: { apiKey?: string } }>;
  };
  assert.equal(generated.model, "bailian-coding-plan/glm-5");
  assert.ok(generated.provider?.["bailian-coding-plan"]);
  assert.equal(generated.provider?.["bailian-coding-plan"]?.npm, "@ai-sdk/anthropic");
  assert.ok(generated.provider?.["bailian-coding-plan"]?.models?.["glm-5"]);
  assert.equal(generated.provider?.["bailian-coding-plan"]?.options?.apiKey, "real-api-key");

  assert.equal(runtime.env.HOME, path.join(repoRoot, ".opencode", "runtime", "home"));
  assert.equal(
    runtime.env.XDG_CONFIG_HOME,
    path.join(repoRoot, ".opencode", "runtime", "xdg-config"),
  );
  assert.equal(
    runtime.env.XDG_STATE_HOME,
    path.join(repoRoot, ".opencode", "runtime", "xdg-state"),
  );
  assert.equal(
    runtime.env.XDG_DATA_HOME,
    path.join(repoRoot, ".opencode", "runtime", "xdg-data"),
  );
  assert.equal(
    runtime.env.XDG_CACHE_HOME,
    path.join(repoRoot, ".opencode", "runtime", "xdg-cache"),
  );
  const xdgConfigPath = path.join(
    repoRoot,
    ".opencode",
    "runtime",
    "xdg-config",
    "opencode",
    "opencode.json",
  );
  assert.equal(await fs.readFile(xdgConfigPath, "utf-8"), generatedText);

  assert.match(
    await fs.readFile(path.join(repoRoot, ".opencode", "runtime", "prompts", "hmos-understanding-system.md"), "utf-8"),
    /正确输出格式/,
  );
  assert.match(
    await fs.readFile(path.join(repoRoot, ".opencode", "runtime", "prompts", "hmos-rubric-scoring-system.md"), "utf-8"),
    /正确输出格式/,
  );
  assert.match(
    await fs.readFile(path.join(repoRoot, ".opencode", "runtime", "prompts", "hmos-rule-assessment-system.md"), "utf-8"),
    /正确输出格式/,
  );
  assert.match(
    await fs.readFile(
      path.join(
        repoRoot,
        ".opencode",
        "runtime",
        "xdg-config",
        "opencode",
        "prompts",
        "hmos-understanding-system.md",
      ),
      "utf-8",
    ),
    /正确输出格式/,
  );
  assert.match(
    await fs.readFile(
      path.join(
        repoRoot,
        ".opencode",
        "runtime",
        "xdg-config",
        "opencode",
        "prompts",
        "hmos-rubric-scoring-system.md",
      ),
      "utf-8",
    ),
    /正确输出格式/,
  );
  assert.match(
    await fs.readFile(
      path.join(
        repoRoot,
        ".opencode",
        "runtime",
        "xdg-config",
        "opencode",
        "prompts",
        "hmos-rule-assessment-system.md",
      ),
      "utf-8",
    ),
    /正确输出格式/,
  );

  assert.match(
    await fs.readFile(path.join(repoRoot, ".opencode", "runtime", "formatters", "format-json.mjs"), "utf-8"),
    /JSON\.parse/,
  );
  assert.match(
    await fs.readFile(
      path.join(
        repoRoot,
        ".opencode",
        "runtime",
        "xdg-config",
        "opencode",
        "formatters",
        "format-json.mjs",
      ),
      "utf-8",
    ),
    /JSON\.stringify/,
  );

  assert.equal(runtime.env.OPENCODE_CONFIG, runtime.configPath);
  assert.equal(runtime.env.OPENCODE_CONFIG_DIR, runtime.configDir);
});
