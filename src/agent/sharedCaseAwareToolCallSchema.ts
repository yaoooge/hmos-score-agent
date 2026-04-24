import { z } from "zod";
import { caseToolNameSchema } from "./caseToolSchemas.js";

export const sharedCaseAwareToolCallSchema = z
  .object({
    action: z.literal("tool_call"),
    tool: caseToolNameSchema,
    args: z.record(z.string(), z.unknown()),
    reason: z.string().optional(),
  })
  .strict();
