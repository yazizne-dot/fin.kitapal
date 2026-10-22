# Restored `fin.qarzhy` preflight (2026-10-22)

This is a read-only inspection of the user's existing PostgreSQL database on `127.0.0.1:5436`. It used `BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`; no schema migration, coverage rule, report override, or application write was applied. Connection credentials remain in the ignored `.env.pg-preflight.local` and are not included here. Re-run `npm run db:preflight` to refresh the counts.

| Check | Observed |
| --- | --- |
| Applied schema versions | `0001_relational_finance`, `0002_relational_source_resolution` |
| Missing for Node API | `0003_node_api_security`, `0004_report_overrides`, `0005_portal_operations` (the last migration was added after this read-only preflight) |
| Users / documents / payment plans | 12 / 126 / 30 |
| Cash movements / financial events | 35,332 / 517 |
| Historical report values | 13,019 |
| Open import issues | 0 |
| Report coverage rules / verified opening snapshots | 0 / 0 |

The `imported_finance` dataset contains 34,878 cash movements dated 2021-04-01 through 2026-08-31. The `legacy_ledger` dataset contains 454 cash movements and 517 financial events; the `live` dataset has no events or movements. A cash-flow coverage rule can select the imported movements without copying or changing them.

All 1,534 historical series are in the consolidated scope. Historical sales have 208 series and no populated `channel_id`, so they cannot be presented as channel-specific totals by guessing from labels. Organization-scoped users must not be given consolidated rows through an implicit fallback.

Historical P&L has 5,316 monthly values from 2022-01 to 2026-12; the latest month with a nonzero value is 2026-08. Later months include reported zero placeholders, so the last stored period is not proof that actual results exist. The portal now excludes unconfigured zero-only historical months from its default and available actual months; an explicitly covered zero month remains selectable. The August 2026 report uses a double space in `ПРОЧИЕ  РАСХОДЫ`; the Node API now normalizes whitespace when recognizing imported P&L totals. The original metric names and amounts remain unchanged.

The August 2026 P&L has a stored retained-profit total but no separate dividend metric. Net profit can be recalculated from the recognized input rows; retained profit remains unknown in the API until the dividend relationship is explicitly mapped. The stored retained-profit value is preserved in the historical rows.

Historical budget has 4,032 monthly values from 2023-01 to 2026-12. In August 2026, the same budget label occurs three times as plan, fact and ratio; the ratio has `unit=ratio`, but both monetary rows have `unit=amount`, opaque metric codes and opaque registry keys. The database does not identify which amount is the plan. Do not choose by size or row order. Approved relational budget versions are supported by the API; the imported budget needs an explicit source-column mapping before it can be shown as plan/fact.

On 2026-10-22, migrations `0003_node_api_security`, `0004_report_overrides`, and `0005_portal_operations` were applied to `fin`. A second read-only preflight reported no missing migrations, 12 users, 126 documents, 30 plans, 35,332 cash movements, 517 financial events, 13,019 historical values, and zero open import issues. A read-only Node ledger projection for September 2026 returned a zero balance difference. No original financial facts were changed by these additive migrations.

With the user's approval, one consolidated historical P&L coverage rule was added for January through August 2026. Monthly net profit is calculated from the imported inputs, and retained profit stays unavailable because a separate dividend input is missing. The January–August monthly sum has operating expenses of 241,444,290.00 and net profit of -3,155,843.27; the stored source-YTD row has operating expenses of 244,935,736.00 and net profit of -6,647,289.24. The API shows the monthly sum and an explicit source-YTD reconciliation warning rather than replacing either source value.

Before using the Next.js/Node API combination for normal finance work, map imported report dimensions, configure coverage for any additional trusted periods, verify an opening snapshot for balance cutover, and compare representative months against the existing interface. The three organizations currently have no cash accounts, so live cash operations remain unavailable until real accounts are configured.

A later read-only projection under the restricted local API role `qarzhy_app` confirmed that the August 2026 monthly and YTD reports both expose calculated profit, preserve unavailable retained profit, and carry coverage warnings. A read-only password-deadline check found all ten active users due for a change: one admin, one finance user and eight employees. Browser tests exercise the change flow on `fin_test`; no real user password was changed during this check.

The cash-movement mapping check found that all 34,878 `imported_finance` movements lack both `organization_id` and `cash_account_id`; their article IDs are populated. All 454 `legacy_ledger` movements lack `cash_account_id`, and four also lack `organization_id`. There are no historical `cashflow` report series. No cash-flow coverage rule was added: the source movements can be counted, but a trusted organization/account breakdown and opening balances cannot yet be derived. The read-only preflight now reports these missing-dimension counts by dataset.
