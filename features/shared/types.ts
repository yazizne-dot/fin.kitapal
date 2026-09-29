export type Language = "kk" | "ru";
export type Role =
  "admin" | "finance" | "employee" | "manager" | "director" | "accountant";
export interface User {
  id: number;
  name: string;
  username: string;
  role: Role;
  language: Language;
  active: number;
  must_change_password: number;
  org: string;
  point: string;
}
export type ApiClient = <T>(path: string, options?: RequestInit) => Promise<T>;
export interface ReportFilters {
  source: "auto" | "workbook" | "ledger";
  month: string;
  range: "month" | "ytd";
  channel: string;
  org: string;
}
export interface ReportActions {
  page: string;
  api: ApiClient;
  refresh: () => Promise<void>;
  filters: ReportFilters;
  setFilters: (values: Partial<ReportFilters>) => void;
  navigate: (page: string, values?: Partial<ReportFilters>) => void;
}
export type ExportCell = string | number | null | undefined;
