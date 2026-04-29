export type ApiMethod = "GET" | "POST" | "OPTIONS";

export type ApiSchemaPrimitive = "boolean" | "number" | "string" | "object" | "array" | "unknown";

export type ApiFieldSchema = {
  type: ApiSchemaPrimitive | "enum";
  description: string;
  required?: boolean;
  values?: readonly string[];
  properties?: ApiSchemaProperties;
  items?: ApiFieldSchema;
  example?: unknown;
};

export type ApiSchemaProperties = Record<string, ApiFieldSchema>;

export type ApiObjectSchema = {
  type: "object";
  description: string;
  properties: ApiSchemaProperties;
  example?: Record<string, unknown>;
};

export type ApiRequestDefinition = {
  pathParams?: ApiSchemaProperties;
  headers?: ApiSchemaProperties;
  body?: ApiObjectSchema;
};

export type ApiResponseDefinition = {
  status: number;
  description: string;
  body: ApiObjectSchema;
};

export type ApiCallbackDefinition = {
  name: string;
  method: ApiMethod;
  urlSource: string;
  description: string;
  headers?: ApiSchemaProperties;
  body: ApiObjectSchema;
};

export type ApiDefinition = {
  method: ApiMethod;
  path: string;
  description: string;
  request?: ApiRequestDefinition;
  responses: ApiResponseDefinition[];
  callbacks?: ApiCallbackDefinition[];
};

export const API_PATHS = {
  health: "/health",
  runRemoteTask: "/score/run-remote-task",
  remoteTaskResult: "/score/remote-tasks/:taskId/result",
  ruleViolationStats: "/score/rule-violation-stats",
  humanReview: "/score/remote-tasks/:taskId/human-review",
  humanReviewStatus: "/score/human-reviews/:reviewId",
} as const;

const successField = {
  type: "boolean",
  required: true,
  description: "Whether the request was handled successfully.",
} as const satisfies ApiFieldSchema;

const messageField = {
  type: "string",
  required: true,
  description: "Human-readable result or error message.",
} as const satisfies ApiFieldSchema;

const taskIdField = {
  type: "number",
  required: true,
  description: "Remote evaluation task id.",
} as const satisfies ApiFieldSchema;

const statusField = {
  type: "enum",
  required: true,
  values: ["pending", "running", "completed", "failed"],
  description: "Remote evaluation callback status.",
} as const satisfies ApiFieldSchema;

const remoteTaskRecordStatusField = {
  type: "enum",
  required: false,
  values: ["preparing", "queued", "running", "completed", "failed", "timed_out"],
  description: "Internal remote task execution status recorded by this service.",
} as const satisfies ApiFieldSchema;

const errorResponseBody = {
  type: "object",
  description: "Common failure response body.",
  properties: {
    success: successField,
    message: messageField,
  },
} as const satisfies ApiObjectSchema;

const remoteTestCaseSchema = {
  type: "object",
  required: true,
  description: "Remote test case metadata and original project manifest URL.",
  properties: {
    id: { type: "number", required: true, description: "Remote test case id." },
    name: { type: "string", required: true, description: "Remote test case name." },
    type: { type: "string", required: true, description: "Remote test case type." },
    description: { type: "string", required: true, description: "Requirement description." },
    input: { type: "string", required: true, description: "Original task input prompt." },
    expectedOutput: {
      type: "string",
      required: true,
      description: "Expected output description from remote platform.",
    },
    fileUrl: {
      type: "string",
      required: true,
      description: "URL of original project file manifest JSON.",
    },
  },
} as const satisfies ApiFieldSchema;

const remoteExecutionResultSchema = {
  type: "object",
  required: true,
  description: "Submitted execution result and generated project artifact URLs.",
  properties: {
    isBuildSuccess: {
      type: "boolean",
      required: true,
      description: "Whether the submitted project build succeeded remotely.",
    },
    outputCodeUrl: {
      type: "string",
      required: true,
      description: "URL of generated project file manifest JSON.",
    },
    diffFileUrl: {
      type: "string",
      required: false,
      description: "Optional URL of patch/diff file for the submitted changes.",
    },
  },
} as const satisfies ApiFieldSchema;

const resultDataField = {
  type: "object",
  required: false,
  description:
    "Completed callback result subset containing only basic_info and overall_conclusion. Full scoring result JSON is available from the result API.",
} as const satisfies ApiFieldSchema;

const remoteCallbackDefinition = {
  name: "remoteTaskCallback",
  method: "POST",
  urlSource: "request.body.callback",
  description: "Callback sent to the remote platform while executing an accepted remote task.",
  body: {
    type: "object",
    description: "Remote task callback payload produced by this service.",
    properties: {
      success: {
        type: "boolean",
        required: false,
        description: "True for completed callbacks.",
      },
      taskId: taskIdField,
      status: statusField,
      resultData: resultDataField,
      errorMessage: {
        type: "string",
        required: false,
        description: "Failure message. Present for failed callbacks.",
      },
    },
  },
} as const satisfies ApiCallbackDefinition;

export const API_DEFINITIONS: ApiDefinition[] = [
  {
    method: "GET",
    path: API_PATHS.health,
    description: "Service health check.",
    responses: [
      {
        status: 200,
        description: "Service is running.",
        body: {
          type: "object",
          description: "Health check response.",
          properties: {
            ok: { type: "boolean", required: true, description: "Always true when service is up." },
          },
          example: { ok: true },
        },
      },
    ],
  },
  {
    method: "POST",
    path: API_PATHS.runRemoteTask,
    description: "Accept one remote evaluation task and execute it asynchronously.",
    request: {
      body: {
        type: "object",
        description: "Remote evaluation task request body.",
        properties: {
          taskId: taskIdField,
          testCase: remoteTestCaseSchema,
          executionResult: remoteExecutionResultSchema,
          token: {
            type: "string",
            required: false,
            description: "Deprecated. This service no longer requires or echoes callback tokens.",
          },
          callback: {
            type: "string",
            required: true,
            description: "Callback URL to receive remote task progress and final result payloads.",
          },
        },
      },
    },
    responses: [
      {
        status: 200,
        description: "Remote task accepted and queued for asynchronous execution.",
        body: {
          type: "object",
          description: "Remote task acceptance response.",
          properties: {
            success: successField,
            taskId: taskIdField,
            message: messageField,
          },
          example: {
            success: true,
            taskId: 4,
            message: "任务接收成功，结果将通过 callback 返回",
          },
        },
      },
      { status: 500, description: "Remote task acceptance failed.", body: errorResponseBody },
    ],
    callbacks: [remoteCallbackDefinition],
  },
  {
    method: "GET",
    path: API_PATHS.ruleViolationStats,
    description: "Read aggregated static rule violation statistics.",
    responses: [
      {
        status: 200,
        description: "Static rule violation statistics.",
        body: {
          type: "object",
          description: "Rules-only static violation stats response.",
          properties: {
            success: successField,
            filters: {
              type: "object",
              required: true,
              description: "Applied query filters.",
            },
            summary: {
              type: "object",
              required: true,
              description: "Aggregate run and violation counts.",
            },
            rules: {
              type: "array",
              required: true,
              description: "Aggregated static rule violation rows. No cases summary is returned.",
              items: {
                type: "object",
                description: "One static rule violation aggregate.",
              },
            },
          },
        },
      },
      { status: 400, description: "Invalid query parameter.", body: errorResponseBody },
      { status: 500, description: "Stats index could not be read.", body: errorResponseBody },
    ],
  },
  {
    method: "GET",
    path: API_PATHS.remoteTaskResult,
    description: "Read the completed remote task result JSON as resultData.",
    request: {
      pathParams: {
        taskId: taskIdField,
      },
    },
    responses: [
      {
        status: 200,
        description: "Completed remote task result is available.",
        body: {
          type: "object",
          description: "Remote task result response.",
          properties: {
            success: successField,
            taskId: taskIdField,
            status: remoteTaskRecordStatusField,
            resultData: {
              type: "object",
              required: true,
              description: "Parsed outputs/result.json content for the completed task.",
            },
          },
        },
      },
      {
        status: 404,
        description: "Task record or result file was not found.",
        body: {
          type: "object",
          description: "Remote task not found response.",
          properties: {
            success: successField,
            taskId: { ...taskIdField, required: false },
            status: remoteTaskRecordStatusField,
            message: messageField,
          },
        },
      },
      {
        status: 409,
        description: "Task exists but has not completed yet.",
        body: {
          type: "object",
          description: "Remote task result unavailable response.",
          properties: {
            success: successField,
            taskId: taskIdField,
            status: remoteTaskRecordStatusField,
            message: messageField,
          },
        },
      },
    ],
  },
  {
    method: "POST",
    path: API_PATHS.humanReview,
    description:
      "Accept human review results for a completed remote task and queue evidence ingestion.",
    request: {
      pathParams: { taskId: taskIdField },
      body: {
        type: "object",
        description: "Human review submission from the remote scoring console.",
        properties: {
          overallDecision: {
            type: "enum",
            required: true,
            values: ["accepted", "rejected", "adjust_required", "uncertain"],
            description: "Overall human review decision for this completed task.",
          },
          overallComment: {
            type: "string",
            required: false,
            description: "Optional overall human review comment.",
          },
          itemReviews: {
            type: "array",
            required: true,
            description: "Per-item human review results. Must contain at least one item.",
            items: { type: "object", description: "One human review item result." },
          },
        },
      },
    },
    responses: [
      {
        status: 200,
        description:
          "Human review raw record was stored and asynchronous classification was queued.",
        body: {
          type: "object",
          description: "Human review acceptance response.",
          properties: {
            success: successField,
            taskId: taskIdField,
            reviewId: {
              type: "string",
              required: true,
              description: "Generated human review id.",
            },
            status: {
              type: "string",
              required: true,
              description: "Submission acceptance status.",
            },
            rawPath: {
              type: "string",
              required: true,
              description: "Path to the stored raw review record.",
            },
            classificationStatus: {
              type: "string",
              required: true,
              description: "Initial asynchronous classification status.",
            },
            message: messageField,
          },
        },
      },
      { status: 400, description: "Invalid human review payload.", body: errorResponseBody },
      {
        status: 404,
        description: "Task record or result file was not found.",
        body: errorResponseBody,
      },
      {
        status: 409,
        description: "Task exists but has not completed yet.",
        body: errorResponseBody,
      },
    ],
  },
  {
    method: "GET",
    path: API_PATHS.humanReviewStatus,
    description: "Read asynchronous human review ingestion status.",
    request: {
      pathParams: {
        reviewId: {
          type: "string",
          required: true,
          description: "Generated human review id.",
        },
      },
    },
    responses: [
      {
        status: 200,
        description: "Human review ingestion status.",
        body: {
          type: "object",
          description: "Stored human review status record.",
          properties: {
            success: successField,
            reviewId: { type: "string", required: true, description: "Human review id." },
            taskId: taskIdField,
            status: { type: "string", required: true, description: "Ingestion status." },
            classificationSummary: {
              type: "object",
              required: false,
              description: "Classification summary when available.",
            },
          },
        },
      },
      { status: 404, description: "Human review status was not found.", body: errorResponseBody },
    ],
  },
];
