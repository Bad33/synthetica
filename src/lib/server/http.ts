import { z } from "zod";
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function readJson(
  req: Request,
  maxBytes = 32_000,
): Promise<unknown> {
  if (!req.headers.get("content-type")?.includes("application/json"))
    throw new ApiError(415, "Send application/json.");
  if (Number(req.headers.get("content-length")) > maxBytes)
    throw new ApiError(413, "Request is too large.");
  if (!req.body) throw new ApiError(400, "A request body is required.");
  const reader = req.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new ApiError(413, "Request is too large.");
      }
      parts.push(value);
    }
    return JSON.parse(Buffer.concat(parts).toString("utf8"));
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, "Invalid JSON.");
  } finally {
    reader.releaseLock();
  }
}
export function failure(error: unknown): Response {
  if (error instanceof ApiError)
    return Response.json(
      { error: error.message },
      {
        status: error.status,
        headers: {
          "Cache-Control": "no-store",
          ...(error.status === 429 ? { "Retry-After": "3600" } : {}),
        },
      },
    );
  if (error instanceof z.ZodError)
    return Response.json(
      { error: "Invalid input. Check required fields and size limits." },
      { status: 400 },
    );
  // Never return upstream errors, source text, tokens, or database details.
  console.error(
    "Research request failed",
    error instanceof Error ? error.name : "UnknownError",
  );
  return Response.json(
    { error: "The request could not be completed. Please try again." },
    { status: 500 },
  );
}
export function json(value: unknown): Response {
  return Response.json(value, { headers: { "Cache-Control": "no-store" } });
}
