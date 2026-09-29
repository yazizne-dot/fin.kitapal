"use client";
import { usePortal } from "./provider";
import { managementPages } from "./routes";
import { WorkbookView } from "../workbook/workbook-view";
import { LedgerView } from "../ledger/ledger-view";
import { ManagementView } from "../management/management-view";
export function PortalPage({ page }: { page: string }) {
  const { data, api, refresh, logout, filters, setFilters, navigate } =
    usePortal();
  if (
    data.user.must_change_password ||
    data.user.role === "employee" ||
    managementPages.some((p) => p === page)
  ) {
    const selected = data.user.must_change_password
      ? "account"
      : data.user.role === "employee"
        ? page === "account"
          ? "account"
          : "my-expenses"
        : page;
    return (
      <ManagementView
        page={selected}
        user={data.user}
        api={api}
        refresh={refresh}
        onLogout={logout}
      />
    );
  }
  const props = { page, api, refresh, filters, setFilters, navigate };
  if (data.source === "workbook")
    return <WorkbookView {...props} data={data} />;
  if (data.source === "ledger") return <LedgerView {...props} data={data} />;
  return null;
}
