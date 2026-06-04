import assert from "node:assert/strict";
import test from "node:test";
import { mapOfficialCodeLinterFindings } from "../src/rules/official-linter/map/resultMapper.js";
import { sanitizeOfficialCodeLinterOutput } from "../src/rules/official-linter/parse/sanitizer.js";
import type { OfficialLinterFinding } from "../src/types.js";

const findings: OfficialLinterFinding[] = [
  {
    rule_id: "@security/no-http",
    message: "use https",
    severity: "error",
    file: "/tmp/workspace/entry/src/main/ets/pages/Changed.ets",
    line: 2,
    column: 1,
    source_rule_set: "plugin:@security/recommended",
  },
  {
    rule_id: "@security/no-http",
    message: "legacy issue",
    severity: "error",
    file: "/tmp/workspace/entry/src/main/ets/pages/Legacy.ets",
    line: 9,
    column: 1,
    source_rule_set: "plugin:@security/recommended",
  },
];

test("changed-file filtering drops unchanged findings before artifacts and rule results", () => {
  const mapped = mapOfficialCodeLinterFindings({
    findings,
    workspaceDir: "/tmp/workspace",
    hasPatch: true,
    changedFiles: ["entry/src/main/ets/pages/Changed.ets"],
  });

  assert.deepEqual(
    mapped.effectiveFindings.map((item) => item.file),
    ["entry/src/main/ets/pages/Changed.ets"],
  );
  assert.equal(mapped.ruleResults.length, 1);
  assert.equal(mapped.ruleResults[0]?.rule_id, "OFFICIAL-LINTER:@security/no-http");
  assert.equal(mapped.ruleResults[0]?.rule_source, "forbidden_pattern");
  assert.doesNotMatch(JSON.stringify(mapped), /Legacy\.ets|legacy issue|filtered/i);
});

test("patch line filtering drops same-file findings outside added patch lines", () => {
  const mapped = mapOfficialCodeLinterFindings({
    findings: [
      {
        rule_id: "@security/no-http",
        message: "new issue",
        severity: "error",
        file: "/tmp/workspace/entry/src/main/ets/pages/Changed.ets",
        line: 2,
        column: 1,
        source_rule_set: "plugin:@security/recommended",
      },
      {
        rule_id: "@security/no-http",
        message: "pre-existing issue",
        severity: "error",
        file: "/tmp/workspace/entry/src/main/ets/pages/Changed.ets",
        line: 9,
        column: 1,
        source_rule_set: "plugin:@security/recommended",
      },
    ],
    workspaceDir: "/tmp/workspace",
    hasPatch: true,
    changedFiles: ["entry/src/main/ets/pages/Changed.ets"],
    changedLineNumbersByFile: {
      "entry/src/main/ets/pages/Changed.ets": [2],
    },
  });

  assert.deepEqual(
    mapped.effectiveFindings.map((item) => `${item.file}:${item.line}:${item.message}`),
    ["entry/src/main/ets/pages/Changed.ets:2:new issue"],
  );
  assert.equal(mapped.ruleResults.length, 1);
  assert.match(mapped.ruleResults[0]?.conclusion ?? "", /:2:1/);
  assert.doesNotMatch(JSON.stringify(mapped), /pre-existing issue|:9:1/);
});

test("without reliable patch scope all official findings are effective", () => {
  const mapped = mapOfficialCodeLinterFindings({
    findings,
    workspaceDir: "/tmp/workspace",
    hasPatch: false,
    changedFiles: [],
  });

  assert.deepEqual(
    mapped.effectiveFindings.map((item) => item.file),
    ["entry/src/main/ets/pages/Changed.ets", "entry/src/main/ets/pages/Legacy.ets"],
  );
});

test("multiple findings for the same rule aggregate to one rule result", () => {
  const mapped = mapOfficialCodeLinterFindings({
    findings: [
      findings[0],
      {
        ...findings[0],
        line: 4,
        column: 2,
        message: "use https again",
      },
    ],
    workspaceDir: "/tmp/workspace",
    hasPatch: false,
    changedFiles: [],
  });

  assert.equal(mapped.effectiveFindings.length, 2);
  assert.equal(mapped.ruleResults.length, 1);
  assert.match(mapped.ruleResults[0]?.conclusion ?? "", /命中 2 处/);
});

test("aggregated official rule results preserve the highest linter severity", () => {
  const mapped = mapOfficialCodeLinterFindings({
    findings: [
      {
        rule_id: "@performance/foreach-args-check",
        message: "suggestion issue",
        severity: "suggestion",
        file: "/tmp/workspace/entry/src/main/ets/pages/Changed.ets",
        line: 2,
        column: 1,
        source_rule_set: "plugin:@performance/recommended",
      },
      {
        rule_id: "@performance/foreach-args-check",
        message: "warn issue",
        severity: "warn",
        file: "/tmp/workspace/entry/src/main/ets/pages/Changed.ets",
        line: 4,
        column: 1,
        source_rule_set: "plugin:@performance/recommended",
      },
    ],
    workspaceDir: "/tmp/workspace",
    hasPatch: false,
    changedFiles: [],
  });

  assert.equal(mapped.ruleResults[0]?.official_linter_severity, "warn");
});

test("sanitized diagnostics do not include finding detail lines or filtered counts", () => {
  const sanitized = sanitizeOfficialCodeLinterOutput({
    text: "/tmp/workspace/entry/src/main/ets/pages/Legacy.ets:9:1 error legacy issue @security/no-http\nfinished\n",
    effectiveFindingCount: 1,
    runStatus: "success",
  });

  assert.doesNotMatch(
    sanitized,
    /Legacy\.ets|legacy issue|@security\/no-http|filtered|dropped|unchanged/i,
  );
  assert.match(sanitized, /runStatus=success/);
  assert.match(sanitized, /effectiveFindingCount=1/);
});
