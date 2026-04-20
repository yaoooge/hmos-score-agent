import { pathToFileURL } from "node:url";
import express, { Request, Response } from "express";
import { getConfig } from "./config.js";
import { resolveDefaultCasePath, runRemoteEvaluationTask, runSingleCase } from "./service.js";
import type { RemoteEvaluationTask } from "./types.js";

type AppDeps = {
  runSingleCase: typeof runSingleCase;
  runRemoteEvaluationTask: typeof runRemoteEvaluationTask;
};

export function createRunHandler(deps: AppDeps) {
  return async (req: Request, res: Response) => {
    try {
      const casePath = String(req.body?.casePath ?? resolveDefaultCasePath());
      const result = await deps.runSingleCase(casePath);
      res.json({ success: true, ...result });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error instanceof Error ? error.message : "未知错误",
      });
    }
  };
}

export function createRunRemoteTaskHandler(deps: AppDeps) {
  return async (req: Request, res: Response) => {
    try {
      const result = await deps.runRemoteEvaluationTask(req.body as RemoteEvaluationTask);
      res.json({ success: true, ...result });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error instanceof Error ? error.message : "未知错误",
      });
    }
  };
}

export function createApp(deps: {
  runSingleCase: typeof runSingleCase;
  runRemoteEvaluationTask: typeof runRemoteEvaluationTask;
} = {
  runSingleCase,
  runRemoteEvaluationTask,
}) {
  const app = express();
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.post("/score/run", createRunHandler(deps));
  app.post("/score/run-remote-task", createRunRemoteTaskHandler(deps));

  return app;
}

const isMainModule =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  const config = getConfig();
  const app = createApp();
  app.listen(config.port, () => {
    console.log(`hmos-score-agent API 已启动，监听端口：${config.port}`);
  });
}
