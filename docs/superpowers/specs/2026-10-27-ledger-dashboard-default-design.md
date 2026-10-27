# PostgreSQL dashboard with the SQLite overview layout

Date: 2026-10-27. Status: approved design direction; implementation pending.

## Goal

Opening the PostgreSQL portal's dashboard should show the same overview layout and controls as the SQLite dashboard in the user's first screenshot: the month and organization filters, cash and finance KPI cards, and the existing ledger charts and sections. Its figures must come from PostgreSQL, without copying values from the SQLite comparison database or the separate historical workbook report.

## Existing behavior and cause

The Next.js portal already contains `LedgerView`, which reproduces the SQLite overview, and `WorkbookView`, which shows the historical report. The Node API already projects the imported SQLite operations from PostgreSQL through `GET /api/data?source=ledger`. On a URL without `source`, `filtersFromSearch` chooses `auto`; the API then returns workbook data. That is why the PostgreSQL dashboard opens on August 2026 with a channel filter and source warnings instead of the ledger overview. The ledger projection selects its latest month from stored operations and already supports organization filtering.

## Chosen approach

For the dashboard's initial URL, request `source=ledger` when no source is specified or a stale `source=auto` link is opened. Drop workbook-only year-to-date and channel filters when entering ledger mode, while preserving month and organization. Keep an explicit `source=workbook` selection unchanged, including the existing navigation control from the ledger view. Preserve the selected source, month, and organization when navigating from the dashboard to other finance pages. Do not change the authentication flow, PostgreSQL schema, ledger calculation, report overrides, or imported facts.

The ledger view continues to use its current layout and i18n strings. The demo badge reflects the provenance flag returned by the PostgreSQL ledger projection; it is shown only when that projection contains imported demo operations. Do not hardcode September 2026 or the sample KPI values. If the database has a later valid ledger month, the existing latest-month selection applies.

## Alternatives considered

- Change the API's `auto` response to ledger globally. This would also change direct report routes and callers that currently rely on workbook data, making the effect broader than the requested dashboard correction.
- Restyle `WorkbookView` to look like `LedgerView`. This duplicates the existing overview and risks mixing workbook and ledger figures with different coverage and dimensions.

## Verification

- Check the dashboard with no `source` parameter and with explicit `source=ledger` and `source=workbook`; verify the first two use `LedgerView` and the last remains `WorkbookView`.
- Confirm the month and organization controls, translated labels, card order, and visible state match the SQLite reference at desktop width. Check that changing the organization updates only that organization's PostgreSQL ledger projection.
- Compare the September 2026 ledger KPI figures with the SQLite reference when the imported data supports that month; investigate any discrepancy rather than replacing figures with static values.
- Check unauthenticated, employee, and password-change flows so the dashboard default does not bypass existing access rules. Run the relevant component, backend, and browser checks against the isolated test database.

## Scope boundary

This change corrects the default dashboard presentation and source selection. It does not claim that the separate PostgreSQL historical workbook has organization-level coverage or verified September 2026 P&L values. That report remains separately available with its warnings.
