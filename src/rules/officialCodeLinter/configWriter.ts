import fs from "node:fs/promises";
import path from "node:path";
import { officialCodeLinterRecommendedRuleSets } from "./recommendedRuleSets.js";

export interface OfficialCodeLinterConfig {
  files: string[];
  ignore: string[];
  ruleSet: string[];
}

export function buildOfficialCodeLinterConfig(): OfficialCodeLinterConfig {
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
    ruleSet: [...officialCodeLinterRecommendedRuleSets],
  };
}

export function serializeOfficialCodeLinterConfig(
  config: OfficialCodeLinterConfig = buildOfficialCodeLinterConfig(),
): string {
  return `${JSON.stringify(config, null, 2)}\n`;
}

export async function writeOfficialCodeLinterConfig(filePath: string): Promise<string> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, serializeOfficialCodeLinterConfig(), "utf-8");
  return filePath;
}

