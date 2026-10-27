# Ledger Dashboard Default Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Open the PostgreSQL portal's dashboard in the existing SQLite-style ledger overview by default, while retaining the explicit workbook report.

**Architecture:** Resolve the default report source from the current route in the client filter parser. On the dashboard, an absent source means `ledger`; direct non-dashboard routes retain `auto`. The Node API and both view components remain unchanged.

**Tech Stack:** Next.js 16.3.7, React 19, TypeScript, Node.js 24, PostgreSQL, existing `node:test`/Playwright checks.

**Spec:** `docs/superpowers/specs/2026-10-27-ledger-dashboard-default-design.md`

## Global Constraints

- Read the relevant guide in `node_modules/next/dist/docs/` before code edits, as required by `AGENTS.md`.
- Do not change authentication, PostgreSQL schema, imported facts, report overrides, or financial calculations.
- Keep explicit `source=workbook` and `source=ledger` links functional.
- Do not hardcode the month, organizations, KPI values, or demo badge.

## Review Focus

- Empty source on `/` uses ledger; empty source on `/pnl` remains auto; ledger mode drops workbook-only YTD and channel filters.
- Explicit `source=workbook` and `source=ledger` keep their meanings; stale `source=auto` on the dashboard resolves to ledger and retains auto on other pages.
- Invalid source values cannot select an unexpected report mode.
- Navigating from the ledger dashboard preserves its source, month, and organization filters.
- An expired-password or employee session still follows the existing identity-first access flow.

---

### Task 1: Route-aware dashboard source

**Files:**
- Modify: `features/portal/routes.ts`
- Modify: `features/portal/provider.tsx`
- Test: `tests/react/reports.test.tsx`

**Interfaces:**
- Consumes: `pathname` from Next.js `usePathname()` and the current URL search parameters.
- Produces: `filtersFromSearch(search: URLSearchParams, page?: string): ReportFilters`; dashboard callers pass `dashboard`, other callers keep their existing behavior.

- [x] Add a focused test: `/` without `source` or with stale `source=auto` resolves to `ledger`; `/pnl` without `source` resolves to `auto`; explicit `ledger` and `workbook` are preserved; invalid source falls back according to route.
- [x] Run the focused component tests and confirm the new assertion fails before the change.
- [x] Implement the route-aware default in `filtersFromSearch`, then pass the pathname's page name from `PortalProvider`.
- [x] Assert `pageHref('pnl', dashboardFilters)` retains `source=ledger`, month, and organization; run component tests to confirm it passes.
- [x] Run typecheck and commit the code and test.

### Task 2: Browser and data parity verification

**Files:**
- Test: `tests/next/postgres-browser.test.mjs` only if the existing browser coverage cannot assert the default view without duplicating other tests.

**Interfaces:**
- Consumes: the route-aware `ReportFilters` from Task 1 and existing PostgreSQL `/api/data?source=ledger` projection.
- Produces: evidence that the default dashboard uses ledger controls and that the workbook remains reachable.

- [x] Verify `/` displays the ledger controls and `/?source=workbook` displays the workbook controls in Chromium, intercepting requests with read-only PostgreSQL projections because the isolated `fin_test` database is absent.
- [x] Verify the Node API's read-only September 2026 ledger projection and compare the displayed KPI values against the SQLite reference where equivalent source data exists.
- [x] Check that unauthenticated, expired-password, and employee views do not expose the finance dashboard through the existing access-control tests.
- [x] Recheck the local 3000/3001 servers and inspect desktop/mobile screenshots and browser errors.
- [x] Record the unavailable isolated database and any mismatch; do not substitute SQLite demo numbers into PostgreSQL.

Execution note: `fin_test` is absent, so the destructive integration/browser suite was not run. The checked browser views used the live PostgreSQL ledger projection read-only with Playwright request interception; account protection was covered by the existing non-database tests. September aggregate and Qalam Books figures matched the separate SQLite comparison instance exactly.
