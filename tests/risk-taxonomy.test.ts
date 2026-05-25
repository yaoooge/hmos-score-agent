import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { loadRiskTaxonomy, normalizeRiskItem } from "../src/scoring/riskTaxonomy.js";

test("loads engineering oriented risk taxonomy entries", () => {
  const taxonomy = loadRiskTaxonomy(path.resolve(process.cwd(), "references/risks/risk-taxonomy.yaml"));

  assert.ok(taxonomy.entries.some((entry) => entry.code === "REQUIREMENT_NOT_IMPLEMENTED"));
  assert.ok(taxonomy.entries.some((entry) => entry.code === "LANGUAGE_CONSTRAINT_VIOLATION"));
  assert.ok(taxonomy.entries.some((entry) => entry.code === "BUILD_OR_RESOURCE_ISSUE"));
  assert.ok(taxonomy.entries.some((entry) => entry.code === "DATA_STATE_CONSISTENCY_RISK"));
  assert.ok(taxonomy.entries.some((entry) => entry.code === "ERROR_HANDLING_OR_VALIDATION_RISK"));
  assert.ok(taxonomy.entries.some((entry) => entry.code === "SECURITY_OR_PRIVACY_RISK"));
  assert.ok(taxonomy.entries.some((entry) => entry.code === "EXTERNAL_SERVICE_INTEGRATION_RISK"));
  assert.ok(taxonomy.reviewOnlyEntries.some((entry) => entry.code === "EVALUATION_METADATA_RISK"));
});

test("normalizes known risk codes to stable taxonomy titles and levels", () => {
  const taxonomy = loadRiskTaxonomy(path.resolve(process.cwd(), "references/risks/risk-taxonomy.yaml"));
  const risk = normalizeRiskItem(
    {
      id: 1,
      level: "low",
      title: "随意生成的标题",
      description: "关键需求没有实现。",
      evidence: "EntryAbility.ets",
      risk_code: "REQUIREMENT_NOT_IMPLEMENTED",
    } as never,
    taxonomy,
  );

  assert.equal(risk.level, "high");
  assert.equal(risk.title, "需求未实现");
});


test("loads split score and review-only taxonomy with one primary item per score entry", () => {
  const taxonomy = loadRiskTaxonomy(path.resolve(process.cwd(), "references/risks/risk-taxonomy.yaml"));

  assert.ok(
    taxonomy.scoreEntries.some((entry) => entry.code === "REQUIREMENT_NOT_IMPLEMENTED"),
  );
  assert.ok(
    taxonomy.reviewOnlyEntries.some((entry) => entry.code === "EVALUATION_METADATA_RISK"),
  );
  assert.equal(
    taxonomy.entries.some((entry) => entry.code === "EVALUATION_METADATA_RISK"),
    false,
  );

  for (const entry of taxonomy.scoreEntries) {
    assert.ok(entry.primaryItem, `${entry.code} should have a primary rubric item`);
    assert.equal(typeof entry.primaryItem.dimension, "string");
    assert.equal(typeof entry.primaryItem.item, "string");
    assert.notEqual(entry.primaryItem.dimension.trim(), "");
    assert.notEqual(entry.primaryItem.item.trim(), "");
  }
});

test("risk taxonomy covers production risk review gap vocabulary without new first-level codes", () => {
  const taxonomy = loadRiskTaxonomy(path.resolve(process.cwd(), "references/risks/risk-taxonomy.yaml"));
  const codes = taxonomy.scoreEntries.map((entry) => entry.code);

  assert.equal(codes.includes("FOLDABLE_ADAPTATION_RISK"), false);
  assert.equal(codes.includes("WEB_NATIVE_ADAPTATION_RISK"), false);
  assert.equal(codes.includes("INTERACTION_FLOW_RISK"), false);
  assert.equal(codes.includes("MALL_RISK"), false);
  assert.equal(codes.includes("MEDICAL_RISK"), false);

  const byCode = new Map(taxonomy.scoreEntries.map((entry) => [entry.code, entry]));
  const api = byCode.get("API_USAGE_DEVIATION");
  const layout = byCode.get("UI_LAYOUT_OR_BREAKPOINT_MISMATCH");
  const state = byCode.get("DATA_STATE_CONSISTENCY_RISK");
  const partial = byCode.get("REQUIREMENT_PARTIALLY_IMPLEMENTED");
  const errors = byCode.get("ERROR_HANDLING_OR_VALIDATION_RISK");
  const maintainability = byCode.get("READABILITY_OR_MAINTAINABILITY_RISK");

  assert.ok(api);
  assert.match(api.description, /真实 import/);
  assert.ok(api.matchHints.includes("指定 Kit"));
  assert.ok(api.matchHints.includes("本地同名函数"));
  assert.ok(api.matchHints.includes("HTTP endpoint"));

  assert.ok(layout);
  assert.match(layout.description, /折叠屏/);
  assert.match(layout.description, /Web\/Native 断点同步/);
  assert.ok(layout.matchHints.includes("浅层窗口"));
  assert.ok(layout.matchHints.includes("折痕区域"));
  assert.ok(layout.matchHints.includes("CSS media query"));

  assert.ok(state);
  assert.ok(state.matchHints.includes("导航栈"));
  assert.ok(state.matchHints.includes("popup 状态"));

  assert.ok(partial);
  assert.ok(partial.matchHints.includes("交互链路不完整"));
  assert.ok(partial.matchHints.includes("无响应按钮"));

  assert.ok(errors);
  assert.ok(errors.matchHints.includes("静默吞没"));
  assert.ok(errors.matchHints.includes("仅 return 拦截"));

  assert.ok(maintainability);
  assert.ok(maintainability.matchHints.includes("死代码"));
  assert.ok(maintainability.matchHints.includes("技术栈混用"));
});
