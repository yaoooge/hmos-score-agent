import assert from "node:assert/strict";
import test from "node:test";
import { buildArktsLightScanIndexFromArkFacts } from "../src/rules/evaluators/arkts/astFacts.js";
import { runArktsStaticRule } from "../src/rules/evaluators/arkts/staticEvaluator.js";
import type { ArkFactsIndex } from "../src/rules/arkfacts/index.js";
import type { CollectedEvidence } from "../src/rules/evidence/types.js";
import type { RegisteredRule } from "../src/rules/types/ruleTypes.js";

const facts: ArkFactsIndex = {
  files: [{ relativePath: "entry/src/main/ets/model/User.ets", hasViewTree: false }],
  declarations: [
    {
      id: "User",
      name: "User",
      filePath: "entry/src/main/ets/model/User.ets",
      kind: "class",
      line: 1,
      extendsNames: ["BaseUser"],
      implementsNames: ["UserLike"],
      fields: [
        {
          name: "id",
          line: 2,
          typeText: "number",
          accessModifier: "private",
        },
        {
          name: "name",
          line: 3,
          typeText: "string",
        },
      ],
    },
    {
      id: "UserKind",
      name: "UserKind",
      filePath: "entry/src/main/ets/model/User.ets",
      kind: "enum",
      line: 8,
      extendsNames: [],
      implementsNames: [],
      fields: [],
      enumMembers: [
        { name: "ADMIN", line: 9, initializer: { kind: "literal", value: 1 } },
        { name: "GUEST", line: 10, initializer: { kind: "literal", value: "guest" } },
      ],
    },
  ],
  methods: [
    {
      name: "rename",
      filePath: "entry/src/main/ets/model/User.ets",
      kind: "method",
      line: 12,
      parameters: [{ name: "nextName", typeText: "string", optional: false }],
      assignments: [{ target: "name", line: 13, value: { kind: "symbol", name: "nextName" } }],
    },
  ],
  viewTrees: [],
  components: [],
  diagnostics: [],
};

test("maps ArkFacts declarations into legacy ArkTS light scan shape", () => {
  const index = buildArktsLightScanIndexFromArkFacts(facts);

  assert.deepEqual([...index.classNames], ["User"]);
  assert.deepEqual(index.files[0]?.classes, [{ name: "User", line: 1 }]);
  assert.deepEqual(index.files[0]?.heritage, [
    {
      relativePath: "entry/src/main/ets/model/User.ets",
      line: 1,
      kind: "class",
      name: "User",
      extendsNames: ["BaseUser"],
      implementsNames: ["UserLike"],
      text: "class User",
    },
  ]);
  assert.deepEqual(
    index.files[0]?.classProperties.map((property) => ({
      name: property.name,
      hasAccessModifier: property.hasAccessModifier,
    })),
    [
      { name: "id", hasAccessModifier: true },
      { name: "name", hasAccessModifier: false },
    ],
  );
  assert.deepEqual(index.files[0]?.enums[0]?.memberInitializers, [
    { name: "ADMIN", initializer: "1" },
    { name: "GUEST", initializer: '"guest"' },
  ]);
  assert.deepEqual(index.files[0]?.assignments, [
    {
      relativePath: "entry/src/main/ets/model/User.ets",
      line: 13,
      name: "name",
      text: "name = nextName",
    },
  ]);
});

test("ArkTS static evaluator prefers ArkFacts when provided on evidence", () => {
  const rule: RegisteredRule = {
    pack_id: "arkts-language",
    rule_id: "ARKTS-FORBID-010",
    rule_source: "forbidden_pattern",
    summary: "类属性必须声明访问修饰符",
    detector: {
      kind: "static",
      mode: "arkts_static",
      config: { check: "class_property_access_modifier", fileExtensions: [".ets"] },
    },
    fallback: { policy: "agent_assisted" },
  };
  const evidence: CollectedEvidence = {
    workspaceFiles: [
      {
        relativePath: "entry/src/main/ets/model/User.ets",
        content: "",
      },
    ],
    allWorkspaceFiles: [],
    originalFiles: [],
    changedFiles: ["entry/src/main/ets/model/User.ets"],
    arkFacts: facts,
    summary: {
      workspaceFileCount: 1,
      originalFileCount: 0,
      changedFileCount: 1,
      changedFiles: ["entry/src/main/ets/model/User.ets"],
      hasPatch: false,
    },
  };

  const result = runArktsStaticRule(rule, evidence);

  assert.equal(result.result, "不满足");
  assert.deepEqual(result.matchedLocations, ["entry/src/main/ets/model/User.ets:3"]);
});

test("ArkTS facts evaluator keeps patch-scoped workspace filtering", () => {
  const rule: RegisteredRule = {
    pack_id: "arkts-language",
    rule_id: "ARKTS-FORBID-010",
    rule_source: "forbidden_pattern",
    summary: "类属性必须声明访问修饰符",
    detector: {
      kind: "static",
      mode: "arkts_static",
      config: { check: "class_property_access_modifier", fileExtensions: [".ets"] },
    },
    fallback: { policy: "agent_assisted" },
  };
  const evidence: CollectedEvidence = {
    workspaceFiles: [
      {
        relativePath: "entry/src/main/ets/pages/Index.ets",
        content: "@Component struct Index { build() {} }",
      },
    ],
    allWorkspaceFiles: [
      {
        relativePath: "entry/src/main/ets/pages/Index.ets",
        content: "@Component struct Index { build() {} }",
      },
      {
        relativePath: "entry/src/main/ets/model/User.ets",
        content: "class User { name: string }",
      },
    ],
    originalFiles: [],
    changedFiles: ["entry/src/main/ets/pages/Index.ets"],
    arkFacts: facts,
    summary: {
      workspaceFileCount: 1,
      originalFileCount: 0,
      changedFileCount: 1,
      changedFiles: ["entry/src/main/ets/pages/Index.ets"],
      hasPatch: true,
    },
  };

  const result = runArktsStaticRule(rule, evidence);

  assert.equal(result.result, "满足");
  assert.deepEqual(result.matchedLocations, []);
});
