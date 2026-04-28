export type ApiMethod = "GET" | "POST" | "OPTIONS";

export type ApiDefinition = {
  method: ApiMethod;
  path: string;
  description: string;
};

export const API_PATHS = {
  health: "/health",
  scoreRun: "/score/run",
  runRemoteTask: "/score/run-remote-task",
  remoteTaskResult: "/score/remote-tasks/:taskId/result",
} as const;

export const API_DEFINITIONS: ApiDefinition[] = [
  { method: "GET", path: API_PATHS.health, description: "Service health check." },
  { method: "POST", path: API_PATHS.scoreRun, description: "Run one local score case." },
  {
    method: "POST",
    path: API_PATHS.runRemoteTask,
    description: "Accept one remote evaluation task and execute it asynchronously.",
  },
  {
    method: "GET",
    path: API_PATHS.remoteTaskResult,
    description: "Read the completed remote task result JSON as resultData.",
  },
];
