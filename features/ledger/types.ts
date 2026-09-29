import type { User } from "../shared/types";

export interface LedgerOperation {
  id: number;
  external_id: string;
  source: string;
  date: string;
  org: string;
  point: string;
  counterparty: string;
  document: string;
  kind: string;
  amount: number;
  cost: number;
  due: string;
  article: string;
}
export interface LedgerAmounts {
  revenue: number;
  cost: number;
  gross: number;
  opex: number;
  ebitda: number;
  depreciation: number;
  pretax: number;
  tax: number;
  profit: number;
  cash: number;
  inflow: number;
  outflow: number;
  operating: number;
  investing: number;
  financing: number;
  receivables: number;
  inventory: number;
  fixed: number;
  assets: number;
  payables: number;
  taxes: number;
  loans: number;
  liabilities: number;
  capital: number;
  equity: number;
  difference: number;
  [key: string]: number;
}
export interface LedgerDebt {
  side: "receivable" | "payable";
  counterparty: string;
  document: string;
  org: string;
  due: string;
  days: number;
  amount: number;
}
export interface LedgerPlan {
  id: number;
  date: string;
  org: string;
  article: string;
  amount: number;
  direction: "in" | "out";
}
export interface LedgerBudget {
  month: string;
  org: string;
  metric: string;
  amount: number;
}
export interface LedgerAudit {
  id: number;
  time: string;
  author: string;
  action: string;
  detail: string;
}
export interface LedgerHistory {
  month: string;
  revenue: number;
  cost: number;
  opex: number;
  tax: number;
  depreciation: number;
  [key: string]: string | number;
}
export interface LedgerData {
  source: "ledger";
  user: User;
  orgs: string[];
  kinds: Record<string, string>;
  month: string;
  end: string;
  operations: LedgerOperation[];
  allOperations: LedgerOperation[];
  budget: LedgerBudget[];
  report: LedgerAmounts;
  opening: LedgerAmounts;
  balance: LedgerAmounts;
  previous: LedgerAmounts;
  history: LedgerHistory[];
  debts: LedgerDebt[];
  plans: LedgerPlan[];
  closed: boolean;
  audit: LedgerAudit[];
  demo: boolean;
  workbookAvailable: boolean;
}
