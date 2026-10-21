import { useState, type FormEvent } from "react";
import { Icon } from "../../components/ui/icon";
import { Modal } from "../../components/ui/modal";
import type { User } from "../shared/types";
import {
  FormModal,
  Localized,
  roleName,
  useAction,
  useResource,
  type ManagementProps,
} from "./common";

interface UsersResponse {
  users: User[];
}
interface UserResult {
  ok: boolean;
  temporary_password?: string;
}
type UserDialog = { kind: "create" } | { kind: "edit" | "reset"; user: User };

export function UsersView({ user, api, refresh }: ManagementProps) {
  const { data, loading, error, reload } = useResource<UsersResponse>(
    api,
    "/api/users",
  );
  const action = useAction(api, refresh, reload);
  const [dialog, setDialog] = useState<UserDialog | null>(null);
  const [temporaryPassword, setTemporaryPassword] = useState("");
  const close = () => {
    setDialog(null);
    action.setError("");
  };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!dialog) return;
    const form = new FormData(event.currentTarget);
    const id = dialog.kind === "create" ? undefined : dialog.user.id;
    const password = String(form.get("password") || "") || undefined;
    let body: object;
    let method: "POST" | "PATCH" = "PATCH";
    if (dialog.kind === "reset")
      body = { id, action: "reset-password", password };
    else {
      body = {
        id,
        name: String(form.get("name") || ""),
        username: String(form.get("username") || ""),
        role: String(form.get("role") || ""),
        ...(dialog.kind === "edit"
          ? { active: form.get("active") === "1" }
          : { password }),
      };
      if (dialog.kind === "create") method = "POST";
    }
    const result = await action.run<UserResult>("/api/users", body, method);
    if (result) {
      close();
      if (result.temporary_password)
        setTemporaryPassword(result.temporary_password);
    }
  };
  return (
    <Localized>
      <>
        <div className="panel">
          <div className="toolbar">
            <p className="note" style={{ margin: 0 }}>
              Өшірілген кабинеттердің бұрынғы шығындары сақталады.
            </p>
            <button
              className="primary"
              style={{ marginLeft: "auto" }}
              data-admin="add-user"
              onClick={() => setDialog({ kind: "create" })}
            >
              <Icon name="plus" size={14} /> Пайдаланушы қосу
            </button>
          </div>
          {loading ? (
            <div className="loading">Жүктелуде…</div>
          ) : error ? (
            <div className="error-message" role="alert">
              {error}
            </div>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Аты-жөні</th>
                    <th>Логин</th>
                    <th>Рөлі</th>
                    <th>Мәртебе</th>
                    <th>Әрекеттер</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.users.map((row) => (
                    <tr key={row.id}>
                      <td data-no-i18n>{row.name}</td>
                      <td data-no-i18n>{row.username}</td>
                      <td>{roleName(row.role)}</td>
                      <td>
                        <span className={`status ${row.active ? "" : "warn"}`}>
                          {row.active ? "Белсенді" : "Өшірілген"}
                        </span>
                      </td>
                      <td>
                        <div className="row-actions">
                          <button
                            className="secondary"
                            data-admin="edit-user"
                            data-id={row.id}
                            onClick={() =>
                              setDialog({ kind: "edit", user: row })
                            }
                          >
                            Өзгерту
                          </button>
                          {row.id !== user.id && (
                            <button
                              className="link-button"
                              data-admin="reset-password"
                              data-id={row.id}
                              onClick={() =>
                                setDialog({ kind: "reset", user: row })
                              }
                            >
                              Жаңа пароль беру
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        {dialog && (
          <FormModal
            id={dialog.kind === "reset" ? "reset-password-form" : "user-form"}
            title={
              dialog.kind === "create"
                ? "Пайдаланушы қосу"
                : dialog.kind === "edit"
                  ? "Пайдаланушыны өзгерту"
                  : "Жаңа пароль беру"
            }
            onClose={close}
            onSubmit={submit}
            busy={action.busy}
            error={action.error}
          >
            {dialog.kind === "reset" ? (
              <>
                <p data-no-i18n>
                  {dialog.user.name} · {dialog.user.username}
                </p>
                <label>
                  Уақытша пароль
                  <input
                    name="password"
                    type="password"
                    minLength={15}
                    maxLength={1024}
                    required
                    autoComplete="new-password"
                    placeholder="Кемінде 15 таңба"
                    style={{ width: "100%" }}
                  />
                </label>
              </>
            ) : (
              <div className="form-grid">
                <label>
                  Аты-жөні
                  <input
                    name="name"
                    required
                    maxLength={100}
                    defaultValue={
                      dialog.kind === "edit" ? dialog.user.name : ""
                    }
                  />
                </label>
                <label>
                  Логин
                  <input
                    name="username"
                    required
                    pattern="[a-zA-Z0-9][a-zA-Z0-9._-]{2,63}"
                    defaultValue={
                      dialog.kind === "edit" ? dialog.user.username : ""
                    }
                    autoComplete="off"
                  />
                </label>
                <label>
                  Рөлі
                  <select
                    name="role"
                    defaultValue={
                      dialog.kind === "edit" ? dialog.user.role : "employee"
                    }
                  >
                    {(["employee", "finance", "admin"] as const).map((role) => (
                      <option key={role} value={role}>
                        {roleName(role)}
                      </option>
                    ))}
                  </select>
                </label>
                {dialog.kind === "edit" ? (
                  <label>
                    Мәртебе
                    <select
                      name="active"
                      defaultValue={dialog.user.active ? "1" : "0"}
                    >
                      <option value="1">Белсенді</option>
                      <option value="0">Өшірілген</option>
                    </select>
                  </label>
                ) : (
                  <label>
                    Уақытша пароль
                    <input
                      name="password"
                      type="password"
                      minLength={15}
                      maxLength={1024}
                      required
                      autoComplete="new-password"
                      placeholder="Кемінде 15 таңба"
                    />
                  </label>
                )}
              </div>
            )}
          </FormModal>
        )}
        {temporaryPassword && (
          <Modal
            title="Жаңа парольді сақтап алыңыз"
            onClose={() => setTemporaryPassword("")}
          >
            <p className="note">
              Бұл пароль тек бір рет көрсетіледі. Пайдаланушыға жеке беріңіз.
            </p>
            <input
              className="temporary-password"
              type="text"
              readOnly
              value={temporaryPassword}
              aria-label="Уақытша пароль"
            />
            <p className="note">Алғаш кіргенде парольді ауыстыру қажет.</p>
          </Modal>
        )}
      </>
    </Localized>
  );
}
