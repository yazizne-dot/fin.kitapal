import type { User } from "../shared/types";

export type MetricKey =
  | "revenue"
  | "cost"
  | "gross"
  | "opex"
  | "operatingProfit"
  | "otherExpense"
  | "taxes"
  | "bonuses"
  | "otherIncome"
  | "profit"
  | "dividends"
  | "retained";
export type Metrics = Record<MetricKey, number | null>;
export interface SourceRef {
  file?: string;
  period?: string;
  sheet: string;
  cell: string;
  value?: number | null;
  raw?: string | number | boolean | null;
  formula?: string | null;
  formulaOrigin?: { cell: string; formula?: string | null } | null;
}
export interface DetailRow {
  id: string;
  label: string;
  display: string;
  group: MetricKey;
  value: number | null;
  sources: SourceRef[];
  manual?: boolean;
}
export interface ChannelRow {
  id: string;
  label: string;
  revenue: number | null;
  cost: number | null;
  gross: number | null;
  previousRevenue: number | null;
  sources: SourceRef[];
}
export interface BudgetRow {
  id: string;
  label: string;
  display: string;
  total: boolean;
  plan: number | null;
  actual: number | null;
  referenceActual?: number | null;
  sources: {
    period: string;
    plan: SourceRef;
    actual: SourceRef;
    pnl?: SourceRef | null;
  }[];
}
export interface CheckRow extends SourceRef {
  id?: string;
  period: string;
  kind: string;
  metric?: MetricKey;
  title: string;
  reported: number | null;
  calculated: number | null;
  difference: number | null;
  detail: string;
}
export interface FileMetadata {
  file: string;
  sha256?: string;
  importedAt?: string | null;
  method?: string;
  unit?: string;
  precision?: number;
  sheets?: string[];
  limitations?: string[];
}
export interface BalanceDetail {
  label: string;
  value: number | null;
  source: SourceRef;
  sku?: string;
  quantity?: number | null;
  publisher?: string;
  contract?: string;
}
export interface BalanceStatement {
  historical?: boolean;
  snapshotStatus?: string;
  date: string;
  asOfLabel: string;
  metadata: FileMetadata;
  rows: (BalanceDetail & { id: string })[];
  cashAccounts: BalanceDetail[];
  suppliers: BalanceDetail[];
  assetGroups: BalanceDetail[];
  inventory: BalanceDetail[];
  checks: { label: string; reported: number; calculated: number }[];
  capitalIsResidual: boolean;
}
export interface CashRow {
  id: number | string;
  date: string;
  period: string;
  article: string;
  inflow: number;
  outflow: number;
  author?: string;
  responsible?: string;
  note?: string;
  cashReplenishment: boolean;
  periodMismatch?: boolean;
  source: SourceRef;
}
export interface CashTotals {
  inflow: number;
  outflow: number;
  net: number;
}
export interface CashflowStatement {
  month: string;
  range: "month" | "ytd";
  available: boolean;
  metadata: FileMetadata;
  periods: string[];
  totals: CashTotals | null;
  business: CashTotals | null;
  replenishments: CashTotals;
  articles: {
    article: string;
    inflow: number;
    outflow: number;
    count: number;
    cashReplenishment: boolean;
  }[];
  rows: CashRow[];
  daily: { date: string; inflow: number; outflow: number }[];
  summary: { inflow: SourceRef; outflow: SourceRef; net: SourceRef } | null;
  opening: number | null;
  closing: number | null;
  closingDate: string | null;
  periodMismatchCount: number;
}
export interface WorkbookData {
  source: "workbook";
  demo: false;
  user: User;
  month: string;
  range: "month" | "ytd";
  aggregation: string;
  channel: string;
  periods: string[];
  latest: string;
  actualThrough: string | null;
  actualAvailable: boolean;
  report: Metrics;
  recalculated: Metrics | null;
  previous: Metrics | null;
  details: DetailRow[];
  refs: Partial<Record<MetricKey, SourceRef[]>>;
  channels: ChannelRow[];
  history: ({ month: string } & Partial<Metrics>)[];
  budgetRows: BudgetRow[];
  budgetTimeline: {
    month: string;
    plan: number | null;
    actual: number | null;
  }[];
  checks: CheckRow[];
  allCheckCount: number;
  checkLimitations?: string[];
  metadata: FileMetadata;
  statements?: {
    balance: BalanceStatement | null;
    cashflow: CashflowStatement | null;
  };
  overrideCount?: number;
  siteEntryCount?: number;
  financialRevision?: number;
}
