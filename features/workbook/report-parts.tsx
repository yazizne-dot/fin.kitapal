import { useState } from "react";
import { Icon } from "../../components/ui/icon";
import { useI18n } from "../i18n/provider";
import type { ReportActions } from "../shared/types";
import type {
  ChannelRow,
  DetailRow,
  MetricKey,
  SourceRef,
  WorkbookData,
} from "./types";
import {
  change,
  compact,
  format,
  fullMonths,
  metricLabels,
  money,
  percent,
  periodLabel,
  ratio,
  shortMonths,
} from "./model";

export interface ReportContext {
  data: WorkbookData;
  navigate: ReportActions["navigate"];
  setFilters: ReportActions["setFilters"];
  onDrill: (key: MetricKey) => void;
  onDetail: (row: DetailRow) => void;
}
export function SourceCell({ source }: { source: SourceRef }) {
  return (
    <span className="source-cell">
      {source.sheet}!<b>{source.cell}</b>
    </span>
  );
}
export function SourceTable({ rows }: { rows: SourceRef[] }) {
  const { t } = useI18n();
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>{t("Кезең / ұяшық")}</th>
            <th className="num">{t("Мәні")}</th>
            <th>{t("Формула / ескертпе")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={`${r.period || ""}-${r.sheet}-${r.cell}-${i}`}>
              <td>
                {r.period && (
                  <>
                    {r.period}
                    <br />
                  </>
                )}
                <SourceCell source={r} />
              </td>
              <td className="num">
                {format(r.value)}
                {r.value === null && r.raw != null && (
                  <small className="cell-note">
                    {t("Бастапқысы")}: {String(r.raw)}
                  </small>
                )}
              </td>
              <td className="formula-cell">
                {r.formula ? (
                  "=" + r.formula
                ) : r.formulaOrigin ? (
                  <>
                    {t("Ортақ формула негізі")}: {r.formulaOrigin.cell}
                    <br />={r.formulaOrigin.formula || ""}
                  </>
                ) : (
                  t("Файлда сақталған мән")
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export function DetailsTable({
  data,
  rows,
  onDetail,
}: {
  data: WorkbookData;
  rows: DetailRow[];
  onDetail: (row: DetailRow) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>{t("Бап")}</th>
            <th>{t("Тобы")}</th>
            <th className="num">{t("Факт, ₸")}</th>
            <th>{t("Дереккөз")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.id}
              className="clickable"
              data-wb-detail={encodeURIComponent(r.id)}
              onClick={() => onDetail(r)}
            >
              <td style={{ whiteSpace: "normal" }}>{r.display}</td>
              <td>{t(metricLabels[r.group])}</td>
              <td className="num">{format(r.value)}</td>
              <td>
                {r.sources[0] && <SourceCell source={r.sources[0]} />}{" "}
                {r.sources.length > 1 && (
                  <small>
                    +{r.sources.length - 1} {t("ай")}
                  </small>
                )}
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={4} className="empty">
                {t("Баптар табылмады")}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
export function Empty({
  title,
  text,
  navigate,
}: {
  title: string;
  text: string;
  navigate: ReportActions["navigate"];
}) {
  const { t } = useI18n();
  return (
    <div className="panel unavailable">
      <span className="unavailable-icon">
        <Icon name="file" size={30} />
      </span>
      <h2>{t(title)}</h2>
      <p>{t(text)}</p>
      <button
        className="secondary"
        data-page="imports"
        onClick={() => navigate("imports")}
      >
        {t("Дереккөз құрамын көру")} <Icon name="arrow" size={14} />
      </button>
    </div>
  );
}
export function Warning({
  data,
  navigate,
}: {
  data: WorkbookData;
  navigate: ReportActions["navigate"];
}) {
  const { t } = useI18n();
  const arithmetic = data.checks.find(
    (x) => x.kind === "arithmetic" && x.metric === "opex",
  );
  if (!data.checks.length) return null;
  return (
    <button
      className="source-warning"
      data-page="checks"
      onClick={() => navigate("checks")}
    >
      <Icon name="info" size={18} />
      <span>
        <b>
          {arithmetic
            ? `${arithmetic.period} ${t("шығыс қорытындысында")} ${money(arithmetic.difference)} ${t("айырма бар")}`
            : t("Бастапқы файлда тексерілетін мәндер бар")}
        </b>
        <small>
          {t("Көрсеткіштер Excel-дегі қорытындымен берілген.")}{" "}
          {data.checks.length} {t("тексеру ескертпесі")}.
        </small>
      </span>
      <span className="warning-link">
        {t("Тексеру")} <Icon name="arrow" size={14} />
      </span>
    </button>
  );
}
export function SourceFooter({ data }: { data: WorkbookData }) {
  const { t } = useI18n();
  return (
    <>
      {Boolean(data.overrideCount || data.siteEntryCount) && (
        <p className="source-warning">
          {t("Есепке сайттағы түзетулер мен жаңа жазбалар енгізілген.")}
        </p>
      )}
      <p className="note">
        {t("Дереккөз")}: <b>{data.metadata.file}</b> ·{" "}
        {data.channel
          ? t(
              "Тек түсім, өзіндік құн және жалпы пайда осы арнаға тиесілі. Жалпы шығыстар арналарға бөлінбеген.",
            )
          : t(
              data.metadata.method ||
                "Excel-де сақталған мәндер; түпнұсқа файл өзгертілмеген",
            )}
        {data.range === "ytd" && (
          <>
            {" "}
            {t(
              data.aggregation === "year-total"
                ? "Негізгі қорытынды — файлдың O («Тотал») бағанынан."
                : "Негізгі қорытынды — таңдалған айлық мәндердің қосындысы.",
            )}{" "}
            {t("Өткен жыл бірдей айлар бойынша салыстырылады.")}
          </>
        )}
      </p>
    </>
  );
}
export function MetricKpi({
  data,
  metric,
  caption,
  dark,
  onDrill,
}: {
  data: WorkbookData;
  metric: MetricKey;
  caption?: string;
  dark?: boolean;
  onDrill: (key: MetricKey) => void;
}) {
  const { t } = useI18n();
  const value = data.report[metric],
    delta = change(value, data.previous?.[metric]);
  const good = delta !== null && (metric === "opex" ? delta <= 0 : delta >= 0);
  return (
    <button
      className={`kpi ${dark ? "dark" : ""}`}
      data-wb-drill={metric}
      onClick={() => onDrill(metric)}
    >
      <div className="kpi-top">
        {t(metricLabels[metric])}
        <Icon
          name={
            (
              {
                revenue: "chart",
                gross: "trend",
                opex: "wallet",
                profit: "spark",
              } as Partial<Record<MetricKey, string>>
            )[metric] || "chart"
          }
          size={17}
        />
      </div>
      <div
        className={`kpi-value ${value != null && value < 0 ? "loss-value" : ""}`}
      >
        {compact(value)}
        {value != null && <span>{t("млн ₸")}</span>}
      </div>
      <div className="kpi-bottom">
        <span className={`trend ${good ? "" : "negative"}`}>
          {delta === null ? (
            "—"
          ) : (
            <>
              <Icon name="trend" size={11} /> {percent(delta)}
            </>
          )}
        </span>
        <span>{t(caption || "өткен жылдың сәйкес кезеңіне")}</span>
      </div>
    </button>
  );
}
export function TrendChart({ data }: { data: WorkbookData }) {
  const { t } = useI18n();
  const [chart, setChart] = useState<"month" | "quarter">("month");
  let rows = data.history.map((r) => ({
    month: r.month,
    revenue: r.revenue ?? 0,
    cost: r.cost ?? 0,
    gross: r.gross ?? 0,
  }));
  if (chart === "quarter") {
    const grouped = new Map<
      string,
      { month: string; revenue: number; cost: number; gross: number }
    >();
    for (const r of rows) {
      const key = "Q" + Math.ceil(Number(r.month.slice(5)) / 3),
        p = grouped.get(key) || { month: key, revenue: 0, cost: 0, gross: 0 };
      p.revenue += r.revenue;
      p.cost += r.cost;
      p.gross += r.gross;
      grouped.set(key, p);
    }
    rows = [...grouped.values()];
  }
  const second = data.channel ? "gross" : "cost",
    values = rows.flatMap((r) => [r.revenue, r[second]]),
    max = Math.max(1, ...values) * 1.15,
    min = Math.min(0, ...values) * 1.15,
    bottom = 211,
    top = 20,
    w = 620 / Math.max(rows.length, 1),
    pos = (v: number) => bottom - ((v - min) / (max - min)) * (bottom - top),
    baseline = pos(0);
  return (
    <>
      <div className="panel-head">
        <div>
          <h2>{t("Сату динамикасы")}</h2>
          <p>
            {data.month.slice(0, 4)}{" "}
            {t(data.metadata.file.startsWith("PostgreSQL")
              ? "жыл · PostgreSQL-де қамтылған айлардың нақты нәтижесі"
              : "жыл · файлда бар айлардың нақты нәтижесі")}
          </p>
        </div>
        <div className="segmented">
          <button
            data-chart="month"
            className={chart === "month" ? "selected" : ""}
            onClick={() => setChart("month")}
          >
            {t("Айлар")}
          </button>
          <button
            data-chart="quarter"
            className={chart === "quarter" ? "selected" : ""}
            onClick={() => setChart("quarter")}
          >
            {t("Тоқсандар")}
          </button>
        </div>
      </div>
      {!rows.length ? (
        <div className="empty">{t("Факт деректері жоқ")}</div>
      ) : (
        <>
          <div className="chart-legend">
            <span className="legend-item">
              <i className="swatch" style={{ background: "#773962" }} />
              {t("Түсім")}
            </span>
            <span className="legend-item">
              <i className="swatch" style={{ background: "#dfb8d2" }} />
              {t(data.channel ? "Жалпы пайда" : "Өзіндік құн")}
            </span>
            <span style={{ marginLeft: "auto" }}>{t("млн ₸")}</span>
          </div>
          <div className="chart">
            <svg
              viewBox="0 0 690 245"
              role="img"
              aria-label={t("Айлар бойынша нақты түсім")}
            >
              {[0, 1, 2, 3, 4].map((i) => {
                const y = bottom - ((bottom - top) * i) / 4;
                return (
                  <g key={i}>
                    <line className="gridline" x1="49" x2="674" y1={y} y2={y} />
                    <text x="37" y={y + 3} textAnchor="end">
                      {Math.round((min + ((max - min) * i) / 4) / 1e6)}
                    </text>
                  </g>
                );
              })}
              {rows.map((r, i) => {
                const x = 52 + i * w + w * 0.19,
                  bw = Math.min(23, w * 0.26);
                return (
                  <g key={r.month}>
                    {([r.revenue, r[second]] as number[]).map((v, j) => (
                      <rect
                        key={j}
                        x={x + j * (bw + 4)}
                        y={Math.min(baseline, pos(v))}
                        width={bw}
                        height={Math.abs(pos(v) - baseline)}
                        rx="3"
                        fill={j ? "#dfb8d2" : "#773962"}
                      >
                        <title>{`${r.month}: ${t(j ? metricLabels[second] : "Түсім")} ${money(v)}`}</title>
                      </rect>
                    ))}
                    <text x={52 + i * w + w * 0.5} y="233" textAnchor="middle">
                      {chart === "quarter"
                        ? r.month
                        : shortMonths[Number(r.month.slice(5)) - 1]}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>
        </>
      )}
    </>
  );
}
export function ChannelTable({
  data,
  navigate,
  limit = 100,
}: {
  data: WorkbookData;
  navigate: ReportActions["navigate"];
  limit?: number;
}) {
  const { t } = useI18n();
  const rows = data.channels
    .filter((r) => !data.channel || data.channel === r.id)
    .slice()
    .sort((a, b) => (b.revenue || 0) - (a.revenue || 0))
    .slice(0, limit);
  return (
    <div className="table-wrap">
      <table className="table wb-channel-table">
        <thead>
          <tr>
            <th>{t("Сату арнасы")}</th>
            <th className="num">{t("Түсім, ₸")}</th>
            <th className="num">{t("Жалпы пайда, ₸")}</th>
            <th className="num">{t("Маржа")}</th>
            <th className="num">{t("Өткен жылға")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r: ChannelRow) => (
            <tr
              key={r.id}
              className="clickable"
              data-wb-channel={r.id}
              onClick={() => navigate("analytics", { channel: r.id })}
            >
              <td>
                <div className="org-cell">
                  <span className="org-icon">
                    <Icon
                      name={r.label.includes("Kitapal") ? "shop" : "chart"}
                      size={14}
                    />
                  </span>
                  <span>
                    <strong>{r.label}</strong>
                    <small>
                      {t(
                        r.label.includes("Kitapal")
                          ? "Кітап дүкені"
                          : "Сату бағыты",
                      )}
                    </small>
                  </span>
                </div>
              </td>
              <td className="num">{format(r.revenue)}</td>
              <td className="num">{format(r.gross)}</td>
              <td className="num">
                <span className="positive-badge">
                  {percent(ratio(r.gross, r.revenue))}
                </span>
              </td>
              <td
                className={`num ${change(r.revenue, r.previousRevenue) !== null && change(r.revenue, r.previousRevenue)! < 0 ? "negative" : ""}`}
              >
                {percent(change(r.revenue, r.previousRevenue))}
              </td>
            </tr>
          ))}
          {!rows.length && (
            <tr>
              <td colSpan={5} className="empty">
                {t("Осы кезеңде арна деректері жоқ")}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
export function ExpenseChart({
  data,
  onDrill,
}: {
  data: WorkbookData;
  onDrill: (key: MetricKey) => void;
}) {
  const { t } = useI18n();
  if (data.channel)
    return (
      <div className="scope-note">
        <Icon name="info" size={22} />
        <p>{t("Арнаға тиесілі операциялық шығыстар файлда бөлінбеген.")}</p>
        <b>
          {t("Жалпы маржа")}{" "}
          {percent(ratio(data.report.gross, data.report.revenue))}
        </b>
      </div>
    );
  const sorted = data.details
      .filter((x) => x.group === "opex" && x.value != null && x.value > 0)
      .sort((a, b) => (b.value || 0) - (a.value || 0)),
    total = sorted.reduce((s, r) => s + (r.value || 0), 0);
  if (!total) return <div className="empty">{t("Шығыс деректері жоқ")}</div>;
  const rows = [
      ...sorted
        .slice(0, 3)
        .map((x) => ({ label: x.display, value: x.value || 0 })),
      {
        label: "Өзге баптар",
        value: sorted.slice(3).reduce((s, r) => s + (r.value || 0), 0),
      },
    ],
    colors = ["#6f375c", "#a66d93", "#d398bf", "#ead5e3"];
  let p = 0;
  const gradient = rows
    .map((x, i) => {
      const start = p;
      p += (x.value / total) * 100;
      return `${colors[i]} ${start}% ${p}%`;
    })
    .join(",");
  return (
    <>
      <div className="panel-head">
        <div>
          <h2>{t("Операциялық шығыстар")}</h2>
          <p>{t("Жеке баптарды қосу арқылы есептелген")}</p>
        </div>
        <button
          data-wb-drill="opex"
          aria-label={t("Шығыс баптарын ашу")}
          onClick={() => onDrill("opex")}
        >
          <Icon name="arrow" size={15} />
        </button>
      </div>
      <div className="donut-layout">
        <div
          className="donut"
          style={{ background: `conic-gradient(${gradient})` }}
        >
          <div className="donut-center">
            <small>{t("Баптар сомасы")}</small>
            <strong>{compact(total)}</strong>
            <span>{t("млн ₸")}</span>
          </div>
        </div>
      </div>
      <div className="expense-legend">
        {rows.map((row, i) => (
          <div key={row.label} className="expense-line">
            <i className="swatch" style={{ background: colors[i] }} />
            <span title={row.label}>
              {row.label.replace("Расходы на ", "").replace("Расходы ", "")}
            </span>
            <span className="value">
              {compact(row.value)} {t("млн")}
            </span>
            <span className="percent">
              {Math.round((row.value / total) * 100)}%
            </span>
          </div>
        ))}
      </div>
    </>
  );
}
export function BudgetSummary({
  data,
  navigate,
}: {
  data: WorkbookData;
  navigate: ReportActions["navigate"];
}) {
  const { t } = useI18n();
  const b = data.budgetRows.find(
    (r) => r.label === "ИТОГО ОПЕРАЦИОННЫЕ РАСХОДЫ",
  );
  if (data.channel || !b)
    return <div className="empty">{t("Бұл кесіндіге бюджет берілмеген")}</div>;
  const completion = ratio(b.actual, b.plan),
    delta = b.actual == null || b.plan == null ? null : b.actual - b.plan;
  return (
    <div className="budget-summary">
      <div className="budget-head-value">
        <strong>
          {compact(b.actual)} <small>{t("млн ₸")}</small>
        </strong>
        <span className={`status ${delta != null && delta > 0 ? "warn" : ""}`}>
          {percent(completion)} {t("орындалды")}
        </span>
      </div>
      <p>
        {t("Жоспар")}:{" "}
        <b>
          {compact(b.plan)} {t("млн ₸")}
        </b>
      </p>
      <div className="progress-track">
        <i
          style={{ width: `${Math.min(Math.max(completion || 0, 0), 100)}%` }}
        />
      </div>
      <div className="budget-foot-value">
        <span>
          {t(
            delta === null
              ? "Факт жоқ"
              : delta <= 0
                ? "Жоспардан төмен"
                : "Жоспардан артық",
          )}
        </span>
        <b>{money(delta === null ? null : Math.abs(delta))}</b>
      </div>
      <div className="forecast-alert">
        <Icon name="info" size={14} />{" "}
        {t(
          "Бюджеттің қамтылған баптары бойынша. P&L қорытындысы бөлек тексеріледі.",
        )}
      </div>
      <button
        className="link-button"
        data-page="plans"
        onClick={() => navigate("plans")}
      >
        {t("Баптар бойынша салыстыру")} <Icon name="arrow" size={13} />
      </button>
    </div>
  );
}
export function PeriodSummary({ data }: { data: WorkbookData }) {
  return (
    <>
      {periodLabel(data)} ·{" "}
      {data.channel
        ? data.channels.find((r) => r.id === data.channel)?.label ||
          data.channel
        : "Барлық сату арналары"}
    </>
  );
}
