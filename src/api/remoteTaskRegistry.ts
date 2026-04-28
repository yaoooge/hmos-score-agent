import fs from "node:fs/promises";
import path from "node:path";

export type RemoteTaskRecordStatus =
  | "preparing"
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "timed_out";

export type RemoteTaskRecord = {
  taskId: number;
  status: RemoteTaskRecordStatus;
  createdAt: number;
  updatedAt: number;
  caseDir?: string;
  token?: string;
  testCaseId?: number;
  error?: string;
};

export type RemoteTaskRecordPatch = {
  taskId: number;
  status: RemoteTaskRecordStatus;
  caseDir?: string;
  token?: string;
  testCaseId?: number;
  error?: string;
};

export type RemoteTaskRegistry = {
  get(taskId: number): Promise<RemoteTaskRecord | undefined>;
  upsert(patch: RemoteTaskRecordPatch): Promise<RemoteTaskRecord>;
};

function isRecord(value: unknown): value is RemoteTaskRecord {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { taskId?: unknown }).taskId === "number" &&
    typeof (value as { status?: unknown }).status === "string" &&
    typeof (value as { createdAt?: unknown }).createdAt === "number" &&
    typeof (value as { updatedAt?: unknown }).updatedAt === "number"
  );
}

export function createRemoteTaskRegistry(localCaseRoot: string): RemoteTaskRegistry {
  const indexPath = path.join(localCaseRoot, "remote-task-index.json");
  const records = new Map<number, RemoteTaskRecord>();
  let loaded = false;
  let operationChain: Promise<void> = Promise.resolve();

  async function load(): Promise<void> {
    if (loaded) {
      return;
    }
    loaded = true;
    try {
      const text = await fs.readFile(indexPath, "utf-8");
      const parsed = JSON.parse(text) as unknown;
      const items = Array.isArray(parsed)
        ? parsed
        : typeof parsed === "object" && parsed !== null && Array.isArray((parsed as { records?: unknown }).records)
          ? (parsed as { records: unknown[] }).records
          : [];
      for (const item of items) {
        if (isRecord(item)) {
          records.set(item.taskId, item);
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  }

  async function save(): Promise<void> {
    await fs.mkdir(localCaseRoot, { recursive: true });
    const tempPath = `${indexPath}.${String(process.pid)}.tmp`;
    const content = JSON.stringify(
      { records: [...records.values()].sort((left, right) => left.taskId - right.taskId) },
      null,
      2,
    );
    await fs.writeFile(tempPath, content, "utf-8");
    await fs.rename(tempPath, indexPath);
  }

  async function runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const run = operationChain.then(operation, operation);
    operationChain = run.then(
      () => undefined,
      () => undefined,
    );
    return await run;
  }

  return {
    async get(taskId: number): Promise<RemoteTaskRecord | undefined> {
      return await runExclusive(async () => {
        await load();
        return records.get(taskId);
      });
    },

    async upsert(patch: RemoteTaskRecordPatch): Promise<RemoteTaskRecord> {
      return await runExclusive(async () => {
        await load();
        const existing = records.get(patch.taskId);
        const now = Date.now();
        const record: RemoteTaskRecord = {
          taskId: patch.taskId,
          status: patch.status,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
          caseDir: patch.caseDir ?? existing?.caseDir,
          token: patch.token ?? existing?.token,
          testCaseId: patch.testCaseId ?? existing?.testCaseId,
          error: patch.error ?? existing?.error,
        };
        records.set(record.taskId, record);
        await save();
        return record;
      });
    },
  };
}
