import assert from "node:assert/strict";
import test from "node:test";
import { parseConstraintSummary } from "../src/agents/normalization/taskUnderstanding.js";

function validSummary(overrides: Record<string, unknown> = {}) {
  return {
    explicitConstraints: ["目标: 适配手机和平板双端展示"],
    contextualConstraints: ["模块: entry"],
    implicitConstraints: ["修改范围: 页面布局"],
    classificationHints: ["full_generation", "multi_device_adaptation"],
    crossDeviceAdaptation: {
      applicability: "involved",
      confidence: "high",
      reasons: ["需求明确要求手机和平板布局适配"],
    },
    ...overrides,
  };
}

test("parseConstraintSummary accepts cross-device adaptation understanding", () => {
  const result = parseConstraintSummary(JSON.stringify(validSummary()));

  assert.deepEqual(result.crossDeviceAdaptation, {
    applicability: "involved",
    confidence: "high",
    reasons: ["需求明确要求手机和平板布局适配"],
  });
});

test("parseConstraintSummary rejects missing cross-device adaptation understanding", () => {
  const raw = validSummary();
  delete (raw as Record<string, unknown>).crossDeviceAdaptation;

  assert.throws(() => parseConstraintSummary(JSON.stringify(raw)), /crossDeviceAdaptation/);
});

test("parseConstraintSummary rejects uncertain cross-device applicability without low confidence", () => {
  assert.throws(
    () =>
      parseConstraintSummary(
        JSON.stringify(
          validSummary({
            crossDeviceAdaptation: {
              applicability: "uncertain",
              confidence: "medium",
              reasons: ["缺少设备形态适配证据"],
            },
          }),
        ),
      ),
    /uncertain/,
  );
});

test("parseConstraintSummary rejects empty cross-device reasons", () => {
  assert.throws(
    () =>
      parseConstraintSummary(
        JSON.stringify(
          validSummary({
            crossDeviceAdaptation: {
              applicability: "not_involved",
              confidence: "high",
              reasons: [],
            },
          }),
        ),
      ),
    /reasons/,
  );
});
