"use client";
import { useState } from "react";
import { Icon } from "../../components/ui/icon";
import { useI18n } from "../i18n/provider";
import { exportRows } from "../shared/download";
import type { ExportCell, ReportActions } from "../shared/types";
import type { LedgerData, LedgerOperation } from "./types";
import {
  balanceRows,
  budgetValue,
  drillKinds,
  filterOperations,
  forecast,
  million,
  money,
  number,
  percent,
  pnlRows,
  privileged,
} from "./format";
import {
  AuditTable,
  BarChart,
  ExpenseDonut,
  ForecastPanel,
  Kpi,
  OperationsTable,
  OrgTable,
} from "./widgets";
import { downloadTemplate, LedgerDialog, type DialogState } from "./forms";

export function LedgerView({
  data,
  ...actions
}: ReportActions & { data: LedgerData }) {
  const { t } = useI18n();
  const { page, filters, setFilters, navigate, api, refresh } = actions;
  const [dialog, setDialog] = useState<DialogState>({ kind: null }),
    [debtSide, setDebtSide] = useState<"receivable" | "payable">("receivable"),
    [search, setSearch] = useState(""),
    [notice, setNotice] = useState("");
  const canEdit = privileged(data.user.role),
    org = filters.org,
    month = filters.month || data.month;
  function drill(key: string) {
    if (key === "debts") {
      navigate("debts");
      return;
    }
    const kinds = drillKinds[key];
    const rows = (
      page === "balance" || key === "cash"
        ? data.allOperations
        : data.operations
    ).filter((row) => !kinds || kinds.includes(row.kind));
    setDialog({ kind: "drill", rows, title: "Операциялар расшифровкасы" });
  }
  function showDocument(document: string) {
    setDialog({
      kind: "document",
      rows: data.allOperations.filter((row) => row.document === document),
      title: document,
    });
  }
  async function submit(
    path: string,
    body: Record<string, unknown>,
    method = "POST",
  ) {
    return api(path, { method, body: JSON.stringify(body) });
  }
  async function logout() {
    try {
      await submit("/api/logout", {});
      window.location.assign(`/${page}`);
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "Қате пайда болды");
    }
  }
  async function exportCurrent() {
    try {
      let rows: ExportCell[][];
      const filename = `qarzhy-${page}-${month}.xlsx`;
      if (page === "dashboard" || page === "pnl")
        rows = [
          ["Көрсеткіш", "Факт", "Жоспар", "Ауытқу", "Өткен жыл"],
          ...pnlRows.map(([key, label]) => {
            const budget = budgetValue(data, org, key);
            return [
              label,
              data.report[key],
              budget ?? "—",
              budget === null ? "—" : data.report[key] - budget,
              data.previous[key],
            ];
          }),
        ];
      else if (page === "balance")
        rows = [
          ["Көрсеткіш", "Бастапқы", "Соңғы"],
          ...balanceRows.map(([key, label]) => [
            label,
            data.opening[key],
            data.balance[key],
          ]),
        ];
      else if (page === "debts")
        rows = [
          ["Контрагент", "Құжат", "Мерзім", "Күн", "Сома"],
          ...data.debts
            .filter((row) => row.side === debtSide)
            .map((row) => [
              row.counterparty,
              row.document,
              row.due,
              row.days,
              row.amount,
            ]),
        ];
      else if (page === "cashflow")
        rows = [
          ["Бап", "Сома"],
          ["Бастапқы қалдық", data.opening.cash],
          ["Операциялық қызмет", data.report.operating],
          ["Инвестициялық қызмет", data.report.investing],
          ["Қаржылық қызмет", data.report.financing],
          ["Соңғы қалдық", data.balance.cash],
        ];
      else if (page === "plans")
        rows = [
          ["Күн", "Ұйым", "Бап", "Бағыт", "Сома"],
          ...data.plans.map((row) => [
            row.date,
            row.org,
            row.article,
            row.direction,
            row.amount,
          ]),
        ];
      else if (page === "audit" || page === "imports")
        rows = [
          ["Уақыт", "Автор", "Әрекет", "Мәлімет"],
          ...data.audit.map((row) => [
            row.time,
            row.author,
            row.action,
            row.detail,
          ]),
        ];
      else
        rows = [
          ["Күн", "Құжат", "Ұйым", "Операция", "Контрагент", "Сома"],
          ...filterOperations(data.operations, search).map((row) => [
            row.date,
            row.document,
            row.org,
            data.kinds[row.kind],
            row.counterparty,
            row.amount,
          ]),
        ];
      await exportRows(rows, filename);
      setNotice("Excel есебі жүктелді");
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "Экспорт орындалмады");
    }
  }
  const subtitles: Record<string, string> = {
    dashboard: "Бизнесіңіздің қаржылық жағдайы — бір көзқараста.",
    pnl: "Кезеңнің қаржылық нәтижесі және өткен жылмен салыстыру.",
    balance: "Активтер, міндеттемелер және меншікті капитал.",
    cashflow: "Нақты ақша қозғалысы және күтілетін қалдық.",
    debts: "Контрагенттер, төлем мерзімі және берешек жасы.",
    analytics: "Баспалар, дүкендер және дистрибуция көрсеткіштері.",
    plans: "Күтілетін түсімдер мен төлемдердің күнтізбесі.",
    operations: "Есептердің негізі — бастапқы операциялар.",
    imports: "CSV деректерін жүктеу және тексеру нәтижелері.",
    audit: "Пайдаланушылар әрекеттерінің тарихы.",
    settings: "Жұмыс кеңістігі, қолжетімділік және кезеңді жабу.",
  };
  const openCorrect = (operation: LedgerOperation) =>
    setDialog({ kind: "correction", operation });
  const orgTable = (
    <OrgTable
      data={data}
      org={org}
      onSelect={(value) => setFilters({ org: value })}
    />
  );
  const chart = <BarChart data={data} />;
  const donut = <ExpenseDonut data={data} />;
  const prediction = <ForecastPanel data={data} />;
  const operations = (
    <OperationsTable
      data={data}
      rows={filterOperations(data.operations, search)}
      onCorrect={openCorrect}
    />
  );
  const forecastData = forecast(data);
  let body: React.ReactNode;
  switch (page) {
    case "dashboard":
      body = (
        <>
          <section className="kpi-grid">
            <Kpi
              label="Ақша қалдығы"
              value={data.balance.cash}
              icon="wallet"
              caption="ай басымен салыстырғанда"
              delta={percent(data.balance.cash, data.opening.cash)}
              dark
              onClick={() => drill("cash")}
            />
            <Kpi
              label="Түсім"
              value={data.report.revenue}
              icon="chart"
              caption="өткен жылдың осы айына"
              delta={percent(data.report.revenue, data.previous.revenue)}
              onClick={() => drill("revenue")}
            />
            <Kpi
              label="Жалпы пайда"
              value={data.report.gross}
              icon="trend"
              caption="өткен жылдың осы айына"
              delta={percent(data.report.gross, data.previous.gross)}
              onClick={() => drill("gross")}
            />
            <Kpi
              label="Таза пайда"
              value={data.report.profit}
              icon="spark"
              caption="өткен жылдың осы айына"
              delta={percent(data.report.profit, data.previous.profit)}
              onClick={() => drill("profit")}
            />
          </section>
          <section className="grid-main">
            <div className="panel">
              <div className="panel-head">
                <div>
                  <h2>{t("Кірістер мен шығыстар динамикасы")}</h2>
                  <p>{t("Бизнес нәтижесінің ай сайынғы өзгерісі")}</p>
                </div>
              </div>
              {chart}
            </div>
            <div className="panel">
              <div className="panel-head">
                <div>
                  <h2>{t("Шығыстар құрылымы")}</h2>
                  <p>{t("Операциялық шығыстар")}</p>
                </div>
                <button
                  onClick={() => navigate("pnl")}
                  aria-label={t("Шығыстар есебін ашу")}
                >
                  <Icon name="arrow" size={15} />
                </button>
              </div>
              {donut}
            </div>
          </section>
          <section className="lower">
            <div className="panel">
              <div className="panel-head table-top">
                <div>
                  <h2>{t("Бағыттар бойынша көрсеткіштер")}</h2>
                  <p>{t("Әр бизнестің жалпы нәтижеге қосқан үлесі")}</p>
                </div>
                <button
                  className="link-button"
                  onClick={() => navigate("analytics")}
                >
                  {t("Толығырақ")} <Icon name="arrow" size={12} />
                </button>
              </div>
              {orgTable}
            </div>
            <div className="panel">
              <div className="panel-head">
                <div>
                  <h2>{t("Ақша қалдығының болжамы")}</h2>
                  <p>{t("Таңдалған кезеңнен кейінгі 30 күн")}</p>
                </div>
              </div>
              {prediction}
            </div>
          </section>
          <section className="insights">
            <button className="insight" onClick={() => navigate("debts")}>
              <span className="insight-icon">
                <Icon name="users" />
              </span>
              <div>
                <strong>
                  {t("Дебиторлық берешек")} ·{" "}
                  {million(data.balance.receivables)} {t("млн ₸")}
                </strong>
                <p>
                  {
                    data.debts.filter(
                      (row) =>
                        row.side === "receivable" &&
                        row.days > 0 &&
                        row.amount > 0,
                    ).length
                  }{" "}
                  {t("құжаттың төлем мерзімі өткен")}
                </p>
              </div>
            </button>
            <button className="insight warn" onClick={() => navigate("debts")}>
              <span className="insight-icon">
                <Icon name="clock" />
              </span>
              <div>
                <strong>
                  {t("Кредиторлық берешек")} · {million(data.balance.payables)}{" "}
                  {t("млн ₸")}
                </strong>
                <p>{t("Жеткізушілермен есеп айырысуға назар аударыңыз")}</p>
              </div>
            </button>
            <button className="insight" onClick={() => navigate("balance")}>
              <span className="insight-icon">
                <Icon name="shield" />
              </span>
              <div>
                <strong>
                  {t(
                    data.balance.difference === 0
                      ? "Баланс бақылауы: теңдік сақталған"
                      : "Баланс алшақтығы анықталды",
                  )}
                </strong>
                <p>{t("Активтер = міндеттемелер + капитал")}</p>
              </div>
            </button>
          </section>
        </>
      );
      break;
    case "pnl":
      body = (
        <>
          <div className="panel report-panel">
            <div className="panel-head table-top">
              <div>
                <h2>{t("Кірістер мен шығыстар туралы есеп")}</h2>
                <p>
                  {t(
                    "Есептеу әдісі · теңге · соманы басып, операцияларды ашыңыз",
                  )}
                </p>
              </div>
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <span className="status">
                  {t(data.closed ? "Кезең жабық" : "Ашық кезең")}
                </span>
                {canEdit && (
                  <button
                    className="secondary"
                    data-action="budget"
                    onClick={() => setDialog({ kind: "budget" })}
                  >
                    {t("Бюджет енгізу")}
                  </button>
                )}
              </div>
            </div>
            <div className="table-wrap">
              <table className="table report-table">
                <thead>
                  <tr>
                    {[
                      "Көрсеткіш",
                      "Факт",
                      "Жоспар",
                      "Ауытқу, ₸ / %",
                      "Өткен жыл",
                      "Жылдық өзгеріс",
                    ].map((label, i) => (
                      <th key={label} className={i ? "num" : ""}>
                        {t(label)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pnlRows.map(([key, label, total]) => {
                    const budget = budgetValue(data, org, key);
                    return (
                      <tr
                        key={key}
                        className={total ? "total" : ""}
                        data-drill={key}
                        onClick={() => drill(key)}
                      >
                        <td>{t(label)}</td>
                        <td className="num">{number(data.report[key])}</td>
                        <td className="num">
                          {budget === null ? "—" : number(budget)}
                        </td>
                        <td className="num">
                          {budget === null
                            ? "—"
                            : `${number(data.report[key] - budget)} / ${percent(data.report[key], budget)}`}
                        </td>
                        <td className="num">{number(data.previous[key])}</td>
                        <td
                          className={`num ${data.report[key] < data.previous[key] ? "negative" : ""}`}
                        >
                          {percent(data.report[key], data.previous[key])}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
          <p className="note">
            {t("Жалпы маржа")}:{" "}
            <b>
              {data.report.revenue
                ? `${((data.report.gross / data.report.revenue) * 100).toFixed(1)}%`
                : "—"}
            </b>
            .{" "}
            {t(
              "Жоспар тек таңдалған ұйымдардың бюджеті толық енгізілген баптар үшін есептеледі.",
            )}
          </p>
        </>
      );
      break;
    case "balance":
      body = (
        <>
          <div className="insight" style={{ marginBottom: 20 }}>
            <span className="insight-icon">
              <Icon name="shield" />
            </span>
            <div>
              <strong>
                {t("Балансты тексеру: айырмашылық")}{" "}
                {money(data.balance.difference)}
              </strong>
              <p>
                {data.end} {t("күнгі активтер = міндеттемелер + капитал")}
              </p>
            </div>
          </div>
          <div className="panel report-panel">
            <div className="table-wrap">
              <table className="table report-table">
                <thead>
                  <tr>
                    <th>{t("Бап")}</th>
                    <th className="num">{t("Бастапқы қалдық")}</th>
                    <th className="num">{t("Өзгеріс")}</th>
                    <th className="num">{t("Соңғы қалдық")}</th>
                  </tr>
                </thead>
                <tbody>
                  {balanceRows.map(([key, label, total]) => (
                    <tr
                      key={key}
                      className={total ? "total" : ""}
                      data-drill={key}
                      onClick={() => drill(key)}
                    >
                      <td>{t(label)}</td>
                      <td className="num">{number(data.opening[key])}</td>
                      <td className="num">
                        {number(data.balance[key] - data.opening[key])}
                      </td>
                      <td className="num">{number(data.balance[key])}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <p className="note">
            {t(
              "Қалдықтар бастапқы күннен бастап операциялармен жинақталады. Ағымдағы пайда капитал құрамында бір рет есептеледі.",
            )}
          </p>
        </>
      );
      break;
    case "cashflow":
      body = (
        <>
          <div className="detail-stats">
            <Kpi
              label="Бастапқы ақша қалдығы"
              value={data.opening.cash}
              icon="wallet"
              caption="таңдалған айдың басына"
              onClick={() => drill("cash")}
            />
            <Kpi
              label="Таза ақша қозғалысы"
              value={data.report.cash}
              icon="swap"
              caption="түсімдер − төлемдер"
              onClick={() => drill("cash")}
            />
            <Kpi
              label="Соңғы ақша қалдығы"
              value={data.balance.cash}
              icon="wallet"
              caption="баланспен сәйкес келеді"
              dark
              onClick={() => drill("cash")}
            />
          </div>
          <div className="grid-main">
            <div className="panel">
              <div className="panel-head table-top">
                <div>
                  <h2>{t("Ақша қозғалысы туралы есеп")}</h2>
                  <p>{t("Төлем күнімен есептеледі · теңге")}</p>
                </div>
              </div>
              <table className="table report-table">
                <tbody>
                  {[
                    ["Түсімдер", data.report.inflow],
                    ["Төлемдер", -data.report.outflow],
                    ["Операциялық қызмет", data.report.operating],
                    ["Инвестициялық қызмет", data.report.investing],
                    ["Қаржылық қызмет", data.report.financing],
                    ["Таза ақша қозғалысы", data.report.cash],
                  ].map(([label, value], i) => (
                    <tr
                      key={label}
                      className={i === 5 ? "total" : ""}
                      onClick={() => drill("cash")}
                    >
                      <td>{t(label)}</td>
                      <td className="num">{money(Number(value))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="panel">
              <div className="panel-head">
                <div>
                  <h2>{t("30 күндік болжам")}</h2>
                  <p>{t("Факт пен жоспар бөлек есептеледі")}</p>
                </div>
              </div>
              {prediction}
            </div>
          </div>
          <p className="note">
            {t(
              "Ішкі шоттар арасындағы аударымдар жалпы түсім мен төлемге қосылмайды. Болжам тек енгізілген жоспарлы оқиғаларды қамтиды.",
            )}
          </p>
        </>
      );
      break;
    case "debts": {
      const rows = data.debts.filter((row) => row.side === debtSide),
        total = rows.reduce((sum, row) => sum + row.amount, 0),
        overdue = rows
          .filter((row) => row.days > 0 && row.amount > 0)
          .reduce((sum, row) => sum + row.amount, 0);
      body = (
        <>
          <div className="report-tabs">
            <button
              data-debt="receivable"
              className={debtSide === "receivable" ? "active" : ""}
              onClick={() => setDebtSide("receivable")}
            >
              {t("Дебиторлық берешек")}
            </button>
            <button
              data-debt="payable"
              className={debtSide === "payable" ? "active" : ""}
              onClick={() => setDebtSide("payable")}
            >
              {t("Кредиторлық берешек")}
            </button>
          </div>
          <div className="detail-stats">
            <Kpi
              label="Жалпы берешек"
              value={total}
              icon="users"
              caption={`${rows.length} ашық құжат`}
              onClick={() => drill("debts")}
            />
            <Kpi
              label="Мерзімі өткен"
              value={overdue}
              icon="clock"
              caption="таңдалған айдың соңына"
              onClick={() => drill("debts")}
            />
            <Kpi
              label="Мерзімі келмеген"
              value={total - overdue}
              icon="calendar"
              caption="жоспарланған төлемдер"
              onClick={() => drill("debts")}
            />
          </div>
          <div className="panel report-panel">
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>{t("Контрагент")}</th>
                    <th>{t("Құжат / ұйым")}</th>
                    <th>{t("Төлем мерзімі")}</th>
                    <th>{t("Берешек жасы")}</th>
                    <th className="num">{t("Сома")}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length ? (
                    rows.map((row, i) => (
                      <tr
                        key={`${row.document}-${i}`}
                        className="clickable"
                        data-document={row.document}
                        onClick={() => showDocument(row.document)}
                      >
                        <td>{row.counterparty}</td>
                        <td>
                          {row.document}
                          <br />
                          <small className="subtle">{row.org}</small>
                        </td>
                        <td>{row.due}</td>
                        <td>
                          <span className={`status ${row.days ? "warn" : ""}`}>
                            {row.days
                              ? `${row.days} ${t("күн")}`
                              : t("Мерзімінде")}
                          </span>
                        </td>
                        <td className="num">{money(row.amount)}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={5} className="empty">
                        {t("Ашық берешек жоқ")}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      );
      break;
    }
    case "analytics":
      body = (
        <>
          <div className="panel report-panel">
            <div className="panel-head table-top">
              <div>
                <h2>{t("Ұйымдар мен бағыттардың тиімділігі")}</h2>
                <p>{t("Ұйымды басып, оның деректеріне өтіңіз")}</p>
              </div>
            </div>
            {orgTable}
          </div>
          <div className="grid-main">
            <div className="panel">
              <div className="panel-head">
                <h2>{t("Түсім мен шығыстар динамикасы")}</h2>
              </div>
              {chart}
            </div>
            <div className="panel">
              <div className="panel-head">
                <h2>{t("Шығыстар құрылымы")}</h2>
              </div>
              {donut}
            </div>
          </div>
          <p className="note">
            {t(
              "Ағымдағы талдау ұйымдар мен операция баптары бойынша жасалған.",
            )}
          </p>
        </>
      );
      break;
    case "plans":
      body = (
        <>
          <div className="panel report-panel">
            <div className="panel-head table-top">
              <div>
                <h2>{t("Жоспарланған ақша қозғалысы")}</h2>
                <p>{t("Жоспарды өзгерту әрекеттері журналға жазылады")}</p>
              </div>
              {canEdit && (
                <button
                  className="primary"
                  data-action="add-plan"
                  onClick={() => setDialog({ kind: "plan" })}
                >
                  <Icon name="plus" size={14} /> {t("Оқиға қосу")}
                </button>
              )}
            </div>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    {["Күні", "Ұйым", "Бап", "Түрі", "Сома"].map((label, i) => (
                      <th key={label} className={i === 4 ? "num" : ""}>
                        {t(label)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.plans.filter((row) => row.date >= `${month}-01`)
                    .length ? (
                    data.plans
                      .filter((row) => row.date >= `${month}-01`)
                      .map((row, i) => (
                        <tr key={row.id || i}>
                          <td>{row.date}</td>
                          <td>{row.org}</td>
                          <td>{row.article}</td>
                          <td>
                            <span
                              className={`status ${row.direction === "out" ? "warn" : ""}`}
                            >
                              {t(
                                row.direction === "in"
                                  ? "Күтілетін түсім"
                                  : "Күтілетін төлем",
                              )}
                            </span>
                          </td>
                          <td className="num">{money(row.amount)}</td>
                        </tr>
                      ))
                  ) : (
                    <tr>
                      <td colSpan={5} className="empty">
                        {t("Жоспарланған оқиғалар жоқ")}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
          <div className="panel report-panel">
            <div className="panel-head">
              <h2>{t("Күнделікті ақша қалдығының болжамы")}</h2>
            </div>
            {prediction}
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>{t("Күн")}</th>
                    <th className="num">{t("Болжамды қалдық")}</th>
                    <th>{t("Мәртебесі")}</th>
                  </tr>
                </thead>
                <tbody>
                  {forecastData.points.map((row) => (
                    <tr key={row.date}>
                      <td>{row.date}</td>
                      <td className="num">{money(row.value)}</td>
                      <td>
                        <span
                          className={`status ${row.value < 0 ? "warn" : ""}`}
                        >
                          {t(row.value < 0 ? "Касса алшақтығы" : "Жеткілікті")}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <p className="note">
            {t(
              "Бұл — ДДС жоспары. ОПиУ бюджеті «Кірістер мен шығыстар» бөлімінде енгізіледі.",
            )}
          </p>
        </>
      );
      break;
    case "operations":
      body = (
        <div className="panel report-panel">
          <div className="toolbar">
            <input
              id="operation-search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t("Құжат немесе контрагент іздеу…")}
              aria-label={t("Операциялардан іздеу")}
            />
            <span id="ops-count" className="subtle">
              {filterOperations(data.operations, search).length} {t("операция")}
            </span>
            {canEdit && (
              <button
                className="primary"
                data-action="add-operation"
                style={{ marginLeft: "auto" }}
                onClick={() => setDialog({ kind: "operation" })}
              >
                <Icon name="plus" size={14} /> {t("Операция қосу")}
              </button>
            )}
          </div>
          <div id="ops-table">{operations}</div>
        </div>
      );
      break;
    case "imports":
      body = (
        <>
          <div className="panel settings-card report-panel">
            <h2>{t("Деректерді жүктеу")}</h2>
            <p className="note">
              {t(
                "Банк, касса, сату және сатып алу операцияларын CSV файлынан жүктеңіз.",
              )}
            </p>
            <div className="upload-zone">
              <Icon name="upload" size={35} />
              <h3>{t("Жаңа деректерді қосыңыз")}</h3>
              <p>{t("UTF-8 CSV · 2 MB дейін · 5 000 жолға дейін")}</p>
              <div
                style={{ display: "flex", gap: 10, justifyContent: "center" }}
              >
                <button
                  className="secondary"
                  data-action="template"
                  onClick={downloadTemplate}
                >
                  <Icon name="download" size={15} /> {t("CSV үлгісі")}
                </button>
                {canEdit && (
                  <button
                    className="primary"
                    data-action="import"
                    onClick={() => setDialog({ kind: "import" })}
                  >
                    {t("Файл таңдау")}
                  </button>
                )}
              </div>
            </div>
          </div>
          <div className="panel report-panel">
            <div className="panel-head table-top">
              <h2>{t("Жүктеу тарихы")}</h2>
            </div>
            <AuditTable
              rows={data.audit.filter((row) => row.action === "Импорт")}
            />
          </div>
        </>
      );
      break;
    case "audit":
      body = (
        <>
          <div className="panel report-panel">
            <AuditTable rows={data.audit} />
          </div>
          <p className="note">
            {t(
              "Соңғы 100 оқиға көрсетілген. Кіру, импорт, жаңа операциялар, жоспарлар және кезеңді қайта ашу әрекеттері тіркеледі.",
            )}
          </p>
        </>
      );
      break;
    case "settings":
      body = (
        <>
          <div className="settings-grid">
            <div className="panel settings-card">
              <h2>{t("Есеп кезеңі")}</h2>
              <p>
                {month} ·{" "}
                <span className="status">
                  {t(data.closed ? "Жабық" : "Ашық")}
                </span>
              </p>
              <p>
                {t(
                  "Жабылған кезеңге жаңа операциялар жүктелмейді. Қайта ашу себебі мен авторы журналға жазылады.",
                )}
              </p>
              {canEdit && (
                <button
                  className="primary"
                  data-action="period"
                  onClick={() => setDialog({ kind: "period" })}
                >
                  <Icon name="lock" size={14} />{" "}
                  {t(data.closed ? "Кезеңді қайта ашу" : "Кезеңді жабу")}
                </button>
              )}
            </div>
            <div className="panel settings-card">
              <h2>{t("Пайдаланушы және қолжетімділік")}</h2>
              <p>
                <b>{data.user.name}</b>
                <br />
                {t("Рөлі")}: {t(data.user.role)}
                <br />
                {t("Қолжетімді ұйымдар")}: {data.orgs.join(", ")}
              </p>
              <button
                className="secondary"
                data-action="logout"
                onClick={logout}
              >
                <Icon name="logout" size={14} /> {t("Шығу")}
              </button>
            </div>
            <div className="panel settings-card">
              <h2>{t("Есеп саясаты")}</h2>
              <p>
                {t("Валюта: KZT (теңге)")}
                <br />
                {t("ОПиУ: есептеу әдісі")}
                <br />
                {t("ДДС: нақты төлем күні")}
                <br />
                {t("Салық: бухгалтерия енгізген сомалар")}
                <br />
                {t("Өзіндік құн: бастапқы операциядан алынады")}
              </p>
            </div>
            <div className="panel settings-card">
              <h2>{t("Нақты деректерге көшу")}</h2>
              <p>{t("Демо деректерді нақты операциялармен араластырмаңыз.")}</p>
              <button
                className="secondary"
                data-action="guide"
                onClick={() => setDialog({ kind: "guide" })}
              >
                {t("Іске қосу нұсқаулығы")} <Icon name="arrow" size={13} />
              </button>
            </div>
          </div>
          <p className="note">
            {t(
              "Жергілікті нұсқа SQLite дерекқорын пайдаланады. Өндірістік іске қосу алдында HTTPS, жеке тіркелгілер және резервтік көшірме саясаты бапталуы қажет.",
            )}
          </p>
        </>
      );
      break;
    default:
      body = <div className="empty">{t("Бет табылмады")}</div>;
  }
  return (
    <div className="ledger-layout">
      <div
        className="toolbar"
        style={{ padding: "0 0 18px", justifyContent: "space-between" }}
      >
        <p className="subtitle">{t(subtitles[page] || "")}</p>
        <div className="heading-actions">
          <button
            className="secondary"
            data-action="export"
            onClick={exportCurrent}
          >
            <Icon name="download" size={15} /> {t("Экспорт")}
          </button>
          {canEdit && (page === "dashboard" || page === "operations") && (
            <button
              className="primary"
              data-action="import"
              onClick={() => setDialog({ kind: "import" })}
            >
              <Icon name="plus" size={15} /> {t("Деректерді жүктеу")}
            </button>
          )}
        </div>
      </div>
      <div className="filters">
        <div className="filter-left">
          <div className="filter-field">
            <Icon name="calendar" size={14} />
            <input
              type="month"
              aria-label={t("Есеп кезеңі")}
              value={month}
              onChange={(event) => setFilters({ month: event.target.value })}
            />
          </div>
          <div className="filter-field">
            <Icon name="building" size={14} />
            <select
              aria-label={t("Ұйым")}
              value={org}
              onChange={(event) => setFilters({ org: event.target.value })}
            >
              {data.user.role !== "manager" && (
                <option value="">{t("Барлық ұйымдар")}</option>
              )}
              {data.orgs.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </div>
          {data.demo && (
            <span className="demo-pill">
              <i className="dot" /> {t("Демо-деректер")}
            </span>
          )}
        </div>
        {data.workbookAvailable ? (
          <button
            className="secondary"
            data-action="use-workbook"
            onClick={() =>
              navigate("dashboard", {
                source: "workbook",
                month: "",
                channel: "",
                org: "",
              })
            }
          >
            {t("Kitapal Excel есебіне өту")}
          </button>
        ) : (
          <span className="updated">{t("Деректер жаңартылды")}</span>
        )}
      </div>
      {notice && (
        <div className="error-message" role="status">
          {t(notice)}{" "}
          <button onClick={() => setNotice("")} aria-label={t("Жабу")}>
            ×
          </button>
        </div>
      )}
      {body}
      <LedgerDialog
        key={`${dialog.kind}-${dialog.operation?.id || ""}`}
        dialog={dialog}
        data={data}
        month={month}
        org={org}
        onClose={() => setDialog({ kind: null })}
        submit={submit}
        refresh={refresh}
        onCorrect={openCorrect}
      />
    </div>
  );
}
