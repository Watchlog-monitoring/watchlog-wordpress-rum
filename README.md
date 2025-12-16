# Watchlog WordPress RUM Plugin

WordPress implementation of the Watchlog Real User Monitoring (RUM) SDK. 

## Features

- ✅ Automatic `session_start`, `page_view`, and `session_end` events.
- 📈 Performance metrics (navigation + paint timing) and optional Web Vitals (CLS/LCP/INP/TTFB/FID via vendored `web-vitals`).
- 📡 Network instrumentation for `fetch` and `XMLHttpRequest` with sampling, body sizes, and timing breakdowns.
- 🧠 Automatic error monitoring (`window.onerror`, `unhandledrejection`).
- 🧹 Resource, long task, and user interaction (click / scroll / submit) capture.
- 🧭 Route normalization extracted from WordPress rewrite/permalink structures so dynamic permalinks such as `/blog/%postname%` become `/blog/:postname` the same way as SPA SDKs.

## Installation

1. Copy the `watchlog-wordpress-rum` folder into `wp-content/plugins/`.
2. Activate the “Watchlog RUM” plugin from WP Admin → Plugins.
3. Visit **Settings → Watchlog RUM** and provide:
   - `apiKey`
   - `endpoint`
   - `app`
   - `sampleRate` (capped at 0.5 like the SPA SDKs)
   - Optional tuning values (environment, release, network sampling, interaction sampling, Web Vitals toggle, etc.)
4. Save changes. The plugin will enqueue the RUM script on every public page.

## Dynamic Route Handling

- The plugin inspects the active permalink structure, custom post type permalinks, taxonomy rewrite slugs, and archive bases to derive deterministic patterns (e.g. `/news/%year%/%postname%/` → `/news/:year/:postname`).
- Those patterns are supplied to the JavaScript SDK via `routeHints`, ensuring every event carries the same `normalizedPath` schema as Vue/React packages, even for deeply nested dynamic routes.
- On top of the server hints we fall back to heuristics (numeric segments → `:id`, date segments → `:year/:month/:day`, taxonomy anchors → `:slug`) to keep MPA‑style navigation or custom rewrites grouped.

## Custom Usage

The runtime exposes `window.WatchlogRUMWP` with the same API surface (`custom`, `captureError`, `flush`, `setNormalizedPath`) so theme or plugin code can emit domain-specific metrics:

```js
window.WatchlogRUMWP?.custom('checkout_step', 2, { step: 'payment' })
```

## Development Notes

- The frontend SDK lives in `assets/js/watchlog-rum.js` and mirrors the Vue package logic with only the framework hooks removed.
- `assets/js/web-vitals.iife.js` is vendored from the official `web-vitals` package (MIT).
- Server-side normalization logic is implemented inside `includes/class-watchlog-rum.php`.
