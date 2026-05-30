import type { AgentTraceEvent } from "../api/dashboard";

export type TraceStepGroupLike = {
  id: string;
  events: AgentTraceEvent[];
};

export type TraceStepGap = {
  id: string;
  afterStepId: string;
  beforeStepId: string;
  elapsedMs: number;
};

export type TraceTokenUsage = NonNullable<AgentTraceEvent["tokenUsage"]>;

export function stepDuration(events: AgentTraceEvent[]): number | undefined {
  const stepStartTimestampMs = events.find((event) => event.type === "step-start")?.timestampMs;
  const stepFinishTimestampMs = [...events]
    .reverse()
    .find((event) => event.type === "step-finish")?.timestampMs;
  if (stepStartTimestampMs !== undefined && stepFinishTimestampMs !== undefined) {
    return Math.max(0, stepFinishTimestampMs - stepStartTimestampMs);
  }

  const stepFinishElapsedMs = [...events]
    .reverse()
    .find((event) => event.type === "step-finish" && event.elapsedMs !== undefined)?.elapsedMs;
  if (stepFinishElapsedMs !== undefined) {
    return stepFinishElapsedMs;
  }

  const timestamps = events
    .map((event) => event.timestampMs)
    .filter((value): value is number => value !== undefined);
  if (timestamps.length >= 2) {
    return Math.max(0, Math.max(...timestamps) - Math.min(...timestamps));
  }

  const elapsedTotal = events.reduce((sum, event) => sum + (event.elapsedMs ?? 0), 0);
  return elapsedTotal > 0 ? elapsedTotal : undefined;
}

export function hasCompleteStepTimestamp(events: AgentTraceEvent[]): boolean {
  return (
    events.some((event) => event.type === "step-start" && event.timestampMs !== undefined) &&
    events.some((event) => event.type === "step-finish" && event.timestampMs !== undefined)
  );
}

function stepStartTimestamp(step: TraceStepGroupLike): number | undefined {
  return step.events.find((event) => event.type === "step-start")?.timestampMs;
}

function stepFinishTimestamp(step: TraceStepGroupLike): number | undefined {
  return [...step.events].reverse().find((event) => event.type === "step-finish")?.timestampMs;
}

export function buildStepGaps(steps: TraceStepGroupLike[]): TraceStepGap[] {
  const gaps: TraceStepGap[] = [];
  for (let index = 0; index < steps.length - 1; index += 1) {
    const current = steps[index];
    const next = steps[index + 1];
    if (!current || !next) {
      continue;
    }
    const finish = stepFinishTimestamp(current);
    const start = stepStartTimestamp(next);
    if (finish === undefined || start === undefined || start <= finish) {
      continue;
    }
    gaps.push({
      id: `${current.id}:gap:${next.id}`,
      afterStepId: current.id,
      beforeStepId: next.id,
      elapsedMs: start - finish,
    });
  }
  return gaps;
}

export function stepTokenUsage(step: TraceStepGroupLike): TraceTokenUsage | undefined {
  return [...step.events].reverse().find((event) => event.type === "step-finish" && event.tokenUsage)
    ?.tokenUsage;
}

export function gapTokenUsage(
  previousStep: TraceStepGroupLike,
  nextStep: TraceStepGroupLike,
): TraceTokenUsage | undefined {
  const previousFinish = stepFinishTimestamp(previousStep);
  const nextStart = stepStartTimestamp(nextStep);
  const messageTokenUsage = nextStep.events.find(
    (event) =>
      event.type === "message" &&
      event.tokenUsage &&
      event.timestampMs !== undefined &&
      previousFinish !== undefined &&
      nextStart !== undefined &&
      event.timestampMs >= previousFinish &&
      event.timestampMs <= nextStart,
  )?.tokenUsage;
  return messageTokenUsage ?? stepTokenUsage(nextStep);
}
