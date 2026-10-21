import { useState } from "react";
import { Icon } from "../../components/ui/icon";
import { useI18n } from "../i18n/provider";
import type { ReportActions } from "../shared/types";
import type {
  BalanceDetail,
  BalanceStatement,
  CashRow,
  CashflowStatement,
  WorkbookData,
} from "./types";
import { compact, format, money } from "./model";
import { SourceCell } from "./report-parts";

export type StatementDetail =
  | { kind: "balance"; id: string }
  | { kind: "cash"; article?: string; replenishment?: boolean };
function Card({
  label,
  value,
  note,
  icon,
}: {
  label: string;
  value: number | null | undefined;
  note: string;
  icon: string;
}) {
  const { t } = useI18n();
  return (
    <div className="kpi">
      <div className="kpi-top">
        {t(label)}
        <Icon name={icon} />
      </div>
      <div className="kpi-value">
        {compact(value)}
        {value != null && <span>{t("млн ₸")}</span>}
      </div>
      <div className="kpi-bottom">{t(note)}</div>
    </div>
  );
}
function Missing({ text }: { text: string }) {
  const { t } = useI18n();
  return (
    <div className="panel unavailable">
      <h2>{t("Деректер жоқ")}</h2>
      <p>{t(text)}</p>
    </div>
  );
}
export function BalancePage({
  data,
  onDetail,
}: {
  data: WorkbookData;
  onDetail: (detail: StatementDetail) => void;
}) {
  const { t } = useI18n(),
    b = data.statements?.balance;
  if (!b) return <Missing text={data.metadata.file.startsWith("PostgreSQL") ? "Бұл күнге расталған бастапқы баланс жоқ." : "Баланс файлы жүктелмеген."} />;
  const relational = b.metadata.file.startsWith("PostgreSQL");
  const v = (id: string) => b.rows.find((r) => r.id === id)?.value;
  return (
    <>
      <div className="method-note">
        <Icon name="calendar" size={18} />
        <p>
          <b>
            {t("Баланс күні")}: {b.asOfLabel}
          </b>{" "}
          · {t("компания бойынша")}.<br />
          {t(relational
            ? "Қалдық расталған бастапқы сәттен және кейінгі қозғалыстардан есептеледі. Расталмаған баптар бос көрсетіледі."
            : "Бұл — 01.09.2026 күнгі бір сәттік қалдық. Жоғарғы ай/арна сүзгілері баланс күнін өзгертпейді. Бастапқы қалдық пен кезең өзгерісі үшін алдыңғы күннің балансы керек.")}
        </p>
      </div>
      <section className="kpi-grid">
        <Card
          label="Активтер"
          value={v("assets")}
          note={relational ? b.asOfLabel : "01.09.2026 күнгі қалдық"}
          icon="balance"
        />
        <Card
          label="Ақша қаражаты"
          value={v("cash")}
          note="банк және касса"
          icon="wallet"
        />
        <Card
          label="Міндеттемелер"
          value={v("liabilities")}
          note="жеткізушілер және қаржы ұйымдары"
          icon="users"
        />
        <Card
          label="Меншікті капитал"
          value={v("equity")}
          note={relational ? "расталған капитал дерегі қажет" : "файлда: активтер − міндеттемелер"}
          icon="chart"
        />
      </section>
      <div className="panel report-panel">
        <div className="panel-head table-top">
          <div>
            <h2>{t("Басқарушылық баланс")}</h2>
            <p>
              {b.metadata.file} ·{" "}
              {t(relational ? "расталған бастапқы қалдық және тіркелген қозғалыстар" : "түпнұсқа C бағаны; қайталанған F бағаны қосылмайды")}
            </p>
          </div>
          <span className="status">{b.asOfLabel}</span>
        </div>
        <div className="table-wrap">
          <table className="table report-table">
            <thead>
              <tr>
                <th>{t("Көрсеткіш")}</th>
                <th className="num">{t("Қалдық, ₸")}</th>
                <th>{t("Дереккөз")}</th>
              </tr>
            </thead>
            <tbody>
              {b.rows.map((r) => (
                <tr
                  key={r.id}
                  className={`${["assets", "liabilities", "equity", "total"].includes(r.id) ? "total" : ""} clickable`}
                  data-statement-detail={`balance:${r.id}`}
                  onClick={() => onDetail({ kind: "balance", id: r.id })}
                >
                  <td>{t(r.label)}</td>
                  <td className="num">{format(r.value)}</td>
                  <td>
                    <SourceCell source={r.source} />{" "}
                    {["cash", "inventory", "fixed", "payables"].includes(
                      r.id,
                    ) && <Icon name="arrow" size={12} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="panel report-panel">
        <div className="panel-head table-top">
          <h2>{t("Сәйкестікті тексеру")}</h2>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{t("Тексеру")}</th>
                <th className="num">{t("Файлда")}</th>
                <th className="num">{t("Қайта есеп")}</th>
                <th className="num">{t("Айырма")}</th>
              </tr>
            </thead>
            <tbody>
              {b.checks.map((c) => (
                <tr key={c.label}>
                  <td>{t(c.label)}</td>
                  <td className="num">{format(c.reported)}</td>
                  <td className="num">{format(c.calculated)}</td>
                  <td
                    className={`num ${Math.abs(c.reported - c.calculated) > 0.02 ? "negative" : ""}`}
                  >
                    {format(c.calculated - c.reported)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="method-note">
        <Icon name="info" size={18} />
        <p>
          {relational ? (
            <><b>{t("Толық баланс әлі расталмаған.")}</b>{" "}
              {t("Тауарлар мен өзге активтердің қозғалысы салыстырылғанға дейін жиынтық пен капитал есептелмейді. Бастапқы құжаттар өзгермейді.")}</>
          ) : (
            <><b>{t("Капитал — файлдағы қалдық формуласы: C19 = C12 − C17.")}</b>{" "}
              {t("Сондықтан баланс теңдігі тәуелсіз тексеру болып саналмайды. Салымдар мен бөлінбеген пайда бөлек берілмеген; P&L пайдасы капиталға қайта қосылмайды.")}
              <br />
              {t("Тауарлар тек «Предоплата» қорынан алынған. «Реализация» қоры осы активке қосылмаған — бастапқы файлдың тәсілі сақталды.")}</>
          )}
        </p>
      </div>
    </>
  );
}
export function CashflowPage({
  data,
  onDetail,
}: {
  data: WorkbookData;
  onDetail: (detail: StatementDetail) => void;
}) {
  const { t } = useI18n(),
    cf = data.statements?.cashflow;
  const relational = data.metadata.file.startsWith("PostgreSQL");
  if (!cf || !cf.available || !cf.totals || !cf.business)
    return (
      <Missing text={relational ? "Бұл кезеңге ақша қозғалысының расталған қамтуы жоқ." : "Бұл кезеңге ДДС фактісі файлдан табылмады. 2026 жылғы тамызды немесе бұрынғы айды таңдаңыз."} />
    );
  const x = cf.business,
    summary = cf.summary,
    delta = summary ? x.inflow - (summary.inflow.value || 0) : null;
  return (
    <>
      <div className="method-note">
        <Icon name="info" size={18} />
        <p>
          <b>{cf.metadata.file}</b> ·{" "}
          {t(cf.range === "ytd" ? "жыл басынан" : "айлық")} ·{" "}
          {t("компания бойынша")}.<br />
          {t(relational
            ? "Төлем күні бойынша PostgreSQL қозғалыстарынан есептелген. Расталған ішкі аударымдар бөлек көрсетіледі. Сатылым арналарының сүзгісі қолданылмайды."
            : "Төлем күні бойынша «База» парағынан есептелген. Сату арнасының сүзгісі ДДС-ке қолданылмайды. «Пополнение_кассы» баптары бөлек көрсетілген; шоттар байланысы берілмегендіктен олардың барлығын расталған ішкі аударым деп есептемейміз.")}
        </p>
      </div>
      <section className="kpi-grid">
        <Card
          label="Түсімдер"
          value={x.inflow}
          note={relational ? "ішкі аударымдарсыз" : "касса толықтыруларынсыз"}
          icon="trend"
        />
        <Card
          label="Төлемдер"
          value={x.outflow}
          note={relational ? "ішкі аударымдарсыз" : "касса толықтыруларынсыз"}
          icon="wallet"
        />
        <Card
          label="Таза ақша қозғалысы"
          value={x.net}
          note={relational ? "ішкі аударымдарсыз" : "касса толықтыруларынсыз"}
          icon="swap"
        />
        <Card
          label="Ақша қалдығы"
          value={cf.closing}
          note={
            cf.closingDate
              ? relational ? `баланс бойынша · ${cf.closingDate}` : "баланс бойынша · 01.09.2026"
              : "осы кезеңге баланс қалдығы жоқ"
          }
          icon="balance"
        />
      </section>
      {summary && delta != null && Math.abs(delta) > 0.02 && (
        <div className="source-warning">
          <Icon name="info" size={18} />
          <span>
            <b>
              {t("«свод» парағымен түсім айырмасы")}: {money(delta)}
            </b>
            <small>
              {t(
                "Бастапқы жолдардағы кіріс пен жиынтық парақ бірдей емес. Негізгі ДДС «База» жолдарынан есептеледі.",
              )}
            </small>
          </span>
        </div>
      )}
      <div className="panel report-panel">
        <div className="panel-head table-top">
          <div>
            <h2>{t("ДДС: бастапқы жолдар мен жиынтық")}</h2>
            <p>
              {t("Теңге")} · {cf.rows.length} {t("бастапқы жазба")} ·{" "}
              {cf.periodMismatchCount} {t("күн/ай сәйкессіздігі")}
            </p>
          </div>
          <button
            className="secondary"
            data-statement-detail="cash:all"
            onClick={() => onDetail({ kind: "cash" })}
          >
            <Icon name="file" size={14} /> {t("Төлем жолдары")}
          </button>
        </div>
        <div className="table-wrap">
          <table className="table report-table">
            <thead>
              <tr>
                <th>{t("Қамтылған операциялар")}</th>
                <th className="num">{t("Кіріс")}</th>
                <th className="num">{t("Шығыс")}</th>
                <th className="num">{t("Таза қозғалыс")}</th>
              </tr>
            </thead>
            <tbody>
              <tr className="total">
                <td>{t(relational ? "Ішкі аударымдарсыз" : "Касса толықтыруларынсыз")}</td>
                <td className="num">{format(x.inflow)}</td>
                <td className="num">{format(x.outflow)}</td>
                <td className="num">{format(x.net)}</td>
              </tr>
              <tr
                className="clickable"
                data-statement-detail="cash:replenishment"
                onClick={() => onDetail({ kind: "cash", replenishment: true })}
              >
                <td>{t(relational ? "Расталған ішкі аударымдар" : "Касса толықтырулары · жіктеу қажет")}</td>
                <td className="num">{format(cf.replenishments.inflow)}</td>
                <td className="num">{format(cf.replenishments.outflow)}</td>
                <td className="num">{format(cf.replenishments.net)}</td>
              </tr>
              <tr className="total">
                <td>{t(relational ? "Барлық ақша қозғалыстары" : "«База» барлық жолдары")}</td>
                <td className="num">{format(cf.totals.inflow)}</td>
                <td className="num">{format(cf.totals.outflow)}</td>
                <td className="num">{format(cf.totals.net)}</td>
              </tr>
              {summary && (
                <>
                  <tr>
                    <td>{t("«свод» парағындағы сақталған қорытынды")}</td>
                    <td className="num">{format(summary.inflow.value)}</td>
                    <td className="num">{format(summary.outflow.value)}</td>
                    <td className="num">{format(summary.net.value)}</td>
                  </tr>
                  <tr>
                    <td>{t("«свод»-пен айырма (толықтырусыз)")}</td>
                    <td className="num negative">
                      {format(x.inflow - (summary.inflow.value || 0))}
                    </td>
                    <td className="num">
                      {format(x.outflow - (summary.outflow.value || 0))}
                    </td>
                    <td className="num negative">
                      {format(x.net - (summary.net.value || 0))}
                    </td>
                  </tr>
                </>
              )}
            </tbody>
          </table>
        </div>
      </div>
      <div className="panel report-panel">
        <div className="panel-head table-top">
          <div>
            <h2>{t("Баптар бойынша қозғалыс")}</h2>
            <p>{t("Бапты басып, төлем күні мен бастапқы жолын ашыңыз")}</p>
          </div>
        </div>
        <div className="table-wrap">
          <table className="table report-table">
            <thead>
              <tr>
                <th>{t("Бап")}</th>
                <th className="num">{t("Кіріс")}</th>
                <th className="num">{t("Шығыс")}</th>
                <th className="num">{t("Нетто")}</th>
              </tr>
            </thead>
            <tbody>
              {cf.articles.map((r) => (
                <tr
                  key={r.article}
                  className={`${r.cashReplenishment ? "row-review" : ""} clickable`}
                  data-statement-detail={`article:${encodeURIComponent(r.article)}`}
                  onClick={() => onDetail({ kind: "cash", article: r.article })}
                >
                  <td style={{ whiteSpace: "normal" }}>
                    {r.article.replaceAll("_", " ")}
                    {r.cashReplenishment && (
                      <small className="cell-note">
                        {t("Бөлек жіктеледі")}
                      </small>
                    )}
                  </td>
                  <td className="num">{format(r.inflow)}</td>
                  <td className="num">{format(r.outflow)}</td>
                  <td className="num">{format(r.inflow - r.outflow)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="panel report-panel">
        <div className="panel-head table-top">
          <h2>{t("Күндер бойынша қозғалыс")}</h2>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{t("Күн")}</th>
                <th className="num">{t("Кіріс")}</th>
                <th className="num">{t("Шығыс")}</th>
                <th className="num">{t("Нетто")}</th>
              </tr>
            </thead>
            <tbody>
              {cf.daily.map((r) => (
                <tr key={r.date}>
                  <td>{r.date}</td>
                  <td className="num">{format(r.inflow)}</td>
                  <td className="num">{format(r.outflow)}</td>
                  <td className="num">{format(r.inflow - r.outflow)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="method-note">
        <Icon name="shield" size={18} />
        <p>
          <b>{t("Ақша қалдығының салыстыруы аяқталмаған.")}</b>{" "}
          {t(relational
            ? "Бастапқы қалдық расталмаған болса, кезең соңындағы қалдық бос қалады. Ақша қозғалыстары бастапқы қалдықты алмастырмайды."
            : "Кезең басындағы тәуелсіз ақша қалдығы файлдарда жоқ. Сондықтан «басы + қозғалыс = соңы» теңдігі расталды деп көрсетілмейді және бастапқы қалдық кері есептеліп факт ретінде берілмейді.")}
          <br />
          {t(
            "Операциялық / инвестициялық / қаржылық қызмет топтары үшін баптар жіктемесін бекіту қажет. Бұл бет бастапқы баптар мен нақты қозғалыстарды көрсетеді.",
          )}
        </p>
      </div>
    </>
  );
}
export function StatementDetailView({
  data,
  detail,
}: {
  data: WorkbookData;
  detail: StatementDetail;
}) {
  const { t } = useI18n();
  const [q, setQ] = useState("");
  if (detail.kind === "balance") {
    const b = data.statements?.balance;
    if (!b) return null;
    const relational = b.metadata.file.startsWith("PostgreSQL");
    const row = b.rows.find((r) => r.id === detail.id);
    if (!row) return null;
    const sets: Record<string, BalanceDetail[]> = {
        cash: b.cashAccounts,
        fixed: b.assetGroups,
        payables: b.suppliers,
        inventory: b.inventory.filter((r) => r.contract === "Предоплата"),
      },
      rows = sets[detail.id],
      filtered =
        rows?.filter((r) =>
          [r.label, r.sku, r.publisher].some((v) =>
            String(v || "")
              .toLowerCase()
              .includes(q.toLowerCase()),
          ),
        ) || [],
      sum = rows?.reduce((s, r) => s + (r.value || 0), 0);
    return (
      <>
        <p className="note">
          {money(row.value)} · {b.metadata.file} ·{" "}
          <SourceCell source={row.source} />
          <br />
          {row.source.formula
            ? `${t("Формула")}: ${row.source.formula}`
            : t(relational ? "Дерекқордағы мән" : "Файлда сақталған мән")}
          {detail.id === "inventory" && !relational && (
            <>
              <br />
              {t("Тек «Предоплата» қоры. «Реализация» бөлек қалады.")}
            </>
          )}
        </p>
        {rows && (!relational || rows.length > 0) ? (
          <>
            <p className="note">
              {t("Расшифровка жолдарының қосындысы")}: {money(sum)} ·{" "}
              {t(relational ? "Жиынтықпен айырма" : "Файл қорытындысымен айырма")}:{" "}
              {money((sum || 0) - (row.value || 0))}
            </p>
            <input
              id="statement-search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t("Бап / тауар / жеткізуші іздеу…")}
              aria-label={t("Расшифровкадан іздеу")}
              style={{ width: "100%", marginBottom: 15 }}
            />
            <div id="statement-table" className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>{t("Бап / атау")}</th>
                    <th className="num">{t("Сома, ₸")}</th>
                    <th>{t("Дереккөз")}</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.slice(0, 200).map((r, i) => (
                    <tr key={`${r.source.cell}-${i}`}>
                      <td style={{ whiteSpace: "normal" }}>
                        {r.label}
                        {r.sku && (
                          <small className="cell-note">
                            {r.sku} · {r.quantity ?? "—"} {t("дана")} ·{" "}
                            {r.publisher}
                          </small>
                        )}
                      </td>
                      <td className="num">{format(r.value)}</td>
                      <td>
                        <SourceCell source={r.source} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="note">
              {Math.min(200, filtered.length)} / {filtered.length} {t("жазба")}.{" "}
              {t("Іздеу барлық жазбаларды қамтиды.")}
            </p>
          </>
        ) : (
          <p className="note">
            {t(relational ? "Бұл баптың толық егжей-тегжейі әлі салыстырылмаған." : "Бұл бап бойынша жеке құжаттар тізілімі файлда берілмеген.")}
          </p>
        )}
      </>
    );
  }
  const cf = data.statements?.cashflow;
  if (!cf) return null;
  const rows = detail.replenishment
    ? cf.rows.filter((r) => r.cashReplenishment)
    : detail.article
      ? cf.rows.filter((r) => r.article === detail.article)
      : cf.rows;
  const filtered = rows.filter((r) =>
    [r.date, r.article, r.note, r.author, r.responsible].some((v) =>
      String(v || "")
        .toLowerCase()
        .includes(q.toLowerCase()),
    ),
  );
  return (
    <>
      <p className="note">
        {cf.metadata.file} · «База» {t("парағы")} · {rows.length} {t("жазба")}
      </p>
      <input
        id="statement-search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={t("Күн, бап немесе түсініктеме іздеу…")}
        aria-label={t("Төлем іздеу")}
        style={{ width: "100%", marginBottom: 15 }}
      />
      <div id="statement-table" className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>{t("Күн / дереккөз")}</th>
              <th>{t("Бап / түсініктеме")}</th>
              <th className="num">{t("Кіріс")}</th>
              <th className="num">{t("Шығыс")}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, 200).map((r) => (
              <tr key={r.id}>
                <td>
                  {r.date}
                  <br />
                  <SourceCell source={r.source} />
                </td>
                <td style={{ whiteSpace: "normal", minWidth: 170 }}>
                  {r.article}
                  <small className="cell-note">{r.note}</small>
                </td>
                <td className="num">{format(r.inflow)}</td>
                <td className="num">{format(r.outflow)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="note">
        {Math.min(200, filtered.length)} / {filtered.length}{" "}
        {t("жол көрсетілді. Іздеу барлық жолдарды қамтиды.")}
      </p>
    </>
  );
}
export function statementTitle(data: WorkbookData, detail: StatementDetail) {
  if (detail.kind === "cash") return "Ақша қозғалысының бастапқы жолдары";
  return (
    data.statements?.balance?.rows.find((r) => r.id === detail.id)?.label ||
    "Баланс"
  );
}
