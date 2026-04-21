import { z } from "zod";

export const caseToolNameSchema = z.enum([
  "read_patch",
  "list_dir",
  "read_file",
  "read_file_chunk",
  "grep_in_files",
  "read_json",
]);

export const caseToolCallSchema = z.object({
  tool: caseToolNameSchema,
  args: z.record(z.string(), z.unknown()).default({}),
});

export const readPathArgsSchema = z.object({
  path: z.string().min(1),
});

export const listDirArgsSchema = z.object({
  path: z.string().min(1).default("."),
});

export const readFileChunkArgsSchema = z.object({
  path: z.string().min(1),
  startLine: z.number().int().min(1).default(1),
  lineCount: z.number().int().min(1).max(400).default(200),
});

export const grepInFilesArgsSchema = z.object({
  pattern: z.string().min(1),
  path: z.string().min(1).default("."),
  limit: z.number().int().min(1).max(100).default(20),
});
