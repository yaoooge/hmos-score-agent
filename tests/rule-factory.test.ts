import assert from "node:assert/strict";
import test from "node:test";
import { createPendingRule, createTextRule } from "../src/rules/packs/shared/ruleFactories.js";

test("rule factories preserve the provided pack id", () => {
  const pending = createPendingRule(
    "arkts-performance",
    "should_rule",
    "ARKTS-PERF-SHOULD-001",
    "不变变量推荐使用 const 声明。",
  );
  const text = createTextRule(
    "arkts-performance",
    "forbidden_pattern",
    "ARKTS-PERF-FORBID-001",
    "禁止使用可选参数。",
    ["\\?:\\s*number"],
  );

  assert.equal(pending.pack_id, "arkts-performance");
  assert.equal(text.pack_id, "arkts-performance");
  assert.equal(text.detector_kind, "text_pattern");
  assert.deepEqual(text.detector_config, {
    fileExtensions: [".ets"],
    patterns: ["\\?:\\s*number"],
  });
});
