import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";

// Instagram's CDNs serve the post thumbnails and media shown in the UI.
const INSTAGRAM_MEDIA_HOSTS =
  "https://*.cdninstagram.com https://*.fbcdn.net https://lookaside.fbsbx.com https://*.giphy.com";

// No nonces (see node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md,
// "Without Nonces"): nonces would force every page, including the static
// public pages, to render per request. Next's own inline bootstrap scripts
// need 'unsafe-inline'; everything else is locked to this origin.
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' blob: data: ${INSTAGRAM_MEDIA_HOSTS}`,
  `media-src 'self' blob: ${INSTAGRAM_MEDIA_HOSTS}`,
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  ...(isDev ? [] : ["upgrade-insecure-requests"]),
].join("; ");

const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: CONTENT_SECURITY_POLICY },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  ...(isDev ? [] : [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }]),
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
  // NEXT_DIST_DIR lets several dev servers run from one checkout (Next locks
  // its build folder per server). Production builds keep the default.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  reactCompiler: true,
  turbopack: {
    root: process.cwd(),
  },
  // The local embedding model (AI setter knowledge retrieval) ships native
  // onnxruntime binaries; it runs in the worker process and must never be
  // bundled by Next.
  serverExternalPackages: ["@huggingface/transformers", "better-sqlite3"],
};

export default nextConfig;
