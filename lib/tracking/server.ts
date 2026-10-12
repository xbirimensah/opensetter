import { createHash, randomBytes } from "node:crypto";
import { clientIp } from "@/lib/client-ip";

export function generateTrackedLinkSlug() {
  return randomBytes(7).toString("base64url");
}

export function hashClickIp(ipAddress: string | null | undefined) {
  if (!ipAddress) return null;

  const salt = process.env.NEXTAUTH_SECRET ?? "campaigncue-click-salt";
  return createHash("sha256").update(`${salt}:${ipAddress}`).digest("hex");
}

/** Cloudflare's header first: it can't be forged through the tunnel, x-forwarded-for can. */
export function getRequestIp(request: Request) {
  return clientIp(request.headers);
}
