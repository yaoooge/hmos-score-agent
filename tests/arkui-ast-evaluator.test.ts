import assert from "node:assert/strict";
import test from "node:test";
import { buildArkuiStaticScanIndexFromArkFacts } from "../src/rules/evaluators/arkui/astFacts.js";
import { runArkuiStaticRule } from "../src/rules/evaluators/arkui/staticEvaluator.js";
import type { ArkFactsIndex } from "../src/rules/arkfacts/index.js";
import type { CollectedEvidence } from "../src/rules/evidence/types.js";
import type { RegisteredRule } from "../src/rules/types/ruleTypes.js";

const facts: ArkFactsIndex = {
  files: [{ relativePath: "entry/src/main/ets/pages/Index.ets", hasViewTree: true }],
  declarations: [],
  methods: [],
  viewTrees: [
    {
      id: "view:0",
      component: "Index",
      filePath: "entry/src/main/ets/pages/Index.ets",
      rootComponentId: "c0",
      nodeCount: 3,
    },
  ],
  components: [
    {
      id: "c0",
      viewTreeId: "view:0",
      name: "Column",
      kind: "system",
      filePath: "entry/src/main/ets/pages/Index.ets",
      childIds: ["c1", "c2"],
      depth: 0,
      attributes: [],
      stateRefs: [],
      line: 2,
    },
    {
      id: "c1",
      viewTreeId: "view:0",
      name: "Tabs",
      kind: "system",
      filePath: "entry/src/main/ets/pages/Index.ets",
      parentId: "c0",
      childIds: [],
      depth: 1,
      attributes: [
        {
          name: "vertical",
          source: "modifier",
          line: 4,
          expr: { kind: "symbol", name: "Index.isLargeScreen" },
        },
        {
          name: "barPosition",
          source: "constructor",
          line: 3,
          expr: { kind: "enum", name: "BarPosition.Start" },
        },
      ],
      stateRefs: ["Index.isLargeScreen"],
      line: 3,
    },
    {
      id: "c2",
      viewTreeId: "view:0",
      name: "GridRow",
      kind: "system",
      filePath: "entry/src/main/ets/pages/Index.ets",
      parentId: "c0",
      childIds: [],
      depth: 1,
      attributes: [
        {
          name: "columns",
          source: "constructor",
          line: 8,
          expr: {
            kind: "object",
            properties: {
              sm: { kind: "literal", value: 4 },
              md: { kind: "literal", value: 8 },
              lg: { kind: "literal", value: 12 },
            },
          },
        },
      ],
      stateRefs: [],
      line: 8,
    },
  ],
  diagnostics: [],
};

test("maps ArkFacts components into legacy ArkUI static scan shape", () => {
  const index = buildArkuiStaticScanIndexFromArkFacts(facts);

  assert.deepEqual(
    index.componentInstances.map((item) => item.component),
    ["Column", "Tabs", "GridRow"],
  );
  assert.equal(index.files[0]?.componentCount, 3);

  const tabs = index.componentInstances.find((item) => item.component === "Tabs");
  assert.equal(tabs?.argumentText, "{ barPosition: BarPosition.Start }");
  assert.deepEqual(tabs?.properties, [
    {
      name: "vertical",
      argumentText: "Index.isLargeScreen",
      line: 4,
      usesBreakpoint: true,
    },
  ]);

  const gridRow = index.componentInstances.find((item) => item.component === "GridRow");
  assert.equal(gridRow?.argumentText, "{ columns: { sm: 4, md: 8, lg: 12 } }");
});

test("ArkUI static evaluator prefers ArkFacts when provided on evidence", () => {
  const rule: RegisteredRule = {
    pack_id: "cross-device-adaptation",
    rule_id: "OM-GRIDROW-MUST-02",
    rule_source: "must_rule",
    summary: "GridRow columns 必须按断点非递减设置列数",
    detector: {
      kind: "static",
      mode: "arkui_static",
      config: { check: "gridrow_columns_non_decreasing" },
    },
    fallback: { policy: "agent_assisted" },
  };
  const evidence: CollectedEvidence = {
    workspaceFiles: [
      {
        relativePath: "entry/src/main/ets/pages/Index.ets",
        content: "",
      },
    ],
    allWorkspaceFiles: [],
    originalFiles: [],
    changedFiles: ["entry/src/main/ets/pages/Index.ets"],
    arkFacts: facts,
    summary: {
      workspaceFileCount: 1,
      originalFileCount: 0,
      changedFileCount: 1,
      changedFiles: ["entry/src/main/ets/pages/Index.ets"],
      hasPatch: false,
    },
  };

  const result = runArkuiStaticRule(rule, evidence);

  assert.equal(result.result, "满足");
  assert.deepEqual(result.matchedFiles, ["entry/src/main/ets/pages/Index.ets"]);
});

test("ArkUI facts evaluator defers opaque ArkAnalyzer property values", () => {
  const rule: RegisteredRule = {
    pack_id: "cross-device-adaptation",
    rule_id: "OM-LIST-MUST-01",
    rule_source: "must_rule",
    summary: "List lanes 必须按断点非递减设置",
    detector: {
      kind: "static",
      mode: "arkui_static",
      config: { check: "list_lanes_non_decreasing" },
    },
    fallback: { policy: "agent_assisted" },
  };
  const opaqueFacts: ArkFactsIndex = {
    files: facts.files,
    declarations: [],
    methods: [],
    viewTrees: [
      {
        id: "view:opaque",
        component: "Index",
        filePath: "entry/src/main/ets/pages/Index.ets",
        nodeCount: 1,
      },
    ],
    components: [
      {
        id: "list",
        viewTreeId: "view:opaque",
        name: "List",
        kind: "system",
        filePath: "entry/src/main/ets/pages/Index.ets",
        attributes: [{ name: "lanes", source: "modifier" }],
        stateRefs: [],
        line: 5,
      },
    ],
    diagnostics: [],
  };
  const evidence: CollectedEvidence = {
    workspaceFiles: [
      {
        relativePath: "entry/src/main/ets/pages/Index.ets",
        content: "List().lanes(this.calcLanes())",
      },
    ],
    allWorkspaceFiles: [],
    originalFiles: [],
    changedFiles: ["entry/src/main/ets/pages/Index.ets"],
    arkFacts: opaqueFacts,
    summary: {
      workspaceFileCount: 1,
      originalFileCount: 0,
      changedFileCount: 1,
      changedFiles: ["entry/src/main/ets/pages/Index.ets"],
      hasPatch: false,
    },
  };

  const result = runArkuiStaticRule(rule, evidence);

  assert.equal(result.result, "未接入判定器");
  assert.deepEqual(result.matchedLocations, ["entry/src/main/ets/pages/Index.ets:5"]);
});
