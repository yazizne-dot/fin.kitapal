# Kitapal Finance

The interface runs on Next.js and sends every `/api/*` request to the standalone Node.js API. The API stores and reads finance data in PostgreSQL schema `fin.qarzhy`. The Next.js runtime no longer opens SQLite. If `API_INTERNAL_URL` is missing, API requests return HTTP 503 instead of starting the old SQLite handler.

The current development database on `127.0.0.1:5436` has schema migrations `0001`–`0005`. One consolidated historical P&L coverage rule selects January–August 2026. The rule retains the original source values and displays warnings for the missing dividend figure and the discrepancy between monthly and source-YTD profit. No verified balance opening snapshots or cash accounts exist for the three organizations; balance totals and new cash operations remain unavailable until real accounts and openings are entered and reconciled.

## Local startup

Install dependencies with `npm install`. For the existing local `fin` database, the ignored `.env.backend.local` and `.env.local` files configure the restricted `qarzhy_app` role and the Next.js proxy. Start the backend and Next.js in separate terminals:

```powershell
npm run api:local
```

```powershell
npm run dev
```

For another local installation with the same `fin` host and schema, create the private `.env.pg-preflight.local` and run `node scripts/provision-local-app-role.mjs --check`, then `--apply` once. The apply command creates a random application password and CSRF secret in ignored local files and grants only the API's required PostgreSQL privileges. Never commit those files or use the PostgreSQL superuser as `DATABASE_URL`. Set `PUBLIC_APP_ORIGIN` and `API_INTERNAL_URL` to the browser and API origins if their ports change. `.env.pg-preflight.local` is for database checks and provisioning, not a backup. `npm run db:preflight` checks schema versions, import issues, coverage and row counts without changing the database. New installations apply the additive SQL migrations explicitly with `MIGRATION_DATABASE_URL` and `npm run db:migrate -- --check` followed by `npm run db:migrate -- --apply`; the application does not run migrations at startup.

## Verification

Backend integration tests reset **only** a database named `fin_test`. Set `TEST_DATABASE_URL` to that database before running `npm test`. The test command runs backend tests, builds Next.js, runs proxy and Chrome browser tests, then runs React component tests. On Windows it uses an installed Chrome; set `PLAYWRIGHT_CHROME_PATH` if Chrome is elsewhere. On other systems, install a Playwright Chromium browser or set that variable. Never point `TEST_DATABASE_URL` at `fin`.

Useful focused commands are `npm run test:backend`, `npm run test:next`, `npm run test:components`, `npm run typecheck`, and `npm run build`. The three React tests tied to the old private workbook extraction skip when that untracked source file is absent; PostgreSQL report behavior is covered by the backend tests. The old SQLite browser suite and MVP instructions are archived under [`tests/legacy-next/`](tests/legacy-next/) and [`docs/legacy-sqlite-readme.md`](docs/legacy-sqlite-readme.md).

For manual acceptance, follow [`docs/api/user-acceptance-checklist.md`](docs/api/user-acceptance-checklist.md). See [`docs/api/next-cutover-contract.md`](docs/api/next-cutover-contract.md) for the remaining report fidelity gaps and [`docs/api/fin-preflight-2026-10-22.md`](docs/api/fin-preflight-2026-10-22.md) for the restored database findings.
