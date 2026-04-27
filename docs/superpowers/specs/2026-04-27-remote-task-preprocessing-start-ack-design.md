# Remote Task Preprocessing Start Acknowledgement Design

## Goal

Update `POST /score/run-remote-task` so the HTTP request is acknowledged when the service starts remote task preprocessing, not after preprocessing completes. All later failures, including preprocessing failures and workflow execution failures, are reported through the task `callback` with `status: "failed"` and an error message.

## Current Behavior

The handler currently waits for `prepareRemoteEvaluationTask()` to finish before returning HTTP success. That means failures while downloading remote files, understanding the task, or classifying the input can still become an HTTP `500` response.

## Required Behavior

The new HTTP success boundary is the point where the service has accepted the request, created a local case directory, and logged `远端任务预处理开始`.

The immediate HTTP response must be `200` with:

```json
{
  "success": true,
  "taskId": 4,
  "message": "任务接收成功，结果将通过 callback 返回"
}
```

The immediate response must not include `caseDir`.

After the HTTP response is sent, the background flow continues with remote preprocessing, task understanding, task classification, scoring workflow execution, result persistence, callback upload, and temporary directory cleanup.

## Callback Semantics

All failures after acknowledgement are reported through callback:

```json
{
  "taskId": 4,
  "status": "failed",
  "resultData": {
    "phase": "failed",
    "error": "..."
  },
  "errorMessage": "..."
}
```

Successful execution keeps the existing status progression: `pending`, `running`, `running`, `completed`.

If callback upload itself fails, the background promise logs the failure. There is no HTTP request left to update because the request has already been acknowledged.

## Architecture

Split remote task handling into three service concepts:

1. `acceptRemoteEvaluationTask(remoteTask)`
   - Creates `caseDir`.
   - Writes initial `case-info.json`.
   - Logs `启动远端评分流程` and `远端任务预处理开始`.
   - Returns an accepted task context immediately.

2. `prepareAcceptedRemoteEvaluationTask(acceptedTask)`
   - Runs the existing remote preprocessing work:
     - `remoteTaskPreparationNode`
     - `taskUnderstandingNode`
     - `inputClassificationNode`
   - Returns the fully prepared workflow state currently produced by `prepareRemoteEvaluationTask()`.

3. `executeAcceptedRemoteEvaluationTask(acceptedTask)`
   - Starts callback status updates.
   - Calls `prepareAcceptedRemoteEvaluationTask()` first if the accepted task only contains the initial accepted state.
   - Runs the prepared scoring workflow.
   - Sends `completed` or `failed` callback.
   - Cleans temporary remote task files in `finally` when they exist.

`prepareRemoteEvaluationTask()` remains available as a synchronous preparation helper for existing service tests and compatibility. Internally it can use the new accept plus prepare split.

The HTTP handler should call only `acceptRemoteEvaluationTask()` before sending the immediate success response, then enqueue `executeAcceptedRemoteEvaluationTask()` in the background.

## Error Handling

HTTP should still return an immediate `500` only for errors that occur before acknowledgement, such as malformed request handling, local case directory creation failure, or initial metadata write failure.

Errors after `远端任务预处理开始` must not be surfaced as HTTP failures. They should be caught by `executeAcceptedRemoteEvaluationTask()` and reported through callback as `failed`.

## Testing

Add or update tests for:

1. HTTP returns `success: true` before remote preprocessing finishes.
2. Immediate HTTP response omits `caseDir`.
3. A preprocessing failure after acknowledgement uploads `failed` callback instead of returning HTTP `500`.
4. A workflow execution failure uploads `failed` callback.
5. Existing synchronous `runRemoteEvaluationTask()` still runs the full remote flow and callback sequence.

## Scope

This change does not introduce persistent task storage, a retry queue, a task status query API, or changes to the callback payload shape beyond using the existing `failed` fields consistently.
