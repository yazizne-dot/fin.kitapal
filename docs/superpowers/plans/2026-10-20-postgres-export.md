# PostgreSQL SQL artifacts

**Goal:** prepare a schema and INSERT data snapshot for the current interface.
**Spec:** `docs/superpowers/specs/2026-10-20-postgres-data-design.md`.
**Execution:** inline, on the user-requested `feat/postgres-migration` branch.
Application runtime and existing local data are not modified.

## Tasks

- [x] Add workbook, sheet and typed-cell tables to the existing schema (16 total).
- [x] Implement a reproducible read-only SQLite/JSON export, with INSERT batches,
  exact decimal handling, one import transaction and a non-empty-target guard.
- [x] Generate `data/postgres-data.sql` and its manifest; exclude both from Git.
- [x] Verify round-trip data, formula metadata, IDs, money conversions, revision,
  session exclusion and SQL literal escaping; update the main architecture guide.

## Decisions carried from the comparison

- Sessions are not exported; users log in again.
- API amounts remain compatible with the current interface; runtime conversion
  is a later task.
- Use INSERT, not COPY, as explicitly requested by the user.
- Use the existing branch; do not create another worktree or commit unrelated files.

## Review focus

Preserve empty strings vs NULL, trailing spaces in sheet names, shared formulas,
decimal precision and deleted flags. Load closed periods after financial data,
restore revision after triggers and advance identity sequences. Reject duplicate
imports without clearing existing data. PostgreSQL execution must be reported
separately from local SQL round-trip verification if no PostgreSQL is available.


## Verification ledger

- Exporter tests: RED (missing exporter), then GREEN, 5/5 tests.
- Full INSERT round-trip: all rows and all 3 reconstructed books equal sources;
  385,661 cells, exact decimal money conversions, revision and session exclusion.
- PostgreSQL 18.6 WASM / PGlite 0.5.10: schema and full INSERT passed;
  counts, totals, revision=4, sequences, duplicate-import guard and closed-period
  trigger passed. All imported cells compared exactly with original JSON.
- Existing project suite: `npm test`, 45 server tests + 10 component tests passed.
- Independent review: no Critical/Important findings; documentation findings fixed.
- No commits, runtime dependency changes, source-data writes or deployment.
