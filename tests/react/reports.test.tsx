import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nProvider } from "../../features/i18n/provider";
import { translate } from "../../features/i18n/dictionary";
import { WorkbookView } from "../../features/workbook/workbook-view";
import { LedgerView } from "../../features/ledger/ledger-view";
import { ManagementView } from "../../features/management/management-view";
import { LoginForm } from "../../components/login-form";
import { workbookExportRows } from "../../features/workbook/model";
import { filtersFromSearch, pageHref } from "../../features/portal/routes";
import { workbookDataset } from "../../server/finance/workbook.mjs";
import { statements } from "../../server/finance/statements.mjs";
import { ledger, kinds } from "../../server/finance/accounting.mjs";
import type {
  ApiClient,
  ReportActions,
  User,
} from "../../features/shared/types";
import type { WorkbookData } from "../../features/workbook/types";
import type { LedgerData } from "../../features/ledger/types";

const user: User = {
  id: 1,
  name: "Қаржыгер",
  username: "finance",
  role: "finance",
  language: "kk",
  active: 1,
  must_change_password: 0,
  org: "",
  point: "",
};
const api: ApiClient = async () => {
  throw Error("API must only be requested after mounting");
};
const actions: ReportActions = {
  page: "dashboard",
  api,
  refresh: async () => {},
  filters: { source: "auto", month: "", range: "month", channel: "", org: "" },
  setFilters: () => {},
  navigate: () => {},
};
const render = (element: React.ReactNode) => {
  const errors: unknown[][] = [];
  const previous = console.error;
  console.error = (...args: unknown[]) => errors.push(args);
  try {
    const html = renderToStaticMarkup(<I18nProvider>{element}</I18nProvider>);
    assert.deepEqual(errors, [], "React render must not emit warnings");
    return html;
  } finally {
    console.error = previous;
  }
};
function report(options: Record<string, string> = {}): WorkbookData {
  const data = workbookDataset!.report(options);
  return {
    ...data,
    user,
    statements: {
      balance: statements.balance,
      cashflow: statements.cashflow(data.month, data.range),
    },
  } as unknown as WorkbookData;
}
test("React workbook pages preserve actual, future, YTD and channel reports without invalid values",
  { skip: !workbookDataset }, () => {
  const scenarios: Record<string, string>[] = [
    {},
    { range: "ytd" },
    { month: "2026-09" },
    { channel: "Продажи_Каспи" },
    { month: "2023-01" },
  ];
  for (const options of scenarios) {
    const data = report(options);
    for (const page of [
      "dashboard",
      "pnl",
      "analytics",
      "plans",
      "operations",
      "checks",
      "imports",
      "balance",
      "cashflow",
      "debts",
      "settings",
    ]) {
      const html = render(
        <WorkbookView {...actions} page={page} data={data} />,
      );
      assert.ok(html.length > 100, page);
      assert.ok(!/\bNaN\b|\bundefined\b/.test(html), page);
    }
  }
});
test("React exports retain source references, exact amounts and missing future facts",
  { skip: !workbookDataset }, () => {
  const rows = workbookExportRows("pnl", report());
  assert.ok(rows.some((row) => row.includes("P&L_2026!J16")));
  assert.ok(rows.some((row) => row.includes(49067743.11)));
  assert.ok(rows.some((row) => row.includes(-5217423.746666668)));
  const future = workbookExportRows("plans", report({ month: "2026-09" }));
  assert.ok(future.some((row) => row.includes("—")));
  const balance = workbookExportRows("balance", report());
  assert.ok(balance.some((row) => row.includes(731964572.06)));
});
test("React escapes source labels rather than treating them as HTML",
  { skip: !workbookDataset }, () => {
  const data = report();
  data.details[0] = {
    ...data.details[0],
    display: "<img src=x onerror=alert(1)>",
    label: "<img src=x onerror=alert(1)>",
  };
  const html = render(
    <WorkbookView {...actions} page="operations" data={data} />,
  );
  assert.ok(html.includes("&lt;img"));
  assert.ok(!html.includes('<img src="x"'));
});
test("React operational pages preserve all report families", () => {
  const zero = ledger([]);
  const data = {
    source: "ledger",
    user,
    orgs: ["Qalam Books"],
    kinds,
    month: "2026-09",
    end: "2026-09-30",
    operations: [],
    allOperations: [],
    report: zero,
    previous: zero,
    opening: zero,
    balance: zero,
    budget: [],
    history: [{ month: "2026-09", ...zero }],
    debts: [],
    plans: [],
    audit: [],
    closed: false,
    demo: true,
    workbookAvailable: true,
  } as unknown as LedgerData;
  for (const page of [
    "dashboard",
    "pnl",
    "balance",
    "cashflow",
    "debts",
    "analytics",
    "plans",
    "operations",
    "imports",
    "audit",
    "settings",
  ]) {
    const html = render(<LedgerView {...actions} page={page} data={data} />);
    assert.ok(html.length > 100, page);
    assert.ok(!/\bNaN\b|\bundefined\b/.test(html), page);
  }
});
test("employee management access and required-password UI remain separate", () => {
  const employee = { ...user, role: "employee" as const };
  const denied = render(
    <ManagementView
      page="users"
      user={employee}
      api={api}
      refresh={actions.refresh}
      onLogout={actions.refresh}
    />,
  );
  assert.ok(denied.includes("Рұқсат жоқ"));
  const forced = render(
    <ManagementView
      page="my-expenses"
      user={{ ...employee, must_change_password: 1 }}
      api={api}
      refresh={actions.refresh}
      onLogout={actions.refresh}
    />,
  );
  assert.ok(forced.includes("password-form"));
  assert.ok(!forced.includes("add-expense"));
});
test("password change form accepts an eight-character new password", () => {
  const html = render(
    <ManagementView
      page="account"
      user={{ ...user, must_change_password: 1 }}
      api={api}
      refresh={actions.refresh}
      onLogout={actions.refresh}
    />,
  );
  for (const name of ["new_password", "confirmation"]) {
    const field = html.match(new RegExp(`<input[^>]*name="${name}"[^>]*>`))?.[0];
    assert.ok(field, name);
    assert.match(field, /minLength="8"/);
  }
});
test("React login has secure password and remember controls, translations preserve source strings", () => {
  const html = render(<LoginForm onSuccess={() => {}} />);
  assert.ok(html.includes('type="password"'));
  assert.ok(html.includes('name="remember"'));
  assert.ok(html.includes('id="show-login-password"'));
  assert.equal(translate("Менің шығындарым", "ru"), "Мои расходы");
  assert.equal(translate("Құпиясөз", "kk"), "Құпиясөз");
  assert.equal(translate("Custom source label", "ru"), "Custom source label");
});
test("URL routes round-trip report filters with special characters", () => {
  const filters = {
    source: "workbook" as const,
    month: "2026-08",
    range: "ytd" as const,
    channel: "Каспи & дүкен",
    org: "A+B",
  };
  const href = pageHref("pnl", filters);
  assert.ok(href.startsWith("/pnl?"));
  assert.ok(!href.includes("#"));
  assert.deepEqual(
    filtersFromSearch(new URL(href, "http://localhost").searchParams),
    filters,
  );
  assert.equal(pageHref("dashboard", actions.filters), "/");
});

test("dashboard defaults to the PostgreSQL ledger without changing explicit report sources", () => {
  const empty = new URLSearchParams();
  assert.equal(filtersFromSearch(empty, "dashboard").source, "ledger");
  assert.equal(filtersFromSearch(empty, "pnl").source, "auto");
  for (const source of ["ledger", "workbook"] as const) {
    assert.equal(filtersFromSearch(new URLSearchParams({ source }), "dashboard").source, source);
  }
  assert.equal(filtersFromSearch(new URLSearchParams({ source: "auto" }), "dashboard").source, "ledger");
  assert.equal(filtersFromSearch(new URLSearchParams({ source: "auto" }), "pnl").source, "auto");
  const staleWorkbookFilters = filtersFromSearch(new URLSearchParams({
    source: "auto", range: "ytd", channel: "online", org: "Kitap Retail",
  }), "dashboard");
  assert.equal(staleWorkbookFilters.range, "month");
  assert.equal(staleWorkbookFilters.channel, "");
  assert.equal(staleWorkbookFilters.org, "Kitap Retail");
  assert.equal(filtersFromSearch(new URLSearchParams({ source: "invalid" }), "dashboard").source, "ledger");
  const dashboard = filtersFromSearch(new URLSearchParams({ month: "2026-09", org: "Kitap Retail" }), "dashboard");
  assert.equal(pageHref("pnl", dashboard), "/pnl?source=ledger&month=2026-09&org=Kitap+Retail");
});
