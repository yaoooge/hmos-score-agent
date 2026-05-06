import fs from "node:fs/promises";
import path from "node:path";
import type {
  HumanReviewDatasetSample,
  HumanReviewDatasetType,
} from "./humanReviewTypes.js";

export type HumanReviewEvidenceStore = {
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

  return {
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
