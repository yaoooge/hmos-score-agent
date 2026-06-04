import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadCaseFromPath } from "../src/commons/io/caseLoader.js";
import { loadCaseConstraintRules } from "../src/rules/case-constraints/loader.js";

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

test("loadCaseConstraintRules accepts top-level list constraints with kit and per-target llm checks", async (t) => {
  const rootDir = await makeTempDir(t);
  const caseDir = await writeCaseFixture(rootDir, {
    expectedConstraintsYaml: `
- id: EXP-MUST-01
  name: 必须通过FormExtensionAbility实现卡片生命周期管理
  priority: P0
  kit:
    - 'ArkUI: FormExtensionAbility'
  rules:
    - target: '**/entryformability/*.ets'
      llm: '检查是否存在继承自 FormExtensionAbility 的类，并实现生命周期方法'
    - target: '**/module.json5'
      llm: '检查 extensionAbilities 中是否声明 type 为 form 的扩展能力'
`,
  });
  const caseInput = await loadCaseFromPath(caseDir);

  const rules = await loadCaseConstraintRules(caseInput);

  assert.equal(rules.length, 1);
  assert.deepEqual(rules[0]?.detector_config.kit, ["ArkUI: FormExtensionAbility"]);
  assert.deepEqual(rules[0]?.detector_config.targetPatterns, [
    "**/entryformability/*.ets",
    "**/module.json5",
  ]);
  assert.deepEqual(rules[0]?.detector_config.targetChecks, [
    {
      target: "**/entryformability/*.ets",
      astSignals: [],
      llmPrompt: "检查是否存在继承自 FormExtensionAbility 的类，并实现生命周期方法",
    },
    {
      target: "**/module.json5",
      astSignals: [],
      llmPrompt: "检查 extensionAbilities 中是否声明 type 为 form 的扩展能力",
    },
  ]);
  assert.equal(
    rules[0]?.detector_config.llmPrompt,
    "**/entryformability/*.ets: 检查是否存在继承自 FormExtensionAbility 的类，并实现生命周期方法\n**/module.json5: 检查 extensionAbilities 中是否声明 type 为 form 的扩展能力",
  );
});

test("loadCaseConstraintRules ignores malformed kit instead of rejecting the constraint file", async (t) => {
  const rootDir = await makeTempDir(t);
  const caseDir = await writeCaseFixture(rootDir, {
    expectedConstraintsYaml: `constraints:
  - id: MALL-MUST-01
    name: 主导航必须采用四 Tab 结构
    priority: P0
    kit: 123
    rules:
      - target: '**/pages/MainPage.ets'
        llm: 检查底部导航栏是否使用 Tabs + TabContent 组件实现
`,
  });
  const caseInput = await loadCaseFromPath(caseDir);

  const rules = await loadCaseConstraintRules(caseInput);

  assert.equal(rules.length, 1);
  assert.equal(rules[0]?.detector_config.kit, undefined);
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

  await assert.rejects(() => loadCaseConstraintRules(caseInput), /unexpected_field/);
});
