import fs from "node:fs/promises";
import path from "node:path";
import type {
  HumanReviewDatasetSample,
  HumanReviewDatasetType,
  HumanReviewStatus,
} from "./humanReviewTypes.js";

export type HumanReviewEvidenceStore = {
  writeStatus(status: HumanReviewStatus): Promise<string>;
  readStatus(reviewId: string): Promise<HumanReviewStatus | undefined>;
  appendDatasetSample(datasetType: HumanReviewDatasetType, sample: HumanReviewDatasetSample): Promise<string>;
};

const DATASET_FILE_NAMES: Record<HumanReviewDatasetType, string> = {
  item_review_calibration: "item_review_calibrations.jsonl",
  risk_review_calibration: "risk_review_calibrations.jsonl",
};

export function createHumanReviewEvidenceStore(root: string): HumanReviewEvidenceStore {
  let operationChain: Promise<void> = Promise.resolve();

  async function runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const run = operationChain.then(operation, operation);
    operationChain = run.then(
      () => undefined,
      () => undefined,
    );
    return await run;
  }

  async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.${String(process.pid)}.${String(Date.now())}.tmp`;
    await fs.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
    await fs.rename(tempPath, filePath);
  }

  return {
    async writeStatus(status: HumanReviewStatus): Promise<string> {
      return await runExclusive(async () => {
        const filePath = path.join(root, "status", `${status.reviewId}.json`);
        await writeJsonAtomic(filePath, status);
        return filePath;
      });
    },

    async readStatus(reviewId: string): Promise<HumanReviewStatus | undefined> {
      try {
        return JSON.parse(await fs.readFile(path.join(root, "status", `${reviewId}.json`), "utf-8")) as HumanReviewStatus;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          return undefined;
        }
        throw error;
      }
    },

    async appendDatasetSample(
      datasetType: HumanReviewDatasetType,
      sample: HumanReviewDatasetSample,
    ): Promise<string> {
      return await runExclusive(async () => {
        const filePath = path.join(root, "datasets", DATASET_FILE_NAMES[datasetType]);
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.appendFile(filePath, `${JSON.stringify(sample)}\n`, "utf-8");
        return filePath;
      });
    },
  };
}
