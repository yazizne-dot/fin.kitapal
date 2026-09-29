import type { ExportCell } from "../shared/types";
import type { MetricKey, SourceRef, WorkbookData } from "./types";

export const metricLabels: Record<MetricKey, string> = {
  revenue: "Сатудан түскен түсім",
  cost: "Өнімнің өзіндік құны",
  gross: "Жалпы пайда",
  opex: "Операциялық шығыстар",
  operatingProfit: "Операциялық пайда",
  otherExpense: "Өзге шығыстар",
  taxes: "Салықтар",
  bonuses: "Дистрибьюторларға ретро-бонустар",
  otherIncome: "Өзге кірістер",
  profit: "Таза пайда / залал",
  dividends: "Құрылтайшыларға төлемдер",
  retained: "Бөлінбеген пайда / залал",
};
export const metricKeys = Object.keys(metricLabels) as MetricKey[];
export const fullMonths = [
  "Қаңтар",
  "Ақпан",
  "Наурыз",
  "Сәуір",
  "Мамыр",
  "Маусым",
  "Шілде",
  "Тамыз",
  "Қыркүйек",
  "Қазан",
  "Қараша",
  "Желтоқсан",
];
export const shortMonths = [
  "Қаң",
  "Ақп",
  "Нау",
  "Сәу",
  "Мам",
  "Мау",
  "Шіл",
  "Там",
  "Қыр",
  "Қаз",
  "Қар",
  "Жел",
];
export const format = (n: number | null | undefined) =>
  n == null
    ? "—"
    : new Intl.NumberFormat("ru-RU", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(n);
export const compact = (n: number | null | undefined) =>
  n == null
    ? "—"
    : new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(
        n / 1e6,
      );
export const percent = (n: number | null | undefined) =>
  n == null || !Number.isFinite(n)
    ? "—"
    : new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(n) +
      "%";
export const money = (n: number | null | undefined) =>
  n == null ? "—" : format(n) + " ₸";
export const ratio = (
  a: number | null | undefined,
  b: number | null | undefined,
) => (a == null || b == null || b === 0 ? null : (a / b) * 100);
export const change = (
  a: number | null | undefined,
  b: number | null | undefined,
) => (a == null || b == null || b === 0 ? null : ((a - b) / Math.abs(b)) * 100);
export function periodLabel(d: {
  month: string;
  range: "month" | "ytd";
  actualThrough?: string | null;
}) {
  const month =
    fullMonths[
      Number((d.actualThrough || d.month).slice(5)) - 1
    ]?.toLowerCase() || "";
  return d.range === "ytd"
    ? `${d.month.slice(0, 4)} · қаңтар–${month}`
    : `${fullMonths[Number(d.month.slice(5)) - 1]} ${d.month.slice(0, 4)}`;
}
export function sourceRows(rows: SourceRef[]): ExportCell[][] {
  return [
    ["Кезең / ұяшық", "Мәні", "Формула / ескертпе"],
    ...rows.map((r) => [
      [r.period, r.sheet + "!" + r.cell].filter(Boolean).join(" · "),
      r.value ?? "—",
      r.formula
        ? "=" + r.formula
        : r.formulaOrigin
          ? `Ортақ формула негізі: ${r.formulaOrigin.cell} =${r.formulaOrigin.formula || ""}`
          : "Файлда сақталған мән",
    ]),
  ];
}
const sourceList = (refs: SourceRef[]) =>
  refs.map((s) => `${s.sheet}!${s.cell}`).join("; ");
export function workbookExportRows(
  page: string,
  d: WorkbookData,
): ExportCell[][] {
  const balance = d.statements?.balance,
    cf = d.statements?.cashflow;
  if (page === "balance" && balance)
    return [
      ["Дереккөз", balance.metadata.file],
      ["Баланс күні", balance.asOfLabel],
      ["Ескерту", "Капитал = активтер − міндеттемелер; тәуелсіз бақылау емес"],
      [],
      ["Көрсеткіш", "Қалдық, KZT", "Дереккөз"],
      ...balance.rows.map((r) => [
        r.label,
        r.value ?? "—",
        `${r.source.sheet}!${r.source.cell}`,
      ]),
    ];
  if (page === "cashflow" && cf)
    return [
      ["Дереккөз", cf.metadata.file],
      ["Кезең", cf.month, cf.range],
      ["Ескерту", "Касса толықтырулары бөлек, бастапқы қалдық белгісіз"],
      [],
      ["Бап", "Кіріс", "Шығыс", "Таза қозғалыс"],
      ...cf.articles.map((r) => [
        r.article,
        r.inflow,
        r.outflow,
        r.inflow - r.outflow,
      ]),
      [],
      [
        "Барлық жолдар",
        cf.totals?.inflow ?? "—",
        cf.totals?.outflow ?? "—",
        cf.totals?.net ?? "—",
      ],
      [
        "Толықтырусыз",
        cf.business?.inflow ?? "—",
        cf.business?.outflow ?? "—",
        cf.business?.net ?? "—",
      ],
      [],
      ["Күн", "Бап", "Кіріс", "Шығыс", "Дереккөз"],
      ...cf.rows.map((r) => [
        r.date,
        r.article,
        r.inflow,
        r.outflow,
        `${r.source.sheet}!${r.source.cell}`,
      ]),
    ];
  const meta: ExportCell[][] = [
    ["Дереккөз", d.metadata.file],
    ["Кезең", periodLabel(d)],
    ["Кесінді", d.channel || "Барлық арналар"],
    ["Әдіс", d.metadata.method],
    ["Ақша өлшемі", "KZT, теңге"],
    [],
  ];
  let rows: ExportCell[][];
  if (page === "plans")
    rows = [
      ["Бап", "Факт", "Жоспар", "Ауытқу", "Парақ / жоспар ұяшығы"],
      ...d.budgetRows.map((r) => [
        r.label,
        r.actual ?? "—",
        r.plan ?? "—",
        r.actual == null || r.plan == null ? "—" : r.actual - r.plan,
        sourceList(r.sources.map((s) => s.plan)),
      ]),
    ];
  else if (page === "analytics")
    rows = [
      [
        "Арна",
        "Түсім",
        "Өзіндік құн",
        "Жалпы пайда",
        "Өткен жыл түсімі",
        "Дереккөз",
      ],
      ...d.channels
        .filter((r) => !d.channel || r.id === d.channel)
        .map((r) => [
          r.label,
          r.revenue ?? "—",
          r.cost ?? "—",
          r.gross ?? "—",
          r.previousRevenue ?? "—",
          sourceList(r.sources),
        ]),
    ];
  else if (page === "operations")
    rows = [
      ["Бап", "Топ", "Факт", "Дереккөз"],
      ...d.details.map((r) => [
        r.label,
        metricLabels[r.group],
        r.value ?? "—",
        sourceList(r.sources),
      ]),
    ];
  else if (page === "checks")
    rows = [
      ["Кезең", "Тексеру", "Файл", "Салыстыру", "Айырма", "Ұяшық", "Ескертпе"],
      ...d.checks.map((r) => [
        r.period,
        r.title,
        r.reported ?? "—",
        r.calculated ?? "—",
        r.difference ?? "—",
        `${r.sheet}!${r.cell}`,
        r.detail,
      ]),
    ];
  else if (page === "debts")
    rows = [["Мәртебе", "Бастапқы файлда осы есепке жеткілікті дерек жоқ"]];
  else
    rows = [
      [
        "Көрсеткіш",
        "Excel қорытындысы",
        "Баптардан қайта есеп",
        "Өткен жыл",
        "Дереккөз",
      ],
      ...metricKeys
        .filter(
          (key) => !d.channel || ["revenue", "cost", "gross"].includes(key),
        )
        .map((key) => [
          metricLabels[key],
          d.report[key] ?? "—",
          d.recalculated?.[key] ?? "—",
          d.previous?.[key] ?? "—",
          sourceList(d.refs[key] || []),
        ]),
    ];
  return [
    ...meta,
    ...rows,
    [],
    [
      "Ескерту",
      "Демо операциялары бұл есепке қосылмаған. Сақталған мәндер мен қайта есеп айырмасын тексеріңіз.",
    ],
  ];
}
