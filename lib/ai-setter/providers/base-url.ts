/**
 * Base URL safety for UI-configured providers.
 *
 * A workspace admin can point the generic provider at any URL, and the
 * server will send an API key there. Without a guard that is an SSRF
 * primitive (cloud metadata, internal services). Rules: https only, no
 * credentials in the URL, no private/loopback/link-local targets, both
 * at save time (literal hosts) and at connect time (resolved addresses,
 * see guarded-request.ts).
 * Self-hosters running a local model can opt in with
 * AI_PROVIDER_ALLOW_PRIVATE_BASE_URL=true.
 */

import { isIP } from "net";

export const ALLOW_PRIVATE_BASE_URL_ENV = "AI_PROVIDER_ALLOW_PRIVATE_BASE_URL";

export function isPrivateBaseUrlAllowed(): boolean {
  return process.env[ALLOW_PRIVATE_BASE_URL_ENV] === "true";
}

function isPrivateIpv4(octets: readonly number[]): boolean {
  const [a, b, c] = octets;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

/** Expand an IPv6 literal (incl. embedded dotted IPv4) to 8 groups. */
function ipv6Groups(address: string): number[] | null {
  let host = address;
  const dotted = host.match(/(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (dotted) {
    const octets = dotted[1].split(".").map(Number);
    if (octets.some((octet) => octet > 255)) return null;
    host =
      host.slice(0, -dotted[1].length) +
      `${((octets[0] << 8) | octets[1]).toString(16)}:${((octets[2] << 8) | octets[3]).toString(16)}`;
  }
  const halves = host.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill("0"), ...tail];
  const parsed = groups.map((group) => parseInt(group, 16));
  return parsed.length === 8 && parsed.every((group) => group >= 0 && group <= 0xffff) ? parsed : null;
}

function embeddedIpv4(high: number, low: number): number[] {
  return [high >> 8, high & 0xff, low >> 8, low & 0xff];
}

function isPrivateIpv6(groups: readonly number[]): boolean {
  const [g0, g1, g2, g3, g4, g5, g6, g7] = groups;
  const leadingZeros = (count: number) => groups.slice(0, count).every((group) => group === 0);
  if (leadingZeros(8) || (leadingZeros(7) && g7 === 1)) return true; // :: and ::1
  if ((g0 & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((g0 & 0xffc0) === 0xfe80 || (g0 & 0xffc0) === 0xfec0) return true; // link/site local
  if ((g0 & 0xff00) === 0xff00) return true; // multicast
  // Forms that embed an IPv4 address: mapped, compatible, NAT64, 6to4.
  if (leadingZeros(5) && g5 === 0xffff) return isPrivateIpv4(embeddedIpv4(g6, g7));
  if (leadingZeros(6)) return isPrivateIpv4(embeddedIpv4(g6, g7));
  if (g0 === 0x64 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) {
    return isPrivateIpv4(embeddedIpv4(g6, g7));
  }
  if (g0 === 0x2002) return isPrivateIpv4(embeddedIpv4(g1, g2));
  return false;
}

export function isPrivateAddress(address: string): boolean {
  const host = address.replace(/^\[|\]$/g, "").toLowerCase();
  if (isIP(host) === 4) return isPrivateIpv4(host.split(".").map(Number));
  if (isIP(host) === 6) {
    const groups = ipv6Groups(host);
    // Unparseable literals are treated as unsafe.
    return groups === null || isPrivateIpv6(groups);
  }
  return false;
}

function isLocalHostname(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal");
}

export type BaseUrlCheck = { ok: true; url: string } | { ok: false; error: string };

export function validateProviderBaseUrl(
  raw: string,
  options: { allowPrivate: boolean }
): BaseUrlCheck {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, error: "Base URL is not a valid URL" };
  }
  if (url.username || url.password) {
    return { ok: false, error: "Base URL must not contain credentials" };
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const isPrivateTarget = isLocalHostname(host) || isPrivateAddress(host);

  if (isPrivateTarget && !options.allowPrivate) {
    return {
      ok: false,
      error: `Base URL points at a private or local address; set ${ALLOW_PRIVATE_BASE_URL_ENV}=true to allow self-hosted models`,
    };
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isPrivateTarget && options.allowPrivate)) {
    return { ok: false, error: "Base URL must use https" };
  }
  return { ok: true, url: url.toString().replace(/\/$/, "") };
}
