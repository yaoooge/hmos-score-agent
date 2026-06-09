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

test("limits ArkUI component scans to patch-scoped workspace files", () => {
  const changedFile = {
    relativePath: "entry/src/main/ets/pages/Changed.ets",
    content:
      'Tabs(){ TabContent(){ Navigation(){} } TabContent(){ NavDestination(){} } }.vertical(this.currentBreakpoint === "lg")',
    patchLineNumbers: [1],
  };
  const unchangedFile = {
    relativePath: "entry/src/main/ets/pages/Unchanged.ets",
    content: "Tabs(){ TabContent(){ Navigation(){} } TabContent(){ NavDestination(){} } }.vertical(false)",
    patchLineNumbers: [],
  };
  const result = runArkuiStaticRule(makeRule("tabs_vertical_by_breakpoint"), {
    workspaceFiles: [changedFile],
    allWorkspaceFiles: [changedFile, unchangedFile],
    originalFiles: [],
    changedFiles: [changedFile.relativePath],
    summary: {
      workspaceFileCount: 1,
      originalFileCount: 0,
      changedFileCount: 1,
      changedFiles: [changedFile.relativePath],
      hasPatch: true,
    },
  });

  assert.equal(result.result, "满足");
  assert.deepEqual(result.matchedLocations, ["entry/src/main/ets/pages/Changed.ets:1"]);
});

test("uses full ArkUI scan context while judging patch-scoped components", () => {
  const changedFile = {
    relativePath: "entry/src/main/ets/pages/Changed.ets",
    content:
      "GridRow({ breakpoints: { value: CommonConstants.BREAK_POINTS_VALUE, reference: BreakpointsReference.WindowSize } }){}",
    patchLineNumbers: [1],
  };
  const unchangedFile = {
    relativePath: "entry/src/main/ets/common/CommonConstants.ets",
    content:
      "export class CommonConstants { static readonly BREAK_POINTS_VALUE: Array<string> = ['320vp', '600vp', '840vp', '1440vp']; }",
    patchLineNumbers: [],
  };
  const result = runArkuiStaticRule(makeRule("gridrow_breakpoints_standard"), {
    workspaceFiles: [changedFile],
    allWorkspaceFiles: [changedFile, unchangedFile],
    originalFiles: [],
    changedFiles: [changedFile.relativePath],
    summary: {
      workspaceFileCount: 1,
      originalFileCount: 0,
      changedFileCount: 1,
      changedFiles: [changedFile.relativePath],
      hasPatch: true,
    },
  });

  assert.equal(result.result, "满足");
  assert.deepEqual(result.matchedLocations, ["entry/src/main/ets/pages/Changed.ets:1"]);
});

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
    makeEvidence("Tabs(){ TabContent(){ Navigation(){} } TabContent(){ NavDestination(){} } }.vertical(false)"),
  );

  assert.equal(result.result, "不满足");
  assert.deepEqual(result.matchedLocations, ["entry/src/main/ets/pages/Index.ets:1"]);
  assert.match(result.conclusion, /位置：entry\/src\/main\/ets\/pages\/Index\.ets:1/);
});

test("passes when a registered component property uses breakpoint expression", () => {
  const result = runArkuiStaticRule(
    makeRule("tabs_vertical_by_breakpoint"),
    makeEvidence('Tabs(){ TabContent(){ Navigation(){} } TabContent(){ NavDestination(){} } }.vertical(this.currentBreakpoint === "lg")'),
  );

  assert.equal(result.result, "满足");
});

test("asks agent to review breakpoint-aware properties hidden behind screen-size booleans", () => {
  const result = runArkuiStaticRule(
    makeRule("tabs_vertical_by_breakpoint"),
    makeEvidence("Tabs(){ TabContent(){ Navigation(){} } TabContent(){ NavDestination(){} } }.vertical(this.isWideScreen)"),
  );

  assert.equal(result.result, "未接入判定器");
  assert.deepEqual(result.matchedLocations, ["entry/src/main/ets/pages/Index.ets:1"]);
  assert.deepEqual(result.matchedSnippets, ["vertical=this.isWideScreen"]);
});

test("asks agent to review ternary breakpoint expressions instead of hard-coding responsive inference", () => {
  const result = runArkuiStaticRule(
    makeRule("tabs_bar_position_by_breakpoint"),
    makeEvidence(
      "Tabs({ barPosition: this.currentBreakpoint === Breakpoint.BREAKPOINT_LG ? BarPosition.Start : BarPosition.End }){ TabContent(){ Navigation(){} } TabContent(){ NavDestination(){} } }",
    ),
  );

  assert.equal(result.result, "未接入判定器");
  assert.deepEqual(result.matchedSnippets, [
    "barPosition=this.currentBreakpoint === Breakpoint.BREAKPOINT_LG ? BarPosition.Start : BarPosition.End",
  ]);
});

test("asks agent to review non-decreasing rules hidden behind helper methods", () => {
  const result = runArkuiStaticRule(
    makeRule("swiper_display_count_non_decreasing"),
    makeEvidence("Swiper(){}.displayCount(this.getDisplayCount())"),
  );

  assert.equal(result.result, "未接入判定器");
  assert.deepEqual(result.matchedLocations, ["entry/src/main/ets/pages/Index.ets:1"]);
  assert.deepEqual(result.matchedSnippets, ["displayCount=this.getDisplayCount()"]);
});

test("manual applicability checks are not involved when target component is absent", () => {
  const result = runArkuiStaticRule(
    makeRule("flex_grow_shrink_required"),
    makeEvidence("Column(){ Text('plain') }"),
  );

  assert.equal(result.result, "不涉及");
  assert.equal(result.preliminaryData?.inspectedComponentCount, 0);
  assert.deepEqual(result.matchedLocations, undefined);
});

test("manual applicability checks provide source snippets for agent review", () => {
  const result = runArkuiStaticRule(
    makeRule("flex_grow_shrink_required"),
    makeEvidence(
      [
        "Flex({ justifyContent: FlexAlign.SpaceBetween }) {",
        "  Text(this.title).flexGrow(1)",
        "  Button('More').flexShrink(0)",
        "}",
      ].join("\n"),
    ),
  );

  assert.equal(result.result, "未接入判定器");
  assert.deepEqual(result.matchedLocations, ["entry/src/main/ets/pages/Index.ets:1"]);
  assert.match(result.matchedSnippets?.[0] ?? "", /Flex\(\{ justifyContent/);
  const reviewEvidence = result.preliminaryData?.reviewEvidence as
    | Array<Record<string, unknown>>
    | undefined;
  assert.equal(reviewEvidence?.[0]?.file, "entry/src/main/ets/pages/Index.ets");
  assert.equal(reviewEvidence?.[0]?.line, 1);
  assert.equal(reviewEvidence?.[0]?.subject, "Flex");
  assert.match(String(reviewEvidence?.[0]?.source ?? ""), /Button\('More'\)\.flexShrink\(0\)/);
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

test("asks agent to review breakpoint-derived WaterFlow columnsTemplate helper", () => {
  const result = runArkuiStaticRule(
    makeRule("waterflow_columns_template_non_decreasing"),
    makeEvidence("WaterFlow(){}.columnsTemplate(this.columnsCount > 1 ? '1fr 1fr' : '1fr')"),
  );

  assert.equal(result.result, "未接入判定器");
});

test("asks agent to review stable Grid columnsTemplate helper", () => {
  const result = runArkuiStaticRule(
    makeRule("grid_columns_template_non_decreasing"),
    makeEvidence("Grid(){}.columnsTemplate(this.templateForGrid)"),
  );

  assert.equal(result.result, "未接入判定器");
});

test("asks agent to review fixed GridCol span when GridRow columns are opaque", () => {
  const result = runArkuiStaticRule(
    makeRule("gridcol_span_by_breakpoint"),
    makeEvidence(
      "GridRow({ columns: this.gridColumns.getValue(this.windowModel.currentBreakpoint) }){ GridCol({ span: 1 }){} }",
    ),
  );

  assert.equal(result.result, "未接入判定器");
});

test("passes SideBarContainer showSideBar when breakpoint boolean values vary explicitly", () => {
  const result = runArkuiStaticRule(
    makeRule("sidebar_show_by_breakpoint"),
    makeEvidence("SideBarContainer(){}.showSideBar({ sm: false, md: true, lg: true })"),
  );

  assert.equal(result.result, "满足");
});

test("asks agent to review opaque SideBarContainer showSideBar expressions", () => {
  const result = runArkuiStaticRule(
    makeRule("sidebar_show_by_breakpoint"),
    makeEvidence("SideBarContainer(){}.showSideBar(this.panel.visible)"),
  );

  assert.equal(result.result, "未接入判定器");
  assert.deepEqual(result.matchedSnippets, ["showSideBar=this.panel.visible"]);
});

test("asks agent to review fixed SideBarContainer showSideBar values", () => {
  const result = runArkuiStaticRule(
    makeRule("sidebar_show_by_breakpoint"),
    makeEvidence("SideBarContainer(){}.showSideBar(false)"),
  );

  assert.equal(result.result, "未接入判定器");
  assert.deepEqual(result.matchedSnippets, ["showSideBar=false"]);
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

test("does not apply List space rule only because space is configured", () => {
  const result = runArkuiStaticRule(
    makeRule("list_space_by_breakpoint"),
    makeEvidence("List(){}\nList({ space: 12 }){}"),
  );

  assert.equal(result.result, "不涉及");
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

test("passes module deviceTypes when separate hap modules collectively cover phone and tablet", () => {
  const result = runArkuiStaticRule(
    makeRule("module_device_types_multi_device"),
    makeEvidenceFiles([
      {
        relativePath: "entry-phone/src/main/module.json5",
        content: '{ "module": { "name": "phone", "type": "entry", "deviceTypes": ["phone"] } }',
      },
      {
        relativePath: "entry-tablet/src/main/module.json5",
        content: '{ "module": { "name": "tablet", "type": "entry", "deviceTypes": ["tablet"] } }',
      },
    ]),
  );

  assert.equal(result.result, "满足");
  assert.deepEqual(result.matchedSnippets, ["deviceTypes=phone", "deviceTypes=tablet"]);
});

test("flags module deviceTypes only after aggregating all hap device declarations", () => {
  const result = runArkuiStaticRule(
    makeRule("module_device_types_multi_device"),
    makeEvidenceFiles([
      {
        relativePath: "entry/src/main/module.json5",
        content: '{ "module": { "name": "entry", "type": "entry", "deviceTypes": ["phone"] } }',
      },
      {
        relativePath: "entry-pc/src/main/module.json5",
        content: '{ "module": { "name": "pc", "type": "entry", "deviceTypes": ["2in1"] } }',
      },
    ]),
  );

  assert.equal(result.result, "不满足");
  assert.deepEqual(result.matchedSnippets, ["aggregatedDeviceTypes=2in1,phone"]);
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

test("asks agent to review List space inside sm-only branch with alternate GridRow branch", () => {
  const result = runArkuiStaticRule(
    makeRule("list_space_by_breakpoint"),
    makeEvidence(
      "if (this.curBp === 'sm') { List({ space: Constants.LIST_GUTTER }){} } else { GridRow({ columns: { md: 2, lg: 4 } }){} }",
    ),
  );

  assert.equal(result.result, "未接入判定器");
});

test("does not apply List space rule to single-lane lists without responsive layout evidence", () => {
  const result = runArkuiStaticRule(
    makeRule("list_space_by_breakpoint"),
    makeEvidence("List({ space: Constants.LIST_GUTTER }){}"),
  );

  assert.equal(result.result, "不涉及");
});

test("asks agent to review List space inside breakpoint branches", () => {
  const result = runArkuiStaticRule(
    makeRule("list_space_by_breakpoint"),
    makeEvidence(
      "if (this.curBp !== 'sm') { List({ space: Constants.LIST_GUTTER }){} } else { GridRow({ columns: { md: 2, lg: 4 } }){} }",
    ),
  );

  assert.equal(result.result, "未接入判定器");
});

test("flags fixed List space only when lanes provide responsive multi-column evidence", () => {
  const result = runArkuiStaticRule(
    makeRule("list_space_by_breakpoint"),
    makeEvidence("List({ lanes: new BreakpointType(1, 2, 3).getValue(this.currentBreakpoint), space: 12 }){}"),
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

test("parses breakpoint helper arguments without relying on selector variable names", () => {
  const result = runArkuiStaticRule(
    makeRule("gridrow_columns_non_decreasing"),
    makeEvidence(
      "GridRow({ columns: new BreakpointType(3, 6, 8).getValue(layoutSize), gutter: { x: 12, y: 12 } }){}",
    ),
  );

  assert.equal(result.result, "满足");
});

test("does not apply List space rule to breakpoint-looking variable names without layout evidence", () => {
  const result = runArkuiStaticRule(
    makeRule("list_space_by_breakpoint"),
    makeEvidence("List({ space: this.breakpointSpacing }){}"),
  );

  assert.equal(result.result, "不涉及");
});

test("does not fail local business Tabs as page-level navigation", () => {
  const result = runArkuiStaticRule(
    makeRule("tabs_bar_position_by_breakpoint"),
    makeEvidence(
      "Column(){ Tabs({ barPosition: BarPosition.Start }) { TabContent(){ List(){} } TabContent(){ List(){} } } }",
    ),
  );

  assert.equal(result.result, "不涉及");
});

test("does not apply custom hover rules to fold listeners that only close or sync state", () => {
  const result = runArkuiStaticRule(
    makeRule("custom_hover_fold_and_landscape"),
    makeEvidence(
      "aboutToAppear(){ display.on('foldStatusChange', (foldStatus) => { if (foldStatus === display.FoldStatus.FOLD_STATUS_FOLDED) { this.closePage(); } }); }",
    ),
  );

  assert.equal(result.result, "不涉及");
});

test("does not treat fold listeners near unrelated window size code as custom hover layout", () => {
  const result = runArkuiStaticRule(
    makeRule("custom_hover_crease_region_api"),
    makeEvidence(
      "onWindowSizeChange(size){ this.updateBreakpoint(size.width); }\nprivate onFoldStatusChange = (foldStatus) => { if (foldStatus === display.FoldStatus.FOLD_STATUS_FOLDED) { this.context.terminateSelf(); } };",
    ),
  );

  assert.equal(result.result, "不涉及");
});

test("does not require cleanup for fold listeners outside custom hover layout", () => {
  const result = runArkuiStaticRule(
    makeRule("custom_hover_fold_listener_cleanup"),
    makeEvidence(
      "Button('open').onClick(() => { display.on('foldStatusChange', (status) => { if (status === display.FoldStatus.FOLD_STATUS_FOLDED) { this.pageInfos.replacePath(new NavPathInfo('Detail', [])); } }); })",
    ),
  );

  assert.equal(result.result, "不涉及");
});

test("recognizes foldStatusChange cleanup with a lifecycle return type", () => {
  const result = runArkuiStaticRule(
    makeRule("custom_hover_fold_listener_cleanup"),
    makeEvidence(
      "private onFoldStatusChange = (foldStatus) => { if (foldStatus === display.FoldStatus.FOLD_STATUS_HALF_FOLDED && display.getDefaultDisplaySync().orientation === display.Orientation.LANDSCAPE) { this.upperHeight = 320; } };\naboutToAppear(){ display.on('foldStatusChange', this.onFoldStatusChange); }\naboutToDisappear(): void { display.off('foldStatusChange'); }",
    ),
  );

  assert.equal(result.result, "满足");
});

test("does not apply Swiper multi-display margins when displayCount is fixed to one", () => {
  const result = runArkuiStaticRule(
    makeRule("swiper_margins_for_multi_display"),
    makeEvidence("Swiper(){}.displayCount(1).indicator(false)"),
  );

  assert.equal(result.result, "不涉及");
});

test("passes Swiper indicator when multi-display Swiper explicitly hides dots", () => {
  const result = runArkuiStaticRule(
    makeRule("swiper_indicator_by_display_count"),
    makeEvidence("Swiper(){}.displayCount(new BreakpointType(2, 3, 4).getValue(sizeClass)).indicator(false)"),
  );

  assert.equal(result.result, "满足");
});

test("passes Swiper multi-display margins when either side margin is configured", () => {
  const result = runArkuiStaticRule(
    makeRule("swiper_margins_for_multi_display"),
    makeEvidence("Swiper(){}.displayCount(new BreakpointType(1, 2, 3).getValue(sizeClass)).nextMargin(12)"),
  );

  assert.equal(result.result, "满足");
});

test("asks agent to review Swiper margins when multi-display swiper disables swiping", () => {
  const result = runArkuiStaticRule(
    makeRule("swiper_margins_for_multi_display"),
    makeEvidence(
      "Swiper(){}.displayCount(new BreakpointType(1, 2, 3).getValue(sizeClass)).disableSwipe(true)",
    ),
  );

  assert.equal(result.result, "未接入判定器");
});

test("does not fail multi-lane List when divider is not configured", () => {
  const result = runArkuiStaticRule(
    makeRule("list_divider_by_lanes"),
    makeEvidence("List(){}.lanes(new BreakpointType(1, 2, 3).getValue(sizeClass))"),
  );

  assert.equal(result.result, "不涉及");
});

test("returns not applicable when an optional scanned property is absent", () => {
  const result = runArkuiStaticRule(
    makeRule("gridrow_breakpoints_standard"),
    makeEvidence("GridRow({ columns: { sm: 4, md: 8, lg: 12 } }){}"),
  );

  assert.equal(result.result, "不涉及");
});

test("resolves string array constants before checking GridRow breakpoints", () => {
  const result = runArkuiStaticRule(
    makeRule("gridrow_breakpoints_standard"),
    makeEvidenceFiles([
      {
        relativePath: "entry/src/main/ets/common/CommonConstants.ets",
        content:
          "export class CommonConstants { static readonly BREAK_POINTS_VALUE: Array<string> = ['320vp', '600vp', '840vp', '1440vp']; }",
      },
      {
        relativePath: "entry/src/main/ets/pages/Index.ets",
        content:
          "GridRow({ breakpoints: { value: CommonConstants.BREAK_POINTS_VALUE, reference: BreakpointsReference.WindowSize } }){}",
      },
    ]),
  );

  assert.equal(result.result, "满足");
});

test("asks agent to review GridRow columns inside breakpoint branch", () => {
  const result = runArkuiStaticRule(
    makeRule("gridrow_columns_non_decreasing"),
    makeEvidence(
      "if (this.currentBreakpoint === BreakpointConstants.BREAKPOINT_MD) { GridRow({ columns: { sm: 2, md: 5, lg: 4 } }){} }",
    ),
  );

  assert.equal(result.result, "未接入判定器");
});

test("does not require GridRow gutter when fewer than two GridCol children need spacing", () => {
  const result = runArkuiStaticRule(
    makeRule("gridrow_gutter_required"),
    makeEvidence("GridRow({ columns: { sm: 4, md: 8, lg: 12 } }) { GridCol({ span: 12 }){} }"),
  );

  assert.equal(result.result, "不涉及");
});

test("flags missing GridRow gutter when multiple GridCol children share a grid row", () => {
  const result = runArkuiStaticRule(
    makeRule("gridrow_gutter_required"),
    makeEvidence("GridRow({ columns: { sm: 4, md: 8, lg: 12 } }) { GridCol({ span: 4 }){} GridCol({ span: 4 }){} }"),
  );

  assert.equal(result.result, "不满足");
});

test("asks agent to review WaterFlow sliding window when dynamic columns are opaque", () => {
  const result = runArkuiStaticRule(
    makeRule("waterflow_sliding_window_mode"),
    makeEvidence("WaterFlow(){}.columnsTemplate(this.getColumnsTemplate())"),
  );

  assert.equal(result.result, "未接入判定器");
});

test("does not apply WaterFlow sliding window rule when columns are not dynamic", () => {
  const result = runArkuiStaticRule(
    makeRule("waterflow_sliding_window_mode"),
    makeEvidence("WaterFlow(){}.columnsTemplate('1fr')"),
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
