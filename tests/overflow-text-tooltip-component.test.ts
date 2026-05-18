import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const componentPath = fileURLToPath(
  new URL("../web/src/components/OverflowTextTooltip.vue", import.meta.url),
);

test("OverflowTextTooltip uses a white constrained popper and disables native title", () => {
  const source = readFileSync(componentPath, "utf8");

  assert.match(source, /effect="light"/);
  assert.match(source, /:show-after="300"/);
  assert.match(source, /:popper-style="tooltipPopperStyle"/);
  assert.match(source, /:title="undefined"/);
  assert.match(source, /removeNativeTitle/);
  assert.match(source, /querySelectorAll\("\[title\]"\)/);
  assert.match(source, /closest\("td"\)/);
  assert.match(source, /maxWidth:\s*"420px"/);
  assert.match(source, /background:\s*"#ffffff"/);
  assert.match(source, /color:\s*"#1f2937"/);
  assert.match(source, /overflowWrap:\s*"anywhere"/);
});
