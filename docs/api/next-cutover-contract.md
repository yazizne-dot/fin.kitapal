# Next.js to Node API cutover contract

The Next.js UI uses one catch-all `/api/[...path]` handler. With `API_INTERNAL_URL` set, it forwards every API request to the standalone Node process. A partial switch is therefore user-visible even when authentication works. Keep the proxy disabled for normal users until this inventory is closed and verified in a browser.

| Existing UI action | Current request | Node/PostgreSQL state | Work needed before cutover |
| --- | --- | --- | --- |
| Sign in, identity, password, logout, profile, users | `/api/login`, `/api/me`, `/api/password`, `/api/logout`, `/api/profile`, `/api/users` | Implemented with PostgreSQL sessions, CSRF and 30-day password rotation | Browser regression with every role |
| Monthly finance workbook | `GET /api/data?source=auto|workbook&month=...` | Implemented for a covered P&L month, with partial balance/cash-flow projections | Configure coverage, verify openings and reconcile displayed values |
| Year-to-date workbook | `GET /api/data?range=ytd` | Returns unavailable | Aggregate only covered monthly data through the selected month; preserve source `source_ytd` totals separately |
| Organization and legacy ledger view | `GET /api/data?source=ledger&org=...` | Returns unavailable; manager view lacks the expected `LedgerData` response | Build an authorized relational ledger projection, including operations, debts, plans and audit |
| Legacy operation form | `POST /api/operations` | Route absent; new documents use `/api/documents` plus posting, and cash uses `/api/movements` | Map each legacy kind to one explicit document/event/movement transaction with idempotency; do not treat every operation as a sale |
| Legacy correction form | `POST /api/correction` | Route absent; new documents reverse by compensating facts | Preserve original posted facts and expose a correction workflow rather than editing imported or posted rows |
| Legacy CSV import | `POST /api/import` | Route absent | Validate and classify each row, report duplicates/errors, write only to the live dataset in an audited transaction |
| Legacy budget form | `POST /api/budget` | Route absent; new model writes draft `budget_versions`/`budget_items` | Resolve organization/metric IDs and define draft/approval behavior before wiring the unchanged form |
| Legacy plan form | `POST /api/plans` with `{date,org,article,direction,amount}` | Compatibility adapter resolves the selected organization and reuses or creates one named article, then writes a payment plan with the existing authorization, closed-period and audit checks | Verify the full ledger screen after its read projection exists |
| Legacy period form | `POST /api/period` with `{month,closed,reason}` | Path exists but additionally requires `organizationId` and a nonempty reason | Resolve the target organization; define behavior for the old global close control; preserve audit reason |
| Report-number editor | `/api/finance/editor`, `/api/finance/cell` | Implemented against PostgreSQL override/history rows | Compare modal behavior and calculated totals with existing UI |

The restored `fin` database has only consolidated historical report series. It cannot supply organization or sales-channel history by guessing from metric labels. The 2026 source-YTD P&L total matches the sum of nonzero January–August monthly revenue within imported precision, but a source-YTD row is a separate stored value and does not identify an arbitrary selected cutoff month. The UI's YTD control must use the chosen month's covered monthly intervals unless a separately verified source total applies.

The Node API has no SQLite dependency. The Next.js fallback still uses SQLite until the complete proxy contract is implemented and cut over. The populated PostgreSQL database remains unchanged by this inventory.
