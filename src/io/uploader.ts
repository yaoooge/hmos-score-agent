import { RemoteCallbackPayload } from "../types.js";

export interface UploadPayload {
  caseId: string;
  fileName: string;
  content: string;
}

async function postJson(
  endpoint: string | undefined,
  headers: Record<string, string>,
  payload: unknown,
  missingEndpointMessage: string,
  successMessage: string,
): Promise<{ uploaded: boolean; message: string }> {
  if (!endpoint) {
    return { uploaded: false, message: missingEndpointMessage };
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    return { uploaded: false, message: `上传失败，状态码：${response.status}` };
  }

  return { uploaded: true, message: successMessage };
}

export async function uploadResultJson(
  endpoint: string | undefined,
  token: string | undefined,
  payload: UploadPayload,
): Promise<{ uploaded: boolean; message: string }> {
  return postJson(
    endpoint,
    token ? { Authorization: `Bearer ${token}` } : {},
    payload,
    "未配置 UPLOAD_ENDPOINT，已跳过上传。",
    "上传成功。",
  );
}

export async function uploadTaskCallback(
  endpoint: string | undefined,
  token: string | undefined,
  payload: RemoteCallbackPayload,
): Promise<{ uploaded: boolean; message: string }> {
  return postJson(
    endpoint,
    token ? { token } : {},
    payload,
    "未提供 callback，已跳过回传。",
    "callback 上传成功。",
  );
}
