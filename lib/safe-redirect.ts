/**
 * Only same-site paths, so the login form can't be used as an open
 * redirect. Browsers treat "/\evil.com" and "/<tab>/evil.com" as another
 * host, so backslashes and control characters are refused outright and
 * the result is re-derived from a parsed URL.
 */
export function safeCallbackUrl(raw: string | undefined, fallback: string): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return fallback;
  if (/[\\\u0000-\u001f\u007f]/.test(raw)) return fallback;
  try {
    const url = new URL(raw, "https://opensetter.invalid");
    if (url.origin !== "https://opensetter.invalid") return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}
