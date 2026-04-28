import { pathToFileURL } from "node:url";
import { createApp } from "./api/app.js";
import { getConfig } from "./config.js";

export * from "./api/app.js";

const isMainModule =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  const config = getConfig();
  const app = createApp();
  app.listen(config.port, () => {
    console.log(`hmos-score-agent API 已启动，监听端口：${config.port}`);
  });
}
