# React pages and project structure

User approved converting report templates to React, replacing hash navigation with Next URL routes, then organizing server modules on existing тест branch. This supersedes the retained-renderer boundary in the earlier migration spec.

React/TypeScript owns all workbook reports, legacy operational reports, management, employee expenses and account forms. No innerHTML templates, delegated document handlers, or MutationObserver translation in the production UI. Preserve current API contracts, financial calculations, source provenance, source discrepancies, role restrictions, language selection, export, forms and drilldowns.

Use a shared portal layout and real URL paths for dashboard, pnl, balance, cashflow, analytics, plans, operations, checks, imports, settings, debts, audit, users, employee-expenses, my-expenses, financial-entries, financial-editor and account. Preserve report filters in the URL and browser navigation. Unknown page -> 404. Direct navigation after login retains destination. Old # links may redirect to their equivalent path once.

Organize server modules into auth/, finance/, db/, exports/; API entry stays thin and database stays lazy. Retain SQLite/source JSON and avoid modifying live data in verification. TypeScript for new UI contracts; server calculations remain tested .mjs with no semantic rewrites.

Verify accounting/API regressions, production build/typecheck and Chrome: direct route/refresh/back, auth and role restrictions, report filters and source drilldowns, exports, management edits with optimistic revisions, employee submissions and approvals, language changes, mobile navigation. Use temporary databases. Keep work on тест without merge/deploy.
