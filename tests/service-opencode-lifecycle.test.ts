import assert from "node:assert/strict";
import test from "node:test";
import type { OpencodeRunnerPool } from "../src/agents/opencode/runnerPool.js";
import {
  setServiceOpencodeRunnerPoolForTesting,
  stopServiceOpencodeRunnerPool,
} from "../src/service/index.js";

test("service opencode runner pool shutdown stops and clears the shared pool", async () => {
  let stopCount = 0;
  const pool: OpencodeRunnerPool = {
    acquire: async () => {
      throw new Error("not used");
    },
    stopAll: async () => {
      stopCount += 1;
    },
  };

  setServiceOpencodeRunnerPoolForTesting(pool);

  await stopServiceOpencodeRunnerPool();
  await stopServiceOpencodeRunnerPool();

  assert.equal(stopCount, 1);
});
