import type { TaskResultResponse } from "./dashboard";

export type SubmitRemoteScoreTaskResponse = {
  success: true;
  taskId: number;
  message: string;
};

export type RemoteScoreResultResponse = TaskResultResponse;

export type RemoteTaskRegistryStatus =
  | "preparing"
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "timed_out"
  | "missing";

export type RemoteTaskStatusItem = {
  taskId: number;
  status: RemoteTaskRegistryStatus;
  createdAt?: number;
  updatedAt?: number;
  testCaseId?: number;
  testCaseName?: string;
  resultAvailable: boolean;
  error?: string;
  message?: string;
};

export type RemoteTaskStatusesResponse = {
  success: true;
  items: RemoteTaskStatusItem[];
};

export type ConsistencyTaskPersistedRecord = {
  id: string;
  sequence: number;
  [key: string]: unknown;
};

export type ConsistencyTaskCollectionResponse = {
  success: true;
  items: ConsistencyTaskPersistedRecord[];
};

export type ConsistencyTaskUpsertResponse = {
  success: true;
  item: ConsistencyTaskPersistedRecord;
};

export function normalizeServiceBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, "");
}

async function readErrorMessage(response: Response): Promise<string> {
  const text = await response.text();
  return text || `${response.status} ${response.statusText}`;
}

export async function submitRemoteScoreTask(
  baseUrl: string,
  payload: unknown,
): Promise<SubmitRemoteScoreTaskResponse> {
  const response = await fetch(`${normalizeServiceBaseUrl(baseUrl)}/score/run-remote-task`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
  return (await response.json()) as SubmitRemoteScoreTaskResponse;
}

export async function fetchRemoteScoreResult(
  baseUrl: string,
  taskId: number,
): Promise<RemoteScoreResultResponse> {
  const response = await fetch(
    `${normalizeServiceBaseUrl(baseUrl)}/score/remote-tasks/${String(taskId)}/result`,
  );
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
  return (await response.json()) as RemoteScoreResultResponse;
}

export async function fetchRemoteTaskStatuses(
  baseUrl: string,
  taskIds: number[],
): Promise<RemoteTaskStatusesResponse> {
  const params = new URLSearchParams({
    taskIds: taskIds.map(String).join(","),
  });
  const response = await fetch(
    `${normalizeServiceBaseUrl(baseUrl)}/score/remote-tasks/status?${params.toString()}`,
  );
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
  return (await response.json()) as RemoteTaskStatusesResponse;
}

export async function deleteRemoteTasks(taskIds: number[]): Promise<{ success: true; deletedTaskIds: number[] }> {
  const params = new URLSearchParams({
    taskIds: taskIds.map(String).join(","),
  });
  const response = await fetch(`/score/remote-tasks?${params.toString()}`, {
    method: "DELETE",
  });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
  return (await response.json()) as { success: true; deletedTaskIds: number[] };
}

export async function fetchConsistencyTasks(): Promise<ConsistencyTaskCollectionResponse> {
  const response = await fetch("/score/consistency-tasks");
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
  return (await response.json()) as ConsistencyTaskCollectionResponse;
}

export async function saveConsistencyTasks(
  items: unknown[],
): Promise<ConsistencyTaskCollectionResponse> {
  const response = await fetch("/score/consistency-tasks", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ items }),
  });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
  return (await response.json()) as ConsistencyTaskCollectionResponse;
}

export async function saveConsistencyTask(
  taskId: string,
  item: unknown,
): Promise<ConsistencyTaskUpsertResponse> {
  const response = await fetch(`/score/consistency-tasks/${encodeURIComponent(taskId)}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(item),
  });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
  return (await response.json()) as ConsistencyTaskUpsertResponse;
}

export async function deleteConsistencyTask(taskId: string): Promise<{ success: true }> {
  const response = await fetch(`/score/consistency-tasks/${encodeURIComponent(taskId)}`, {
    method: "DELETE",
  });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
  return (await response.json()) as { success: true };
}
