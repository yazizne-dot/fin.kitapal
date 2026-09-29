"use client";
import { useEffect, useState } from "react";
import { Icon } from "../../components/ui/icon";
import { Modal } from "../../components/ui/modal";
import { useI18n } from "../i18n/provider";
import { exportRows } from "../shared/download";
import type { ReportActions } from "../shared/types";
import type { DetailRow, MetricKey, WorkbookData } from "./types";
import { fullMonths, metricLabels, money, periodLabel } from "./model";
import { DetailsTable, SourceTable } from "./report-parts";
import {
  Analytics,
  Checks,
  Dashboard,
  Debts,
  Imports,
  Operations,
  Plans,
  Pnl,
  Settings,
} from "./reports";
import {
  BalancePage,
  CashflowPage,
  StatementDetailView,
  statementTitle,
  type StatementDetail,
} from "./statements";
import { workbookExportRows } from "./model";

type Dialog =
  | { kind: "metric"; key: MetricKey }
  | { kind: "detail"; id: string }
  | { kind: "budget"; id: string }
  | { kind: "statement"; detail: StatementDetail };
const drillGroups: Partial<Record<MetricKey, MetricKey[]>> = {
  gross: ["revenue", "cost"],
  operatingProfit: ["revenue", "cost", "opex"],
  profit: [
    "revenue",
    "cost",
    "opex",
    "otherExpense",
    "taxes",
    "bonuses",
    "otherIncome",
  ],
  retained: [
    "revenue",
    "cost",
    "opex",
    "otherExpense",
    "taxes",
    "bonuses",
    "otherIncome",
    "dividends",
  ],
};
export function WorkbookView({
  data,
  page,
  filters,
  setFilters,
  navigate,
  refresh,
}: ReportActions & { data: WorkbookData }) {
  const { t } = useI18n();
  const [dialog, setDialog] = useState<Dialog | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(
    () => setDialog(null),
    [page, data.month, data.range, data.channel],
  );
  const onDrill = (key: MetricKey) => setDialog({ kind: "metric", key }),
    onDetail = (row: DetailRow) => setDialog({ kind: "detail", id: row.id }),
    onBudget = (id: string) => setDialog({ kind: "budget", id });
  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  const common = { data, navigate, setFilters, onDrill, onDetail };
  let content;
  switch (page) {
    case "dashboard":
      content = <Dashboard {...common} />;
      break;
    case "pnl":
      content = <Pnl {...common} />;
      break;
    case "analytics":
      content = <Analytics {...common} />;
      break;
    case "plans":
      content = <Plans {...common} onBudget={onBudget} />;
      break;
    case "operations":
      content = <Operations {...common} />;
      break;
    case "checks":
      content = <Checks {...common} />;
      break;
    case "imports":
      content = <Imports {...common} refresh={() => run(refresh)} />;
      break;
    case "settings":
      content = <Settings {...common} />;
      break;
    case "balance":
      content = (
        <BalancePage
          data={data}
          onDetail={(detail) => setDialog({ kind: "statement", detail })}
        />
      );
      break;
    case "cashflow":
      content = (
        <CashflowPage
          data={data}
          onDetail={(detail) => setDialog({ kind: "statement", detail })}
        />
      );
      break;
    case "debts":
      content = <Debts navigate={navigate} />;
      break;
    default:
      content = null;
  }
  const selected =
      dialog?.kind === "detail"
        ? data.details.find((r) => r.id === dialog.id)
        : null,
    budget =
      dialog?.kind === "budget"
        ? data.budgetRows.find((r) => r.id === dialog.id)
        : null,
    key = dialog?.kind === "metric" ? dialog.key : null;
  const title =
    dialog?.kind === "statement"
      ? statementTitle(data, dialog.detail)
      : key
        ? metricLabels[key]
        : selected?.display || budget?.display || "";
  return (
    <>
      <div className="page-heading workbook-report-actions">
        <p className="subtitle">
          {periodLabel(data)} ·{" "}
          {data.channel
            ? data.channels.find((r) => r.id === data.channel)?.label ||
              data.channel
            : t("Барлық сату арналары")}
        </p>
        <div className="heading-actions">
          <button
            className="secondary"
            data-page="financial-editor"
            onClick={() => navigate("financial-editor")}
          >
            {t("Есеп сандарын түзету")}
          </button>
          <button
            className="secondary"
            data-action="refresh-workbook"
            onClick={() => void run(refresh)}
            disabled={busy}
          >
            <Icon name="refresh" size={15} /> {t("Жаңарту")}
          </button>
          <button
            className="primary"
            data-action="export"
            onClick={() =>
              void run(() =>
                exportRows(
                  workbookExportRows(page, data),
                  `kitapal-${page}-${data.month}-${data.range}.xlsx`,
                ),
              )
            }
            disabled={busy}
          >
            <Icon name="download" size={15} /> {t("Excel экспорт")}
          </button>
        </div>
      </div>
      <div className="filters workbook-filters">
        <div className="filter-left">
          <div className="filter-field">
            <Icon name="calendar" size={14} />
            <select
              id="wb-period"
              aria-label={t("Есеп кезеңі")}
              value={filters.month || data.month}
              onChange={(e) =>
                setFilters({ month: e.target.value, channel: "" })
              }
            >
              {data.periods.map((p) => (
                <option key={p} value={p}>
                  {t(fullMonths[Number(p.slice(5)) - 1])} {p.slice(0, 4)}
                  {p > data.latest ? ` · ${t("жоспар")}` : ""}
                </option>
              ))}
            </select>
          </div>
          <div className="segmented range-switch">
            <button
              data-wb-range="month"
              className={filters.range === "month" ? "selected" : ""}
              onClick={() => setFilters({ range: "month" })}
            >
              {t("Ай")}
            </button>
            <button
              data-wb-range="ytd"
              className={filters.range === "ytd" ? "selected" : ""}
              onClick={() => setFilters({ range: "ytd" })}
            >
              {t("Жыл басынан")}
            </button>
          </div>
          <div className="filter-field">
            <Icon name="shop" size={14} />
            <select
              id="wb-channel"
              aria-label={t("Сату арнасы")}
              value={filters.channel}
              onChange={(e) => setFilters({ channel: e.target.value })}
            >
              <option value="">{t("Барлық арналар")}</option>
              {data.channels.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <span className="demo-pill workbook-pill">
          <i className="dot" /> Excel · {data.latest}
        </span>
      </div>
      {error && (
        <p className="error-message" role="alert">
          {t(error)}
        </p>
      )}
      <div id="page-content">{content}</div>
      {dialog && (
        <Modal title={title} onClose={() => setDialog(null)}>
          {key && (
            <>
              <div className="drill-totals">
                <div>
                  <small>{t("Excel қорытындысы")}</small>
                  <b>{money(data.report[key])}</b>
                </div>
                <div>
                  <small>{t("Баптардан қайта есеп")}</small>
                  <b>{money(data.recalculated?.[key])}</b>
                </div>
              </div>
              <p className="note">
                {t(
                  "Бастапқы операциялар емес, Excel есебінің баптары. Сандардың парағы мен ұяшығы сақталған.",
                )}
              </p>
              {Boolean(data.refs[key]?.length) && (
                <SourceTable rows={data.refs[key] || []} />
              )}
              <DetailsTable
                data={data}
                rows={data.details.filter((r) =>
                  (drillGroups[key] || [key]).includes(r.group),
                )}
                onDetail={onDetail}
              />
            </>
          )}
          {selected && (
            <>
              <p className="note">
                {t("Айлық жиынтық бап")} · {t(metricLabels[selected.group])} ·{" "}
                {money(selected.value)}
              </p>
              <SourceTable rows={selected.sources} />
            </>
          )}
          {budget && (
            <>
              <p className="note">
                {t("Жоспар")}: {money(budget.plan)} · {t("Факт")}:{" "}
                {money(budget.actual)}
                <br />
                {t("Төменде жоспар және факт ұяшықтары жеке көрсетілген.")}
              </p>
              <SourceTable
                rows={budget.sources.flatMap((s) => [
                  { ...s.plan, period: s.period + " · жоспар" },
                  {
                    ...s.actual,
                    period: s.period + " · факт ұяшығы (сақталған мән)",
                  },
                ])}
              />
            </>
          )}
          {dialog.kind === "statement" && (
            <StatementDetailView
              key={`${dialog.detail.kind}-${dialog.detail.kind === "balance" ? dialog.detail.id : dialog.detail.article || dialog.detail.replenishment || "all"}`}
              data={data}
              detail={dialog.detail}
            />
          )}
        </Modal>
      )}
    </>
  );
}
