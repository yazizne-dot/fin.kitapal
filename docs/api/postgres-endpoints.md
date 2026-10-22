# PostgreSQL Node API: current backend contract

The standalone process listens on `127.0.0.1:3139` unless `API_HOST`/`API_PORT` are set. It requires `DATABASE_URL`, `PUBLIC_APP_ORIGIN`, and `CSRF_SECRET`; the latter should be a random value of at least 32 bytes. Browser traffic stays on the Next.js origin. Setting `API_INTERNAL_URL=http://127.0.0.1:3139` on the Next.js process enables its same-origin proxy; keep it unset until all portal routes are implemented. The API checks `qarzhy.schema_migrations` at startup and never runs DDL itself.

| Method and path | Request | Response | PostgreSQL entities |
| --- | --- | --- | --- |
| `GET /health` | none | `{ok:true}` only after a DB query | `schema_migrations` at startup |
| `POST /api/login` | `{username,password,remember?}` | `{user}`, `qarzhy_session` cookie | `users`, `roles`, `login_attempts`, `sessions`, `audit_log` |
| `GET /api/me` | cookie | `{user}` | `sessions`, `users`, `roles`, permissions |
| `GET /api/csrf` | cookie | `{csrf_token}` | session identity |
| `POST /api/password` | `{current_password,new_password}` | `{ok:true,user}`, rotated cookie | `users`, `login_attempts`, `sessions`, `audit_log` |
| `POST /api/logout` | cookie and `X-CSRF-Token` | `{ok:true}`, cleared cookie | `sessions` |
| `POST/PATCH /api/profile` | language, optional username/current password | `{user}` | `users`, `audit_log` |
| `GET /api/users` | admin cookie | `{users}` | `users`, `roles`, organizations, locations |
| `POST /api/users` | admin: name, username, role, password | `{ok:true,user}` | `users`, `audit_log` |
| `PATCH /api/users` | admin: id and changes; or reset-password action | `{ok:true,user?}` | `users`, `sessions`, `audit_log` |

`user` has the current frontend fields `id`, `name`, `username`, `role`, `language`, `active`, `must_change_password`, `org`, and `point`. Password hashes, session tokens and temporary passwords never appear in JSON. All responses use `Cache-Control: private, no-store`; errors use `{error,request_id}`.

For every mutation, the browser must send its exact `Origin` matching `PUBLIC_APP_ORIGIN`. Authenticated mutations also send `X-CSRF-Token` obtained from `/api/csrf`; the token is tied to the current cookie and changes after password rotation. Fetch metadata indicating a cross-site request is rejected. The cookie is host-only, `HttpOnly`, `SameSite=Strict`, and `Secure` when the public origin is HTTPS.

Migration `0003_node_api_security.sql` adds `users.password_changed_at` and `login_attempts`. The new timestamp is intentionally NULL for imported users: their first session permits only identity, password change and logout until they choose a new password. Every role, including admin, must change it again after 30 days. New passwords require at least 15 characters and are checked against common/weak values. `--check` reads the target database name, role and versions; `--apply` is explicit and uses only `MIGRATION_DATABASE_URL`, never the app's `DATABASE_URL`. The SQL is additive and idempotent. Before applying to a live environment, inspect the target and take an independent backup. To roll back the application, stop the API and deploy the prior app version; the additive columns/table can remain unused. Removing them after password changes requires a separately reviewed data rollback.

Development integration tests require `TEST_DATABASE_URL` ending in `/fin_test`; `scripts/run-backend-tests.mjs` resets `qarzhy` in that isolated database before running. They never connect to the restored `fin` database. Run `npm run typecheck` under Node.js 24+.

## Finance and report routes implemented so far

| Method and path | Purpose |
| --- | --- |
| `GET/POST /api/documents`, `POST /api/documents/post`, `POST /api/documents/reverse` | List and create live documents, post once, and reverse without changing the original fact |
| `GET/POST /api/movements`, `POST /api/settlements` | Read and record cash movements; apply a payment to a document |
| `GET/POST/PATCH /api/expenses` | Employee expenses, owner edit/delete, and finance review; existing UI cents/category fields map to exact PostgreSQL money/article IDs |
| `GET /api/data` | Employee personal view, or a finance P&L view for one covered month; other finance sections are still incomplete |
| `GET /api/finance/audit` | Last 100 audit actions for accounts-management permission; displays actor/action/reason without raw before/after JSON |
| `POST /api/export` | Download the currently displayed report rows as XLSX; requires finance session, exact Origin and session CSRF token |
| `GET/POST /api/plans`, `POST /api/budget/items`, `POST /api/period` | Plans, budgets, and period closure |
| `GET/POST /api/reports/coverage` | Inspect report-family source intervals and configure cutover |
| `POST /api/reports/opening-snapshot/verify` | Verify an opening balance before balance cutover |
| `GET /api/reports/pnl` | Read one P&L period from the selected historical series or live events; `source=auto` requires one complete coverage interval |
| `GET /api/reports/cashflow` | Read cash movements from coverage-selected live data or the legacy PostgreSQL dataset; internal transfers are excluded from external flow totals |
| `GET /api/reports/balance` | Read a dated balance from historical rows or a verified opening snapshot and scoped live cash movements; missing components remain null |
| `GET/POST /api/reports/figures`, `POST /api/reports/figures/reset` | List, set, and reset individual effective report figures with a revision and reason |
| `GET /api/finance/editor`, `POST /api/finance/cell` | Compatibility adapter for the existing table and modal editor layout; report books select historical or live P&L and month or source YTD |

`GET /api/reports/pnl` accepts `scope_id`, `start`, `end`, optional `kind=monthly|source_ytd`, and optional `source=auto|historical|events`. It returns `figures`, source rows, coverage, and warnings. Missing historical inputs stay null; `source_ytd` is read from its own PostgreSQL rows and is never silently reconstructed from monthly rows. An input correction recalculates gross, operating, net, and retained profit with decimal arithmetic. Explicit derived-number corrections take precedence and expose a reconciliation difference. The edit changes only `report_overrides`; original history, documents, events, and cash movements remain intact.
Live P&L includes the sale event's `cost_amount` in cost of sales. A sale return reduces both revenue and cost; a purchase return remains outside P&L until its inventory/accounting effect is classified. Unknown return events produce a warning instead of being silently counted in profit.
Migration `0004` also registers stable `live.pnl.*` metric keys. The same figure editor can list live inputs and calculated totals for a period; an input or derived-number override changes the effective report while the source event remains unchanged. Reset restores event-derived values, and the append-only history records both actions.
The editor adapter returns decimal strings to the unchanged table and modal structure. It identifies figures by PostgreSQL metric and optional dimension IDs instead of Excel cell coordinates. Historical monthly and `YYYY-YTD` choices remain separate. Its edit route checks that the selected figure actually exists for the chosen source and period before applying a correction.

The existing employee expense form sends integer cents and a category name. The API converts cents to exact money, resolves the article, and returns the original table fields (`date`, `amount_cents`, `category`, `vendor`) while retaining relational IDs internally. Owners may edit or soft-delete unapproved expenses with a version check; finance may review submitted expenses. Standard form categories are created lazily if absent, and personal category lists do not expose another employee's custom categories. `/api/data` serves the authenticated employee's personal view and projects a finance P&L month into the unchanged report view shape. That projection uses effective PostgreSQL figures, so a report override changes the displayed profit while the original event remains unchanged. An approved PostgreSQL budget version supplies plan rows only under budget coverage; article/channel plans show no actual without a matching rule. Live channel sales use scoped revenue, cost, and sale-return events. A channel selection shows revenue, cost, and gross profit; operating/net profit remains blank because overhead allocation is not configured. Previous-year channel revenue is also blank until matching coverage is available. Source `ledger`, YTD, and organization filters still return unavailable.

`GET /api/reports/cashflow` accepts `scope_id`, `start`, `end`, and `source=auto|historical|movements|ledger`. Its live and ledger totals use exact decimals and omit paired internal transfers. Imported movements with unknown organization or cash account retain null references and an explicit warning. Historical cash-flow rows can be read, but aggregate totals remain null until the source metric mapping is completed.
Consolidated live P&L, cash flow, and balance aggregate facts recorded under the organization scopes; imported ledger rows continue to use their own dataset and scope. Report date boundaries are read as PostgreSQL date strings so host timezone settings cannot move a month boundary.

`GET /api/reports/balance` accepts `scope_id`, `as_of`, and `source=auto|historical|opening_and_movements`. Automatic selection requires one coverage rule for the date. The live path requires a verified opening snapshot in the same dataset and scope, then adds cash movements from the opening date up to (but not including) `as_of`. Receivables and payables add posted document events and subtract their partial settlements; unallocated counterparty cash makes both debt totals unknown. Historical balance rows are returned without an aggregate until metric mapping is defined. Inventory and other assets remain unknown after the opening date until their movements are reconciled. Missing or unmapped values are never treated as zero; `complete=false` and warnings explain the gap. The `/api/data` projection displays available balance components and cash-flow rows in the existing cards/tables, while keeping unreconciled totals blank and showing warnings.
The restored `fin` database stores the imported cash-flow workbook's `База` rows in the `imported_finance` dataset; legacy ledger movements are in `legacy_ledger`. A cash-flow coverage rule may select either imported dataset with `source_kind=movements`. Each interval selects one dataset, so imported and live movements are not combined implicitly.

All report reads and writes enforce the caller's organization scope. Mutations require the same cookie, Origin, and CSRF checks as account routes. Migration `0004_report_overrides.sql` adds the effective override key and append-only history. Neither `0003` nor `0004` is applied automatically to the populated database.

The XLSX download preserves the existing report button and workbook format. The client sends its displayed rows after obtaining a session CSRF token; the Node API validates row/cell types and size, and the writer encodes text cells as strings so formula-like labels are not executed. This route does not read SQLite or Excel source data.

The Next.js UI still uses the existing SQLite-backed handler when `API_INTERNAL_URL` is unset, while complete balance reconciliation, sales, import, export, and full `/api/data` compatibility routes are being implemented. Do not enable the proxy for normal UI use yet; the report and finance endpoints above can be exercised directly in the isolated test environment. The proxy forwards method, query, selected browser security headers, cookie, request body, response cookie, content type, download disposition and binary body; every response is no-store. It accepts only a loopback HTTP backend origin.
