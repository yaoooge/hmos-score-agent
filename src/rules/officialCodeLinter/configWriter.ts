import fs from "node:fs/promises";
import path from "node:path";
import { resolveOfficialCodeLinterRecommendedRuleSets } from "./recommendedRuleSets.js";

export interface OfficialCodeLinterConfig {
  files: string[];
  ignore: string[];
  ruleSet: string[];
}

export function buildOfficialCodeLinterConfig(input?: { ruleSets?: string[] }): OfficialCodeLinterConfig {
  return {
    files: ["**/*.ets", "**/*.ts", "**/*.js", "**/*.json", "**/*.json5"],
    ignore: [
      "node_modules/**/*",
      "oh_modules/**/*",
      "build/**/*",
      ".preview/**/*",
      "src/ohosTest/**/*",
      "src/test/**/*",
      "hvigorfile.ts",
      "hvigorfile.js",
      "BuildProfile.ets",
    ],
    ruleSet: input?.ruleSets ?? resolveOfficialCodeLinterRecommendedRuleSets({}),
  };
}

export function serializeOfficialCodeLinterConfig(
  config: OfficialCodeLinterConfig = buildOfficialCodeLinterConfig(),
): string {
  return `${JSON.stringify(config, null, 2)}\n`;
}

export async function writeOfficialCodeLinterConfig(
  filePath: string,
  input?: { ruleSets?: string[] },
): Promise<string> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, serializeOfficialCodeLinterConfig(buildOfficialCodeLinterConfig(input)), "utf-8");
  return filePath;
}
