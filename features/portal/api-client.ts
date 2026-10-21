import type { ApiClient, User } from "../shared/types";
import type { WorkbookData } from "../workbook/types";
import type { LedgerData } from "../ledger/types";

export type PortalData = WorkbookData | LedgerData | { source: "personal"; user: User };

export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

export function createPortalRequester(fetcher: typeof fetch): ApiClient {
  return async <T,>(path: string, options: RequestInit = {}): Promise<T> => {
    const method = (options.method || "GET").toUpperCase();
    const headers = new Headers(options.headers);
    if (options.body && !headers.has("content-type")) headers.set("content-type", "application/json");
    if (!["GET", "HEAD"].includes(method) && path !== "/api/login") {
      const csrf = await fetcher("/api/csrf", { cache: "no-store", signal: options.signal });
      if (csrf.ok) {
        const token = (await csrf.json() as { csrf_token: string }).csrf_token;
        headers.set("x-csrf-token", token);
      } else if (csrf.status !== 404) {
        const error = await csrf.json().catch(() => ({})) as { error?: string };
        throw new ApiError(error.error || "CSRF token unavailable", csrf.status);
      }
    }
    const response = await fetcher(path, { ...options, headers, cache: "no-store" });
    const result = await response.json();
    if (!response.ok) throw new ApiError(result.error || "Request failed", response.status);
    return result as T;
  };
}

export async function loadPortalIdentityFirst(api: ApiClient, query: string, signal?: AbortSignal): Promise<PortalData> {
  const { user } = await api<{ user: User }>("/api/me", { signal });
  if (user.must_change_password) return { source: "personal", user };
  return api<PortalData>(`/api/data?${query}`, { signal });
}
