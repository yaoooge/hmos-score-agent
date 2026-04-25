import { z } from "zod";

export class StrictJsonProtocolError extends Error {
  constructor(
    public readonly code:
      | "not_single_json_object"
      | "multiple_json_objects"
      | "invalid_json"
      | "schema_validation",
    message: string,
  ) {
    super(`protocol_error: ${message}`);
    this.name = "StrictJsonProtocolError";
  }
}

function formatIssuePath(path: PropertyKey[]): string {
  if (path.length === 0) {
    return "<root>";
  }

  return path
    .map((segment) => {
      const segmentText = String(segment);
      return typeof segment === "number"
        ? `[${segment}]`
        : /^[A-Za-z_][A-Za-z0-9_]*$/.test(segmentText)
          ? segmentText
          : JSON.stringify(segmentText);
    })
    .join(".")
    .replace(/\.\[/g, "[");
}

export function formatSchemaValidationError(error: z.ZodError): string {
  const formattedIssues = error.issues.map((issue) => {
    const path = formatIssuePath(issue.path);
    return `${path}: ${issue.message}`;
  });

  return formattedIssues.join("; ") || z.prettifyError(error);
}

export function findTopLevelJsonObjectEnd(rawText: string): number {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < rawText.length; index += 1) {
    const char = rawText[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) {
      continue;
    }

    if (char === "{") {
      depth += 1;
      continue;
    }

    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
}

export function parseSingleJsonObjectStrict<T>(rawText: string, schema: z.ZodSchema<T>): T {
  const trimmed = rawText.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    throw new StrictJsonProtocolError(
      "not_single_json_object",
      "output must be one top-level JSON object without prose",
    );
  }

  const objectEndIndex = findTopLevelJsonObjectEnd(trimmed);
  if (objectEndIndex >= 0 && objectEndIndex < trimmed.length - 1) {
    throw new StrictJsonProtocolError(
      "multiple_json_objects",
      "received multiple top-level JSON objects in one response",
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new StrictJsonProtocolError("invalid_json", `invalid JSON: ${message}`);
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new StrictJsonProtocolError(
      "schema_validation",
      formatSchemaValidationError(result.error),
    );
  }

  return result.data;
}
