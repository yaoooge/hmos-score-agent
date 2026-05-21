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
  assert.ok(taxonomy.entries.some((entry) => entry.code === "EVALUATION_METADATA_RISK"));
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
