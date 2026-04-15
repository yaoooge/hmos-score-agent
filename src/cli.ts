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
  // eslint-disable-next-line no-console
  console.log(`Scoring completed. Case artifacts: ${result.caseDir}`);
  if (result.uploadMessage) {
    // eslint-disable-next-line no-console
    console.log(`Upload: ${result.uploadMessage}`);
  }
}

main().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
