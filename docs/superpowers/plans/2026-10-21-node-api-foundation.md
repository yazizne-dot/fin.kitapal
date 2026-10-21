# Node API Foundation and Authentication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a standalone, protected Node.js API that authenticates existing PostgreSQL users and enforces monthly password changes.

**Architecture:** A loopback HTTP process uses `pg` against `fin.qarzhy`. Its small request router calls session, account, and authorization services; Next.js continues using its current API until the final cutover plan. This plan adds only additive schema migrations and uses a disposable PostgreSQL test database.

**Tech Stack:** Node.js 24+, ES modules, `pg`, PostgreSQL 18 test container, `node:test`, Next.js 16.3.7 (unchanged here).

**Spec:** `docs/superpowers/specs/2026-10-21-node-postgres-backend-design.md`

## Global Constraints

- PostgreSQL `fin.qarzhy` is the only new API data store; never open SQLite or runtime Excel/JSON.
- The user's restored database is never used by automated tests or changed during development.
- New passwords expire 30 days after their last successful change for every role; imported users change theirs at first login after cutover.
- Session cookie is host-only, `HttpOnly`, `SameSite=Strict`, and `Secure` on HTTPS. Only SHA-256 token hashes are stored.
- No second authentication factor in this release. No secrets or tokens in logs, source files, URLs, or API JSON.
- PostgreSQL money and historical numeric values remain decimal strings until explicitly formatted for the frontend.
- The installed `next` package's local guide must be read before any Next.js code edit; it is currently absent from this checkout.

## Review Focus

- Unknown username and wrong password return the same login message and rate-limit accounting; Task 2 tests both.
- A session whose user is disabled or whose password is due cannot access finance routes; Task 3 tests both.
- A forged `Origin` or missing CSRF header cannot change data, including across the proxy later; Task 3 tests direct API enforcement.
- Two concurrent requests after an admin resets a password cannot reuse an old session; Task 2 tests revocation.
- Missing or wrong PostgreSQL schema version fails startup without creating or modifying tables; Task 1 tests it.

## File structure

- `backend/db/connection.mjs`: pool, schema gate, transaction helper.
- `backend/http/server.mjs`, `backend/http/response.mjs`: HTTP process, routing, validation, error translation.
- `backend/auth/passwords.mjs`, `backend/auth/sessions.mjs`, `backend/auth/guards.mjs`, `backend/auth/accounts.mjs`: one responsibility each.
- `backend/main.mjs`: startup and shutdown.
- `docs/sql/migrations/0003_node_api_security.sql`: additive authentication tables/columns.
- `tests/backend/helpers/test-db.mjs` and `tests/backend/*.test.mjs`: isolated PostgreSQL tests.
- `compose.test-db.yml`, `scripts/run-backend-tests.mjs`, `scripts/migrate-postgres.mjs`, `package.json`, `README.md`: repeatable local execution and explicit migrations.

### Task 1: Isolated PostgreSQL runtime

**Files:** Create `backend/db/connection.mjs`, `backend/http/server.mjs`, `backend/http/response.mjs`, `backend/main.mjs`, `tests/backend/helpers/test-db.mjs`, `tests/backend/startup.test.mjs`, `compose.test-db.yml`, `scripts/run-backend-tests.mjs`; modify `package.json`, `README.md`.

**Interfaces:** `createPool({connectionString})`, `assertSchema(pool)`, `withTransaction(pool, fn)`, `createApi({pool, clock, registerRoutes})`, and `startApi({pool, host, port, clock, registerRoutes})`. `fn(client)` must use one checked-out connection through `BEGIN`/`COMMIT`/`ROLLBACK` and always release it. `registerRoutes(router)` adds bounded route modules from later tasks.

- [ ] Write `startup.test.mjs`: `assertSchema` accepts `0001_relational_finance` plus `0002_relational_source_resolution`, rejects missing/wrong version, and leaves row counts unchanged; `withTransaction` rolls back an injected failure; `/health` returns 200 only when the database check succeeds.
- [ ] Run `node --test tests/backend/startup.test.mjs` against `fin_test`; confirm the tests fail before implementation. The test helper must reject any database whose name is not exactly `fin_test` before it executes schema-reset SQL.
- [ ] Ensure a Node.js 24+ runtime, add the isolated PostgreSQL 18 Compose service on port 15435, install `pg`, and implement the listed interfaces, `npm run test:backend`, and error response format `{error, request_id}`. Bind HTTP to `127.0.0.1` by default. Startup reads `DATABASE_URL` and never runs DDL against it.
- [ ] Run `npm run test:backend` with the isolated container; confirm startup/transaction tests pass. Run `npm run typecheck` only after dependencies and Node 24 are available.
- [ ] Commit the runtime, harness, and documentation.

### Task 2: Passwords and session lifecycle

**Files:** Create `docs/sql/migrations/0003_node_api_security.sql`, `backend/auth/passwords.mjs`, `backend/auth/sessions.mjs`, `scripts/migrate-postgres.mjs`, `tests/backend/auth.test.mjs`; modify `backend/http/server.mjs`, `tests/backend/helpers/test-db.mjs`, `package.json`.

**Interfaces:** `verifyPassword(password, user)`, `hashPassword(password)`, `login({pool, username, password, remember, now})`, `resolveSession({pool, token, now})`, `changePassword({pool, principal, currentPassword, newPassword, now})`, `logout({pool, token})`. `login` returns the cookie token only to the HTTP layer and a public user object to the caller; `resolveSession` returns a principal with role, permissions, and password-change state.

- [ ] Write `auth.test.mjs`: imported scrypt hashes verify; raw session token never appears in `sessions`; 24-hour and remembered 30-day expiry work; disabled users fail; unknown user and wrong password have one response; failed attempts are limited across two API instances; imported accounts require first-login change; 30-day expiry applies to admin and employee; reset/password change revoke old sessions even under concurrent requests; new passwords under 15 characters and common passwords are rejected.
- [ ] Run `node --test tests/backend/auth.test.mjs`; confirm failures for missing migration/services.
- [ ] Add `password_changed_at` and PostgreSQL-backed login-attempt counters in `0003_node_api_security.sql`, with an idempotent migration version entry. Implement `scripts/migrate-postgres.mjs` requiring `MIGRATION_DATABASE_URL`, never `DATABASE_URL`, and never run it at API startup. Implement password verification using existing `password_salt`/`password_hash` values, token hashing, session rotation, revocation, expiry, and audit within transactions. The migration does not alter imported password hashes or set guessed change dates.
- [ ] Run the auth tests against `fin_test`; confirm all pass and a second migration run changes no data.
- [ ] Commit migration, service, and tests.

### Task 3: HTTP security, accounts, and permissions

**Files:** Create `backend/auth/guards.mjs`, `backend/auth/accounts.mjs`, `backend/http/security.mjs`, `tests/backend/access.test.mjs`; modify `backend/http/server.mjs`, `backend/http/response.mjs`.

**Interfaces:** `requirePrincipal(request)`, `requirePermission(principal, code, ownerId)`, `checkMutationRequest(request, principal)`, `registerAccountRoutes(router, services)`. Routes: `/api/login`, `/api/logout`, `/api/me`, `/api/password`, `/api/profile`, `/api/users`, and `/api/csrf`. Public user JSON matches `features/shared/types.ts` without hashes, salts, or token.

- [ ] Write `access.test.mjs`: unauthenticated requests get 401; finance cannot manage users; employee cannot read another employee; last active admin cannot be disabled; expired-password sessions can reach only me/password/logout; wrong `Origin`, cross-site fetch metadata, and absent/invalid CSRF header reject authenticated mutations; login also rejects wrong origin; tokens and password hashes never appear in responses.
- [ ] Run `node --test tests/backend/access.test.mjs`; confirm security tests fail.
- [ ] Implement request validation, exact origin policy against configured `PUBLIC_APP_ORIGIN`, session-bound CSRF header, permission lookup from `role_permissions`/`user_permissions`, account changes, and a default-deny route table. Keep the account view's current password-change and user-management payloads, adapting its security fields where needed.
- [ ] Run all backend tests; confirm access tests and prior auth/startup tests pass. Confirm read requests and binary responses are `private, no-store`.
- [ ] Commit account routes and security tests.

### Task 4: Foundation handoff

**Files:** Modify `README.md`, `docs/local-postgres-handoff.md`, `package.json`; create `docs/api/postgres-endpoints.md`.

**Interfaces:** Document local `DATABASE_URL`, API port, test-only `TEST_DATABASE_URL`, migration command, `/api/*` account payloads, and the exact port/cookie contract consumed by the later finance and Next.js plans.

- [ ] Write a smoke test in `tests/backend/startup.test.mjs` that starts the standalone process against `fin_test`, logs in, reads `/api/me`, and logs out without invoking Next.js or SQLite.
- [ ] Run the smoke test and confirm it fails before wiring the standalone launch script.
- [ ] Add `npm run api:dev` and `npm run api:start`; document test database setup, `PUBLIC_APP_ORIGIN`, and the rule that app startup never runs migrations on the restored database. Document the additive migration's inspection and rollback procedure.
- [ ] Run `npm run test:backend`, `npm run typecheck`, and `git diff --check`; record exact pass/fail results.
- [ ] Commit the handoff. Do not switch Next.js `/api/*` yet; the portal stays on its existing route until the final cutover plan.

## Next plans

Continue with `2026-10-21-node-api-finance.md`, then `2026-10-21-node-api-reports-cutover.md`. Each plan assumes the preceding plan's interfaces and tests remain green.
