import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadCaseFromPath } from "../src/io/caseLoader.js";
import { loadCaseConstraintRules } from "../src/rules/caseConstraintLoader.js";

async function makeTempDir(t: test.TestContext): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "hmos-score-agent-case-rules-"));
  t.after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });
  return dir;
}

async function writeCaseFixture(
  rootDir: string,
  options: {
    caseId?: string;
    expectedConstraintsYaml?: string;
  } = {},
): Promise<string> {
  const caseDir = path.join(rootDir, options.caseId ?? "requirement_004");
  await fs.mkdir(path.join(caseDir, "original", "entry", "src", "main", "ets"), {
    recursive: true,
  });
  await fs.mkdir(path.join(caseDir, "workspace", "entry", "src", "main", "ets"), {
    recursive: true,
  });
  await fs.writeFile(path.join(caseDir, "input.txt"), "新增华为账号登录页", "utf-8");
  await fs.writeFile(
    path.join(caseDir, "original", "entry", "src", "main", "ets", "Index.ets"),
    "let count: number = 1;\n",
    "utf-8",
  );
  await fs.writeFile(
    path.join(caseDir, "workspace", "entry", "src", "main", "ets", "Index.ets"),
    "let count: number = 2;\n",
    "utf-8",
  );
  if (options.expectedConstraintsYaml) {
    await fs.writeFile(
      path.join(caseDir, "expected_constraints.yaml"),
      options.expectedConstraintsYaml,
      "utf-8",
    );
  }
  return caseDir;
}

const validConstraintsYaml = `constraints:
  - id: HM-REQ-008-01
    name: 必须使用 LoginWithHuaweiIDButton 实现华为账号一键登录
    description: 登录页必须使用 Account Kit 提供的 LoginWithHuaweiIDButton 组件作为一键登录入口，通过 loginComponentManager 管理登录流程，禁止自行封装普通 Button 模拟登录。
    priority: P0
    rules:
      - target: '**/pages/*.ets'
        ast:
          - type: import
            module: '@kit.AccountKit'
          - type: call
            name: LoginWithHuaweiIDButton
        llm: 检查是否从 @kit.AccountKit 导入并使用了 LoginWithHuaweiIDButton 组件
`;

test("loadCaseConstraintRules maps current YAML fields into runtime case rules", async (t) => {
  const rootDir = await makeTempDir(t);
  const caseDir = await writeCaseFixture(rootDir, {
    expectedConstraintsYaml: validConstraintsYaml,
  });
  const caseInput = await loadCaseFromPath(caseDir);

  const rules = await loadCaseConstraintRules(caseInput);

  assert.equal(rules.length, 1);
  assert.deepEqual(rules[0], {
    pack_id: "case-requirement_004",
    rule_id: "HM-REQ-008-01",
    rule_name: "必须使用 LoginWithHuaweiIDButton 实现华为账号一键登录",
    rule_source: "must_rule",
    summary:
      "登录页必须使用 Account Kit 提供的 LoginWithHuaweiIDButton 组件作为一键登录入口，通过 loginComponentManager 管理登录流程，禁止自行封装普通 Button 模拟登录。",
    priority: "P0",
    detector_kind: "case_constraint",
    detector_config: {
      targetPatterns: ["**/pages/*.ets"],
      astSignals: [
        { type: "import", module: "@kit.AccountKit" },
        { type: "call", name: "LoginWithHuaweiIDButton" },
      ],
      llmPrompt: "检查是否从 @kit.AccountKit 导入并使用了 LoginWithHuaweiIDButton 组件",
    },
    fallback_policy: "agent_assisted",
    is_case_rule: true,
  });
});

test("loadCaseConstraintRules rejects unsupported fields instead of ignoring them", async (t) => {
  const rootDir = await makeTempDir(t);
  const caseDir = await writeCaseFixture(rootDir, {
    expectedConstraintsYaml: `constraints:
  - id: HM-REQ-008-01
    name: 必须使用 LoginWithHuaweiIDButton 实现华为账号一键登录
    description: 登录页必须使用 Account Kit 提供的 LoginWithHuaweiIDButton 组件作为一键登录入口。
    priority: P0
    unexpected_field: should-fail
    rules:
      - target: '**/pages/*.ets'
        ast:
          - type: import
            module: '@kit.AccountKit'
        llm: 检查是否从 @kit.AccountKit 导入并使用了 LoginWithHuaweiIDButton 组件
`,
  });
  const caseInput = await loadCaseFromPath(caseDir);

  await assert.rejects(
    () => loadCaseConstraintRules(caseInput),
    /unexpected_field/,
  );
});
