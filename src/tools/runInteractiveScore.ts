import path from "node:path";
import { pathToFileURL } from "node:url";
import { resolveDefaultCasePath, runSingleCase } from "../service.js";

// 解析 CLI 参数，允许通过 `--case` 复用任意输入目录。
export function parseLauncherArgs(argv: string[]): string {
  const caseFlagIndex = argv.findIndex((item) => item === "--case");
  if (caseFlagIndex >= 0 && argv[caseFlagIndex + 1]) {
    return path.resolve(process.cwd(), argv[caseFlagIndex + 1]);
  }
  return resolveDefaultCasePath();
}

export async function runInteractiveScore(argv: string[] = process.argv.slice(2)): Promise<void> {
  const casePath = parseLauncherArgs(argv);
  const result = await runSingleCase(casePath);
  console.log(`评分完成，结果目录：${result.caseDir}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runInteractiveScore().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
