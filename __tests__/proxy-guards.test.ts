import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";

function request(path: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}) {
  return new NextRequest(`http://127.0.0.1:8310${path}`, {
    method: init.method ?? "GET",
    headers: { host: "opensetter.example.com", ...(init.headers ?? {}) },
    body: init.body,
  });
}

afterEach(() => vi.unstubAllEnvs());

describe("API write guard", () => {
  it("lets same-origin JSON writes through", () => {
    const res = proxy(request("/api/flows", {
      method: "POST",
      headers: { origin: "https://opensetter.example.com", "sec-fetch-site": "same-origin", "content-type": "application/json", "content-length": "2" },
      body: "{}",
    }));
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  it("blocks cross-site writes (CSRF)", () => {
    expect(proxy(request("/api/flows", { method: "POST", headers: { "sec-fetch-site": "cross-site" } })).status).toBe(403);
    expect(proxy(request("/api/flows", { method: "DELETE", headers: { origin: "https://evil.example" } })).status).toBe(403);
  });

  it("enforces content types and body size", () => {
    const textBody = proxy(request("/api/flows", { method: "POST", headers: { "content-type": "text/plain", "content-length": "2" }, body: "hi" }));
    expect(textBody.status).toBe(415);
    const huge = proxy(request("/api/flows", { method: "POST", headers: { "content-type": "application/json", "content-length": String(5 * 1024 * 1024) } }));
    expect(huge.status).toBe(413);
    const jsonUpload = proxy(request("/api/media", { method: "POST", headers: { "content-type": "application/json", "content-length": "2" }, body: "{}" }));
    expect(jsonUpload.status).toBe(415);
  });

  it("leaves server-to-server endpoints to their own auth, but still caps size", () => {
    const meta = proxy(request("/api/webhook", { method: "POST", headers: { "sec-fetch-site": "cross-site", "content-type": "application/json", "content-length": "2" }, body: "{}" }));
    expect(meta.headers.get("x-middleware-next")).toBe("1");
    const flood = proxy(request("/api/webhook", { method: "POST", headers: { "content-length": String(2 * 1024 * 1024) } }));
    expect(flood.status).toBe(413);
  });
});

describe("https redirect", () => {
  it("sends plain-http visitors to https on the public host", () => {
    vi.stubEnv("NODE_ENV", "production");
    const res = proxy(request("/login?x=1", { headers: { "x-forwarded-proto": "http" } }));
    expect(res.status).toBe(308);
    expect(res.headers.get("location")).toBe("https://opensetter.example.com/login?x=1");
  });

  it("leaves local requests alone", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(proxy(request("/api/health")).headers.get("x-middleware-next")).toBe("1");
  });
});
