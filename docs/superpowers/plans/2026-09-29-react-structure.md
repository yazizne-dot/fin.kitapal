# React Structure Implementation Plan

**Goal:** Replace retained DOM renderers with typed React pages and URL routing, then organize server code.
**Spec:** ../specs/2026-09-29-react-structure.md
**Architecture:** Shared portal provider/layout handles API, session, URL filters, language and navigation. Independently owned feature components consume typed props. No DOM-template compatibility layer.

- [x] Shared types, I18n provider, modal/icon utilities and React portal shell with App Router routes.
- [x] Workbook feature: all workbook reports, source details, statement views, filters and exports.
- [x] Management feature: users, expenses, profile/password, financial editor/entries, audit.
- [x] Ledger feature: operational demo reports, operations, budgets, planning, CSV import, period controls and exports.
- [x] Organize auth/finance/db/export server files and imports without changing API behavior.
- [x] Replace obsolete DOM-renderer tests with React/URL browser regressions; retain all accounting and API assertions.
- [x] Typecheck, production build, full tests, browser verification, final review and README.

Shared contracts are features/shared/types.ts. Feature agents own only their feature directories. Parent owns shared files, shell/routes, server moves, tests and integration. Existing source renderers are read-only references until integration removes them.
