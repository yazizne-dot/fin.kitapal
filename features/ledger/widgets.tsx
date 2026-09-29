"use client";
import { useState } from "react";
import { Icon } from "../../components/ui/icon";
import { useI18n } from "../i18n/provider";
import type { LedgerData, LedgerOperation, LedgerAudit } from "./types";
import {
  forecast,
  million,
  money,
  monthNames,
  number,
  orgRows,
  percent,
  privileged,
} from "./format";

export function Kpi({
  label,
  value,
  icon,
  caption,
  delta,
  dark = false,
  onClick,
}: {
  label: string;
  value: number;
  icon: string;
  caption: string;
  delta?: string;
  dark?: boolean;
  onClick?: () => void;
}) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      className={`kpi ${dark ? "dark" : ""}`}
      onClick={onClick}
    >
      <div className="kpi-top">
        {t(label)}
        <Icon name={icon} />
      </div>
      <div className="kpi-value">
        {million(value)}
        <span>{t("млн ₸")}</span>
      </div>
      <div className="kpi-bottom">
        {delta && <span className="trend">{delta}</span>}
        <span>{t(caption)}</span>
      </div>
    </button>
  );
}
export function BarChart({ data }: { data: LedgerData }) {
  const { t } = useI18n();
  const [period, setPeriod] = useState<"month" | "quarter">("month");
  const rows =
    period === "month"
      ? data.history
      : Object.values(
          data.history.reduce<
            Record<
              string,
              {
                month: string;
                revenue: number;
                cost: number;
                opex: number;
                tax: number;
                depreciation: number;
              }
            >
          >((all, row) => {
            const key = `${row.month.slice(0, 4)} Q${Math.ceil(Number(row.month.slice(5)) / 3)}`;
            const group = (all[key] ??= {
              month: key,
              revenue: 0,
              cost: 0,
              opex: 0,
              tax: 0,
              depreciation: 0,
            });
            for (const field of [
              "revenue",
              "cost",
              "opex",
              "tax",
              "depreciation",
            ] as const)
              group[field] += row[field];
            all[key] = group;
            return all;
          }, {}),
        );
  const max = Math.max(...rows.map((row) => row.revenue), 1000000) * 1.18;
  const W = 650,
    H = 242,
    pad = 45,
    top = 20,
    bottom = 208,
    width = (W - pad - 15) / Math.max(rows.length, 1);
  return (
    <>
      <div className="segmented">
        <button
          className={period === "month" ? "selected" : ""}
          onClick={() => setPeriod("month")}
        >
          {t("Айлар")}
        </button>
        <button
          className={period === "quarter" ? "selected" : ""}
          onClick={() => setPeriod("quarter")}
        >
          {t("Тоқсандар")}
        </button>
      </div>
      <div className="chart-legend">
        <span className="legend-item">
          <i className="swatch" style={{ background: "#773962" }} />
          {t("Түсім")}
        </span>
        <span className="legend-item">
          <i className="swatch" style={{ background: "#e2bfd6" }} />
          {t("Шығыстар")}
        </span>
        <span style={{ marginLeft: "auto" }}>{t("млн ₸")}</span>
      </div>
      <div className="chart">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={t("Түсім мен шығыс диаграммасы")}
        >
          {[0, 1, 2, 3, 4].map((i) => {
            const y = bottom - ((bottom - top) * i) / 4;
            return (
              <g key={i}>
                <line className="gridline" x1={pad} x2="635" y1={y} y2={y} />
                <text x="33" y={y + 3} textAnchor="end">
                  {Math.round((max * i) / 4 / 1e6)}
                </text>
              </g>
            );
          })}
          {rows.map((row, i) => {
            const expense = row.cost + row.opex + row.tax + row.depreciation,
              x = pad + i * width + width * 0.2,
              bw = Math.min(18, width * 0.28),
              revHeight = (row.revenue / max) * (bottom - top),
              expHeight = (expense / max) * (bottom - top);
            return (
              <g key={row.month}>
                <rect
                  className="bar"
                  x={x}
                  y={bottom - revHeight}
                  width={bw}
                  height={revHeight}
                  rx="3"
                  fill="#773962"
                >
                  <title>{`${row.month}: ${t("Түсім")} ${money(row.revenue)}`}</title>
                </rect>
                <rect
                  className="bar"
                  x={x + bw + 4}
                  y={bottom - expHeight}
                  width={bw}
                  height={expHeight}
                  rx="3"
                  fill="#e2bfd6"
                >
                  <title>{`${t("Шығыстар")}: ${money(expense)}`}</title>
                </rect>
                <text
                  x={pad + i * width + width * 0.5}
                  y="229"
                  textAnchor="middle"
                >
                  {period === "quarter"
                    ? row.month.split(" ")[1]
                    : monthNames[Number(row.month.slice(5)) - 1]}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </>
  );
}
export function ExpenseDonut({ data }: { data: LedgerData }) {
  const { t } = useI18n();
  const totals = new Map<string, number>();
  for (const row of data.operations.filter((row) => row.kind === "expense"))
    totals.set(row.article, (totals.get(row.article) || 0) + row.amount);
  const items = [...totals].sort((a, b) => b[1] - a[1]);
  const total = items.reduce((sum, [, value]) => sum + value, 0);
  const colors = ["#773962", "#af749c", "#d5a9c4", "#e9cbdc", "#f2e3ec"];
  let sum = 0;
  const gradient = items
    .map(([, value], i) => {
      const start = sum;
      sum += total ? (value / total) * 100 : 0;
      return `${colors[i % colors.length]} ${start}% ${sum}%`;
    })
    .join(",");
  return (
    <>
      <div className="donut-layout">
        <div
          className="donut"
          style={{
            background: gradient ? `conic-gradient(${gradient})` : "#eee",
          }}
        >
          <div className="donut-center">
            <small>{t("Барлығы")}</small>
            <strong>{million(total)}</strong>
            <span>{t("млн ₸")}</span>
          </div>
        </div>
      </div>
      <div className="expense-legend">
        {items.map(([label, value], i) => (
          <div className="expense-line" key={label}>
            <i
              className="swatch"
              style={{ background: colors[i % colors.length] }}
            />
            <span>{t(label)}</span>
            <span className="value">{million(value)}</span>
            <span className="percent">
              {total ? ((value / total) * 100).toFixed(0) : 0}%
            </span>
          </div>
        ))}
      </div>
    </>
  );
}
export function OrgTable({
  data,
  org,
  onSelect,
}: {
  data: LedgerData;
  org: string;
  onSelect: (org: string) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>{t("Ұйым / бағыт")}</th>
            <th className="num">{t("Түсім")}</th>
            <th className="num">{t("Жалпы пайда")}</th>
            <th className="num">{t("Маржа")}</th>
          </tr>
        </thead>
        <tbody>
          {orgRows(data, org).map((row, i) => (
            <tr
              key={row.org}
              className="clickable"
              data-org={row.org}
              onClick={() => onSelect(row.org)}
            >
              <td>
                <div className="org-cell">
                  <span className="org-icon">
                    <Icon name={["book", "shop", "building"][i]} size={15} />
                  </span>
                  <span>
                    <strong>{row.org}</strong>
                    <small>
                      {t(
                        (
                          {
                            "Qalam Books": "Баспа",
                            "Kitap Retail": "Кітап дүкендері",
                            "Dara Distribution": "Дистрибуция",
                          } as Record<string, string>
                        )[row.org] || "",
                      )}
                    </small>
                  </span>
                </div>
              </td>
              <td className="num">
                {million(row.revenue)} {t("млн ₸")}
              </td>
              <td className="num">
                {million(row.gross)} {t("млн ₸")}
              </td>
              <td className="num">
                <span className="positive-badge">
                  {row.revenue
                    ? `${((row.gross / row.revenue) * 100).toFixed(1)}%`
                    : "—"}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export function ForecastPanel({ data }: { data: LedgerData }) {
  const { t } = useI18n();
  if (data.user.role === "manager")
    return <div className="empty">{t("Болжам қаржыгерге қолжетімді")}</div>;
  const result = forecast(data),
    max = Math.max(...result.points.map((point) => point.value), 1),
    min = Math.min(...result.points.map((point) => point.value), 0),
    span = max - min || 1,
    coords = result.points
      .map(
        (point, i) =>
          `${20 + i * 10},${85 - ((point.value - min) / span) * 65}`,
      )
      .join(" ");
  return (
    <>
      <div className="forecast-top">
        <div>
          <strong>
            {million(result.min)}{" "}
            <span style={{ fontSize: 13, fontWeight: 400 }}>{t("млн ₸")}</span>
          </strong>
          <small>{t("Болжамды ең төменгі қалдық")}</small>
        </div>
        <span className={`status ${result.gap ? "warn" : ""}`}>
          {t(result.gap ? "Назар аударыңыз" : "Тұрақты")}
        </span>
      </div>
      <div className="chart">
        <svg
          viewBox="0 0 345 123"
          role="img"
          aria-label={t("Жоспар бойынша ақша қалдығы")}
        >
          <line x1="20" x2="320" y1="86" y2="86" className="gridline" />
          <polyline
            points={coords}
            fill="none"
            stroke="#a96b94"
            strokeWidth="2"
            strokeDasharray="4 3"
          />
          {[0, 10, 20, 30].map((i) => (
            <text
              key={i}
              x={20 + i * 10}
              y="113"
              textAnchor={i === 0 ? "start" : i === 30 ? "end" : "middle"}
            >
              {result.points[i].date.slice(8)}{" "}
              {monthNames[Number(result.points[i].date.slice(5, 7)) - 1]}
            </text>
          ))}
        </svg>
      </div>
      <div className="forecast-alert">
        <Icon name={result.gap ? "info" : "check"} size={13} />
        {t(
          !result.hasPlans
            ? "Жоспар жоқ: қалдық өзгеріссіз көрсетілген"
            : result.gap
              ? `Касса алшақтығы: ${result.gap}`
              : "Енгізілген жоспар бойынша касса алшақтығы жоқ",
        )}
      </div>
    </>
  );
}
export function OperationsTable({
  data,
  rows,
  onCorrect,
}: {
  data: LedgerData;
  rows: LedgerOperation[];
  onCorrect: (operation: LedgerOperation) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>{t("Күн / құжат")}</th>
            <th>{t("Операция")}</th>
            <th>{t("Контрагент")}</th>
            <th>{t("Ұйым")}</th>
            <th className="num">{t("Сома")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.length ? (
            rows.map((row) => (
              <tr key={row.id}>
                <td>
                  {row.date}
                  <br />
                  <small className="subtle">{row.document}</small>
                </td>
                <td>
                  {t(data.kinds[row.kind] || row.kind)}
                  <br />
                  <small className="subtle">{t(row.article)}</small>
                </td>
                <td>{row.counterparty || "—"}</td>
                <td>{row.org}</td>
                <td className="num">
                  {money(row.amount)}
                  {privileged(data.user.role) && (
                    <button
                      type="button"
                      data-correct={row.id}
                      aria-label={t("Операцияны түзету")}
                      onClick={() => onCorrect(row)}
                    >
                      <Icon name="settings" size={12} />
                    </button>
                  )}
                </td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={5} className="empty">
                {t("Операциялар табылмады")}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
export function AuditTable({ rows }: { rows: LedgerAudit[] }) {
  const { t } = useI18n();
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>{t("Уақыты")}</th>
            <th>{t("Пайдаланушы")}</th>
            <th>{t("Әрекет")}</th>
            <th>{t("Мәлімет")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.length ? (
            rows.map((row) => (
              <tr key={row.id}>
                <td>{new Date(row.time).toLocaleString("ru-RU")}</td>
                <td>{row.author}</td>
                <td>{t(row.action)}</td>
                <td
                  style={{
                    whiteSpace: "normal",
                    maxWidth: 460,
                    overflowWrap: "anywhere",
                  }}
                >
                  {row.detail}
                </td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={4} className="empty">
                {t("Жазбалар жоқ")}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
