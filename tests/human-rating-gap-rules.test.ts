import assert from "node:assert/strict";
import test from "node:test";
import {
  decideHumanRatingGap,
  mapAutoScoreToRating,
} from "../src/datasets/humanRating/humanRatingGapRules.js";

test("mapAutoScoreToRating maps scoring thresholds", () => {
  assert.equal(mapAutoScoreToRating(100), "L6");
  assert.equal(mapAutoScoreToRating(99), "L5");
  assert.equal(mapAutoScoreToRating(90), "L5");
  assert.equal(mapAutoScoreToRating(89.9), "L4");
  assert.equal(mapAutoScoreToRating(80), "L4");
  assert.equal(mapAutoScoreToRating(79.9), "L3");
  assert.equal(mapAutoScoreToRating(60), "L3");
  assert.equal(mapAutoScoreToRating(59.9), "L2");
});

test("decideHumanRatingGap only qualifies L1 >=70 and L2 >=80", () => {
  assert.deepEqual(decideHumanRatingGap("L1", 70), {
    autoRating: "L3",
    gapQualified: true,
    gapRule: "manual=L1 autoScore>=70",
  });
  assert.equal(decideHumanRatingGap("L1", 69.99).gapQualified, false);
  assert.deepEqual(decideHumanRatingGap("L2", 80), {
    autoRating: "L4",
    gapQualified: true,
    gapRule: "manual=L2 autoScore>=80",
  });
  assert.equal(decideHumanRatingGap("L2", 79.99).gapQualified, false);
  assert.equal(decideHumanRatingGap("L3", 100).gapQualified, false);
  assert.equal(decideHumanRatingGap("L6", 100).gapQualified, false);
});
