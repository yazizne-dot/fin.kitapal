"use client";
import { useState, type FormEvent, type ReactNode } from "react";
import { Modal } from "../../components/ui/modal";
import { Icon } from "../../components/ui/icon";
import { useI18n } from "../i18n/provider";
import { downloadFile } from "../shared/download";
import type { LedgerData, LedgerOperation } from "./types";
import { nextPlanDate, pnlRows } from "./format";
import { OperationsTable } from "./widgets";

export type DialogKind =
  | "operation"
  | "plan"
  | "budget"
  | "period"
  | "import"
  | "drill"
  | "document"
  | "correction"
  | "guide"
  | null;
export interface DialogState {
  kind: DialogKind;
  operation?: LedgerOperation;
  rows?: LedgerOperation[];
  title?: string;
}
export interface ImportResult {
  added: number;
  duplicates: number;
  errors: { row: number; message: string }[];
}
export interface DialogProps {
  dialog: DialogState;
  data: LedgerData;
  month: string;
  org: string;
  onClose: () => void;
  submit: (
    path: string,
    body: Record<string, unknown>,
    method?: string,
  ) => Promise<unknown>;
  refresh: () => Promise<void>;
  onCorrect: (operation: LedgerOperation) => void;
}

export function parseCSV(text: string): Record<string, unknown>[] {
  text = text.replace(/^\uFEFF/, "");
  const delimiter = text.split("\n")[0].includes(";") ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (char === delimiter && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = "";
    } else cell += char;
  }
  if (quoted) throw Error("CSV: жабылмаған тырнақша");
  row.push(cell);
  if (row.some(Boolean)) rows.push(row);
  if (!rows.length) throw Error("Файл бос");
  const headers = rows.shift()!.map((value) => value.trim());
  for (const required of [
    "external_id",
    "source",
    "date",
    "org",
    "document",
    "kind",
    "amount",
  ])
    if (!headers.includes(required)) throw Error(`Баған жоқ: ${required}`);
  return rows.map((values) => {
    if (values.length !== headers.length)
      throw Error("CSV жолындағы баған саны сәйкес емес");
    const result = Object.fromEntries(
      headers.map((key, index) => [key, values[index].trim()]),
    );
    return {
      ...result,
      amount: Number(result.amount),
      cost: Number(result.cost || 0),
    };
  });
}
const template = [
  [
    "external_id",
    "source",
    "date",
    "org",
    "point",
    "counterparty",
    "document",
    "kind",
    "amount",
    "cost",
    "due",
    "article",
  ],
  [
    "my-sale-001",
    "my-accounting",
    "2026-09-28",
    "Qalam Books",
    "Алматы",
    "Жаңа клиент",
    "SALE-001",
    "sale",
    150000,
    75000,
    "2026-10-10",
    "Кітап сату",
  ],
];
export function downloadTemplate() {
  const text =
    "\uFEFF" +
    template
      .map((row) =>
        row
          .map((value) => {
            let item = String(value);
            if (/^[=+@\-]/.test(item) && typeof value !== "number")
              item = "'" + item;
            return `"${item.replaceAll('"', '""')}"`;
          })
          .join(";"),
      )
      .join("\r\n");
  downloadFile(
    new Blob([text], { type: "text/csv;charset=utf-8" }),
    "qarzhy-import-template.csv",
  );
}

export function LedgerDialog({
  dialog,
  data,
  month,
  org,
  onClose,
  submit,
  refresh,
  onCorrect,
}: DialogProps) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [result, setResult] = useState<ImportResult | null>(null),
    [file, setFile] = useState<File | null>(null);
  if (!dialog.kind) return null;
  const title =
    dialog.title ||
    (
      {
        operation: "Жаңа операция",
        plan: "Жоспарлы оқиға",
        budget: "ОПиУ бюджетін енгізу",
        period: data.closed ? "Кезеңді қайта ашу" : "Кезеңді жабу",
        import: "CSV деректерін жүктеу",
        drill: "Операциялар расшифровкасы",
        document: "Операциялар",
        correction: "Операцияны түзету",
        guide: "Қысқаша нұсқаулық",
      } as Record<string, string>
    )[dialog.kind];
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget),
      values = Object.fromEntries(form) as Record<string, string>;
    try {
      if (dialog.kind === "operation")
        await submit("/api/operations", {
          ...values,
          amount: Number(values.amount),
          cost: Number(values.cost),
          external_id: crypto.randomUUID(),
          source: "manual",
        });
      if (dialog.kind === "correction")
        await submit("/api/correction", {
          id: dialog.operation!.id,
          amount: Number(values.amount),
          cost: Number(values.cost),
          reason: values.reason,
        });
      if (dialog.kind === "budget")
        await submit("/api/budget", {
          month,
          org: values.org,
          metric: values.metric,
          amount: Number(values.amount),
        });
      if (dialog.kind === "plan")
        await submit("/api/plans", {
          date: values.date,
          org: values.org,
          article: values.article,
          direction: values.direction,
          amount: Number(values.amount),
        });
      if (dialog.kind === "period")
        await submit("/api/period", {
          month,
          closed: !data.closed,
          reason: values.reason || "",
        });
      if (dialog.kind === "import") {
        if (!file) throw Error("CSV файлын таңдаңыз");
        if (file.size > 2000000)
          throw Error("Файл көлемі 2 MB-тан аспауы керек");
        const rows = parseCSV(await file.text());
        const outcome = (await submit("/api/import", { rows })) as ImportResult;
        setResult(outcome);
        await refresh();
        return;
      }
      await refresh();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Қате пайда болды");
    } finally {
      setBusy(false);
    }
  }
  const input = (
    name: string,
    label: string,
    props: Record<string, unknown> = {},
  ): ReactNode => (
    <label key={name} className={props.className as string | undefined}>
      {t(label)}
      <input name={name} {...props} className={undefined} />
    </label>
  );
  const selection = (
    name: string,
    label: string,
    choices: [string, string][],
    initial?: string,
  ): ReactNode => (
    <label key={name}>
      {t(label)}
      <select name={name} defaultValue={initial}>
        {choices.map(([value, label]) => (
          <option key={value} value={value}>
            {t(label)}
          </option>
        ))}
      </select>
    </label>
  );
  let content: ReactNode;
  if (dialog.kind === "drill" || dialog.kind === "document")
    content = (
      <>
        <p className="note">{t(`${(dialog.rows || []).length} операция`)}</p>
        <OperationsTable
          data={data}
          rows={dialog.rows || []}
          onCorrect={onCorrect}
        />
      </>
    );
  else if (dialog.kind === "guide")
    content = (
      <div className="note">
        <h3>1. {t("Кезең мен ұйымды таңдаңыз")}</h3>
        <p>
          {t(
            "Шолудағы барлық көрсеткіштер таңдалған сүзгілер бойынша қайта есептеледі.",
          )}
        </p>
        <h3>2. {t("Деректерді жүктеңіз")}</h3>
        <p>
          {t(
            "CSV үлгісін алып, банк, касса, сату және сатып алу операцияларын жүктеңіз.",
          )}
        </p>
        <h3>3. {t("Тексеріңіз және жоспарлаңыз")}</h3>
        <p>
          {t(
            "Баланс теңдігін, ДДС қалдығын және мерзімі өткен берешекті тексеріңіз.",
          )}
        </p>
      </div>
    );
  else
    content = (
      <form
        id={
          (
            {
              operation: "operation-form",
              correction: "correction-form",
              budget: "budget-form",
              plan: "plan-form",
              period: "period-form",
              import: "import-form",
            } as Record<string, string>
          )[dialog.kind]
        }
        onSubmit={handleSubmit}
      >
        {dialog.kind === "operation" && (
          <>
            <div className="form-grid">
              {input("date", "Күні", {
                type: "date",
                defaultValue: `${month}-28`,
                required: true,
              })}
              {selection("kind", "Операция түрі", Object.entries(data.kinds))}
              {selection(
                "org",
                "Ұйым",
                data.orgs.map((item) => [item, item]),
                org,
              )}
              {input("point", "Нүкте", { placeholder: "Алматы" })}
              {input("amount", "Сома, ₸", {
                type: "number",
                min: 1,
                step: 1,
                required: true,
              })}
              {input("cost", "Сатылған тауардың өзіндік құны, ₸", {
                type: "number",
                min: 0,
                step: 1,
                defaultValue: 0,
              })}
              {input("counterparty", "Контрагент", { required: true })}
              {input("document", "Құжат нөмірі", {
                required: true,
                placeholder: "SALE-001",
              })}
              {input("article", "Бап", { required: true })}
              {input("due", "Төлем мерзімі", { type: "date" })}
            </div>
            <p className="note">
              {t(
                "Төлемді берешекпен байланыстыру үшін бастапқы сатудың немесе сатып алудың құжат нөмірін көрсетіңіз.",
              )}
            </p>
          </>
        )}
        {dialog.kind === "correction" && (
          <>
            <p className="note">
              {dialog.operation?.document} · {dialog.operation?.date} ·{" "}
              {dialog.operation?.org}
            </p>
            <div className="form-grid">
              {input("amount", "Сома, ₸", {
                type: "number",
                min: 1,
                step: 1,
                required: true,
                defaultValue: dialog.operation?.amount,
              })}
              {input("cost", "Өзіндік құн, ₸", {
                type: "number",
                min: 0,
                step: 1,
                required: true,
                defaultValue: dialog.operation?.cost,
              })}
              {input("reason", "Түзету себебі", {
                required: true,
                className: "wide",
              })}
            </div>
          </>
        )}
        {dialog.kind === "budget" && (
          <>
            <p className="note">
              {month} {t("кезеңі. Өзгеріс журналға жазылады.")}
            </p>
            <div className="form-grid">
              {selection(
                "org",
                "Ұйым",
                data.orgs.map((item) => [item, item]),
                org,
              )}
              {selection(
                "metric",
                "Бап",
                pnlRows
                  .filter((row) =>
                    ["revenue", "cost", "opex", "depreciation", "tax"].includes(
                      row[0],
                    ),
                  )
                  .map(([key, label]) => [key, label]),
              )}
              {input("amount", "Жоспар, ₸", {
                type: "number",
                min: 0,
                step: 1,
                required: true,
              })}
            </div>
          </>
        )}
        {dialog.kind === "plan" && (
          <div className="form-grid">
            {input("date", "Күні", {
              type: "date",
              defaultValue: nextPlanDate(data),
              required: true,
            })}
            {selection(
              "org",
              "Ұйым",
              data.orgs.map((item) => [item, item]),
            )}
            {selection("direction", "Бағыты", [
              ["in", "Күтілетін түсім"],
              ["out", "Күтілетін төлем"],
            ])}
            {input("amount", "Сома, ₸", {
              type: "number",
              min: 1,
              step: 1,
              required: true,
            })}
            {input("article", "Бап / сипаттама", { required: true })}
          </div>
        )}
        {dialog.kind === "period" && (
          <>
            <p className="note">
              {month}{" "}
              {t(
                data.closed
                  ? "кезеңі қайта ашылады. Себебін жазыңыз."
                  : "кезеңі жабылады. Осы кезеңге жаңа операциялар енгізу бұғатталады.",
              )}
            </p>
            {data.closed &&
              input("reason", "Қайта ашу себебі", { required: true })}
          </>
        )}
        {dialog.kind === "import" && (
          <>
            <p className="note">
              {t(
                "Қайталанған ID өткізіледі. Қате жолдар импорт нәтижесінде көрсетіледі.",
              )}
            </p>
            <div className="upload-zone">
              <Icon name="upload" size={30} />
              <p>{t("UTF-8 CSV файлын таңдаңыз (үтір немесе нүктелі үтір)")}</p>
              <input
                id="csv-file"
                type="file"
                accept=".csv,text/csv"
                aria-label={t("CSV файл")}
                onChange={(event) => setFile(event.target.files?.[0] || null)}
              />
              <p>
                <button
                  type="button"
                  className="link-button"
                  onClick={downloadTemplate}
                >
                  {t("Деректер үлгісін жүктеу")}
                </button>
              </p>
            </div>
            {result && (
              <div id="import-result" className="import-result">
                <p>
                  <b>{result.added}</b> {t("қосылды")} ·{" "}
                  <b>{result.duplicates}</b> {t("қайталанған")} ·{" "}
                  <b>{result.errors.length}</b> {t("қате")}
                </p>
                {result.errors.map((item) => (
                  <div className="error-message" key={item.row}>
                    {item.row}-{t("жол")}: {item.message}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
        {error && (
          <div className="error-message" role="alert">
            {t(error)}
          </div>
        )}
        <div className="form-actions">
          <button type="button" className="secondary" onClick={onClose}>
            {t("Бас тарту")}
          </button>
          <button
            className="primary"
            data-action={dialog.kind === "import" ? "run-import" : undefined}
            type="submit"
            disabled={busy}
          >
            {t(
              busy
                ? "Жүктелуде…"
                : dialog.kind === "import"
                  ? "Жүктеу және тексеру"
                  : "Сақтау",
            )}
          </button>
        </div>
      </form>
    );
  return (
    <Modal title={title} onClose={onClose}>
      {content}
    </Modal>
  );
}
