import fs from "node:fs/promises";
import path from "node:path";
import type {
  ClassifiedHumanReviewEvidence,
  HumanReviewDatasetSample,
  HumanReviewDatasetType,
  HumanReviewRawRecord,
  HumanReviewStatus,
} from "./humanReviewTypes.js";

type HumanReviewIndex = {
  schemaVersion: 1;
  reviews: Array<{
    reviewId: string;
    taskId: number;
    rawPath?: string;
    updatedAt: string;
  }>;
  evidences: Array<{
    evidenceId: string;
    reviewId: string;
    taskId: number;
    polarity: string;
    category: string;
    path: string;
    updatedAt: string;
  }>;
};

export type HumanReviewEvidenceStore = {
  writeRawRecord(record: HumanReviewRawRecord): Promise<string>;
  writeStatus(status: HumanReviewStatus): Promise<string>;
  readStatus(reviewId: string): Promise<HumanReviewStatus | undefined>;
  writeClassifiedEvidence(evidence: ClassifiedHumanReviewEvidence): Promise<string>;
  appendDatasetSample(datasetType: HumanReviewDatasetType, sample: HumanReviewDatasetSample): Promise<string>;
};

const DATASET_FILE_NAMES: Record<HumanReviewDatasetType, string> = {
  sft_positive: "sft_positive.jsonl",
  preference_pair: "preference_pairs.jsonl",
  negative_diagnostic: "negative_diagnostics.jsonl",
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

  async function readIndex(): Promise<HumanReviewIndex> {
    try {
      const parsed = JSON.parse(await fs.readFile(path.join(root, "index.json"), "utf-8")) as Partial<HumanReviewIndex>;
      return {
        schemaVersion: 1,
        reviews: Array.isArray(parsed.reviews) ? parsed.reviews : [],
        evidences: Array.isArray(parsed.evidences) ? parsed.evidences : [],
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { schemaVersion: 1, reviews: [], evidences: [] };
      }
      throw error;
    }
  }

  async function writeIndex(index: HumanReviewIndex): Promise<void> {
    await writeJsonAtomic(path.join(root, "index.json"), index);
  }

  async function updateIndex(mutator: (index: HumanReviewIndex) => void): Promise<void> {
    const index = await readIndex();
    mutator(index);
    await writeIndex(index);
  }

  return {
    async writeRawRecord(record: HumanReviewRawRecord): Promise<string> {
      return await runExclusive(async () => {
        const day = record.receivedAt.slice(0, 10);
        const filePath = path.join(root, "raw", day, `task-${String(record.taskId)}-review-${record.reviewId}.json`);
        await writeJsonAtomic(filePath, record);
        await updateIndex((index) => {
          const relativePath = path.relative(root, filePath);
          const existing = index.reviews.find((item) => item.reviewId === record.reviewId);
          if (existing) {
            existing.taskId = record.taskId;
            existing.rawPath = relativePath;
            existing.updatedAt = record.receivedAt;
            return;
          }
          index.reviews.push({
            reviewId: record.reviewId,
            taskId: record.taskId,
            rawPath: relativePath,
            updatedAt: record.receivedAt,
          });
        });
        return filePath;
      });
    },

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

    async writeClassifiedEvidence(evidence: ClassifiedHumanReviewEvidence): Promise<string> {
      return await runExclusive(async () => {
        const filePath = path.join(
          root,
          "classified",
          evidence.polarity,
          evidence.category,
          `${evidence.evidenceId}.json`,
        );
        await writeJsonAtomic(filePath, evidence);
        await updateIndex((index) => {
          const relativePath = path.relative(root, filePath);
          const existing = index.evidences.find((item) => item.evidenceId === evidence.evidenceId);
          const item = {
            evidenceId: evidence.evidenceId,
            reviewId: evidence.reviewId,
            taskId: evidence.taskId,
            polarity: evidence.polarity,
            category: evidence.category,
            path: relativePath,
            updatedAt: new Date().toISOString(),
          };
          if (existing) {
            Object.assign(existing, item);
            return;
          }
          index.evidences.push(item);
        });
        return filePath;
      });
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
