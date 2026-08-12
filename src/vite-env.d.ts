/// <reference types="vite/client" />

/**
 * The app's version, substituted at build time by vite.config.ts's `define`
 * from package.json.
 *
 * `declare const` in a .d.ts is an *ambient declaration*: it tells TypeScript
 * this identifier exists at runtime without emitting anything for it. That is
 * exactly right here, because the value is not a variable at all — Vite
 * find-and-replaces the literal text `__APP_VERSION__` in the bundle before it
 * ever reaches a browser.
 *
 * Consequence worth knowing: under Vitest, `define` does not run unless the
 * test config asks for it, so anything reading this directly is awkward to
 * test. That is why `buildBugReportUrl` takes the version as an argument
 * rather than reading the global itself.
 */
declare const __APP_VERSION__: string;
