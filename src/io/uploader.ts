export interface UploadPayload {
  caseId: string;
  fileName: string;
  content: string;
}

export async function uploadResultJson(
  endpoint: string | undefined,
  token: string | undefined,
  payload: UploadPayload,
): Promise<{ uploaded: boolean; message: string }> {
  if (!endpoint) {
    return { uploaded: false, message: "未配置 UPLOAD_ENDPOINT，已跳过上传。" };
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    return { uploaded: false, message: `上传失败，状态码：${response.status}` };
  }
  return { uploaded: true, message: "上传成功。" };
}
