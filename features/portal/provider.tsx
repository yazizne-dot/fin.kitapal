"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ApiClient, ReportFilters } from "../shared/types";
import { ApiError, createPortalRequester, loadPortalIdentityFirst, type PortalData } from "./api-client";
import { useI18n } from "../i18n/provider";
import { filtersFromSearch, isPortalPage, pageHref } from "./routes";
import { LoginForm } from "../../components/login-form";
import { PortalShell } from "./shell";

interface PortalState {
  data: PortalData;
  api: ApiClient;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
  filters: ReportFilters;
  setFilters: (values: Partial<ReportFilters>) => void;
  navigate: (page: string, values?: Partial<ReportFilters>) => void;
  loading: boolean;
}
const Context = createContext<PortalState | null>(null);
export function usePortal() {
  const context = useContext(Context);
  if (!context) throw Error("Portal provider missing");
  return context;
}

export function PortalProvider({ children }: { children: ReactNode }) {
  const router = useRouter(),
    pathname = usePathname(),
    search = useSearchParams();
  const { setLanguage } = useI18n();
  const searchKey = search.toString();
  const filters = useMemo(
    () => filtersFromSearch(new URLSearchParams(searchKey), pathname.split("/")[1] || "dashboard"),
    [searchKey, pathname],
  );
  const [data, setData] = useState<PortalData | null>(null),
    [phase, setPhase] = useState<"loading" | "ready" | "login" | "error">(
      "loading",
    );
  const [error, setError] = useState(""),
    [loading, setLoading] = useState(false);
  const pending = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      pending.current?.abort();
    };
  }, []);
  const api = useCallback<ApiClient>(
    async <T,>(path: string, options: RequestInit = {}): Promise<T> => {
      try {
        return await createPortalRequester(fetch)<T>(path, options);
      } catch (cause) {
        if (cause instanceof ApiError && cause.status === 401 && mounted.current) {
          pending.current?.abort();
          setData(null);
          setPhase("login");
        }
        throw cause;
      }
    },
    [],
  );
  const refresh = useCallback(async () => {
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setLoading(true);
    setError("");
    try {
      const query = new URLSearchParams({ ...filters });
      const result = await loadPortalIdentityFirst(api, query.toString(), controller.signal);
      if (controller.signal.aborted || !mounted.current) return;
      setData(result);
      setLanguage(result.user.language || "kk");
      setPhase("ready");
    } catch (cause) {
      if (
        !mounted.current ||
        controller.signal.aborted ||
        (cause instanceof ApiError && cause.status === 401)
      )
        return;
      setError(
        cause instanceof Error ? cause.message : "Есепті жүктеу мүмкін болмады",
      );
      setPhase("error");
    } finally {
      if (mounted.current && pending.current === controller) setLoading(false);
    }
  }, [api, filters, setLanguage]);
  useEffect(() => {
    void refresh();
    return () => pending.current?.abort();
  }, [refresh]);
  const navigate = useCallback(
    (page: string, values: Partial<ReportFilters> = {}) => {
      if (isPortalPage(page))
        router.push(pageHref(page, { ...filters, ...values }));
    },
    [router, filters],
  );
  const setFilters = useCallback(
    (values: Partial<ReportFilters>) =>
      navigate(pathname.split("/")[1] || "dashboard", values),
    [navigate, pathname],
  );
  const logout = useCallback(async () => {
    await api("/api/logout", { method: "POST" });
    pending.current?.abort();
    setData(null);
    setPhase("login");
  }, [api]);
  useEffect(() => {
    const old = window.location.hash.slice(1);
    if (old && isPortalPage(old)) router.replace(pageHref(old, filters));
  }, [router, filters]);
  useEffect(() => {
    if (!data || phase !== "ready") return;
    const page = pathname.split("/")[1] || "dashboard";
    if (data.user.must_change_password && page !== "account")
      router.replace(pageHref("account", filters));
    else if (
      data.user.role === "employee" &&
      !["account", "my-expenses"].includes(page)
    )
      router.replace(pageHref("my-expenses", filters));
  }, [data, phase, pathname, router, filters]);
  if (phase === "login")
    return (
      <LoginForm
        onSuccess={() => {
          setPhase("loading");
          void refresh();
        }}
      />
    );
  if (phase === "loading" || (!data && phase !== "error"))
    return (
      <div className="loading" role="status">
        Kitapal жүктелуде…
      </div>
    );
  if (phase === "error" || !data)
    return (
      <main className="loading" role="alert">
        <p>{error}</p>
        <button className="primary" onClick={() => void refresh()}>
          Қайта жүктеу
        </button>
      </main>
    );
  return (
    <Context.Provider
      value={{
        data,
        api,
        refresh,
        logout,
        filters,
        setFilters,
        navigate,
        loading,
      }}
    >
      <PortalShell>{children}</PortalShell>
    </Context.Provider>
  );
}
