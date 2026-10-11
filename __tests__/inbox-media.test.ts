/**
 * Inbox media: the CDN host allowlist (SSRF guard), Range parsing for
 * seekable audio/video, safe content types, and the media route's
 * workspace scoping, local streaming and CDN proxy behaviour.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import {
  contentDisposition,
  isAllowedMediaUrl,
  mimeFromKey,
  parseRangeHeader,
  servableContentType,
} from "../lib/inbox/media";
import { mediaSourceFor, parseStoredAttachments, toInboxAttachment } from "../lib/inbox/attachments";

describe("isAllowedMediaUrl", () => {
  it.each([
    "https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=1&signature=x",
    "https://scontent.xx.fbcdn.net/v/t1.15752-9/abc.jpg?oh=1",
    "https://scontent-fra5-1.xx.fbcdn.net/v/abc.mp4",
    "https://video.fbcdn.net/v/abc.mp4",
    "https://scontent-fra3-2.cdninstagram.com/v/t51.2885-15/abc.jpg",
    "https://LOOKASIDE.FBSBX.COM/x",
    "https://lookaside.fbsbx.com:443/x",
  ])("allows Meta CDN url %s", (url) => {
    expect(isAllowedMediaUrl(url)).toBe(true);
  });

  it.each([
    "http://lookaside.fbsbx.com/x", // not https
    "https://fbcdn.net/x", // bare suffix, not a subdomain
    "https://evilfbcdn.net/x",
    "https://fbcdn.net.evil.com/x",
    "https://cdninstagram.com.attacker.io/x",
    "https://evil.com/#.fbcdn.net",
    "https://evil.com/?u=https://scontent.xx.fbcdn.net/a",
    "https://user:pass@scontent.xx.fbcdn.net/a",
    "https://scontent.xx.fbcdn.net:8443/a",
    "https://169.254.169.254/latest/meta-data",
    "https://localhost/x",
    "https://lookaside.fbsbx.com.evil.com/x",
    "ftp://scontent.xx.fbcdn.net/a",
    "file:///etc/passwd",
    "javascript:alert(1)",
    "not a url",
    "",
    null,
    undefined,
  ])("refuses %s", (url) => {
    expect(isAllowedMediaUrl(url as string | null | undefined)).toBe(false);
  });
});

describe("parseRangeHeader", () => {
  const size = 1000;

  it("returns null without a usable header", () => {
    expect(parseRangeHeader(null, size)).toBeNull();
    expect(parseRangeHeader("", size)).toBeNull();
    expect(parseRangeHeader("items=0-10", size)).toBeNull();
    expect(parseRangeHeader("bytes=", size)).toBeNull();
    expect(parseRangeHeader("bytes=-", size)).toBeNull();
    expect(parseRangeHeader("bytes=abc-def", size)).toBeNull();
    expect(parseRangeHeader("bytes=0-10,20-30", size)).toBeNull();
    expect(parseRangeHeader("bytes=500-100", size)).toBeNull();
  });

  it("parses closed, open and suffix ranges", () => {
    expect(parseRangeHeader("bytes=0-99", size)).toEqual({ start: 0, end: 99 });
    expect(parseRangeHeader("bytes=500-", size)).toEqual({ start: 500, end: 999 });
    expect(parseRangeHeader("bytes=-100", size)).toEqual({ start: 900, end: 999 });
    expect(parseRangeHeader("BYTES=0-0", size)).toEqual({ start: 0, end: 0 });
    expect(parseRangeHeader(" bytes=10 - 20 ", size)).toEqual({ start: 10, end: 20 });
  });

  it("clamps the end and the suffix to the file", () => {
    expect(parseRangeHeader("bytes=900-5000", size)).toEqual({ start: 900, end: 999 });
    expect(parseRangeHeader("bytes=-5000", size)).toEqual({ start: 0, end: 999 });
  });

  it("flags ranges that start past the end as unsatisfiable", () => {
    expect(parseRangeHeader("bytes=1000-", size)).toBe("unsatisfiable");
    expect(parseRangeHeader("bytes=2000-3000", size)).toBe("unsatisfiable");
    expect(parseRangeHeader("bytes=-0", size)).toBe("unsatisfiable");
    expect(parseRangeHeader("bytes=0-", 0)).toBe("unsatisfiable");
  });

  it("ignores numbers beyond safe integers", () => {
    expect(parseRangeHeader("bytes=99999999999999999999-", size)).toBeNull();
  });
});

describe("servableContentType", () => {
  it("keeps media and PDFs inline", () => {
    expect(servableContentType("audio/mp4")).toEqual({ contentType: "audio/mp4", inline: true });
    expect(servableContentType("image/JPEG; charset=binary")).toEqual({ contentType: "image/jpeg", inline: true });
    expect(servableContentType("application/pdf")).toEqual({ contentType: "application/pdf", inline: true });
  });

  it("downloads anything that could run script on our origin", () => {
    for (const mime of ["text/html", "image/svg+xml", "application/xhtml+xml", "text/xml", "application/javascript", "", null]) {
      expect(servableContentType(mime)).toEqual({ contentType: "application/octet-stream", inline: false });
    }
  });
});

describe("mimeFromKey and contentDisposition", () => {
  it("guesses types from stored keys", () => {
    expect(mimeFromKey("inbound/c1/m1-0.m4a")).toBe("audio/mp4");
    expect(mimeFromKey("inbound/c1/m1-1.JPG")).toBe("image/jpeg");
    expect(mimeFromKey("inbound/c1/m1-2.bin")).toBeNull();
  });

  it("escapes filenames", () => {
    expect(contentDisposition(true)).toBe("inline");
    expect(contentDisposition(false, 'evil".html')).toBe(
      `attachment; filename="evil_.html"; filename*=UTF-8''evil%22.html`
    );
    expect(contentDisposition(false, "Präsentation.pdf")).toContain("filename*=UTF-8''Pr%C3%A4sentation.pdf");
  });
});

describe("stored attachments", () => {
  it("drops unknown shapes and keeps known ones", () => {
    const parsed = parseStoredAttachments([
      { type: "audio", url: "https://lookaside.fbsbx.com/a", localKey: "inbound/c/m-0.m4a" },
      { type: "bogus" },
      "nope",
      null,
      { type: "card", title: "Hi", buttons: [{ title: "Go", url: "https://x.test" }, { nope: true }] },
      { type: "story", url: "https://scontent.xx.fbcdn.net/s.jpg", localKey: "inbound/c/m-3.jpg", mimeType: "image/jpeg" },
    ]);
    expect(parsed.map((a) => a.type)).toEqual(["audio", "card", "story"]);
    expect(parseStoredAttachments({ not: "an array" })).toEqual([]);
  });

  it("serves local copies of media and story thumbnails, nothing for stickers", () => {
    const [audio, card, story] = parseStoredAttachments([
      { type: "audio", url: "https://lookaside.fbsbx.com/a", localKey: "inbound/c/m-0.m4a", mimeType: "audio/mp4" },
      { type: "card", imageUrl: "https://scontent.xx.fbcdn.net/i.jpg", buttons: [] },
      { type: "story", localKey: "inbound/c/m-2.mp4", mimeType: "video/mp4" },
    ]);
    expect(mediaSourceFor(audio)).toMatchObject({ localKey: "inbound/c/m-0.m4a", mimeType: "audio/mp4" });
    expect(mediaSourceFor(card)).toMatchObject({ url: "https://scontent.xx.fbcdn.net/i.jpg" });
    expect(mediaSourceFor(story)).toMatchObject({ localKey: "inbound/c/m-2.mp4", mimeType: "video/mp4" });
    expect(mediaSourceFor({ type: "sticker" })).toBeNull();
  });

  it("strips storage keys for the browser and flags what can be served", () => {
    const browser = toInboxAttachment({ type: "image", url: "https://evil.test/x.jpg", localKey: "inbound/c/m-0.jpg" });
    expect(browser).not.toHaveProperty("localKey");
    expect(browser.servable).toBe(true);
    expect(toInboxAttachment({ type: "image", url: "https://evil.test/x.jpg" }).servable).toBe(false);
    expect(toInboxAttachment({ type: "image", url: "https://scontent.xx.fbcdn.net/x.jpg" }).servable).toBe(true);
  });
});

// ─── Route ─────────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  getCurrentWorkspaceContext: vi.fn(),
  findFirst: vi.fn(),
  mediaSize: vi.fn(),
  mediaStream: vi.fn(),
}));

vi.mock("@/lib/workspace-access", () => ({
  getCurrentWorkspaceContext: mocks.getCurrentWorkspaceContext,
}));
vi.mock("@/lib/db/client", () => ({ prisma: { dmMessage: { findFirst: mocks.findFirst } } }));
vi.mock("@/lib/media/storage", () => ({
  mediaSize: mocks.mediaSize,
  mediaStream: mocks.mediaStream,
}));

import { GET } from "../app/api/inbox/media/[messageId]/[index]/route";

function call(messageId: string, index: string, headers: Record<string, string> = {}) {
  const request = new NextRequest(`http://localhost/api/inbox/media/${messageId}/${index}`, { headers });
  return GET(request, { params: Promise.resolve({ messageId, index }) });
}

function bodyOf(text: string): ReadableStream {
  return new Response(text).body as ReadableStream;
}

describe("GET /api/inbox/media/[messageId]/[index]", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
    mocks.getCurrentWorkspaceContext.mockResolvedValue({ workspaceId: "ws1", role: "MEMBER" });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("requires a session", async () => {
    mocks.getCurrentWorkspaceContext.mockResolvedValue(null);
    expect((await call("m1", "0")).status).toBe(401);
  });

  it("rejects malformed references", async () => {
    expect((await call("../etc", "0")).status).toBe(400);
    expect((await call("m1", "-1")).status).toBe(400);
  });

  it("scopes the lookup to the caller's workspace", async () => {
    mocks.findFirst.mockResolvedValue(null);
    expect((await call("m1", "0")).status).toBe(404);
    expect(mocks.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "m1", conversation: { instagramAccount: { workspaceId: "ws1" } } },
      })
    );
  });

  it("streams a stored copy with a 206 for a range", async () => {
    mocks.findFirst.mockResolvedValue({
      attachments: [{ type: "audio", localKey: "inbound/c/m1-0.m4a", mimeType: "audio/mp4" }],
    });
    mocks.mediaSize.mockResolvedValue(1000);
    mocks.mediaStream.mockReturnValue(bodyOf("x"));

    const res = await call("m1", "0", { range: "bytes=100-199" });
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe("bytes 100-199/1000");
    expect(res.headers.get("content-length")).toBe("100");
    expect(res.headers.get("content-type")).toBe("audio/mp4");
    expect(res.headers.get("accept-ranges")).toBe("bytes");
    expect(mocks.mediaStream).toHaveBeenCalledWith("inbound/c/m1-0.m4a", { start: 100, end: 199 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("answers 416 for a range past the end", async () => {
    mocks.findFirst.mockResolvedValue({ attachments: [{ type: "video", localKey: "inbound/c/m1-0.mp4" }] });
    mocks.mediaSize.mockResolvedValue(10);
    const res = await call("m1", "0", { range: "bytes=50-" });
    expect(res.status).toBe(416);
    expect(res.headers.get("content-range")).toBe("bytes */10");
  });

  it("forces a download for script-capable stored files", async () => {
    mocks.findFirst.mockResolvedValue({
      attachments: [{ type: "file", localKey: "inbound/c/m1-0.bin", mimeType: "text/html", name: "x.html" }],
    });
    mocks.mediaSize.mockResolvedValue(5);
    mocks.mediaStream.mockReturnValue(bodyOf("<b>x"));
    const res = await call("m1", "0");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/octet-stream");
    expect(res.headers.get("content-disposition")).toMatch(/^attachment;/);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("proxies a Meta CDN url when there is no stored copy", async () => {
    mocks.findFirst.mockResolvedValue({
      attachments: [{ type: "image", url: "https://scontent.xx.fbcdn.net/v/a.jpg" }],
    });
    fetchMock.mockResolvedValue(
      new Response("img", { status: 200, headers: { "content-type": "image/jpeg", "content-length": "3" } })
    );
    const res = await call("m1", "0");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://scontent.xx.fbcdn.net/v/a.jpg",
      expect.objectContaining({ redirect: "manual" })
    );
  });

  it("returns 410 when Meta has expired the url", async () => {
    mocks.findFirst.mockResolvedValue({
      attachments: [{ type: "audio", url: "https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=1" }],
    });
    fetchMock.mockResolvedValue(new Response("gone", { status: 403 }));
    const res = await call("m1", "0");
    expect(res.status).toBe(410);
    expect((await res.json()).success).toBe(false);
  });

  it("never fetches non-Meta hosts, directly or via redirect", async () => {
    mocks.findFirst.mockResolvedValue({
      attachments: [{ type: "image", url: "https://169.254.169.254/latest/meta-data" }],
    });
    expect((await call("m1", "0")).status).toBe(410);
    expect(fetchMock).not.toHaveBeenCalled();

    mocks.findFirst.mockResolvedValue({
      attachments: [{ type: "image", url: "https://lookaside.fbsbx.com/a" }],
    });
    fetchMock.mockResolvedValue(
      new Response(null, { status: 302, headers: { location: "http://10.0.0.1/internal" } })
    );
    expect((await call("m1", "0")).status).toBe(410);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("follows redirects that stay on Meta hosts", async () => {
    mocks.findFirst.mockResolvedValue({
      attachments: [{ type: "video", url: "https://lookaside.fbsbx.com/a" }],
    });
    fetchMock
      .mockResolvedValueOnce(
        new Response(null, { status: 302, headers: { location: "https://video.xx.fbcdn.net/v.mp4" } })
      )
      .mockResolvedValueOnce(
        new Response("vid", {
          status: 206,
          headers: { "content-type": "video/mp4", "content-range": "bytes 0-2/10" },
        })
      );
    const res = await call("m1", "0", { range: "bytes=0-2" });
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe("bytes 0-2/10");
    expect(fetchMock).toHaveBeenLastCalledWith(
      "https://video.xx.fbcdn.net/v.mp4",
      expect.objectContaining({ headers: { Range: "bytes=0-2" } })
    );
  });

  it("404s for attachments with nothing to serve", async () => {
    mocks.findFirst.mockResolvedValue({ attachments: [{ type: "sticker" }] });
    expect((await call("m1", "0")).status).toBe(404);
    expect((await call("m1", "5")).status).toBe(404);
  });
});
