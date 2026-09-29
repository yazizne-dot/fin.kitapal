import {
  Children,
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import type { ApiClient, User } from "../shared/types";
import { Modal } from "../../components/ui/modal";
import { useI18n } from "../i18n/provider";

export interface ManagementProps {
  page: string;
  user: User;
  api: ApiClient;
  refresh: () => Promise<void>;
  onLogout: () => Promise<void>;
}
export interface Expense {
  id: number;
  user_id: number;
  user_name?: string;
  date: string;
  amount_cents: number;
  category: string;
  description: string;
  vendor: string;
  status: "submitted" | "approved" | "rejected";
  review_note: string;
  version: number;
}
export interface ExpensesResponse {
  expenses: Expense[];
  categories: string[];
}
export interface EditorRow {
  cell: string;
  label: string;
  original: number;
  value: number;
  formula: string | null;
  overridden: boolean;
  recalculated: boolean;
}
export interface EditorResponse {
  books: { id: string; file: string }[];
  book: string;
  sheet: string;
  sheets: string[];
  rows: EditorRow[];
  total: number;
  offset: number;
  revision: number;
}
export interface Entry {
  id: number;
  date: string;
  kind: string;
  amount_cents: number;
  label: string;
  note: string;
  cash_effect: number;
  expense_id: number | null;
  author: string;
}
export interface EntriesResponse {
  entries: Entry[];
  revision: number;
}
export interface AuditRecord {
  id: number;
  time: string;
  author: string;
  action: string;
  detail: string;
}

export const money = (cents: number) =>
  new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100) + " ₸";
export const amount = (value: number) =>
  new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 6 }).format(value);
export const today = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};
export const roleName = (role: string) =>
  (
    ({ admin: "Әкімші", finance: "Қаржыгер", employee: "Қызметкер" }) as Record<
      string,
      string
    >
  )[role] || role;
export const statusName = (status: string) =>
  (
    ({
      submitted: "Қаралуда",
      approved: "Есепке қосылған",
      rejected: "Қайтарылған",
    }) as Record<string, string>
  )[status] || status;
export const entryKinds: Record<string, string> = {
  revenue: "Сатудан түскен түсім",
  cost: "Өнімнің өзіндік құны",
  opex: "Операциялық шығыстар",
  otherExpense: "Өзге шығыстар",
  taxes: "Салықтар",
  bonuses: "Дистрибьюторларға ретро-бонустар",
  otherIncome: "Өзге кірістер",
  cash_in: "ДДС: кіріс",
  cash_out: "ДДС: шығыс",
};
export const send = <T,>(
  api: ApiClient,
  path: string,
  body: object,
  method: "POST" | "PATCH" | "DELETE" = "POST",
) => api<T>(path, { method, body: JSON.stringify(body) });
export const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/** Translate literal React text while leaving source data marked data-no-i18n untouched. */
export function Localized({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const visit = (node: ReactNode): ReactNode => {
    if (typeof node === "string") return t(node);
    if (!isValidElement(node)) return node;
    const element = node as React.ReactElement<{
      children?: ReactNode;
      "data-no-i18n"?: boolean | string;
      placeholder?: string;
      "aria-label"?: string;
      title?: string;
    }>;
    if (element.props["data-no-i18n"] !== undefined) return element;
    const next: Record<string, unknown> = {};
    for (const key of ["placeholder", "aria-label", "title"] as const)
      if (typeof element.props[key] === "string")
        next[key] = t(element.props[key]);
    if (element.props.children !== undefined)
      next.children = Children.map(element.props.children, visit);
    return cloneElement(element, next);
  };
  return <>{Children.map(children, visit)}</>;
}

export function useResource<T>(api: ApiClient, path: string) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    api<T>(path)
      .then((value) => {
        if (active) setData(value);
      })
      .catch((reason) => {
        if (active) setError(errorText(reason));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [api, path, revision]);
  return { data, loading, error, reload };
}

export function useAction(
  api: ApiClient,
  refresh: () => Promise<void>,
  reload: () => void,
) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const run = async <T,>(
    path: string,
    body: object,
    method: "POST" | "PATCH" | "DELETE" = "POST",
  ): Promise<T | null> => {
    setBusy(true);
    setError("");
    try {
      const result = await send<T>(api, path, body, method);
      reload();
      try {
        await refresh();
      } catch (reason) {
        setError(errorText(reason));
      }
      return result;
    } catch (reason) {
      setError(errorText(reason));
      return null;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, setError, run };
}

export function FormModal({
  title,
  onClose,
  onSubmit,
  busy,
  error,
  children,
  id,
}: {
  title: string;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  busy: boolean;
  error: string;
  children: ReactNode;
  id: string;
}) {
  return (
    <Modal title={title} onClose={onClose}>
      <Localized>
        <form id={id} onSubmit={onSubmit}>
          {children}
          <div className="form-error" role="alert">
            {error}
          </div>
          <div className="form-actions">
            <button
              type="button"
              className="secondary"
              onClick={onClose}
              disabled={busy}
            >
              Бас тарту
            </button>
            <button type="submit" className="primary" disabled={busy}>
              {busy ? "Сақталуда…" : "Сақтау"}
            </button>
          </div>
        </form>
      </Localized>
    </Modal>
  );
}
