"use client";
import type { ManagementProps } from "./common";
import { AccountView } from "./account";
import { AuditView } from "./audit";
import { ExpensesView } from "./expenses";
import { FinancialEditorView } from "./financial-editor";
import { FinancialEntriesView } from "./financial-entries";
import { UsersView } from "./users";

export function ManagementView(props: ManagementProps) {
  const { page, user } = props;
  const privileged = user.role === "admin" || user.role === "finance";
  if (page === "account" || Boolean(user.must_change_password))
    return <AccountView {...props} />;
  if (page === "my-expenses") return <ExpensesView {...props} />;
  if (!privileged)
    return (
      <div className="error-message" role="alert">
        Рұқсат жоқ
      </div>
    );
  if (page === "users") return <UsersView {...props} />;
  if (page === "employee-expenses") return <ExpensesView {...props} />;
  if (page === "financial-editor") return <FinancialEditorView {...props} />;
  if (page === "financial-entries") return <FinancialEntriesView {...props} />;
  if (page === "admin-audit") return <AuditView {...props} />;
  return (
    <div className="error-message" role="alert">
      Бет табылмады
    </div>
  );
}
