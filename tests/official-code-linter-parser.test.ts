import assert from "node:assert/strict";
import test from "node:test";
import { parseOfficialCodeLinterOutput } from "../src/rules/officialCodeLinter/parser.js";

test("parseOfficialCodeLinterOutput parses ESLint-like JSON", () => {
  const parsed = parseOfficialCodeLinterOutput({
    stdout: JSON.stringify([
      {
        filePath: "/tmp/workspace/entry/src/main/ets/pages/Index.ets",
        messages: [
          {
            ruleId: "@performance/foreach-args-check",
            message: "Avoid unnecessary foreach argument.",
            severity: 2,
            line: 12,
            column: 4,
          },
        ],
      },
    ]),
    stderr: "",
  });

  assert.equal(parsed.status, "parsed");
  assert.equal(parsed.findings[0]?.rule_id, "@performance/foreach-args-check");
  assert.equal(parsed.findings[0]?.severity, "error");
  assert.equal(parsed.findings[0]?.source_rule_set, "plugin:@performance/recommended");
});

test("parseOfficialCodeLinterOutput parses Code Linter JSON after CLI banners", () => {
  const parsed = parseOfficialCodeLinterOutput({
    stdout: [
      "\u001b[32mThe configuration file code-linter.json5 is in use.\u001b[0m",
      "\u001b[33mCodeLinter found some defects in your code.\u001b[0m",
      JSON.stringify([
        {
          filePath: "/tmp/workspace/entry/src/main/ets/pages/Index.ets",
          messages: [
            {
              rule: "@hw-stylistic/max-len",
              message: "This line has a length of 128. Maximum allowed is 120.",
              severity: "warn",
              line: 12,
              column: 4,
            },
          ],
        },
      ]),
    ].join("\n"),
    stderr: "",
  });

  assert.equal(parsed.status, "parsed");
  assert.equal(parsed.findings[0]?.rule_id, "@hw-stylistic/max-len");
  assert.equal(parsed.findings[0]?.severity, "warn");
  assert.equal(parsed.findings[0]?.source_rule_set, "plugin:@hw-stylistic/recommended");
});


test("parseOfficialCodeLinterOutput parses common text output", () => {
  const parsed = parseOfficialCodeLinterOutput({
    stdout:
      "/tmp/workspace/entry/src/main/ets/pages/Index.ets:12:4 error Avoid unnecessary foreach argument @performance/foreach-args-check\n",
    stderr: "",
  });

  assert.equal(parsed.status, "parsed");
  assert.equal(parsed.findings[0]?.file, "/tmp/workspace/entry/src/main/ets/pages/Index.ets");
  assert.equal(parsed.findings[0]?.rule_id, "@performance/foreach-args-check");
  assert.equal(parsed.findings[0]?.message, "Avoid unnecessary foreach argument");
});

test("parseOfficialCodeLinterOutput reports unparsed output without fabricating findings", () => {
  const parsed = parseOfficialCodeLinterOutput({
    stdout: "Code Linter finished with an unexpected banner",
    stderr: "",
  });

  assert.equal(parsed.status, "unparsed");
  assert.deepEqual(parsed.findings, []);
});
