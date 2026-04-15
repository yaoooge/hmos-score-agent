import express from "express";
import { getConfig } from "./config.js";
import { runSingleCase } from "./service.js";

const app = express();
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/score/run", async (req, res) => {
  try {
    const casePath = String(req.body?.casePath ?? "init-input");
    const result = await runSingleCase(casePath);
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

const config = getConfig();
app.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(`hmos-score-agent api listening on :${config.port}`);
});
