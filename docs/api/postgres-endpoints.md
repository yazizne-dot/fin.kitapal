# PostgreSQL Node API: foundation contract

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
