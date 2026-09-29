import type {
  LedgerAmounts,
  LedgerData,
  LedgerOperation,
  LedgerPlan,
} from "./types";

export const number = (value: number | undefined) =>
  new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(
    value || 0,
  );
export const money = (value: number | undefined) => `${number(value)} ₸`;
export const million = (value: number | undefined) =>
  (Number(value || 0) / 1e6).toLocaleString("ru-RU", {
    maximumFractionDigits: 2,
  });
export const percent = (value: number, base: number) =>
  base
    ? `${(((value - base) / Math.abs(base)) * 100).toFixed(1).replace(".", ",")}%`
    : "—";
export const privileged = (role: string) =>
  role === "admin" || role === "finance";
export const monthNames = [
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
export const pnlRows: [string, string, boolean?][] = [
  ["revenue", "Түсім"],
  ["cost", "Сатылған тауардың өзіндік құны"],
  ["gross", "Жалпы пайда", true],
  ["opex", "Операциялық шығыстар"],
  ["ebitda", "EBITDA", true],
  ["depreciation", "Амортизация"],
  ["pretax", "Салыққа дейінгі пайда", true],
  ["tax", "Есептелген салық"],
  ["profit", "Таза пайда", true],
];
export const balanceRows: [string, string, boolean?][] = [
  ["assets", "АКТИВТЕР", true],
  ["cash", "Ақша қаражаты"],
  ["receivables", "Дебиторлық берешек"],
  ["inventory", "Тауар қоры"],
  ["fixed", "Негізгі құралдар (таза)"],
  ["liabilities", "МІНДЕТТЕМЕЛЕР", true],
  ["payables", "Кредиторлық берешек"],
  ["taxes", "Есептелген салықтар"],
  ["loans", "Кредиттер мен қарыздар"],
  ["equity", "КАПИТАЛ", true],
  ["capital", "Құрылтайшылар салымдары"],
  ["profit", "Жинақталған пайда, ағымдағы кезеңмен бірге"],
];
export const drillKinds: Record<string, string[]> = {
  revenue: ["sale", "return"],
  cost: ["sale", "return"],
  gross: ["sale", "return"],
  opex: ["expense"],
  ebitda: ["sale", "return", "expense"],
  depreciation: ["depreciation"],
  pretax: ["sale", "return", "expense", "depreciation"],
  tax: ["tax"],
  profit: ["sale", "return", "expense", "depreciation", "tax"],
  cash: [
    "receipt",
    "supplier_payment",
    "expense_payment",
    "tax_payment",
    "capital",
    "loan",
    "loan_payment",
    "asset",
  ],
  receivables: ["sale", "return", "receipt"],
  inventory: ["purchase", "sale", "return"],
  fixed: ["asset", "depreciation"],
  payables: ["purchase", "expense", "supplier_payment", "expense_payment"],
  taxes: ["tax", "tax_payment"],
  loans: ["loan", "loan_payment"],
  capital: ["capital"],
};
export function budgetValue(
  data: LedgerData,
  org: string,
  key: string,
): number | null {
  const orgs = org ? [org] : data.orgs;
  const base = (metric: string) => {
    const rows = data.budget.filter((row) => row.metric === metric);
    return orgs.every((item) => rows.some((row) => row.org === item))
      ? rows.reduce((sum, row) => sum + row.amount, 0)
      : null;
  };
  const formula: Record<string, string[]> = {
    gross: ["revenue", "cost"],
    ebitda: ["revenue", "cost", "opex"],
    pretax: ["revenue", "cost", "opex", "depreciation"],
    profit: ["revenue", "cost", "opex", "depreciation", "tax"],
  };
  if (!formula[key]) return base(key);
  const values = formula[key].map(base);
  return values.some((value) => value === null)
    ? null
    : (values[0] as number) -
        values.slice(1).reduce<number>((sum, value) => sum + (value || 0), 0);
}
export function forecast(data: LedgerData) {
  const start = new Date(`${data.end}T00:00:00Z`);
  let value = data.balance.cash,
    min = value;
  let gap: string | null = null;
  const points: { date: string; value: number }[] = [{ date: data.end, value }];
  for (let i = 1; i <= 30; i++) {
    const date = new Date(start.getTime() + i * 86400000)
      .toISOString()
      .slice(0, 10);
    for (const plan of data.plans.filter((p) => p.date === date))
      value += plan.direction === "in" ? plan.amount : -plan.amount;
    min = Math.min(min, value);
    if (value < 0 && !gap) gap = date;
    points.push({ date, value });
  }
  return {
    points,
    min,
    gap,
    hasPlans: data.plans.some(
      (plan) => plan.date > data.end && plan.date <= points[30].date,
    ),
  };
}
export function orgRows(data: LedgerData, selected: string) {
  return data.orgs
    .filter((org) => !selected || org === selected)
    .map((org) => {
      const ops = data.operations.filter((operation) => operation.org === org);
      const revenue = ops.reduce(
          (sum, o) =>
            sum +
            (o.kind === "sale"
              ? o.amount
              : o.kind === "return"
                ? -o.amount
                : 0),
          0,
        ),
        cost = ops.reduce(
          (sum, o) =>
            sum +
            (o.kind === "sale" ? o.cost : o.kind === "return" ? -o.cost : 0),
          0,
        );
      return { org, revenue, gross: revenue - cost };
    });
}
export function filterOperations(
  operations: LedgerOperation[],
  search: string,
) {
  const q = search.toLowerCase();
  return operations
    .filter((operation) =>
      [
        operation.document,
        operation.counterparty,
        operation.article,
        operation.org,
      ].some((value) =>
        String(value || "")
          .toLowerCase()
          .includes(q),
      ),
    )
    .slice()
    .reverse();
}
export function nextPlanDate(data: LedgerData) {
  return forecast(data).points[1].date;
}
export type { LedgerPlan };
