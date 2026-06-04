import assert from "node:assert/strict";
import test from "node:test";
import { buildArkuiStaticScanIndex } from "../src/rules/evaluators/arkui/staticScanner.js";

test("indexes ArkUI component calls and chained property calls from ets files", () => {
  const index = buildArkuiStaticScanIndex([
    {
      relativePath: "entry/src/main/ets/pages/Index.ets",
      content: `
        build() {
          Column() {
            Tabs({ barPosition: BarPosition.Start }) {
              TabContent()
            }
            .vertical(this.currentBreakpoint === "sm")

            GridRow({ columns: this.columns }) {
              Text("title")
            }
          }
        }
      `,
    },
  ]);

  assert.equal(index.componentInstances.length, 5);
  assert.deepEqual(
    index.componentInstances.map((item) => item.component),
    ["Column", "Tabs", "TabContent", "GridRow", "Text"],
  );
  assert.deepEqual(index.componentInstances.find((item) => item.component === "Tabs")?.properties, [
    {
      name: "vertical",
      argumentText: 'this.currentBreakpoint === "sm"',
      line: 7,
      usesBreakpoint: true,
    },
  ]);
  assert.equal(
    index.componentInstances.find((item) => item.component === "GridRow")?.argumentText,
    "{ columns: this.columns }",
  );
});

test("keeps one scan index for multiple components and ignores comments or strings", () => {
  const index = buildArkuiStaticScanIndex([
    {
      relativePath: "entry/src/main/ets/pages/Index.ets",
      content: `
        // Tabs().vertical(false)
        const sample = "GridRow()";
        if (breakpoint === Breakpoint.SM) {
          List() {
            ListItem()
          }
          .lanes(2)
        }
      `,
    },
  ]);

  assert.deepEqual(
    index.componentInstances.map((item) => item.component),
    ["List", "ListItem"],
  );
  assert.equal(index.componentInstances[0]?.breakpointContext, "if");
  assert.equal(index.componentInstances[0]?.properties[0]?.name, "lanes");
});
