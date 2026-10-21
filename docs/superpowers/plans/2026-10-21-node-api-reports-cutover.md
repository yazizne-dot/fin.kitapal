# PostgreSQL Reports and Next.js Cutover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace old workbook/SQLite reporting with PostgreSQL reports, keep the current portal appearance and editor, and route Next.js to the standalone Node.js API.

**Architecture:** Report services choose historical values or new live facts through `coverage_rules` and expose the current `/api/data` contract. Report overrides form a separate presentation layer with audit and recalculation; source financial facts stay intact. Next.js forwards same-origin API traffic to the loopback service, then the old SQLite and JSON runtime path is removed.

**Tech Stack:** Node.js 24+, ES modules, `pg`, `decimal.js`, PostgreSQL 18 test container, Next.js 16.3.7, React 19.3.0, `node:test`, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-21-node-postgres-backend-design.md`

## Global Constraints

- Execute `2026-10-21-node-api-foundation.md` and `2026-10-21-node-api-finance.md` first; all their backend tests must remain green.
- `fin.qarzhy` is the sole runtime finance store. Never read SQLite or Excel/JSON to serve a request.
- Keep the current page routes, general appearance, bilingual controls, login form, report tables, and management flows.
- Do not combine `legacy_ledger` and `imported_finance` automatically. `coverage_rules` may differ by family, scope, metric, and period.
- Missing data stays missing; no zero substitution or invented opening balance. Money uses decimal arithmetic.
- Report edits recalculate dependents without mutating documents, events, or cash movements.
- Before editing a Next.js file, install Node.js 24+ dependencies and read the relevant guide under `node_modules/next/dist/docs/`, as required by `AGENTS.md`.
- Tests and browser checks use isolated `fin_test`; do not mutate the user's populated PostgreSQL.

## Review Focus

- A monthly P&L and a source YTD total for the same period remain distinct; Task 2 tests both.
- An imported cash row with unknown organization/account is shown with an explicit gap rather than assigned a guessed one; Task 2 tests it.
- An override on revenue changes profit but leaves cash and document counts identical; Task 3 tests it.
- A missing or draft opening snapshot prevents a combined balance; Task 1 tests it.
- Forwarded `Set-Cookie`, `Cookie`, binary export, and no-store headers survive the Next.js proxy; Task 5 tests each.

## File structure

- `backend/reports/coverage.mjs`, `backend/reports/pnl.mjs`, `backend/reports/cashflow.mjs`, `backend/reports/balance.mjs`, `backend/reports/planning.mjs`, `backend/reports/overrides.mjs`, `backend/reports/present.mjs`: bounded report units.
- `backend/http/report-routes.mjs`, `backend/http/export-routes.mjs`: API contracts and export.
- `docs/sql/migrations/0004_report_overrides.sql`: additive override tables and history.
- `features/portal/provider.tsx`, `features/portal/routes.ts`, `features/workbook/*`, `features/ledger/*`, `features/management/financial-editor.tsx`, `features/shared/types.ts`: minimal interface adaptation.
- `app/api/[...path]/route.ts`, `next.config.ts`: same-origin forwarding and runtime setup.
- `tests/backend/reports-*.test.mjs`, `tests/next/portal.test.mjs`, `tests/react/reports.test.tsx`: report, proxy, and interface checks.

### Task 1: Coverage and opening balance configuration

**Files:** Create `backend/reports/coverage.mjs`, `backend/http/report-routes.mjs`, `tests/backend/reports-coverage.test.mjs`; modify `backend/http/server.mjs`, `features/workbook/reports.tsx`, `docs/api/postgres-endpoints.md`.

**Interfaces:** `getCoverage({pool, principal, family, scopeId, metricId, start, end})` returns ordered non-overlapping source intervals or a typed gap; `saveCoverage({client, principal, input})` validates family/scope/date/snapshot and audits changes; `verifyOpeningSnapshot({client, principal, id, version})` validates the snapshot before status change.

- [ ] Write tests for separate family cutovers, overlapping rules rejected, missing range reported as a gap, unauthorized changes denied, draft/wrong-date opening snapshot rejected, verified matching snapshot accepted, and configuration change audited.
- [ ] Run `node --test tests/backend/reports-coverage.test.mjs`; confirm failures.
- [ ] Implement coverage queries and one-time settings API. PostgreSQL's overlap/snapshot triggers remain authoritative. Add the existing settings page controls without changing its layout.
- [ ] Run coverage and prior backend tests; confirm all pass.
- [ ] Commit coverage setup and tests.

### Task 2: Relational report calculations

**Files:** Create `backend/reports/pnl.mjs`, `backend/reports/cashflow.mjs`, `backend/reports/balance.mjs`, `backend/reports/planning.mjs`, `backend/reports/present.mjs`, `tests/backend/reports-calculation.test.mjs`; modify `backend/http/report-routes.mjs`, `docs/api/postgres-endpoints.md`.

**Interfaces:** `buildReport({pool, principal, source, month, range, channelId, organizationId})` returns a typed report model; `presentPortalData(report, principal)` returns `source:'workbook'|'ledger'|'personal'` compatible with `features/portal/page-view.tsx`, plus explicit coverage warnings and relational source references. `source='auto'` follows coverage, `source='ledger'` reads the former ledger in PostgreSQL, and `source='workbook'` reads imported finance history in PostgreSQL.

- [ ] Write tests for historical-only and live-only periods, different P&L/cash/balance boundaries, no overlap double counting, distinct monthly/YTD historical values, partial payment and debts, draft balance snapshot, null/unknown money values, and exact decimal totals.
- [ ] Run `node --test tests/backend/reports-calculation.test.mjs`; confirm failures.
- [ ] Implement P&L/sales/budget, cash flow, balance/debt, analytics, planning, and checks projections from relational tables. Separate source selection from physical database choice. Add `/api/data` and report-detail routes; preserve role-specific visibility.
- [ ] Run report and finance suites; confirm the same effective numbers appear in summary and detail views.
- [ ] Commit report engines and tests.

### Task 3: Editable report figures

**Files:** Create `docs/sql/migrations/0004_report_overrides.sql`, `backend/reports/overrides.mjs`, `tests/backend/reports-overrides.test.mjs`; modify `backend/http/report-routes.mjs`, `features/management/financial-editor.tsx`, `features/management/common.tsx`, `features/workbook/report-parts.tsx`.

**Interfaces:** `listEditableFigures({pool, principal, filters})` returns current editor rows and revision; `setReportOverride({client, principal, key, value, reason, revision})` writes one effective override plus append-only history; `resetReportOverride({client, principal, key, reason, revision})` removes the effective override while recording the reset. `key` contains dataset, report family, scope, period/kind, metric, and optional article/channel.

- [ ] Write tests for editing historical and live figures, required reason, revision conflict, per-dataset isolation, reset with retained history, direct override precedence plus visible reconciliation difference, downstream profit recalculation, and unchanged documents/events/cash rows.
- [ ] Run `node --test tests/backend/reports-overrides.test.mjs`; confirm failures.
- [ ] Add the keyed table and immutable history, service calculations, and `/api/finance/editor`/`/api/finance/cell` adapters. Keep the editor's table/form arrangement; replace Excel coordinates and file names with truthful report/period references.
- [ ] Run override, calculation, and component tests; confirm all pass.
- [ ] Commit overrides and editor compatibility.

### Task 4: Exports and complete UI contract

**Files:** Create `backend/http/export-routes.mjs`, `tests/backend/reports-contract.test.mjs`; modify `features/workbook/types.ts`, `features/workbook/workbook-view.tsx`, `features/ledger/types.ts`, `features/ledger/ledger-view.tsx`, `features/shared/types.ts`, `features/portal/provider.tsx`, `features/portal/routes.ts`, `features/management/management-view.tsx`, `docs/api/postgres-endpoints.md`.

**Interfaces:** `/api/data` and all current report/management paths return payloads consumed by the existing screens; `/api/export` returns an XLSX generated from the same effective report model and user scope. Missing coverage is a visible warning, not a numeric zero.

- [ ] Write a contract matrix test for dashboard, P&L, balance, cash flow, analytics, plans, operations, checks, imports, settings, debts, audit, users, expenses, financial entries/editor, and account. Include employee and finance roles, bilingual labels, and an expired-password login that reaches the account view without `/api/data`. Assert XLSX numbers match effective screen data after an override.
- [ ] Run `node --test tests/backend/reports-contract.test.mjs`; confirm failing missing contracts.
- [ ] Adapt the current view types/components to relational source references, coverage warnings, and session-bound CSRF headers while preserving page layout. On login read `/api/me` first: if `must_change_password`, render the account/password view from identity data and call `/api/data` only after password change. Reuse the existing XLSX writer for export if it remains independent of SQLite/JSON.
- [ ] Run backend contract/component tests and `npm run typecheck`; confirm all pass.
- [ ] Commit UI contract and export changes.

### Task 5: Next.js proxy and removal of old runtime

**Files:** Modify `app/api/[...path]/route.ts`, `server/runtime.ts`, `next.config.ts`, `package.json`, `README.md`, `tests/next/portal.test.mjs`; remove runtime-only SQLite/Excel readers after replacing their tests (`server/db/open.mjs`, `server/db/seed.mjs`, `server/http/portal.mjs`, `server/finance/workspace.mjs` as applicable). Keep migration scripts/docs as archives.

**Interfaces:** All browser `/api/*` requests use the standalone API at private `API_INTERNAL_URL`; Next.js passes method, path/query, body, cookie, and origin safely, and returns status, body, `Set-Cookie`, content type, and `Cache-Control: private, no-store`. API bind remains loopback/private.

- [ ] Install Node.js 24+ and dependencies, read the relevant local Next.js 16.3.7 guides in `node_modules/next/dist/docs/`, and write proxy tests for cookie/login/logout, missing backend, rejected origin, binary export, no-store headers, and every current portal page loading from `fin_test`.
- [ ] Run `npm run test:next`; confirm the new proxy tests fail before replacing the route.
- [ ] Implement the proxy and start both processes in dev/test scripts. Remove active SQLite and workbook file reads, old startup paths, and obsolete tests only after equivalent PostgreSQL contract tests pass. Keep the prior private source files out of builds and Git.
- [ ] Run `npm run test:backend`, `npm run test:components`, `npm run test:next`, `npm run typecheck`, `npm run build`, and `git diff --check`; record results. Run a read-only preflight against the restored PostgreSQL for schema versions, row counts, access to expected datasets, sample report values, and zero open import issues; do not apply migrations there during this test.
- [ ] Commit the cutover. Document the separate production processes, restricted DB/API roles, additive migration procedure and rollback, password-change onboarding, coverage setup, and verification commands.

## Completion gate

The work is ready for environment cutover only when every current screen runs through the PostgreSQL API, no runtime SQLite/Excel reader remains, the count/sample checks match the restored database, and missing coverage is explicit. Applying migrations or switching a live environment is a separate operational action after this implementation is reviewable.
