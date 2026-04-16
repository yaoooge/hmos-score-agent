import "dotenv/config";
import path from "node:path";

export interface AppConfig {
  port: number;
  localCaseRoot: string;
  referenceRoot: string;
  uploadEndpoint?: string;
  uploadToken?: string;
}

export function getConfig(): AppConfig {
  return {
    port: Number(process.env.PORT ?? 3000),
    localCaseRoot: path.resolve(process.cwd(), process.env.LOCAL_CASE_ROOT ?? ".local-cases"),
    referenceRoot:
      process.env.DEFAULT_REFERENCE_ROOT ??
      path.resolve(process.cwd(), "references/scoring"),
    uploadEndpoint: process.env.UPLOAD_ENDPOINT,
    uploadToken: process.env.UPLOAD_TOKEN,
  };
}
