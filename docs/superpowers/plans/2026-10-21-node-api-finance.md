# PostgreSQL Finance API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the standalone Node.js API handle the portal's financial writes and reads through PostgreSQL transactions.

**Architecture:** Finance services use `withTransaction(pool, fn)` and the authenticated principal from the foundation plan. New records belong to the `live` dataset; imported records retain their existing data set and IDs. Route adapters preserve existing UI paths while presenting relational documents, events, movements, and plans.

**Tech Stack:** Node.js 24+, ES modules, `pg`, PostgreSQL 18 test container, `node:test`, `decimal.js` for precise money calculations.

**Spec:** `docs/superpowers/specs/2026-10-21-node-postgres-backend-design.md`

## Global Constraints

- Execute `2026-10-21-node-api-foundation.md` first; use its `createPool`, `withTransaction`, `resolveSession`, `requirePermission`, and route registration interfaces.
- All new finance rows use PostgreSQL `qarzhy.datasets.kind='live'`; imported rows remain immutable except explicit permitted status/coverage updates.
- Never sum overlapping `legacy_ledger` and `imported_finance` merely because their dates match.
- Money is parsed from decimal strings and written as exact decimal strings. No JavaScript floating-point addition for finance totals.
- Each accepted state change is atomic, authorized, version-checked where applicable, and audited; duplicate submission cannot duplicate a posted fact.
- Tests use only `fin_test`; they never connect to or mutate the user's restored database.

## Review Focus

- Two concurrent post requests with one idempotency key produce one document and one set of facts; Task 1 tests this.
- Partial payment beyond a document's remaining amount rolls back movement and settlement together; Task 2 tests this.
- Approving one employee expense twice produces one active financial recognition; Task 3 tests this.
- A closed period rejects operations, expense recognition, and budget changes without partial rows; Task 4 tests each.
- A malformed or repeated import row returns a per-row result and never duplicates source facts; Task 5 tests this.

## File structure

- `backend/finance/documents.mjs`, `backend/finance/movements.mjs`, `backend/finance/expenses.mjs`, `backend/finance/planning.mjs`, `backend/finance/imports.mjs`: bounded transaction services.
- `backend/finance/validation.mjs`: shared decimal/date/ID validation; `backend/finance/audit.mjs`: audit insert.
- `backend/http/finance-routes.mjs`: existing route contracts mapped to those services.
- `tests/backend/finance-*.test.mjs`: one suite per service using the foundation's isolated DB helper.
- `docs/api/postgres-endpoints.md`: route-to-table mapping maintained with implementation.

### Task 1: Documents, lines, and financial posting

**Files:** Create `backend/finance/documents.mjs`, `backend/finance/validation.mjs`, `backend/finance/audit.mjs`, `backend/http/finance-routes.mjs`, `tests/backend/finance-documents.test.mjs`; modify `backend/http/server.mjs`, `docs/api/postgres-endpoints.md`, `package.json`.

**Interfaces:** `createDocument({client, principal, input})`, `postDocument({client, principal, id, version, idempotencyKey})`, `reverseDocument({client, principal, id, reason})`, `listOperations({pool, principal, filters})`; route registration `registerFinanceRoutes(router, services)`.

- [ ] Write tests for sale/purchase in summary and itemized modes, authorized organization scope, posted document integrity, one `financial_events` recognition, closed period rejection, invalid amount, and two concurrent identical idempotency keys.
- [ ] Run `node --test tests/backend/finance-documents.test.mjs`; confirm missing-service failures.
- [ ] Implement document/line validation, draft creation, posting and reversal in one transaction using the schema's posting keys and integrity triggers. Adapt `/api/operations` and `/api/correction` without fabricating old SQLite records. Add `decimal.js` using string inputs.
- [ ] Run the documents tests and existing auth tests; confirm all pass.
- [ ] Commit document service and route tests.

### Task 2: Cash movements and settlements

**Files:** Create `backend/finance/movements.mjs`, `tests/backend/finance-movements.test.mjs`; modify `backend/http/finance-routes.mjs`, `docs/api/postgres-endpoints.md`.

**Interfaces:** `recordMovement({client, principal, input})`, `settleDocument({client, principal, documentId, movementId, amount})`, `listMovements({pool, principal, filters})`.

- [ ] Write tests for inbound/outbound movement, partial payment, overpayment rejection with full rollback, duplicate posting key, transfer pairing, closed period, and reading imported movements without changing their dataset.
- [ ] Run the movement tests; confirm failures before implementation.
- [ ] Implement exact decimal amounts and document settlement transactions; let PostgreSQL constraints enforce source/document consistency. Adapt movement-related `/api/operations` and debt/detail reads to these entities.
- [ ] Run movement and document tests; confirm no duplicate cash or revenue recognition.
- [ ] Commit movement service and tests.

### Task 3: Employee expenses and financial entries

**Files:** Create `backend/finance/expenses.mjs`, `tests/backend/finance-expenses.test.mjs`; modify `backend/http/finance-routes.mjs`, `docs/api/postgres-endpoints.md`.

**Interfaces:** `createExpense({client, principal, input})`, `reviewExpense({client, principal, id, version, decision, note})`, `listExpenses({pool, principal, filters})`, `createFinancialEntry({client, principal, input})`, `reverseFinancialEntry({client, principal, id, reason})`.

- [ ] Write tests for employee self-only visibility and edits, finance/admin review, optimistic version conflict, approved/rejected state, one active recognition even after repeated review, independent cash effect, and append-only audit.
- [ ] Run `node --test tests/backend/finance-expenses.test.mjs`; confirm failures.
- [ ] Implement the transaction services using `employee_expenses`, `expense_reviews`, `financial_events`, and optional `cash_movements`. Adapt `/api/expenses` and `/api/finance/entries` payloads to existing management components. Reversals retain history.
- [ ] Run expense tests and the existing access tests; confirm all pass.
- [ ] Commit expense services and tests.

### Task 4: Plans, budgets, and periods

**Files:** Create `backend/finance/planning.mjs`, `tests/backend/finance-planning.test.mjs`; modify `backend/http/finance-routes.mjs`, `docs/api/postgres-endpoints.md`.

**Interfaces:** `savePlan({client, principal, input})`, `saveBudgetItem({client, principal, input})`, `setPeriodClosed({client, principal, organizationId, month, closed, reason})`, `listPlanning({pool, principal, filters})`.

- [ ] Write tests for plan/fact separation, draft budget version and item, close/reopen with mandatory reason, employee denial, and closed-period rejection for all write services.
- [ ] Run planning tests; confirm failures.
- [ ] Implement `payment_plans`, `budget_versions`, `budget_items`, and `accounting_periods` operations with audit and revision checks. Adapt `/api/plans`, `/api/budget`, and `/api/period`.
- [ ] Run planning plus document/movement/expense tests; confirm all pass.
- [ ] Commit planning routes and tests.

### Task 5: Import, audit, and finance API contract

**Files:** Create `backend/finance/imports.mjs`, `backend/http/audit-routes.mjs`, `tests/backend/finance-imports.test.mjs`, `tests/backend/finance-contract.test.mjs`; modify `backend/http/finance-routes.mjs`, `docs/api/postgres-endpoints.md`.

**Interfaces:** `importOperations({pool, principal, rows, sourceKey})` returns `{added, duplicates, errors}`; `listAudit({pool, principal, filters})` returns role-scoped audit rows. A row is either fully posted or reported as rejected with no partial business rows.

- [ ] Write tests for duplicate import keys, malformed rows, per-row rollback, import into `live` only, no access for employees, audit read permissions, and each existing finance mutation endpoint's HTTP status/response shape.
- [ ] Run import and contract tests; confirm failures.
- [ ] Implement `/api/import`, audit endpoints, bounded batch size, and common finance error mapping without exposing SQL text. Document every retained frontend path and relational target.
- [ ] Run `npm run test:backend`, `npm run typecheck`, and `git diff --check`; confirm pass results before claiming the finance API is ready.
- [ ] Commit finance contract and verification changes.

## Next plan

Continue with `2026-10-21-node-api-reports-cutover.md`, which adds reports, editor, export, Next.js proxy, end-to-end checks, and removes the old SQLite runtime.
