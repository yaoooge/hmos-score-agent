import type {
  AgentTraceAttempt,
  AgentTraceEvent,
  AgentTraceEventStatus,
  OpenCodeTraceEventType,
  OpencodeSessionSnapshot,
} from "./types.js";

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readTimestampMs(record: Record<string, unknown> | undefined): number | undefined {
  if (!record) {
    return undefined;
  }
  return (
    readFiniteNumber(record.createdAtMs) ??
    readFiniteNumber(record.created_at_ms) ??
    readFiniteNumber(record.created) ??
    readFiniteNumber(record.time)
  );
}

function normalizeEventType(value: unknown): OpenCodeTraceEventType {
  switch (value) {
    case "message":
    case "step-start":
    case "reasoning":
    case "tool":
    case "step-finish":
    case "text":
      return value;
    default:
      return "unknown";
  }
}

function normalizeStatus(value: unknown): AgentTraceEventStatus | undefined {
  switch (value) {
    case "completed":
    case "success":
      return "completed";
    case "error":
    case "failed":
      return "error";
    case "running":
    case "pending":
      return "running";
    case undefined:
    case null:
      return undefined;
    default:
      return "unknown";
  }
}

function findAttempt(
  timestampMs: number | undefined,
  attempts: AgentTraceAttempt[],
): AgentTraceAttempt | undefined {
  if (timestampMs === undefined) {
    return undefined;
  }
  return attempts.find(
    (attempt) =>
      attempt.startedAtMs !== undefined &&
      attempt.endedAtMs !== undefined &&
      timestampMs >= attempt.startedAtMs &&
      timestampMs <= attempt.endedAtMs,
  );
}

function summarizePayload(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value.slice(0, 240);
  }
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }
  const filePath = readString(record.filePath) ?? readString(record.file) ?? readString(record.path);
  if (filePath) {
    return filePath;
  }
  try {
    return JSON.stringify(record).slice(0, 240);
  } catch {
    return undefined;
  }
}

function readPart(record: Record<string, unknown>): Record<string, unknown> | undefined {
  const properties = asRecord(record.properties);
  return asRecord(record.part) ?? asRecord(properties?.part);
}

function readEventStatus(part: Record<string, unknown>): AgentTraceEventStatus | undefined {
  const state = asRecord(part.state);
  return normalizeStatus(part.status) ?? normalizeStatus(state?.status);
}

function messageTitle(info: Record<string, unknown>): string {
  const role = readString(info.role) ?? "message";
  const agent = readString(info.agent);
  const model = readString(info.model);
  return [role, agent, model].filter(Boolean).join(" ");
}

function partTitle(part: Record<string, unknown>, type: OpenCodeTraceEventType): string {
  const state = asRecord(part.state);
  const title = readString(part.title) ?? readString(state?.title);
  if (title) {
    return title;
  }
  if (type === "tool") {
    return readString(part.tool) ?? readString(part.toolName) ?? "tool";
  }
  if (type === "step-finish") {
    return readString(part.reason) ?? "step-finish";
  }
  return type;
}

function makeEventId(sessionId: string, sequence: number, partId?: string): string {
  return partId ? `${sessionId}:${partId}` : `${sessionId}:event-${String(sequence)}`;
}

function makeRawEventId(attempt: AgentTraceAttempt, sequence: number, partId?: string): string {
  return partId ? `${attempt.id}:${partId}` : `${attempt.id}:raw-event-${String(sequence)}`;
}

function rawEventRecordToTraceEvent(input: {
  record: Record<string, unknown>;
  attempt: AgentTraceAttempt;
  sequence: number;
}): AgentTraceEvent | undefined {
  const properties = asRecord(input.record.properties);
  const info = asRecord(input.record.info) ?? asRecord(properties?.info);
  const eventType = readString(input.record.type);
  if (info && eventType?.startsWith("message.")) {
    const messageId = readString(info.id);
    return {
      id: makeRawEventId(input.attempt, input.sequence, messageId),
      sequence: input.sequence,
      attemptId: input.attempt.id,
      retryIndex: input.attempt.retryIndex,
      type: "message",
      title: messageTitle(info),
      messageId,
      timestampMs: readTimestampMs(info) ?? readTimestampMs(input.record),
      summary: readString(info.role),
      rawPayload: input.record,
      hasRawPayload: true,
    };
  }
  const part = readPart(input.record);
  if (!part) {
    return undefined;
  }
  const type = normalizeEventType(part.type ?? input.record.type);
  const state = asRecord(part.state);
  const inputSummary = summarizePayload(part.input ?? state?.input);
  const outputSummary = summarizePayload(part.output ?? state?.output ?? state?.error);
  const summary = inputSummary ?? outputSummary ?? readString(part.text);
  const partId = readString(part.id);
  return {
    id: makeRawEventId(input.attempt, input.sequence, partId),
    sequence: input.sequence,
    attemptId: input.attempt.id,
    retryIndex: input.attempt.retryIndex,
    type,
    title: partTitle(part, type),
    status: readEventStatus(part),
    timestampMs: readTimestampMs(part) ?? readTimestampMs(input.record),
    elapsedMs: readFiniteNumber(part.elapsedMs) ?? readFiniteNumber(part.elapsed),
    toolName: readString(part.tool) ?? readString(part.toolName) ?? readString(part.name),
    messageId: readString(part.messageId) ?? readString(input.record.messageId),
    partId,
    summary,
    rawPayload: input.record,
    hasRawPayload: true,
  };
}

export function parseOpencodeRawEventStream(
  rawEvents: string,
  attempt: AgentTraceAttempt,
): { events: AgentTraceEvent[]; warnings: string[] } {
  const events: AgentTraceEvent[] = [];
  const warnings = new Set<string>();

  for (const line of rawEvents.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(line) as unknown;
    } catch {
      warnings.add("opencode_raw_event_parse_failed");
      continue;
    }
    const record = asRecord(parsed);
    if (!record) {
      warnings.add("opencode_raw_event_non_object");
      continue;
    }
    const event = rawEventRecordToTraceEvent({
      record,
      attempt,
      sequence: events.length,
    });
    if (event) {
      events.push(event);
    }
  }

  if (rawEvents.trim().length > 0 && events.length === 0) {
    warnings.add("opencode_raw_events_empty_after_parse");
  }
  return { events, warnings: Array.from(warnings) };
}

export function parseOpencodeSessionEvents(
  snapshot: OpencodeSessionSnapshot,
  attempts: AgentTraceAttempt[],
): { events: AgentTraceEvent[]; warnings: string[] } {
  const events: AgentTraceEvent[] = [];
  const warnings = new Set<string>();

  function pushEvent(event: Omit<AgentTraceEvent, "id" | "sequence"> & { id?: string }): void {
    const attempt = findAttempt(event.timestampMs, attempts);
    if (!attempt && attempts.length > 0) {
      warnings.add("event_attempt_unresolved");
    }
    const sequence = events.length;
    events.push({
      id: event.id ?? makeEventId(snapshot.id, sequence, event.partId),
      sequence,
      ...event,
      attemptId: event.attemptId ?? attempt?.id,
      retryIndex: event.retryIndex ?? attempt?.retryIndex,
      hasRawPayload: event.hasRawPayload ?? event.rawPayload !== undefined,
    });
  }

  for (const message of snapshot.messages) {
    const info = asRecord(message.info);
    if (info) {
      pushEvent({
        type: "message",
        title: messageTitle(info),
        messageId: readString(info.id),
        timestampMs: readTimestampMs(info),
        rawPayload: info,
        summary: readString(info.role),
      });
    }
    for (const rawPart of message.parts ?? []) {
      const part = asRecord(rawPart);
      if (!part) {
        continue;
      }
      const type = normalizeEventType(part.type);
      const state = asRecord(part.state);
      const inputSummary = summarizePayload(part.input ?? state?.input);
      const outputSummary = summarizePayload(part.output ?? state?.output ?? state?.error);
      const summary = inputSummary ?? outputSummary ?? readString(part.text);
      pushEvent({
        type,
        title: partTitle(part, type),
        status: readEventStatus(part),
        timestampMs: readTimestampMs(part),
        elapsedMs: readFiniteNumber(part.elapsedMs) ?? readFiniteNumber(part.elapsed),
        toolName: readString(part.tool) ?? readString(part.toolName),
        messageId: info ? readString(info.id) : undefined,
        partId: readString(part.id),
        summary,
        rawPayload: part,
      });
    }
  }

  return { events, warnings: Array.from(warnings) };
}
