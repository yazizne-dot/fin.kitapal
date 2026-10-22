# Restored `fin.qarzhy` preflight (2026-10-22)

This is a read-only inspection of the user's existing PostgreSQL database on `127.0.0.1:5436`. It used `BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`; no schema migration, coverage rule, report override, or application write was applied. Connection credentials remain in the ignored `.env.pg-preflight.local` and are not included here. Re-run `npm run db:preflight` to refresh the counts.

| Check | Observed |
| --- | --- |
| Applied schema versions | `0001_relational_finance`, `0002_relational_source_resolution` |
| Missing for Node API | `0003_node_api_security`, `0004_report_overrides` |
| Users / documents / payment plans | 12 / 126 / 30 |
| Cash movements / financial events | 35,332 / 517 |
| Historical report values | 13,019 |
| Open import issues | 0 |
| Report coverage rules / verified opening snapshots | 0 / 0 |

The `imported_finance` dataset contains 34,878 cash movements dated 2021-04-01 through 2026-08-31. The `legacy_ledger` dataset contains 454 cash movements and 517 financial events; the `live` dataset has no events or movements. A cash-flow coverage rule can select the imported movements without copying or changing them.

All 1,534 historical series are in the consolidated scope. Historical sales have 208 series and no populated `channel_id`, so they cannot be presented as channel-specific totals by guessing from labels. Organization-scoped users must not be given consolidated rows through an implicit fallback.

Historical P&L has 5,316 monthly values from 2022-01 to 2026-12; the latest month with a nonzero value is 2026-08. Later months include reported zero placeholders, so the last stored period is not proof that actual results exist. The August 2026 report uses a double space in `ПРОЧИЕ  РАСХОДЫ`; the Node API now normalizes whitespace when recognizing imported P&L totals. The original metric names and amounts remain unchanged.

Historical budget has 4,032 monthly values from 2023-01 to 2026-12. In August 2026, the same budget label occurs three times as plan, fact and ratio; the ratio has `unit=ratio`, but both monetary rows have `unit=amount`, opaque metric codes and opaque registry keys. The database does not identify which amount is the plan. Do not choose by size or row order. Approved relational budget versions are supported by the API; the imported budget needs an explicit source-column mapping before it can be shown as plan/fact.

Before enabling the Next.js proxy for normal users, complete the missing API view routes, map imported report dimensions, apply and verify the two additive migrations in a reviewed cutover, configure nonoverlapping coverage rules, verify an opening snapshot for balance cutover, and compare representative months against the existing interface. The current preflight exits nonzero while the required schema versions are absent. The production `fin` database has not been modified.
