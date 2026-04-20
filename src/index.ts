import express from "express";
import { getConfig } from "./config.js";
import { resolveDefaultCasePath, runSingleCase } from "./service.js";

const app = express();
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/score/run", async (req, res) => {
  try {
    const casePath = String(req.body?.casePath ?? resolveDefaultCasePath());
    const result = await runSingleCase(casePath);
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : "未知错误",
    });
  }
});

const config = getConfig();
app.listen(config.port, () => {
  console.log(`hmos-score-agent API 已启动，监听端口：${config.port}`);
});
