export class RequestTooLargeError extends Error {
  constructor() { super("Request body exceeds the GentX2 upload limit"); this.name = "RequestTooLargeError"; }
}

export async function readBoundedFormData(request: Request, maximumBytes: number) {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data;")) throw new Error("Expected multipart form data");
  const declared = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(declared) && declared > maximumBytes) throw new RequestTooLargeError();
  if (!request.body) throw new Error("Request body is empty");

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maximumBytes) {
        await reader.cancel("GentX2 request size limit exceeded");
        throw new RequestTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  const boundedRequest = new Request(request.url, { method: "POST", headers: { "content-type": contentType }, body });
  return boundedRequest.formData();
}
