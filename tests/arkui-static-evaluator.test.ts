import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { RegisteredRule } from "../src/rules/types/ruleTypes.js";
import type { CollectedEvidence } from "../src/rules/evidence/types.js";
import { runArkuiStaticRule } from "../src/rules/evaluators/arkui/staticEvaluator.js";

function makeRule(check: string): RegisteredRule {
  return {
    pack_id: "cross-device-adaptation",
    rule_id: `OM-TEST-${check}`,
    rule_source: "must_rule",
    summary: "测试规则",
    detector: {
      kind: "static",
      mode: "arkui_static",
      config: { check },
    },
    fallback: { policy: "agent_assisted" },
    profile: {
      scoring: true,
      riskCode: "UI_LAYOUT_OR_BREAKPOINT_MISMATCH",
      metricGroups: ["type_safety"],
      impact: "medium",
    },
  };
}

function makeEvidence(content: string): CollectedEvidence {
  return makeEvidenceFiles([
    {
      relativePath: "entry/src/main/ets/pages/Index.ets",
      content,
    },
  ]);
}

function makeEvidenceFiles(
  files: Array<{ relativePath: string; content: string }>,
): CollectedEvidence {
  return {
    workspaceFiles: files,
    allWorkspaceFiles: files,
    originalFiles: [],
    changedFiles: [],
    summary: {
      workspaceFileCount: files.length,
      originalFileCount: 0,
      changedFileCount: 0,
      changedFiles: [],
      hasPatch: false,
    },
  };
}

async function makeTempDir(t: test.TestContext): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "hmos-arkui-static-"));
  t.after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });
  return dir;
}

test("fails when a registered component property is fixed instead of breakpoint aware", () => {
  const result = runArkuiStaticRule(
    makeRule("tabs_vertical_by_breakpoint"),
    makeEvidence("Tabs(){}.vertical(false)"),
  );

  assert.equal(result.result, "不满足");
  assert.deepEqual(result.matchedLocations, ["entry/src/main/ets/pages/Index.ets:1"]);
});

test("passes when a registered component property uses breakpoint expression", () => {
  const result = runArkuiStaticRule(
    makeRule("tabs_vertical_by_breakpoint"),
    makeEvidence('Tabs(){}.vertical(this.currentBreakpoint === "lg")'),
  );

  assert.equal(result.result, "满足");
});

test("passes when a registered component property uses breakpoint-derived helper", () => {
  const result = runArkuiStaticRule(
    makeRule("tabs_vertical_by_breakpoint"),
    makeEvidence("Tabs(){}.vertical(this.isWideScreen)"),
  );

  assert.equal(result.result, "满足");
});

test("fails when numeric breakpoint map descends across larger breakpoints", () => {
  const result = runArkuiStaticRule(
    makeRule("gridrow_columns_non_decreasing"),
    makeEvidence("GridRow({ columns: { sm: 4, md: 8, lg: 6, xl: 12 } }){}"),
  );

  assert.equal(result.result, "不满足");
  assert.match(result.conclusion, /非递减/);
});

test("passes fixed single-column WaterFlow columnsTemplate", () => {
  const result = runArkuiStaticRule(
    makeRule("waterflow_columns_template_non_decreasing"),
    makeEvidence("WaterFlow(){}.columnsTemplate('1fr')"),
  );

  assert.equal(result.result, "满足");
});

test("passes breakpoint-derived WaterFlow columnsTemplate helper", () => {
  const result = runArkuiStaticRule(
    makeRule("waterflow_columns_template_non_decreasing"),
    makeEvidence("WaterFlow(){}.columnsTemplate(this.columnsCount > 1 ? '1fr 1fr' : '1fr')"),
  );

  assert.equal(result.result, "满足");
});

test("passes stable Grid columnsTemplate helper", () => {
  const result = runArkuiStaticRule(
    makeRule("grid_columns_template_non_decreasing"),
    makeEvidence("Grid(){}.columnsTemplate(this.templateForGrid)"),
  );

  assert.equal(result.result, "满足");
});

test("passes fixed GridCol span when GridRow columns are responsive in the same file", () => {
  const result = runArkuiStaticRule(
    makeRule("gridcol_span_by_breakpoint"),
    makeEvidence(
      "GridRow({ columns: this.gridColumns.getValue(this.windowModel.currentBreakpoint) }){ GridCol({ span: 1 }){} }",
    ),
  );

  assert.equal(result.result, "满足");
});

test("does not fail layout-intent rules without applicability evidence", () => {
  const flexResult = runArkuiStaticRule(
    makeRule("flex_space_evenly_required"),
    makeEvidence("Flex({ justifyContent: FlexAlign.SpaceBetween }){}"),
  );
  const rowResult = runArkuiStaticRule(
    makeRule("row_column_layout_weight_required"),
    makeEvidence("Row({ space: 8 }){}"),
  );
  const scrollResult = runArkuiStaticRule(
    makeRule("horizontal_scroll_required"),
    makeEvidence("Scroll(){}"),
  );

  assert.equal(flexResult.result, "未接入判定器");
  assert.equal(rowResult.result, "未接入判定器");
  assert.equal(scrollResult.result, "未接入判定器");
});

test("does not apply Swiper indicator rule without displayCount", () => {
  const result = runArkuiStaticRule(
    makeRule("swiper_indicator_by_display_count"),
    makeEvidence("Swiper(){}.indicator(false)"),
  );

  assert.equal(result.result, "不涉及");
});

test("does not apply List divider rule without lanes", () => {
  const result = runArkuiStaticRule(
    makeRule("list_divider_by_lanes"),
    makeEvidence("List(){}.divider({ strokeWidth: 1 })"),
  );

  assert.equal(result.result, "不涉及");
});

test("only flags List space rule when space is configured", () => {
  const result = runArkuiStaticRule(
    makeRule("list_space_by_breakpoint"),
    makeEvidence("List(){}\nList({ space: 12 }){}"),
  );

  assert.equal(result.result, "不满足");
  assert.deepEqual(result.matchedLocations, ["entry/src/main/ets/pages/Index.ets:2"]);
});

test("passes module deviceTypes when phone and tablet are declared", () => {
  const result = runArkuiStaticRule(
    makeRule("module_device_types_multi_device"),
    makeEvidenceFiles([
      {
        relativePath: "entry/src/main/module.json5",
        content: '{ "module": { "type": "entry", "deviceTypes": ["phone", "tablet", "2in1"] } }',
      },
    ]),
  );

  assert.equal(result.result, "满足");
});

test("only checks hap entry modules for deviceTypes", () => {
  const result = runArkuiStaticRule(
    makeRule("module_device_types_multi_device"),
    makeEvidenceFiles([
      {
        relativePath: "entry/src/main/module.json5",
        content:
          '{ "module": { "name": "entry", "type": "entry", "deviceTypes": ["phone", "tablet"] } }',
      },
      {
        relativePath: "commons/lib_search/src/main/module.json5",
        content:
          '{ "module": { "name": "lib_search", "type": "har", "deviceTypes": ["default"] } }',
      },
    ]),
  );

  assert.equal(result.result, "满足");
  assert.deepEqual(result.matchedLocations, ["entry/src/main/module.json5:1"]);
});

test("flags hardcoded breakpoint width comparisons", () => {
  const result = runArkuiStaticRule(
    makeRule("breakpoint_no_hardcoded_width"),
    makeEvidence("if (this.screenWidth >= 840) { this.columns = 8; }"),
  );

  assert.equal(result.result, "不满足");
});

test("flags breakpoint listener registered before loadContent", () => {
  const result = runArkuiStaticRule(
    makeRule("breakpoint_listener_after_load_content"),
    makeEvidence(
      "onWindowStageCreate(){ windowClass.on('windowSizeChange', () => {}); windowStage.loadContent('pages/Index'); }",
    ),
  );

  assert.equal(result.result, "不满足");
});

test("flags custom breakpoint source derived from hardcoded width", () => {
  const result = runArkuiStaticRule(
    makeRule("breakpoint_source_standard"),
    makeEvidence("update(width: number) { this.currentBreakpoint = width >= 840 ? 'lg' : 'md'; }"),
  );

  assert.equal(result.result, "不满足");
});

test("passes fullscreen FolderStack", () => {
  const result = runArkuiStaticRule(
    makeRule("folderstack_fullscreen"),
    makeEvidence(
      "FolderStack({ upperItems: ['video'] }) { Video().id('video') }.width('100%').height('100%')",
    ),
  );

  assert.equal(result.result, "满足");
});

test("flags FolderStack upperItems without matching child ids", () => {
  const result = runArkuiStaticRule(
    makeRule("folderstack_upper_items_ids"),
    makeEvidence("FolderStack({ upperItems: ['video'] }) { Video().id('player') }"),
  );

  assert.equal(result.result, "不满足");
});

test("flags Web fixed container size", () => {
  const result = runArkuiStaticRule(
    makeRule("web_container_size_by_breakpoint"),
    makeEvidence("Web({ src: 'index.html', controller: this.controller }).width(720).height(480)"),
  );

  assert.equal(result.result, "不满足");
});

test("flags inconsistent Web media query breakpoints", () => {
  const result = runArkuiStaticRule(
    makeRule("web_media_query_breakpoints_standard"),
    makeEvidenceFiles([
      {
        relativePath: "entry/src/main/resources/rawfile/index.css",
        content: "@media (min-width: 500px) { .grid { width: 100%; } }",
      },
    ]),
  );

  assert.equal(result.result, "不满足");
});

test("flags fixed aspectRatio when aspectRatio rule requires breakpoint awareness", () => {
  const result = runArkuiStaticRule(
    makeRule("aspect_ratio_by_breakpoint"),
    makeEvidence("Image($r('app.media.poster')).width('100%').aspectRatio(16 / 9)"),
  );

  assert.equal(result.result, "不满足");
});

test("does not fail dynamic constraintSize when grid system is present", () => {
  const result = runArkuiStaticRule(
    makeRule("gridrow_no_dynamic_constraint_size_centering"),
    makeEvidence(
      "GridRow({ columns: { sm: 4, md: 8, lg: 12 } }) { GridCol({ span: 8 }){} }\nColumn().constraintSize({ maxWidth: this.contentMaxWidth.getValue(this.windowModel.currentBreakpoint) || undefined })",
    ),
  );

  assert.equal(result.result, "满足");
});

test("resolves numeric constants used by GridRow columns", () => {
  const result = runArkuiStaticRule(
    makeRule("gridrow_columns_non_decreasing"),
    makeEvidenceFiles([
      {
        relativePath: "entry/src/main/ets/common/Constants.ets",
        content:
          "export default class Constants { static readonly GRID_ALL_COLUMNS: number = 4; static readonly GRID_ROW_COLUMNS: number[] = [1, 2, 4]; }",
      },
      {
        relativePath: "entry/src/main/ets/pages/Index.ets",
        content:
          "GridRow({ columns: { md: Constants.GRID_ROW_COLUMNS[1], lg: Constants.GRID_ROW_COLUMNS[2] } }){}\nGridRow({ columns: Constants.GRID_ALL_COLUMNS }){}",
      },
    ]),
  );

  assert.equal(result.result, "满足");
});

test("passes default GridCol spans inside responsive GridRow", () => {
  const result = runArkuiStaticRule(
    makeRule("gridcol_span_by_breakpoint"),
    makeEvidence(
      "GridRow({ columns: { md: 2, lg: 4 } }) { GridCol(){} GridCol({ span: { md: 2, lg: 1 } }){} }",
    ),
  );

  assert.equal(result.result, "满足");
});

test("does not pass default GridCol spans just because a responsive GridRow exists in the same file", () => {
  const result = runArkuiStaticRule(
    makeRule("gridcol_span_by_breakpoint"),
    makeEvidence("GridRow({ columns: { md: 2, lg: 4 } }) {}\nGridCol(){}"),
  );

  assert.equal(result.result, "不满足");
});

test("does not require breakpoint-aware List space inside sm-only branch", () => {
  const result = runArkuiStaticRule(
    makeRule("list_space_by_breakpoint"),
    makeEvidence(
      "if (this.curBp === 'sm') { List({ space: Constants.LIST_GUTTER }){} } else { GridRow({ columns: { md: 2, lg: 4 } }){} }",
    ),
  );

  assert.equal(result.result, "满足");
});

test("does not pass sm-only List space without an alternate GridRow branch", () => {
  const result = runArkuiStaticRule(
    makeRule("list_space_by_breakpoint"),
    makeEvidence("if (this.curBp === 'sm') { List({ space: Constants.LIST_GUTTER }){} }"),
  );

  assert.equal(result.result, "不满足");
});

test("does not treat not-sm List branch as sm-only fallback", () => {
  const result = runArkuiStaticRule(
    makeRule("list_space_by_breakpoint"),
    makeEvidence(
      "if (this.curBp !== 'sm') { List({ space: Constants.LIST_GUTTER }){} } else { GridRow({ columns: { md: 2, lg: 4 } }){} }",
    ),
  );

  assert.equal(result.result, "不满足");
});

test("still fails fixed List space in non-sm breakpoint branch", () => {
  const result = runArkuiStaticRule(
    makeRule("list_space_by_breakpoint"),
    makeEvidence("if (this.curBp === 'md') { List({ space: Constants.LIST_GUTTER }){} }"),
  );

  assert.equal(result.result, "不满足");
});

test("resolves non-Constants numeric constants used by GridRow columns", () => {
  const result = runArkuiStaticRule(
    makeRule("gridrow_columns_non_decreasing"),
    makeEvidenceFiles([
      {
        relativePath: "entry/src/main/ets/common/GridSpec.ets",
        content: "export const GRID_COLUMNS: number[] = [2, 4, 8];",
      },
      {
        relativePath: "entry/src/main/ets/pages/Index.ets",
        content:
          "GridRow({ columns: { sm: GRID_COLUMNS[0], md: GridSpec.GRID_COLUMNS[1], lg: GridSpec.GRID_COLUMNS[2] } }){}",
      },
    ]),
  );

  assert.equal(result.result, "满足");
});

test("returns not applicable when an optional scanned property is absent", () => {
  const result = runArkuiStaticRule(
    makeRule("gridrow_breakpoints_standard"),
    makeEvidence("GridRow({ columns: { sm: 4, md: 8, lg: 12 } }){}"),
  );

  assert.equal(result.result, "不涉及");
});

test("returns not applicable when the target component is absent", () => {
  const result = runArkuiStaticRule(
    makeRule("tabs_vertical_by_breakpoint"),
    makeEvidence("Column(){}"),
  );

  assert.equal(result.result, "不涉及");
});

test("writes intermediate scan artifacts under case intermediate directory", async (t) => {
  const caseDir = await makeTempDir(t);
  const evidence = {
    ...makeEvidence("Tabs(){}.vertical(false)"),
    caseDir,
  };

  runArkuiStaticRule(makeRule("tabs_vertical_by_breakpoint"), evidence);

  const artifactDir = path.join(caseDir, "intermediate", "arkui-static-scan");
  const index = JSON.parse(
    await fs.readFile(path.join(artifactDir, "arkui-scan-index.json"), "utf-8"),
  ) as {
    componentInstances: unknown[];
  };
  const traces = JSON.parse(
    await fs.readFile(path.join(artifactDir, "arkui-rule-traces.json"), "utf-8"),
  ) as {
    ruleTraces: unknown[];
  };
  const unresolved = JSON.parse(
    await fs.readFile(path.join(artifactDir, "unresolved-expressions.json"), "utf-8"),
  ) as {
    unresolvedExpressions: unknown[];
  };

  assert.equal(index.componentInstances.length, 1);
  assert.equal(traces.ruleTraces.length, 1);
  assert.equal(unresolved.unresolvedExpressions.length, 0);
});
