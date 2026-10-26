/**
 * Link check for AI drafts. A model can invent a URL (a fake booking page,
 * a competitor, a typo of the real link) and rate the reply highly; any
 * link outside the booking link's host and the account's allowlist holds
 * the draft for review instead of auto-sending it.
 */

/** Links with a scheme or a leading www. */
const EXPLICIT_LINK = /\b(?:https?:\/\/|www\.)[^\s<>()"']+/gi;
/**
 * Top-level domains a bare link ("calendly.com/x") is recognised by. A
 * list instead of any letters, so "Next.js" or a missing space after a
 * full stop never reads as a link; scheme and www links match any TLD.
 */
const BARE_TLDS = [
  "com", "de", "io", "net", "org", "co", "me", "at", "ch", "ai", "app", "link",
  "ly", "gg", "so", "to", "page", "site", "online", "store", "shop", "info",
  "biz", "eu", "uk", "us", "xyz", "dev", "tv", "fm", "cc", "li", "nl", "fr",
  "es", "it", "pl", "be", "se", "dk", "no", "fi", "pt", "cz", "ca", "au", "in",
  "sh", "bio", "club", "pro", "live", "academy", "coach", "digital", "media",
  "agency", "studio", "cloud", "tech", "space", "world", "click", "sale",
];
/** Mentions (@name.de) and e-mail domains are not links. */
const BARE_DOMAIN = new RegExp(
  `(?<![@\\p{L}\\p{N}._-])(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\\.)+(?:${BARE_TLDS.join("|")})(?![\\p{L}\\p{N}-])(?:[/:?#][^\\s<>()"']*)?`,
  "giu"
);
const TRAILING_PUNCTUATION = /[.,!?;:)\]]+$/;

export const DISALLOWED_LINK_REASON = "draft contains a link that is not on the allowlist";

/** Lower-cased host of a link or domain, or null when it isn't one. */
export function hostOf(value: string): string | null {
  const trimmed = value.trim().replace(TRAILING_PUNCTUATION, "");
  if (!trimmed) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const host = new URL(withScheme).hostname.toLowerCase().replace(/\.$/, "");
    return host.includes(".") ? host : null;
  } catch {
    return null;
  }
}

/** Every link-like token in a draft, in order of appearance. */
export function extractLinks(text: string): string[] {
  const normalized = text.normalize("NFKC");
  const found: Array<{ index: number; value: string }> = [];
  const explicitSpans: Array<[number, number]> = [];
  for (const match of normalized.matchAll(EXPLICIT_LINK)) {
    const value = match[0].replace(TRAILING_PUNCTUATION, "");
    found.push({ index: match.index ?? 0, value });
    explicitSpans.push([match.index ?? 0, (match.index ?? 0) + match[0].length]);
  }
  for (const match of normalized.matchAll(BARE_DOMAIN)) {
    const start = match.index ?? 0;
    if (explicitSpans.some(([from, to]) => start >= from && start < to)) continue;
    found.push({ index: start, value: match[0].replace(TRAILING_PUNCTUATION, "") });
  }
  return found.sort((a, b) => a.index - b.index).map((entry) => entry.value);
}

/**
 * Normalize allowlist entries ("https://cal.com/me", "Example.de",
 * "*.example.de") to bare hosts. Invalid entries are dropped.
 */
export function normalizeAllowedHosts(entries: readonly (string | null | undefined)[]): string[] {
  const hosts = new Set<string>();
  for (const entry of entries) {
    if (!entry) continue;
    const host = hostOf(entry.trim().replace(/^\*\./, ""));
    if (host) hosts.add(host.replace(/^www\./, ""));
  }
  return [...hosts];
}

function isAllowedHost(host: string, allowed: readonly string[]): boolean {
  const bare = host.replace(/^www\./, "");
  return allowed.some((entry) => bare === entry || bare.endsWith(`.${entry}`));
}

/** Links in the draft whose host is neither allowlisted nor a subdomain of one. */
export function findDisallowedLinks(text: string, allowedHosts: readonly string[]): string[] {
  const allowed = normalizeAllowedHosts(allowedHosts);
  return extractLinks(text).filter((link) => {
    const host = hostOf(link);
    return host !== null && !isAllowedHost(host, allowed);
  });
}
