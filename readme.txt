=== Watchlog RUM ===
Contributors: watchlog
Tags: rum, monitoring, performance, analytics
Requires at least: 5.8
Tested up to: 6.9
Requires PHP: 7.4
Stable tag: 0.2.0
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Real User Monitoring (RUM) for WordPress powered by Watchlog.

== Description ==
Watchlog RUM delivers Real User Monitoring for WordPress sites by mirroring the Watchlog Vue/React SDK event format. It tracks session lifecycle events, performance metrics, network activity, resource usage, and optional Web Vitals so you can understand how visitors experience your site in production.

* Automatic `session_start`, `page_view`, and `session_end` events.
* Navigation/paint timings plus optional Web Vitals (CLS, LCP, INP, TTFB, FID).
* Instrumentation for `fetch`, `XMLHttpRequest`, long tasks, resources, and user interactions.
* Breadcrumb and error capture hooks to enrich every event.
* WordPress-aware route normalization and session persistence to align data with SPA SDKs.

== Installation ==
1. Upload the `watchlog-rum` folder to `/wp-content/plugins/` or install via WP-CLI.
2. Activate “Watchlog RUM” from **Plugins → Installed Plugins** in wp-admin.
3. Open **Settings → Watchlog RUM** and configure your API key, endpoint, app name, sampling, flush interval, and session timeout.
4. Save changes. The frontend SDK will automatically load on public pages.

== Changelog ==
= 0.2.0 =
* Initial public release of the Watchlog RUM WordPress integration.
