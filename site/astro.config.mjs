// @ts-check
import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";

// Static one-page marketing site for OpenSetter. It builds into the Next.js
// app's public/landing folder (npm run build:site at the repo root), and a
// rewrite in next.config.ts serves it at "/". The app itself (login, legal
// pages, dashboard) stays in Next; links point there via PUBLIC_APP_URL
// (empty = same origin).
export default defineConfig({
  output: "static",
  base: "/landing/",
  outDir: "../public/landing",
  vite: {
    plugins: [tailwindcss()],
    server: { fs: { allow: [".."] } },
  },
});
