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
    return { uploaded: false, message: "UPLOAD_ENDPOINT is empty; skipped upload." };
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
    return { uploaded: false, message: `Upload failed: ${response.status}` };
  }
  return { uploaded: true, message: "Uploaded successfully." };
}
