import assert from "node:assert/strict";
import test from "node:test";
import {
  buildStepGaps,
  gapTokenUsage,
  stepDuration,
  stepTokenUsage,
  type TraceStepGroupLike,
} from "../web/src/components/agentTraceTiming.js";

test("stepDuration uses step-start to step-finish timestamps before event elapsed fallback", () => {
  const elapsedMs = stepDuration([
    { id: "start", type: "step-start", title: "step-start", sequence: 0, timestampMs: 1_000 },
    {
      id: "tool",
      type: "tool",
      title: "read",
      sequence: 1,
      timestampMs: 1_200,
      elapsedMs: 5,
    },
    { id: "finish", type: "step-finish", title: "tool-calls", sequence: 2, timestampMs: 3_100 },
  ]);

  assert.equal(elapsedMs, 2_100);
});

test("stepDuration prefers complete step timestamps over step-finish elapsed", () => {
  const elapsedMs = stepDuration([
    { id: "start", type: "step-start", title: "step-start", sequence: 0, timestampMs: 1_000 },
    { id: "finish", type: "step-finish", title: "tool-calls", sequence: 1, timestampMs: 11_000, elapsedMs: 5 },
  ]);

  assert.equal(elapsedMs, 10_000);
});

test("stepDuration falls back to event elapsed when timestamps are unavailable", () => {
  const elapsedMs = stepDuration([
    { id: "start", type: "step-start", title: "step-start", sequence: 0 },
    { id: "tool", type: "tool", title: "read", sequence: 1, elapsedMs: 5 },
    { id: "text", type: "text", title: "text", sequence: 2, elapsedMs: 95 },
    { id: "finish", type: "step-finish", title: "tool-calls", sequence: 3 },
  ]);

  assert.equal(elapsedMs, 100);
});

test("buildStepGaps computes gaps between adjacent complete steps", () => {
  const steps: TraceStepGroupLike[] = [
    {
      id: "step-1",
      events: [
        { id: "start-1", type: "step-start", title: "step-start", sequence: 0, timestampMs: 1_000 },
        { id: "finish-1", type: "step-finish", title: "tool-calls", sequence: 1, timestampMs: 2_000 },
      ],
    },
    {
      id: "step-2",
      events: [
        { id: "start-2", type: "step-start", title: "step-start", sequence: 2, timestampMs: 7_000 },
        { id: "finish-2", type: "step-finish", title: "tool-calls", sequence: 3, timestampMs: 9_000 },
      ],
    },
  ];

  assert.deepEqual(buildStepGaps(steps), [
    {
      id: "step-1:gap:step-2",
      afterStepId: "step-1",
      beforeStepId: "step-2",
      elapsedMs: 5_000,
    },
  ]);
});

test("buildStepGaps skips gaps when either adjacent step lacks complete timestamps", () => {
  const steps: TraceStepGroupLike[] = [
    {
      id: "step-1",
      events: [{ id: "start-1", type: "step-start", title: "step-start", sequence: 0, timestampMs: 1_000 }],
    },
    {
      id: "step-2",
      events: [
        { id: "start-2", type: "step-start", title: "step-start", sequence: 1, timestampMs: 7_000 },
        { id: "finish-2", type: "step-finish", title: "tool-calls", sequence: 2, timestampMs: 9_000 },
      ],
    },
  ];

  assert.deepEqual(buildStepGaps(steps), []);
});

test("stepTokenUsage reads token usage from the step-finish event", () => {
  const step: TraceStepGroupLike = {
    id: "step-1",
    events: [
      { id: "start-1", type: "step-start", title: "step-start", sequence: 0, timestampMs: 1_000 },
      {
        id: "finish-1",
        type: "step-finish",
        title: "tool-calls",
        sequence: 1,
        timestampMs: 2_000,
        tokenUsage: { total: 120, output: 10, reasoning: 5 },
      },
    ],
  };

  assert.deepEqual(stepTokenUsage(step), { total: 120, output: 10, reasoning: 5 });
});

test("gapTokenUsage reads assistant message tokens between adjacent steps", () => {
  const previous: TraceStepGroupLike = {
    id: "step-7",
    events: [
      { id: "start-7", type: "step-start", title: "step-start", sequence: 0, timestampMs: 1_000 },
      { id: "finish-7", type: "step-finish", title: "tool-calls", sequence: 1, timestampMs: 2_000 },
    ],
  };
  const next: TraceStepGroupLike = {
    id: "step-8",
    events: [
      {
        id: "message-8",
        type: "message",
        title: "assistant",
        sequence: 2,
        timestampMs: 2_010,
        tokenUsage: { total: 8_262, output: 8_189, reasoning: 0 },
      },
      { id: "start-8", type: "step-start", title: "step-start", sequence: 3, timestampMs: 126_748 },
      {
        id: "finish-8",
        type: "step-finish",
        title: "tool-calls",
        sequence: 4,
        timestampMs: 126_900,
        tokenUsage: { total: 8_262, output: 8_189, reasoning: 0 },
      },
    ],
  };

  assert.deepEqual(gapTokenUsage(previous, next), { total: 8_262, output: 8_189, reasoning: 0 });
});
