import assert from "node:assert/strict";
import test from "node:test";
import { adaptArkAnalyzerScene } from "../src/rules/arkfacts/adapter.js";

const sceneFixture = {
  projectDirectory: "/workspace/sample",
  totals: {
    files: 1,
    classes: 2,
    methods: 2,
    viewTrees: 1,
  },
  files: [
    {
      name: "entry/src/main/ets/pages/Index.ets",
      path: "/workspace/sample/entry/src/main/ets/pages/Index.ets",
      classCount: 2,
      classes: [
        {
          name: "%dflt",
          signature: "@sample/entry/src/main/ets/pages/Index.ets: %dflt",
          hasViewTree: false,
          methodCount: 1,
          fieldCount: 0,
          methods: ["%dflt"],
        },
        {
          name: "Index",
          signature: "@sample/entry/src/main/ets/pages/Index.ets: Index",
          hasViewTree: true,
          methodCount: 1,
          fieldCount: 1,
          methods: ["build"],
        },
      ],
    },
  ],
  viewTrees: [
    {
      component: "Index",
      signature: "@sample/entry/src/main/ets/pages/Index.ets: Index",
      file: "entry/src/main/ets/pages/Index.ets",
      nodeCount: 3,
      root: {
        name: "Column",
        kind: "system",
        attributes: {
          create: {
            uses: [],
            stmt: "%1 = staticinvoke <@%unk/%unk: Column.create()>()",
          },
          width: {
            uses: ["'100%'"],
            stmt: "%2 = instanceinvoke %1.<@%unk/%unk: .width()>('%100')",
          },
        },
        stateValues: [],
        children: [
          {
            name: "Tabs",
            kind: "system",
            attributes: {
              create: {
                uses: [],
                stmt: "%3 = staticinvoke <@%unk/%unk: Tabs.create()>()",
              },
              vertical: {
                uses: [
                  "this.<@sample/entry/src/main/ets/pages/Index.ets: Index.isLargeScreen>",
                ],
                stmt: "%4 = instanceinvoke %3.<@%unk/%unk: .vertical()>(%0)",
              },
              barPosition: {
                uses: ["BarPosition.<@%unk/%unk: .Start>"],
                stmt: "%5 = instanceinvoke %4.<@%unk/%unk: .barPosition()>(%2)",
              },
            },
            stateValues: [
              "this.<@sample/entry/src/main/ets/pages/Index.ets: Index.isLargeScreen>",
            ],
            children: [],
          },
          {
            name: "Text",
            kind: "system",
            attributes: {
              create: {
                uses: ["'hello'"],
                stmt: "%6 = staticinvoke <@%unk/%unk: Text.create()>('hello')",
              },
            },
            stateValues: [],
            children: [],
          },
        ],
      },
    },
  ],
};

test("adapts ArkAnalyzer scene summary into compact facts", () => {
  const facts = adaptArkAnalyzerScene(sceneFixture);

  assert.deepEqual(facts.files, [
    {
      relativePath: "entry/src/main/ets/pages/Index.ets",
      hasViewTree: true,
    },
  ]);
  assert.deepEqual(
    facts.declarations.map((item) => ({
      name: item.name,
      filePath: item.filePath,
      kind: item.kind,
    })),
    [
      {
        name: "Index",
        filePath: "entry/src/main/ets/pages/Index.ets",
        kind: "struct",
      },
    ],
  );
  assert.equal(facts.methods[0]?.name, "build");

  const tabs = facts.components.find((item) => item.name === "Tabs");
  assert.ok(tabs);
  assert.equal(tabs.parentId, facts.components.find((item) => item.name === "Column")?.id);
  assert.deepEqual(facts.components.find((item) => item.name === "Column")?.childIds, [
    tabs.id,
    facts.components.find((item) => item.name === "Text")?.id,
  ]);
  assert.deepEqual(tabs.stateRefs, ["Index.isLargeScreen"]);
  assert.deepEqual(tabs.attributes.find((item) => item.name === "create"), {
    name: "create",
    source: "create",
    stmt: "%3 = staticinvoke <@%unk/%unk: Tabs.create()>()",
    expr: {
      kind: "opaque",
      reason: "empty_uses",
    },
    opaqueReason: "empty_uses",
  });
  assert.deepEqual(tabs.attributes.find((item) => item.name === "barPosition")?.expr, {
    kind: "enum",
    name: "BarPosition.Start",
  });
  assert.deepEqual(tabs.attributes.find((item) => item.name === "vertical")?.expr, {
    kind: "symbol",
    name: "Index.isLargeScreen",
  });
  assert.equal(
    tabs.attributes.find((item) => item.name === "vertical")?.stmt,
    "%4 = instanceinvoke %3.<@%unk/%unk: .vertical()>(%0)",
  );
});

test("records diagnostics for malformed scene input", () => {
  const facts = adaptArkAnalyzerScene({ files: "not-array", viewTrees: "not-array" });

  assert.equal(facts.files.length, 0);
  assert.equal(facts.components.length, 0);
  assert.deepEqual(
    facts.diagnostics.map((item) => item.code),
    ["INVALID_FILES", "INVALID_VIEW_TREES"],
  );
});

test("records nested component parent and child ids in traversal order", () => {
  const facts = adaptArkAnalyzerScene({
    files: [],
    viewTrees: [
      {
        component: "Index",
        file: "entry/src/main/ets/pages/Index.ets",
        root: {
          name: "Column",
          kind: "system",
          attributes: {},
          stateValues: [],
          children: [
            {
              name: "Row",
              kind: "system",
              attributes: {},
              stateValues: [],
              children: [
                {
                  name: "Text",
                  kind: "system",
                  attributes: {},
                  stateValues: [],
                  children: [],
                },
              ],
            },
            {
              name: "Blank",
              kind: "system",
              attributes: {},
              stateValues: [],
              children: [],
            },
          ],
        },
      },
    ],
  });

  const column = facts.components.find((item) => item.name === "Column");
  const row = facts.components.find((item) => item.name === "Row");
  const text = facts.components.find((item) => item.name === "Text");
  const blank = facts.components.find((item) => item.name === "Blank");

  assert.ok(column);
  assert.ok(row);
  assert.ok(text);
  assert.ok(blank);
  assert.deepEqual(column.childIds, [row.id, blank.id]);
  assert.deepEqual(row.childIds, [text.id]);
  assert.equal(blank.parentId, column.id);
  assert.equal(text.parentId, row.id);
});

test("adapts simple array attribute uses for constructor-backed ArkUI rules", () => {
  const facts = adaptArkAnalyzerScene({
    files: [],
    viewTrees: [
      {
        component: "Index",
        file: "entry/src/main/ets/pages/Index.ets",
        root: {
          name: "FolderStack",
          kind: "system",
          attributes: {
            create: {
              uses: ["['video', 'preview']"],
              stmt: "%1 = staticinvoke <@%unk/%unk: FolderStack.create()>(%0)",
            },
          },
          stateValues: [],
          children: [],
        },
      },
    ],
  });

  assert.deepEqual(facts.components[0]?.attributes[0]?.expr, {
    kind: "array",
    items: [
      { kind: "literal", value: "video" },
      { kind: "literal", value: "preview" },
    ],
  });
});
