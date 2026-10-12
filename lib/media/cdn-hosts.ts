/** Hosts inbound message media may be downloaded from. */

/** Meta CDN hosts only: the URL comes from a webhook, never from a user. */
export function isMetaCdnUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return false;
    const host = url.hostname.toLowerCase();
    return (
      host === "lookaside.fbsbx.com" ||
      host.endsWith(".fbcdn.net") ||
      host.endsWith(".cdninstagram.com") ||
      // GIFs from Instagram's picker arrive as image attachments on Giphy.
      /^media\d*\.giphy\.com$/.test(host)
    );
  } catch {
    return false;
  }
}
