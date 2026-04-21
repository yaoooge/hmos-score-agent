import fs from "node:fs/promises";
import path from "node:path";
import type { CaseToolBudgetSnapshot, CaseToolName } from "../types.js";
import {
  caseToolCallSchema,
  grepInFilesArgsSchema,
  listDirArgsSchema,
  readFileChunkArgsSchema,
  readPathArgsSchema,
} from "./caseToolSchemas.js";

type CaseToolErrorCode =
  | "tool_budget_exceeded"
  | "path_out_of_scope"
  | "file_not_found"
  | "invalid_args"
  | "file_budget_exceeded"
  | "byte_budget_exceeded"
  | "invalid_json";

type CaseToolSuccess = {
  ok: true;
  result: Record<string, unknown>;
  budget: CaseToolBudgetSnapshot;
  pathsRead: string[];
  bytesReturned: number;
};

type CaseToolFailure = {
  ok: false;
  error: {
    code: CaseToolErrorCode;
    message: string;
  };
  budget: CaseToolBudgetSnapshot;
  pathsRead: string[];
  bytesReturned: number;
};

type CaseToolResult = CaseToolSuccess | CaseToolFailure;

const READ_PATCH_MAX_BYTES = 12 * 1024;

function buildBudgetSnapshot(input: {
  maxToolCalls: number;
  maxTotalBytes: number;
  maxFiles: number;
  usedToolCalls: number;
  usedBytes: number;
  readFileCount: number;
}): CaseToolBudgetSnapshot {
  return {
    usedToolCalls: input.usedToolCalls,
    usedBytes: input.usedBytes,
    readFileCount: input.readFileCount,
    remainingToolCalls: Math.max(0, input.maxToolCalls - input.usedToolCalls),
    remainingBytes: Math.max(0, input.maxTotalBytes - input.usedBytes),
    remainingFileSlots: Math.max(0, input.maxFiles - input.readFileCount),
  };
}

function truncateToBytes(text: string, maxBytes: number): {
  content: string;
  bytes: number;
  truncated: boolean;
} {
  const buffer = Buffer.from(text, "utf8");
  if (buffer.length <= maxBytes) {
    return {
      content: text,
      bytes: buffer.length,
      truncated: false,
    };
  }

  let end = maxBytes;
  while (end > 0 && (buffer[end] & 0b11000000) === 0b10000000) {
    end -= 1;
  }

  return {
    content: buffer.subarray(0, end).toString("utf8"),
    bytes: end,
    truncated: true,
  };
}

async function ensureFileExists(filePath: string): Promise<void> {
  try {
    await fs.access(filePath);
  } catch {
    throw new Error("file_not_found");
  }
}

async function listFilesRecursive(rootPath: string): Promise<string[]> {
  const entries = await fs.readdir(rootPath, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(rootPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFilesRecursive(fullPath)));
      continue;
    }
    if (entry.isFile()) {
      files.push(fullPath);
    }
  }

  return files;
}

export function createCaseToolExecutor(config: {
  caseRoot: string;
  effectivePatchPath?: string;
  maxToolCalls: number;
  maxTotalBytes: number;
  maxFiles: number;
}): {
  execute(input: { tool: CaseToolName; args: Record<string, unknown> }): Promise<CaseToolResult>;
  getBudget(): CaseToolBudgetSnapshot;
} {
  const normalizedCaseRoot = path.resolve(config.caseRoot);
  const normalizedEffectivePatchPath = config.effectivePatchPath
    ? path.resolve(config.effectivePatchPath)
    : undefined;
  let usedToolCalls = 0;
  let usedBytes = 0;
  const readFiles = new Set<string>();

  function getBudget(): CaseToolBudgetSnapshot {
    return buildBudgetSnapshot({
      maxToolCalls: config.maxToolCalls,
      maxTotalBytes: config.maxTotalBytes,
      maxFiles: config.maxFiles,
      usedToolCalls,
      usedBytes,
      readFileCount: readFiles.size,
    });
  }

  function failure(code: CaseToolErrorCode, message: string, pathsRead: string[] = []): CaseToolFailure {
    return {
      ok: false,
      error: { code, message },
      budget: getBudget(),
      pathsRead,
      bytesReturned: 0,
    };
  }

  function normalizeScopePath(relativePath: string): { relativePath: string; absolutePath: string } {
    const absolutePath = path.resolve(normalizedCaseRoot, relativePath);
    const relativeToRoot = path.relative(normalizedCaseRoot, absolutePath);

    if (
      normalizedEffectivePatchPath &&
      absolutePath === normalizedEffectivePatchPath
    ) {
      return {
        relativePath: path.relative(normalizedCaseRoot, absolutePath),
        absolutePath,
      };
    }

    if (
      relativeToRoot.startsWith("..") ||
      path.isAbsolute(relativeToRoot) ||
      relativeToRoot.length === 0 && absolutePath !== normalizedCaseRoot
    ) {
      throw new Error("path_out_of_scope");
    }

    return {
      relativePath: relativeToRoot.length > 0 ? relativeToRoot : ".",
      absolutePath,
    };
  }

  function trackFile(relativePath: string): void {
    if (!readFiles.has(relativePath) && readFiles.size >= config.maxFiles) {
      throw new Error("file_budget_exceeded");
    }
    readFiles.add(relativePath);
  }

  function finalizeSuccess(
    payload: Record<string, unknown>,
    pathsRead: string[],
    rawTextPayload: string | undefined,
    maxBytesOverride?: number,
  ): CaseToolSuccess | CaseToolFailure {
    const remainingBytes = config.maxTotalBytes - usedBytes;
    if (remainingBytes <= 0) {
      return failure("byte_budget_exceeded", "byte budget exceeded", pathsRead);
    }

    const serialized = rawTextPayload ?? JSON.stringify(payload, null, 2);
    const truncated = truncateToBytes(
      serialized,
      Math.max(1, Math.min(remainingBytes, maxBytesOverride ?? remainingBytes)),
    );
    usedBytes += truncated.bytes;

    if (rawTextPayload !== undefined) {
      return {
        ok: true,
        result: {
          ...payload,
          content: truncated.content,
          truncated: truncated.truncated,
        },
        budget: getBudget(),
        pathsRead,
        bytesReturned: truncated.bytes,
      };
    }

    return {
      ok: true,
      result: {
        ...payload,
        truncated: truncated.truncated,
      },
      budget: getBudget(),
      pathsRead,
      bytesReturned: truncated.bytes,
    };
  }

  async function execute(input: {
    tool: CaseToolName;
    args: Record<string, unknown>;
  }): Promise<CaseToolResult> {
    if (usedToolCalls >= config.maxToolCalls) {
      return failure("tool_budget_exceeded", "tool call budget exceeded");
    }

    usedToolCalls += 1;

    const parsedCall = caseToolCallSchema.safeParse(input);
    if (!parsedCall.success) {
      return failure("invalid_args", parsedCall.error.message);
    }

    try {
      switch (parsedCall.data.tool) {
        case "read_patch": {
          const normalizedArgs = {
            path:
              (typeof parsedCall.data.args.path === "string" && parsedCall.data.args.path) ||
              (typeof parsedCall.data.args.patch_path === "string" &&
                parsedCall.data.args.patch_path) ||
              undefined,
          };
          const parsedArgs = readPathArgsSchema.partial({ path: true }).safeParse(normalizedArgs);
          if (!parsedArgs.success) {
            return failure("invalid_args", parsedArgs.error.message);
          }

          const scopePath = normalizeScopePath(parsedArgs.data.path ?? "intermediate/effective.patch");
          await ensureFileExists(scopePath.absolutePath);
          trackFile(scopePath.relativePath);
          const content = await fs.readFile(scopePath.absolutePath, "utf-8");
          return finalizeSuccess(
            { path: scopePath.relativePath },
            [scopePath.relativePath],
            content,
            READ_PATCH_MAX_BYTES,
          );
        }
        case "list_dir": {
          const normalizedArgs = {
            path:
              (typeof parsedCall.data.args.path === "string" && parsedCall.data.args.path) ||
              (typeof parsedCall.data.args.root === "string" && parsedCall.data.args.root) ||
              ".",
          };
          const parsedArgs = listDirArgsSchema.safeParse(normalizedArgs);
          if (!parsedArgs.success) {
            return failure("invalid_args", parsedArgs.error.message);
          }

          const scopePath = normalizeScopePath(parsedArgs.data.path);
          const entries = await fs.readdir(scopePath.absolutePath, { withFileTypes: true });
          return finalizeSuccess(
            {
              path: scopePath.relativePath,
              entries: entries.map((entry) => ({
                name: entry.name,
                type: entry.isDirectory() ? "dir" : entry.isFile() ? "file" : "other",
              })),
            },
            [],
            undefined,
          );
        }
        case "read_file": {
          const parsedArgs = readPathArgsSchema.safeParse(parsedCall.data.args);
          if (!parsedArgs.success) {
            return failure("invalid_args", parsedArgs.error.message);
          }

          const scopePath = normalizeScopePath(parsedArgs.data.path);
          await ensureFileExists(scopePath.absolutePath);
          trackFile(scopePath.relativePath);
          const content = await fs.readFile(scopePath.absolutePath, "utf-8");
          return finalizeSuccess({ path: scopePath.relativePath }, [scopePath.relativePath], content);
        }
        case "read_file_chunk": {
          const parsedArgs = readFileChunkArgsSchema.safeParse(parsedCall.data.args);
          if (!parsedArgs.success) {
            return failure("invalid_args", parsedArgs.error.message);
          }

          const scopePath = normalizeScopePath(parsedArgs.data.path);
          await ensureFileExists(scopePath.absolutePath);
          trackFile(scopePath.relativePath);
          const content = await fs.readFile(scopePath.absolutePath, "utf-8");
          const lines = content.split("\n");
          const startIndex = parsedArgs.data.startLine - 1;
          const endIndex = startIndex + parsedArgs.data.lineCount;
          const chunk = lines.slice(startIndex, endIndex).join("\n");
          return finalizeSuccess(
            {
              path: scopePath.relativePath,
              startLine: parsedArgs.data.startLine,
              endLine: Math.min(lines.length, endIndex),
            },
            [scopePath.relativePath],
            chunk,
          );
        }
        case "grep_in_files": {
          const normalizedPatterns = Array.isArray(parsedCall.data.args.patterns)
            ? parsedCall.data.args.patterns.filter((item): item is string => typeof item === "string" && item.length > 0)
            : [];
          const normalizedArgs = {
            pattern: parsedCall.data.args.pattern,
            patterns: normalizedPatterns.length > 0 ? normalizedPatterns : undefined,
            path:
              (typeof parsedCall.data.args.path === "string" && parsedCall.data.args.path) ||
              (typeof parsedCall.data.args.root === "string" && parsedCall.data.args.root) ||
              ".",
            limit: parsedCall.data.args.limit,
          };
          const parsedArgs = grepInFilesArgsSchema.safeParse(normalizedArgs);
          if (!parsedArgs.success) {
            return failure("invalid_args", parsedArgs.error.message);
          }

          const scopePath = normalizeScopePath(parsedArgs.data.path);
          const patterns =
            typeof parsedArgs.data.pattern === "string" && parsedArgs.data.pattern.length > 0
              ? [parsedArgs.data.pattern]
              : parsedArgs.data.patterns ?? [];
          if (patterns.length === 0) {
            return failure("invalid_args", "grep_in_files requires pattern or patterns");
          }
          const requestedFiles = Array.isArray(parsedCall.data.args.files)
            ? parsedCall.data.args.files.filter((item): item is string => typeof item === "string")
            : Array.isArray(parsedCall.data.args.paths)
              ? parsedCall.data.args.paths.filter((item): item is string => typeof item === "string")
              : [];
          const candidateFiles =
            requestedFiles.length > 0
              ? requestedFiles.map((item) => normalizeScopePath(path.join(scopePath.relativePath, item)).absolutePath)
              : (await (async () => {
                  const stat = await fs.stat(scopePath.absolutePath);
                  return stat.isDirectory()
                    ? listFilesRecursive(scopePath.absolutePath)
                    : [scopePath.absolutePath];
                })());
          const matches: Array<{ path: string; line: number; content: string; matched_pattern: string }> = [];
          const trackedPaths: string[] = [];

          for (const filePath of candidateFiles) {
            if (matches.length >= parsedArgs.data.limit) {
              break;
            }

            const relativePath = path.relative(normalizedCaseRoot, filePath);
            const content = await fs.readFile(filePath, "utf-8");
            const lines = content.split("\n");
            for (let index = 0; index < lines.length; index += 1) {
              const line = lines[index] ?? "";
              const matchedPattern = patterns.find((pattern) => line.includes(pattern));
              if (!matchedPattern) {
                continue;
              }
              if (!trackedPaths.includes(relativePath)) {
                trackFile(relativePath);
                trackedPaths.push(relativePath);
              }
              matches.push({
                path: relativePath,
                line: index + 1,
                content: line,
                matched_pattern: matchedPattern,
              });
              if (matches.length >= parsedArgs.data.limit) {
                break;
              }
            }
          }

          return finalizeSuccess(
            {
              path: scopePath.relativePath,
              pattern: patterns[0],
              patterns,
              matches,
            },
            trackedPaths,
            undefined,
          );
        }
        case "read_json": {
          const parsedArgs = readPathArgsSchema.safeParse(parsedCall.data.args);
          if (!parsedArgs.success) {
            return failure("invalid_args", parsedArgs.error.message);
          }

          const scopePath = normalizeScopePath(parsedArgs.data.path);
          await ensureFileExists(scopePath.absolutePath);
          trackFile(scopePath.relativePath);
          const content = await fs.readFile(scopePath.absolutePath, "utf-8");
          try {
            const parsedJson = JSON.parse(content) as Record<string, unknown>;
            return finalizeSuccess(
              {
                path: scopePath.relativePath,
                value: parsedJson,
              },
              [scopePath.relativePath],
              undefined,
            );
          } catch {
            return failure("invalid_json", `invalid json file: ${scopePath.relativePath}`, [
              scopePath.relativePath,
            ]);
          }
        }
        default:
          return failure("invalid_args", `unsupported tool: ${parsedCall.data.tool}`);
      }
    } catch (error) {
      const code =
        error instanceof Error
          ? (error.message as CaseToolErrorCode)
          : "invalid_args";
      if (code === "path_out_of_scope") {
        return failure("path_out_of_scope", "path is outside case root");
      }
      if (code === "file_not_found") {
        return failure("file_not_found", "file does not exist");
      }
      if (code === "file_budget_exceeded") {
        return failure("file_budget_exceeded", "file budget exceeded");
      }
      return failure("invalid_args", error instanceof Error ? error.message : String(error));
    }
  }

  return { execute, getBudget };
}
