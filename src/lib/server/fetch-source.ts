import { lookup } from "node:dns/promises";
import { request } from "node:https";
import ipaddr from "ipaddr.js";
import { ApiError } from "./http";
export const MAX_FILE_BYTES = 3 * 1024 * 1024;
export function publicAddress(address: string): boolean {
  try {
    return ipaddr.process(address).range() === "unicast";
  } catch {
    return false;
  }
}
export function sourceUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ApiError(400, "Provide a valid HTTPS paper URL or DOI.");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443")
  )
    throw new ApiError(
      400,
      "Only HTTPS URLs on port 443 without credentials are supported.",
    );
  if (
    url.hostname === "localhost" ||
    url.hostname.endsWith(".localhost") ||
    url.hostname.endsWith(".local")
  )
    throw new ApiError(400, "Private network sources are not allowed.");
  return url;
}
export async function fetchSource(
  raw: string,
  redirects = 0,
  deadline = Date.now() + 20_000,
): Promise<{ body: Buffer; mime: string; url: string }> {
  if (redirects > 4)
    throw new ApiError(
      422,
      "The source redirected too many times. Upload the document instead.",
    );
  const url = sourceUrl(raw);
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new ApiError(504, "Source retrieval timed out.");
  let dnsTimer: ReturnType<typeof setTimeout> | undefined;
  const addresses = await Promise.race([
    lookup(hostname, { all: true }),
    new Promise<never>((_, reject) => {
      dnsTimer = setTimeout(
        () => reject(new ApiError(504, "Source lookup timed out.")),
        Math.min(5000, remaining),
      );
    }),
  ]).finally(() => clearTimeout(dnsTimer));
  if (!addresses.length || addresses.some((a) => !publicAddress(a.address)))
    throw new ApiError(
      400,
      "Private or reserved network sources are not allowed.",
    );
  const target = addresses[0];
  const response = await new Promise<{
    body: Buffer;
    mime: string;
    location?: string;
  }>((resolve, reject) => {
    // Pin the checked address for this connection to prevent DNS rebinding.
    const req = request(
      url,
      {
        method: "GET",
        agent: false,
        lookup: (_host, _options, callback) => callback(null, [target]),
        headers: {
          Accept: "application/pdf,text/html,text/plain",
          "Accept-Encoding": "identity",
          "User-Agent": "Synthetica/0.2 (research source retrieval)",
        },
      },
      (res) => {
        const status = res.statusCode ?? 500;
        if (
          [301, 302, 303, 307, 308].includes(status) &&
          res.headers.location
        ) {
          res.resume();
          resolve({
            body: Buffer.alloc(0),
            mime: "",
            location: res.headers.location,
          });
          return;
        }
        if (status !== 200) {
          res.resume();
          reject(
            new ApiError(
              422,
              "The source could not be retrieved. Upload a PDF or paste the text.",
            ),
          );
          return;
        }
        if (Number(res.headers["content-length"]) > MAX_FILE_BYTES) {
          res.destroy();
          reject(new ApiError(413, "The source exceeds 3 MB."));
          return;
        }
        const parts: Buffer[] = [];
        let size = 0;
        res.on("data", (part: Buffer) => {
          size += part.length;
          if (size > MAX_FILE_BYTES) {
            res.destroy();
            reject(new ApiError(413, "The source exceeds 3 MB."));
          } else parts.push(part);
        });
        res.on("end", () =>
          resolve({
            body: Buffer.concat(parts),
            mime: String(res.headers["content-type"] || "")
              .split(";")[0]
              .toLowerCase(),
          }),
        );
        res.on("error", reject);
      },
    );
    const requestTimer = setTimeout(
      () => req.destroy(new ApiError(504, "Source retrieval timed out.")),
      Math.max(1, Math.min(10_000, deadline - Date.now())),
    );
    req.on("close", () => clearTimeout(requestTimer));
    req.on("error", reject);
    req.end();
  });
  if (response.location)
    return fetchSource(
      new URL(response.location, url).toString(),
      redirects + 1,
      deadline,
    );
  return { ...response, url: url.toString() };
}
