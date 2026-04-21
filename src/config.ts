import "dotenv/config";
import path from "node:path";

export interface AppConfig {
  port: number;
  localCaseRoot: string;
  referenceRoot: string;
  modelProviderBaseUrl?: string;
  modelProviderApiKey?: string;
  modelProviderModel?: string;
}

export function getConfig(): AppConfig {
  return {
    port: Number(process.env.PORT ?? 3000),
    localCaseRoot: path.resolve(process.cwd(), process.env.LOCAL_CASE_ROOT ?? ".local-cases"),
    referenceRoot:
      process.env.DEFAULT_REFERENCE_ROOT ?? path.resolve(process.cwd(), "references/scoring"),
    modelProviderBaseUrl: process.env.MODEL_PROVIDER_BASE_URL,
    modelProviderApiKey: process.env.MODEL_PROVIDER_API_KEY,
    modelProviderModel: process.env.MODEL_PROVIDER_MODEL ?? "gpt-5.4",
  };
}
