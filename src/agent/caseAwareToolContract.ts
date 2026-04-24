import type { CaseToolName } from "../types.js";

export const SHARED_CASE_AWARE_ALLOWED_TOOLS: CaseToolName[] = [
  "read_patch",
  "list_dir",
  "read_file",
  "read_files",
  "read_file_chunk",
  "grep_in_files",
  "read_json",
];

export const SHARED_CASE_TOOL_CATALOG_LINE = `case 目录只读工具包括：${SHARED_CASE_AWARE_ALLOWED_TOOLS.join("、")}。`;

export const SHARED_CASE_TOOL_ARGUMENT_LINES = [
  "read_patch: args 可为空，或仅允许 path 字段。",
  "list_dir: args = { path }，只允许 path 字段。",
  "read_file: args = { path }，只允许 path 字段。",
  "read_files: args = { paths }，paths 必须是非空字符串数组。",
  "read_file_chunk: args = { path, startLine, lineCount }。",
  "grep_in_files: args = { pattern, path, limit }，其中 limit 必须在 1 到 100 之间。",
  "read_json: args = { path }，只允许 path 字段。",
];

export function createRuleAgentToolContract(): {
  allowed_tools: CaseToolName[];
  max_tool_calls: number;
  max_total_bytes: number;
  max_files: number;
} {
  return {
    allowed_tools: [...SHARED_CASE_AWARE_ALLOWED_TOOLS],
    max_tool_calls: 6,
    max_total_bytes: 122880,
    max_files: 40,
  };
}

export function createRubricAgentToolContract(): {
  allowed_tools: CaseToolName[];
  max_tool_calls: number;
  max_total_bytes: number;
  max_files: number;
} {
  return {
    allowed_tools: [...SHARED_CASE_AWARE_ALLOWED_TOOLS],
    max_tool_calls: 4,
    max_total_bytes: 81920,
    max_files: 24,
  };
}
