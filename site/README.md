# OpenSetter site

The public landing page, built with Astro, Tailwind CSS and anime.js. The app
(login, legal pages, dashboard) stays in the Next.js app at the repo root; the
site links there through `PUBLIC_APP_URL` (empty = same origin).

```bash
cd site
npm install
npm run dev      # http://localhost:4321
npm run build    # static output in ../public/landing/
```

The app's own `npm run build` runs `npm run build:site` first, and a rewrite
in `next.config.ts` serves `public/landing/index.html` at `/`. So one Next
server (or Docker image) serves the site and the app on one domain.

- Templates come straight from `../lib/templates/campaign-templates.ts`, so the
  cards always match the app.
- Step and trigger labels live in `src/lib/flow-types.ts` and mirror
  `../lib/flows/types.ts`. Update both when the flow engine gains a type.
- Motion is progressive: without JavaScript or with reduced motion every
  section renders in its final state, and the phone demo becomes tap-to-step.
