import { resolveDefaultCasePath, runSingleCase } from "./service.js";

function parseCaseArg(argv: string[]): string {
  const idx = argv.findIndex((a) => a === "--case");
  if (idx >= 0 && argv[idx + 1]) {
    return argv[idx + 1];
  }
  return resolveDefaultCasePath();
}

async function main(): Promise<void> {
  const casePath = parseCaseArg(process.argv.slice(2));
  const result = await runSingleCase(casePath);

  console.log(`评分完成，结果目录：${result.caseDir}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
