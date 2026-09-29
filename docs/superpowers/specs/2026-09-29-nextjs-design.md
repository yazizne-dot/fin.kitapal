# Next.js migration

User request: migrate this existing financial portal on the `тест` branch to Next.js, following the agreed Next.js + TypeScript recommendation.

## Scope and architecture
- Next.js App Router becomes the production and development entry point. React/TypeScript owns the page, login form, loading/error states, and dashboard lifecycle.
- Existing financial report/admin DOM renderers are retained as an explicitly scoped client module inside a React component, preserving every existing report, form, drilldown, export, and translation. They are not separate public scripts or an iframe. Converting every report template to JSX is outside this runtime migration.
- Next.js Node-runtime route handlers serve `/api/*` directly, adapting Web Request/Response to the existing tested API contract without a second HTTP server.
- Move server initialization into a lazy factory. Building or importing the Next route must not open/migrate the production database. One handler/database is reused per Node process.
- Keep SQLite, source JSON workbooks, accounting calculations, credentials, API paths and role boundaries. Do not copy credentials into source, browser bundles, or build output.
- Keep `server.mjs` only as the isolated test API harness. `npm run dev`, `npm run build`, and `npm start` use Next.js.

## Lifecycle and security
Mounting/unmounting (including React Strict Mode) must remove listeners, disconnect translation observers and abort pending requests. Login is React-owned. Session expiration and logout return to login. Non-authentication API/network errors show an actionable retry state. API responses are private/no-store, including XLSX. Retain CSRF checks and cookie settings. Use request nonces for Next inline scripts instead of breaking hydration with the old static CSP.

## Verification
Retain the existing 51 regression tests; add Web Request API adapter tests, client mount/unmount tests, and production Next integration tests. Run TypeScript, a production build, tests, and browser verification when available. Test with temporary databases only. No deployment or merge is part of this request.
