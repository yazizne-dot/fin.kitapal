# PostgreSQL Node API: current backend contract

The standalone process listens on `127.0.0.1:3139` unless `API_HOST`/`API_PORT` are set. It requires `DATABASE_URL`, `PUBLIC_APP_ORIGIN`, and `CSRF_SECRET`; the latter should be a random value of at least 32 bytes. Browser traffic stays on the Next.js origin and will be forwarded to this service after the report/finance API is complete. The API checks `qarzhy.schema_migrations` at startup and never runs DDL itself.

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
| `GET/POST/PATCH /api/expenses` | Own expenses and finance review |
| `GET/POST /api/plans`, `POST /api/budget/items`, `POST /api/period` | Plans, budgets, and period closure |
| `GET/POST /api/reports/coverage` | Inspect report-family source intervals and configure cutover |
| `POST /api/reports/opening-snapshot/verify` | Verify an opening balance before balance cutover |
| `GET /api/reports/pnl` | Read one P&L period from the selected historical series or live events; `source=auto` requires one complete coverage interval |
| `GET/POST /api/reports/figures`, `POST /api/reports/figures/reset` | List, set, and reset individual effective report figures with a revision and reason |

`GET /api/reports/pnl` accepts `scope_id`, `start`, `end`, optional `kind=monthly|source_ytd`, and optional `source=auto|historical|events`. It returns `figures`, source rows, coverage, and warnings. Missing historical inputs stay null; `source_ytd` is read from its own PostgreSQL rows and is never silently reconstructed from monthly rows. An input correction recalculates gross, operating, net, and retained profit with decimal arithmetic. Explicit derived-number corrections take precedence and expose a reconciliation difference. The edit changes only `report_overrides`; original history, documents, events, and cash movements remain intact.

All report reads and writes enforce the caller's organization scope. Mutations require the same cookie, Origin, and CSRF checks as account routes. Migration `0004_report_overrides.sql` adds the effective override key and append-only history. Neither `0003` nor `0004` is applied automatically to the populated database.

The Next.js UI still uses the existing SQLite-backed handler while the remaining balance, cash flow, sales, import, export, and full `/api/data` compatibility routes are being implemented. Do not point the UI to this API yet; the report and finance endpoints above can be exercised directly in the isolated test environment.
