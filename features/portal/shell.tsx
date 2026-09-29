"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { usePortal } from "./provider";
import { pageHref, pageTitles } from "./routes";
import { useI18n } from "../i18n/provider";
import { Icon } from "../../components/ui/icon";
import type { Language } from "../shared/types";
const icons: Record<string, string> = {
  dashboard: "grid",
  pnl: "chart",
  balance: "balance",
  cashflow: "swap",
  analytics: "shop",
  plans: "calendar",
  operations: "file",
  checks: "shield",
  imports: "upload",
  settings: "settings",
  debts: "users",
  audit: "clock",
  users: "users",
  "employee-expenses": "wallet",
  "my-expenses": "wallet",
  "financial-entries": "plus",
  "financial-editor": "settings",
  account: "lock",
  "admin-audit": "clock",
};
export function PortalShell({ children }: { children: ReactNode }) {
  const { data, api, filters, logout, refresh, loading } = usePortal(),
    { language, t, setLanguage } = useI18n();
  const pathname = usePathname(),
    page = pathname.split("/")[1] || "dashboard";
  const [open, setOpen] = useState(false),
    [error, setError] = useState("");
  const privileged = ["admin", "finance"].includes(data.user.role),
    personal = data.user.role === "employee";
  const reports = personal
    ? ["my-expenses"]
    : data.user.role === "manager"
      ? ["dashboard", "pnl", "debts", "analytics", "operations"]
      : [
          "dashboard",
          "pnl",
          "balance",
          "cashflow",
          "analytics",
          "plans",
          "operations",
          "debts",
          ...(data.source === "workbook" ? ["checks"] : ["audit"]),
          "imports",
          "settings",
        ];
  const management = privileged
    ? [
        "users",
        "employee-expenses",
        "financial-entries",
        "financial-editor",
        "admin-audit",
        "account",
      ]
    : ["account"];
  const link = (key: string) => (
    <Link
      key={key}
      href={pageHref(key, filters)}
      data-page={key}
      className={page === key ? "active" : ""}
      aria-current={page === key ? "page" : undefined}
      onClick={() => setOpen(false)}
    >
      <Icon name={icons[key]} />
      <span>{t(pageTitles[key])}</span>
    </Link>
  );
  async function changeLanguage(value: Language) {
    try {
      setError("");
      await api("/api/profile", {
        method: "POST",
        body: JSON.stringify({ language: value }),
      });
      setLanguage(value);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Қате");
    }
  }
  return (
    <div
      className={`layout ${data.source === "workbook" ? "workbook-layout" : ""}`}
    >
      <aside className={`sidebar ${open ? "open" : ""}`}>
        <Link
          href={pageHref("dashboard", filters)}
          className="brand company-brand"
        >
          <img
            src="/kitapal-logo.png"
            alt="Kitapal"
            width="1880"
            height="701"
          />
        </Link>
        <div className="workspace">
          <span className="workspace-icon">
            <Icon name={personal ? "wallet" : "book"} />
          </span>
          <div>
            <b>{personal ? data.user.name : "Kitapal · Қаржы"}</b>
            <small>
              {personal
                ? t("Менің шығындарым")
                : t("Қаржылық басқару платформасы")}
            </small>
          </div>
        </div>
        <div className="nav-label">{t("ҚАРЖЫЛЫҚ ЕСЕПТЕР")}</div>
        <nav className="nav">{reports.map(link)}</nav>
        <div className="nav-label" style={{ marginTop: 24 }}>
          {t("БАСҚАРУ")}
        </div>
        <nav className="nav">{management.map(link)}</nav>
        <div className="sidebar-bottom">
          <button
            className="secondary"
            data-action="logout"
            onClick={() =>
              void logout().catch((cause) => setError(cause.message))
            }
          >
            <Icon name="logout" />
            {t("Жүйеден шығу")}
          </button>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <div className="breadcrumbs">
            <button
              className="mobile-menu"
              data-action="menu"
              aria-label={t("Мәзір")}
              aria-expanded={open}
              onClick={() => setOpen(!open)}
            >
              <Icon name="menu" />
            </button>
            <span>Kitapal</span>
            <span>/</span>
            <strong>{t(pageTitles[page] || "Қаржылық шолу")}</strong>
          </div>
          <div className="top-right">
            <select
              id="app-language"
              className="language-select"
              aria-label={t("Тіл")}
              value={language}
              onChange={(e) => void changeLanguage(e.target.value as Language)}
            >
              <option value="kk">Қазақша</option>
              <option value="ru">Русский</option>
            </select>
            <Link
              className="user"
              data-page="account"
              href={pageHref("account", filters)}
            >
              <span className="avatar">{data.user.name.slice(0, 1)}</span>
              <span>
                <b>{data.user.name}</b>
                <small>
                  {t(
                    data.user.role === "admin"
                      ? "Әкімші"
                      : data.user.role === "finance"
                        ? "Қаржыгер"
                        : "Қызметкер",
                  )}
                </small>
              </span>
            </Link>
          </div>
        </header>
        <div className="content" aria-busy={loading}>
          <div className="page-heading">
            <div>
              <h1>{t(pageTitles[page] || "Қаржылық шолу")}</h1>
            </div>
          </div>
          {error && (
            <p className="error-message" role="alert">
              {t(error)}
            </p>
          )}
          {loading && (
            <p className="note" role="status">
              {t("Жүктелуде…")}
            </p>
          )}
          {children}
          <footer className="footer">
            <span>© 2026 Kitapal</span>
            <span>{t("Басқарушылық есеп")} · KZT</span>
          </footer>
        </div>
      </main>
    </div>
  );
}
