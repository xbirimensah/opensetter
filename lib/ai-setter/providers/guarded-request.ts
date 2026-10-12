/**
 * Outbound HTTP for UI-configured model providers.
 *
 * fetch() resolves the hostname itself and follows redirects, so a
 * pre-flight DNS check can be bypassed by DNS rebinding (public on the
 * check, private on the connect) or by a 3xx to an internal URL. This
 * helper validates the address the socket actually connects to, never
 * follows redirects, and caps the response size.
 */

import { lookup as dnsLookup, type LookupAddress } from "dns";
import http from "http";
import https from "https";
import type { LookupFunction } from "net";
import { isPrivateAddress, validateProviderBaseUrl } from "./base-url";

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

/** Error when any resolved address is private and that is not allowed. */
export function rejectPrivateResolution(
  addresses: readonly string[],
  allowPrivate: boolean
): Error | null {
  if (allowPrivate) return null;
  return addresses.some((address) => isPrivateAddress(address))
    ? new Error("Provider host resolves to a private address; refusing to send credentials")
    : null;
}

function guardedLookup(allowPrivate: boolean): LookupFunction {
  return (hostname, options, callback) => {
    dnsLookup(hostname, { ...options, all: true }, (error, results) => {
      if (error) {
        callback(error, "", 0);
        return;
      }
      const entries = results as LookupAddress[];
      const rejection = rejectPrivateResolution(
        entries.map((entry) => entry.address),
        allowPrivate
      );
      if (rejection || entries.length === 0) {
        callback(rejection ?? new Error(`No address for ${hostname}`), "", 0);
        return;
      }
      if (options.all) {
        callback(null, entries);
      } else {
        callback(null, entries[0].address, entries[0].family);
      }
    });
  };
}

export interface GuardedResponse {
  status: number;
  body: string;
}

export function postJsonGuarded(
  url: string,
  headers: Record<string, string>,
  payload: unknown,
  options: { timeoutMs: number; allowPrivate: boolean }
): Promise<GuardedResponse> {
  const check = validateProviderBaseUrl(url, { allowPrivate: options.allowPrivate });
  if (!check.ok) return Promise.reject(new Error(check.error));
  return requestGuarded(url, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    timeoutMs: options.timeoutMs,
    allowPrivate: options.allowPrivate,
  });
}

/**
 * One HTTP(S) request that checks the address the socket connects to,
 * never follows redirects and stops reading past maxBytes. Callers
 * validate the URL itself (scheme, host, port) first.
 */
export function requestGuarded(
  url: string,
  options: {
    method: "GET" | "POST";
    headers: Record<string, string>;
    body?: string;
    timeoutMs: number;
    allowPrivate: boolean;
    maxBytes?: number;
  }
): Promise<GuardedResponse> {
  const target = new URL(url);
  const transport = target.protocol === "http:" ? http : https;
  const maxBytes = options.maxBytes ?? MAX_RESPONSE_BYTES;
  const body = options.method === "POST" ? options.body ?? "" : undefined;

  return new Promise((resolve, reject) => {
    const request = transport.request(
      target,
      {
        method: options.method,
        headers: {
          ...options.headers,
          ...(body !== undefined ? { "Content-Length": Buffer.byteLength(body).toString() } : {}),
        },
        lookup: guardedLookup(options.allowPrivate),
        timeout: options.timeoutMs,
      },
      (response) => {
        const status = response.statusCode ?? 0;
        if (status >= 300 && status < 400) {
          response.resume();
          reject(new Error(`Answered with a redirect (${status}); redirects are not followed`));
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > maxBytes) {
            request.destroy(new Error("Response too large"));
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () => resolve({ status, body: Buffer.concat(chunks).toString("utf8") }));
        response.on("error", reject);
      }
    );
    // "timeout" is per idle socket; this caps the whole exchange, so a server
    // dripping bytes slowly can't hold the request open forever.
    const deadline = setTimeout(() => request.destroy(new Error("Request timed out")), options.timeoutMs);
    request.on("close", () => clearTimeout(deadline));
    request.on("timeout", () => request.destroy(new Error("Request timed out")));
    request.on("error", reject);
    request.end(body);
  });
}
