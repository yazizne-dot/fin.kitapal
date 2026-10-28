import type { ReportFilters } from "../shared/types";
export const reportPages = [
  "dashboard",
  "pnl",
  "balance",
  "cashflow",
  "analytics",
  "plans",
  "operations",
  "checks",
  "imports",
  "settings",
  "debts",
  "audit",
] as const;
export const managementPages = [
  "users",
  "employee-expenses",
  "my-expenses",
  "financial-entries",
  "financial-editor",
  "account",
  "admin-audit",
] as const;
export const pageTitles: Record<string, string> = {
  dashboard: "Қаржылық шолу",
  pnl: "Кірістер мен шығыстар",
  balance: "Баланс",
  cashflow: "Ақша қозғалысы",
  analytics: "Сату арналары",
  plans: "Бюджет · факт / жоспар",
  operations: "Операциялар",
  checks: "Деректерді тексеру",
  imports: "Деректерді жүктеу",
  settings: "Баптаулар",
  debts: "Дебитор / кредитор",
  audit: "Өзгерістер журналы",
  users: "Пайдаланушыларды басқару",
  "employee-expenses": "Қызметкерлер шығындары",
  "my-expenses": "Менің шығындарым",
  "financial-entries": "Жаңа ақпарат",
  "financial-editor": "Есеп сандарын түзету",
  account: "Жеке кабинет",
  "admin-audit": "Өзгерістер журналы",
};
export function isPortalPage(page: string) {
  return Object.hasOwn(pageTitles, page);
}
export function filtersFromSearch(search: URLSearchParams, page = ""): ReportFilters {
  const source = search.get("source");
  const savedLedgerDashboard = page === "dashboard" && source === "ledger";
  const selectedSource = page === "dashboard" ? "workbook"
    : source === "ledger" || source === "workbook" ? source : "auto";
  return {
    source: selectedSource,
    month: search.get("month") || "",
    range: !savedLedgerDashboard && selectedSource !== "ledger" && search.get("range") === "ytd" ? "ytd" : "month",
    channel: savedLedgerDashboard || selectedSource === "ledger" ? "" : search.get("channel") || "",
    org: savedLedgerDashboard ? "" : search.get("org") || "",
  };
}
export function pageHref(page: string, filters: ReportFilters) {
  const selectedFilters: ReportFilters = page === "dashboard" && filters.source === "ledger"
    ? { ...filters, source: "workbook", org: "", channel: "", range: "month" } : filters;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(selectedFilters))
    if (
      value &&
      !(key === "source" && value === "auto") &&
      !(key === "range" && value === "month")
    )
      query.set(key, value);
  const path = page === "dashboard" ? "/" : `/${page}`;
  return path + (query.size ? "?" + query.toString() : "");
}

export function reportPageTitle(page: string, source: string) {
  return page === "operations" && source === "workbook" ? "Есеп баптары" : pageTitles[page] || "Қаржылық шолу";
}
