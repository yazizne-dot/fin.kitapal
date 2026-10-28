import { Fragment, useState } from "react";
import { Icon } from "../../components/ui/icon";
import { useI18n } from "../i18n/provider";
import type { ReportActions } from "../shared/types";
import type { MetricKey, WorkbookData } from "./types";
import {
  change,
  compact,
  format,
  fullMonths,
  metricKeys,
  metricLabels,
  money,
  percent,
  periodLabel,
  ratio,
} from "./model";
import {
  BudgetSummary,
  ChannelTable,
  DetailsTable,
  Empty,
  ExpenseChart,
  MetricKpi,
  SourceCell,
  SourceFooter,
  TrendChart,
  Warning,
  type ReportContext,
} from "./report-parts";

export function Dashboard({ data, navigate, onDrill }: ReportContext) {
  const { t } = useI18n();
  const balance = data.statements?.balance,
    cf = data.statements?.cashflow,
    prior = data.previous,
    prevChange = change(data.report.revenue, prior?.revenue);
  return (
    <>
      {(balance || cf) && (
        <section className="insights">
          <button
            className="insight"
            data-page="balance"
            onClick={() => navigate("balance")}
          >
            <span className="insight-icon">
              <Icon name="wallet" size={19} />
            </span>
            <div>
              <strong>
                {t("Ақша")}:{" "}
                {money(balance?.rows.find((r) => r.id === "cash")?.value)}
              </strong>
              <p>
                {t("Баланс күні")}: {balance?.asOfLabel || "—"} ·{" "}
                {t("барлық компания")}
              </p>
            </div>
          </button>
          <button
            className="insight"
            data-page="cashflow"
            onClick={() => navigate("cashflow")}
          >
            <span className="insight-icon">
              <Icon name="swap" size={19} />
            </span>
            <div>
              <strong>
                {t("ДДС нетто")}: {money(cf?.business?.net)}
              </strong>
              <p>
                {data.month} · {t("касса толықтыруларынсыз")}
              </p>
            </div>
          </button>
          <button
            className="insight"
            data-page="balance"
            onClick={() => navigate("balance")}
          >
            <span className="insight-icon">
              <Icon name="balance" size={19} />
            </span>
            <div>
              <strong>{t("Баланс пен ДДС қосылды")}</strong>
              <p>{t("Бастапқы ұяшықтар мен төлем жолдары ашылады")}</p>
            </div>
          </button>
        </section>
      )}
      <Warning data={data} navigate={navigate} />
      {!data.actualAvailable && (
        <Empty
          title="Бұл айдың фактісі әлі жоқ"
          text={data.metadata.file.startsWith("PostgreSQL")
            ? "Бұл кезеңге PostgreSQL деректері немесе есепті қамту ережесі табылмады."
            : "Файлда соңғы факт — 2026 жылғы тамыз. Қыркүйек–желтоқсан бюджеті жоспар бөлімінде қолжетімді."}
          navigate={navigate}
        />
      )}
      <section className="kpi-grid">
        {(["revenue", "gross", "opex", "profit"] as MetricKey[]).map(
          (key, i) => (
            <MetricKpi
              key={key}
              data={data}
              metric={key}
              dark={i === 0}
              onDrill={onDrill}
            />
          ),
        )}
      </section>
      <section className="grid-main">
        <div className="panel">
          <TrendChart data={data} />
        </div>
        <div className="panel">
          <ExpenseChart data={data} onDrill={onDrill} />
        </div>
      </section>
      <section className="lower">
        <div className="panel">
          <div className="panel-head table-top">
            <div>
              <h2>{t("Сату арналары")}</h2>
              <p>{t("Түсімі ең жоғары бес бағыт")}</p>
            </div>
            <button
              className="link-button"
              data-page="analytics"
              onClick={() => navigate("analytics")}
            >
              {t("Барлығы")} <Icon name="arrow" size={12} />
            </button>
          </div>
          <ChannelTable data={data} navigate={navigate} limit={5} />
        </div>
        <div className="panel">
          <div className="panel-head">
            <div>
              <h2>{t("Бюджеттің орындалуы")}</h2>
              <p>{t(data.metadata.file.startsWith("PostgreSQL")
                ? "Операциялық шығыстар · бекітілген бюджет"
                : "Операциялық шығыстар · файл бюджеті")}</p>
            </div>
            <Icon name="calendar" size={16} />
          </div>
          <BudgetSummary data={data} navigate={navigate} />
        </div>
      </section>
      <section className="insights">
        <button
          className={`insight ${prevChange !== null && prevChange < 0 ? "warn" : ""}`}
          data-page="analytics"
          onClick={() => navigate("analytics")}
        >
          <span className="insight-icon">
            <Icon name="trend" size={19} />
          </span>
          <div>
            <strong>
              {t("Түсім")}: {percent(prevChange)} {t("жылдық өзгеріс")}
            </strong>
            <p>
              {t("Өткен жылдың сәйкес кезеңі")}: {compact(prior?.revenue)}{" "}
              {t("млн ₸")}
            </p>
          </div>
        </button>
        <button
          className={`insight ${data.report.profit != null && data.report.profit < 0 ? "warn" : ""}`}
          data-wb-drill="profit"
          onClick={() => onDrill("profit")}
        >
          <span className="insight-icon">
            <Icon name="chart" size={19} />
          </span>
          <div>
            <strong>
              {t("Таза рентабельділік")}:{" "}
              {percent(ratio(data.report.profit, data.report.revenue))}
            </strong>
            <p>
              {t(
                data.channel
                  ? "Арналарға ортақ шығыстар бөлінбеген"
                  : data.report.profit != null && data.report.profit < 0
                    ? "Кезең шығынмен аяқталған"
                    : "Файлдағы таза пайда негізінде",
              )}
            </p>
          </div>
        </button>
        <button
          className="insight"
          data-page="imports"
          onClick={() => navigate("imports")}
        >
          <span className="insight-icon">
            <Icon name="file" size={19} />
          </span>
          <div>
            <strong>{t("44 айлық P&L тарихы")}</strong>
            <p>2023–2026 · {t("айлық және жыл басынан есеп")}</p>
          </div>
        </button>
      </section>
      <SourceFooter data={data} />
    </>
  );
}
export function Pnl({ data, navigate, onDrill, onDetail }: ReportContext) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState<MetricKey[]>([]);
  if (!data.actualAvailable)
    return (
      <>
        <Warning data={data} navigate={navigate} />
        <Empty
          title="P&L фактісі жоқ"
          text={data.metadata.file.startsWith("PostgreSQL")
            ? "Бұл кезеңге PostgreSQL деректері немесе есепті қамту ережесі табылмады."
            : "Таңдалған айға бастапқы файлда нақты есеп берілмеген. Нөл сомаларды факт ретінде көрсетпейміз."}
          navigate={navigate}
        />
      </>
    );
  return (
    <>
      <Warning data={data} navigate={navigate} />
      <div className="panel report-panel">
        <div className="panel-head table-top">
          <div>
            <h2>
              {t("Кірістер мен шығыстар")} · {periodLabel(data)}
            </h2>
            <p>{t("Құрылым мен баптар Excel файлына сәйкес сақталған")}</p>
          </div>
          <span className="subtle">{t("теңге · 2 ондық белгі")}</span>
        </div>
        <div className="table-wrap">
          <table className="table report-table wb-pnl">
            <thead>
              <tr>
                <th>{t("Көрсеткіш / бап")}</th>
                <th className="num">{t("Excel қорытындысы")}</th>
                <th className="num">{t("Баптардан қайта есеп")}</th>
                <th className="num">{t("Өткен жыл")}</th>
                <th className="num">{t("Өзгеріс")}</th>
              </tr>
            </thead>
            <tbody>
              {metricKeys
                .filter(
                  (key) =>
                    !data.channel || ["revenue", "cost", "gross"].includes(key),
                )
                .map((key) => {
                  const children = data.details.filter((x) => x.group === key),
                    source = data.report[key],
                    calc = data.recalculated?.[key],
                    delta =
                      source == null || calc == null ? null : calc - source,
                    prior = data.previous?.[key],
                    open = expanded.includes(key),
                    significant = delta != null && Math.abs(delta) > 0.02;
                  return (
                    <Fragment key={key}>
                      <tr
                        className={`total ${significant ? "row-review" : ""}`}
                      >
                        <td>
                          <div className="wb-row-title">
                            {children.length ? (
                              <button
                                data-wb-toggle={key}
                                aria-label={t(
                                  metricLabels[key] + " баптарын ашу",
                                )}
                                onClick={() =>
                                  setExpanded(
                                    open
                                      ? expanded.filter((x) => x !== key)
                                      : [...expanded, key],
                                  )
                                }
                              >
                                <Icon name={open ? "down" : "plus"} size={12} />
                              </button>
                            ) : (
                              <span className="row-indent" />
                            )}
                            <button
                              data-wb-drill={key}
                              onClick={() => onDrill(key)}
                            >
                              {t(metricLabels[key])}
                            </button>
                          </div>
                        </td>
                        <td className="num">
                          <button
                            data-wb-drill={key}
                            onClick={() => onDrill(key)}
                          >
                            {format(source)}
                          </button>
                        </td>
                        <td className={`num ${significant ? "negative" : ""}`}>
                          {format(calc)}
                          {significant && (
                            <small className="cell-note">
                              Δ {format(delta)}
                            </small>
                          )}
                        </td>
                        <td className="num">{format(prior)}</td>
                        <td
                          className={`num ${change(source, prior) != null && change(source, prior)! < 0 ? "negative" : ""}`}
                        >
                          {percent(change(source, prior))}
                        </td>
                      </tr>
                      {open &&
                        children.map((row) => (
                          <tr
                            key={row.id}
                            className="detail-row clickable"
                            data-wb-detail={encodeURIComponent(row.id)}
                            onClick={() => onDetail(row)}
                          >
                            <td>{row.display}</td>
                            <td className="num">{format(row.value)}</td>
                            <td className="num subtle">
                              {row.sources.length === 1
                                ? row.sources[0].cell
                                : `${row.sources.length} ${t("ай")}`}
                            </td>
                            <td colSpan={2}>
                              {row.sources[0] && (
                                <SourceCell source={row.sources[0]} />
                              )}
                            </td>
                          </tr>
                        ))}
                    </Fragment>
                  );
                })}
            </tbody>
          </table>
        </div>
      </div>
      <div className="method-note">
        <Icon name="info" size={17} />
        <p>
          <b>{t("Екі нұсқа не үшін берілген?")}</b>{" "}
          {t(
            "«Excel қорытындысы» — файлда сақталған сома. «Баптардан қайта есеп» — сол файлдағы жеке баптарды қосу нәтижесі. Айырма бастапқы формулаға немесе қамтылған жолдарға байланысты болуы мүмкін; файл автоматты түзетілмейді.",
          )}
          <br />
          {t(
            "EBITDA жеке жол ретінде файлда жоқ. «Операциялық пайда» Excel-дегі атауымен сақталған. Салықтар, комиссиялар және ретро-бонустар бастапқы жіктемемен көрсетілген.",
          )}
        </p>
      </div>
      <SourceFooter data={data} />
    </>
  );
}
export function Analytics({ data, navigate, onDrill }: ReportContext) {
  const { t } = useI18n();
  return (
    <>
      <div className="detail-stats">
        <MetricKpi data={data} metric="revenue" dark onDrill={onDrill} />
        <MetricKpi data={data} metric="gross" onDrill={onDrill} />
        <div className="kpi">
          <div className="kpi-top">
            {t("Жалпы маржа")} <Icon name="trend" size={17} />
          </div>
          <div className="kpi-value">
            {percent(ratio(data.report.gross, data.report.revenue))}
          </div>
          <div className="kpi-bottom">{t("(түсім − өзіндік құн) / түсім")}</div>
        </div>
      </div>
      <div className="panel report-panel">
        <div className="panel-head table-top">
          <div>
            <h2>{t("Бағыттар бойынша нақты нәтиже")}</h2>
            <p>{t("Дүкенді немесе арнаны басып, оның жеке есебін ашыңыз")}</p>
          </div>
          {data.channel && (
            <button
              className="secondary"
              data-wb-channel=""
              onClick={() => navigate("analytics", { channel: "" })}
            >
              {t("Барлық арналар")}
            </button>
          )}
        </div>
        <ChannelTable data={data} navigate={navigate} />
      </div>
      <div className="panel">
        <TrendChart data={data} />
      </div>
      <SourceFooter data={data} />
    </>
  );
}
export function Plans({
  data,
  navigate,
  onBudget,
  setFilters,
}: ReportContext & { onBudget: (id: string) => void }) {
  const { t } = useI18n();
  if (data.channel)
    return (
      <Empty
        title="Арнаға бөлінген бюджет жоқ"
        text="Бастапқы файлда шығыстар бюджеті жалпы компания бойынша берілген. Барлық арналар кесіндісін таңдаңыз."
        navigate={navigate}
      />
    );
  if (!data.budgetRows.length)
    return (
      <Empty
        title="Бұл жылға бюджет табылмады"
        text={data.metadata.file.startsWith("PostgreSQL")
          ? "Бұл кезеңге бекітілген бюджет немесе оны қолдану ережесі табылмады."
          : "2026, 2024 және 2023 жылғы бюджет парақтары енгізілген. 2025 жылғы жеке бюджет парағы файлда жоқ."}
        navigate={navigate}
      />
    );
  return (
    <>
      <div className="panel report-panel">
        <div className="panel-head table-top">
          <div>
            <h2>
              {t("Шығыстар бюджеті")} · {periodLabel(data)}
            </h2>
            <p>
              {t(
                "Ауытқу = факт − жоспар. Шығыстың артуы қоңыр түспен көрсетілген.",
              )}
            </p>
          </div>
          <span className="subtle">{t("теңге · 2 ондық белгі")}</span>
        </div>
        <div className="table-wrap">
          <table className="table report-table wb-budget">
            <thead>
              <tr>
                <th>{t("Бап")}</th>
                <th className="num">{t("Факт")}</th>
                <th className="num">{t("Жоспар")}</th>
                <th className="num">{t("Ауытқу, ₸")}</th>
                <th className="num">{t("Орындалуы")}</th>
              </tr>
            </thead>
            <tbody>
              {data.budgetRows.map((r) => {
                const delta =
                  r.actual == null || r.plan == null ? null : r.actual - r.plan;
                return (
                  <tr
                    key={r.id}
                    className={`${r.total ? "total" : ""} clickable`}
                    data-wb-budget={r.id}
                    onClick={() => onBudget(r.id)}
                  >
                    <td>
                      {r.display}
                      {r.plan != null && r.plan > 0 && r.plan < 1 && (
                        <small className="cell-note negative">
                          {t(data.metadata.file.startsWith("PostgreSQL")
                            ? "Бекітілген жоспардағы сома"
                            : "Бастапқы файлда 0,1 ₸")}
                        </small>
                      )}
                    </td>
                    <td className="num">{format(r.actual)}</td>
                    <td className="num">{format(r.plan)}</td>
                    <td
                      className={`num ${delta != null && delta > 0 ? "negative" : "favorable"}`}
                    >
                      {format(delta)}
                    </td>
                    <td className="num">{percent(ratio(r.actual, r.plan))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <div className="panel report-panel">
        <div className="panel-head table-top">
          <div>
            <h2>
              {data.month.slice(0, 4)} {t("жыл · айлық бюджет")}
            </h2>
            <p>
              {t(
                "Алдағы айлар — жоспар. Факт жоқ айлар «—» болып көрсетіледі.",
              )}
            </p>
          </div>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{t("Ай")}</th>
                <th className="num">{t("Шығыс жоспары")}</th>
                <th className="num">{t("Шығыс фактісі")}</th>
                <th className="num">{t("Ауытқу")}</th>
              </tr>
            </thead>
            <tbody>
              {data.budgetTimeline.map((b) => (
                <tr key={b.month}>
                  <td>
                    <button
                      className="link-button"
                      data-wb-month={b.month}
                      onClick={() =>
                        setFilters({
                          month: b.month,
                          range: "month",
                          channel: "",
                        })
                      }
                    >
                      {t(fullMonths[Number(b.month.slice(5)) - 1])}{" "}
                      {b.actual === null && (
                        <span className="article-tag">{t("Жоспар")}</span>
                      )}
                    </button>
                  </td>
                  <td className="num">{format(b.plan)}</td>
                  <td className="num">{format(b.actual)}</td>
                  <td
                    className={`num ${b.actual != null && b.plan != null && b.actual > b.plan ? "negative" : ""}`}
                  >
                    {b.actual == null || b.plan == null
                      ? "—"
                      : format(b.actual - b.plan)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="method-note">
        <Icon name="info" size={17} />
        <p>
          {t(data.metadata.file.startsWith("PostgreSQL")
            ? "Жоспар бекітілген бюджеттен алынады. Нақты сома тек көрсеткіш дәл сәйкес келгенде көрсетіледі; бап немесе арна бойынша сәйкестік ережесі жоқ болса, факт бос қалады."
            : "Бюджет пен P&L-дің шығыс құрамы бірдей емес: «Возвраты» P&L-де бөлек бар, ал бюджетте жеке жоспар жолы жоқ. Барлық «Тотал» жолдарын бір-біріне қосуға болмайды — олар аралық және жалпы қорытындылар. Әр жолдан бастапқы ұяшықты ашуға болады.")}
        </p>
      </div>
      <SourceFooter data={data} />
    </>
  );
}
export function Operations({ data, onDetail }: ReportContext) {
  const { t } = useI18n();
  const [q, setQ] = useState("");
  const rows = data.details.filter((r) =>
    r.display.toLowerCase().includes(q.toLowerCase()),
  );
  return (
    <>
      <div className="panel report-panel">
        <div className="toolbar">
          <input
            id="wb-search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("Есеп бабын іздеу…")}
            aria-label={t("Есеп бабын іздеу")}
          />
          <span className="subtle">
            {t("Айлық жиынтық баптар · бастапқы операциялар емес")}
          </span>
        </div>
        <div id="wb-detail-table">
          <DetailsTable data={data} rows={rows} onDetail={onDetail} />
        </div>
      </div>
      <SourceFooter data={data} />
    </>
  );
}
const checkLimitationLabels: Record<string, string> = {
  "Balance coverage is missing or ambiguous for the requested date": "Для выбранной даты не подтверждено покрытие данных баланса.",
  "Cash flow coverage is incomplete or splits the requested interval": "Покрытие данных движения денег за выбранный период не подтверждено полностью.",
  "Historical imported budget; not an approved live budget version": "Показан исторический бюджет из исходного файла; это не утверждённый оперативный бюджет.",
  "Previous-year channel revenue is unavailable without matching coverage": "Сравнение каналов с прошлым годом недоступно без подтверждённого покрытия данных.",
};

export function Checks({ data }: ReportContext) {
  const { t } = useI18n();
  return (
    <>
      <div className="check-summary">
        <span className="insight-icon">
          <Icon name="shield" size={24} />
        </span>
        <div>
          <h2>
            {data.checks.length
              ? `${data.checks.length} ${t("тексеру ескертпесі")}`
              : t("Бұл кезеңде сандық айырма анықталмады")}
          </h2>
          <p>
            {t(
              "Қорытындыны баптармен салыстыру, парақтар арасындағы сәйкестік және формула сілтемелері",
            )}
          </p>
        </div>
      </div>
      {!!data.checkLimitations?.length && (
        <div className="panel check-card">
          <h3>{t("Ограничения проверки")}</h3>
          <ul>{data.checkLimitations.map((text) => <li key={text}>{t(checkLimitationLabels[text] ?? text)}</li>)}</ul>
        </div>
      )}
      {data.checks.map((w, i) => (
        <div key={w.id || i} className="panel check-card">
          <div className="check-card-head">
            <span className="status warn">{w.period}</span>
            <h3>{t(w.title)}</h3>
          </div>
          <p>{t(w.detail)}</p>
          <div className="check-values">
            <div>
              <small>{t("Файлдағы сома")}</small>
              <strong>{money(w.reported)}</strong>
            </div>
            <div>
              <small>
                {t(
                  w.kind === "arithmetic"
                    ? "Баптардан есеп"
                    : "Салыстырылатын сома",
                )}
              </small>
              <strong>{money(w.calculated)}</strong>
            </div>
            <div>
              <small>{t("Айырма")}</small>
              <strong className="negative">{money(w.difference)}</strong>
            </div>
          </div>
          <SourceCell source={w} />
        </div>
      ))}
      <div className="method-note">
        <Icon name="info" size={17} />
        <p>
          {t(
            "Негізгі панель Excel-де сақталған мәндерді көрсетеді. Формула қателері мен жіктеу айырмаларын түпнұсқада тексеру керек. Жеке баптардың арифметикалық тексеруі бухгалтерлік есептің толық аудиті емес.",
          )}
        </p>
      </div>
    </>
  );
}
export function Imports({
  data,
  navigate,
  refresh,
}: ReportContext & { refresh: () => Promise<void> }) {
  const { t } = useI18n();
  const imported = data.metadata.importedAt
    ? new Date(data.metadata.importedAt).toLocaleString("ru-RU")
    : "—";
  return (
    <>
      <div className="panel source-file-card">
        <span className="source-file-icon">
          <Icon name="file" size={34} />
        </span>
        <div>
          <span className="eyebrow">{t("БЕЛСЕНДІ ДЕРЕККӨЗ")}</span>
          <h2>{data.metadata.file}</h2>
          <p>
            Excel есебі · KZT · 2023–2026 · {t("соңғы факт")}: {data.latest}
          </p>
          <span className="status">{t("Жүктелген · демо емес")}</span>
        </div>
      </div>
      {data.statements?.balance && (
        <div className="panel settings-card report-panel">
          <h2>{t("Қосылған баланс және ДДС")}</h2>
          <p>
            <b>{data.statements.balance.metadata.file}</b> ·{" "}
            {data.statements.balance.asOfLabel} ·{" "}
            {t("баланс, касса, қор және жеткізушілер расшифровкасы.")}
            <br />
            <b>{data.statements.cashflow?.metadata.file || ""}</b> ·{" "}
            {t("нақты төлем жолдары, баптар және «свод» бақылауы.")}
          </p>
          <button
            className="secondary"
            data-page="balance"
            onClick={() => navigate("balance")}
          >
            {t("Балансты ашу")}
          </button>{" "}
          <button
            className="secondary"
            data-page="cashflow"
            onClick={() => navigate("cashflow")}
          >
            {t("ДДС ашу")}
          </button>
        </div>
      )}
      <div className="settings-grid">
        <div className="panel settings-card">
          <h2>{t("Файлдан алынған деректер")}</h2>
          <p>
            P&L: 2023, 2024, 2025, 2026
            <br />
            {t("Бюджет")}: 2023, 2024, 2026
            <br />
            {t("Сату есебі: 2026, P&L-мен бақылау")}
            <br />
            {t("Сату арналары, өзіндік құн, шығыс баптары")}
            <br />
            {t("Комиссиялар, салықтар, бонустар және өзге кірістер")}
          </p>
        </div>
        <div className="panel settings-card">
          <h2>{t("Толықтыруды қажет ететін деректер")}</h2>
          <p>
            {t("Бастапқы кезеңнің ақша қалдығы")}
            <br />
            {t("ДДС баптарының қызмет түрлері бойынша жіктемесі")}
            <br />
            {t("Дебиторлық берешектің жеке құжаттары")}
            <br />
            {t("Капиталдың құрамдас бөліктері")}
            <br />
            {t("Юрлицалар мен арналар арасындағы байланыс")}
          </p>
        </div>
        <div className="panel settings-card">
          <h2>{t("Деректердің сақталуы")}</h2>
          <p>
            {t(
              "Түпнұсқа Excel өзгертілмеген. Әр санның парағы мен ұяшығы сақталған. Демо деректер бөлек режимде қалдырылған; екі дереккөз қосылмайды.",
            )}
          </p>
          <p>
            {t("Жүктелген уақыт")}: {imported}
          </p>
          <small className="source-hash">SHA-256: {data.metadata.sha256}</small>
        </div>
        <div className="panel settings-card">
          <h2>{t("Есепті жаңарту")}</h2>
          <p>
            {t(
              "«Есеп сандарын түзету» бөлімінде Excel ұяшықтарын өзгертіңіз. «Жаңа ақпарат» бөлімінде кіріс пен шығыс қосыңыз. Өзгерістер журналға жазылады.",
            )}
          </p>
          <button
            className="secondary"
            data-action="refresh-workbook"
            onClick={() => void refresh()}
          >
            <Icon name="refresh" size={14} /> {t("Деректерді қайта оқу")}
          </button>
        </div>
      </div>
      <SourceFooter data={data} />
    </>
  );
}
export function Settings({ data, navigate, setFilters }: ReportContext) {
  const { t } = useI18n();
  return (
    <>
      <div className="settings-grid">
        <div className="panel settings-card">
          <h2>{t("Негізгі есеп дереккөзі")}</h2>
          <p>
            Kitapal · Excel P&L {t("және бюджет")}
            <br />
            {t("Әдепкі кезең")}: 2026 {t("жылғы тамыз")}
            <br />
            {t("Сомалар")}: {t("теңге, екі ондық белгі")}
            <br />
            {t("Жіктеме")}: {t("түпнұсқа файл бойынша")}
          </p>
          <button
            className="secondary"
            data-page="imports"
            onClick={() => navigate("imports")}
          >
            {t("Файл мәліметі")} <Icon name="arrow" size={14} />
          </button>
        </div>
        <div className="panel settings-card">
          <h2>{t("Демо / операциялық режим")}</h2>
          <p>
            {t(
              "Алдыңғы демо операциялары мен енгізілген өзгерістер сақталған. Олар Excel есебіне араласпайды. Осы режимге өтсеңіз, жоғарғы жағында «Демо» белгісі көрсетіледі.",
            )}
          </p>
          <button
            className="secondary"
            data-action="use-ledger"
            onClick={() =>
              navigate("dashboard", {
                source: "ledger",
                month: "2026-09",
                channel: "",
                org: "",
              })
            }
          >
            {t("Демо режимін ашу")} <Icon name="arrow" size={14} />
          </button>
        </div>
      </div>
      <SourceFooter data={data} />
    </>
  );
}
export function Debts({ navigate }: { navigate: ReportActions["navigate"] }) {
  return (
    <Empty
      title="Берешек тізілімі қажет"
      text="Сату арнасының түсімі берешекке тең емес. Контрагент, құжат, төлем, төлем мерзімі және бастапқы қалдықтар берілгеннен кейін берешек есебі жасалады."
      navigate={navigate}
    />
  );
}
