import { useState, type FormEvent } from "react";
import { Icon } from "../../components/ui/icon";
import {
  FormModal,
  Localized,
  entryKinds,
  money,
  today,
  useAction,
  useResource,
  type EntriesResponse,
  type Entry,
  type ManagementProps,
} from "./common";

type EntryDialog =
  { kind: "create" } | { kind: "edit" | "delete"; entry: Entry };

export function FinancialEntriesView({ api, refresh }: ManagementProps) {
  const { data, loading, error, reload } = useResource<EntriesResponse>(
    api,
    "/api/finance/entries",
  );
  const action = useAction(api, refresh, reload);
  const [dialog, setDialog] = useState<EntryDialog | null>(null);
  const close = () => {
    setDialog(null);
    action.setError("");
  };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!dialog) return;
    const form = new FormData(event.currentTarget);
    let body: object;
    let method: "POST" | "PATCH" | "DELETE" = "POST";
    if (dialog.kind === "create")
      body = {
        date: String(form.get("date")),
        kind: String(form.get("kind")),
        amount_cents: Math.round(Number(form.get("amount")) * 100),
        label: String(form.get("label") || ""),
        note: String(form.get("note") || ""),
        cash_effect: form.get("cash_effect") === "on",
      };
    else if (dialog.kind === "edit") {
      method = "PATCH";
      body = {
        id: dialog.entry.id,
        revision: data?.revision,
        amount_cents: Math.round(Number(form.get("amount")) * 100),
        reason: String(form.get("reason") || ""),
      };
    } else {
      method = "DELETE";
      body = { id: dialog.entry.id, reason: String(form.get("reason") || "") };
    }
    const result = await action.run<{ ok: boolean }>(
      "/api/finance/entries",
      body,
      method,
    );
    if (result) close();
  };
  return (
    <Localized>
      <>
        <div className="panel">
          <div className="toolbar">
            <p className="note" style={{ margin: 0 }}>
              Сайтта енгізілген жазбалар
            </p>
            <button
              className="primary"
              style={{ marginLeft: "auto" }}
              data-admin="add-entry"
              onClick={() => setDialog({ kind: "create" })}
            >
              <Icon name="plus" size={14} /> Жазба қосу
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
                    <th>Күні</th>
                    <th>Есеп түрі</th>
                    <th>Бап</th>
                    <th className="num">Сома, ₸</th>
                    <th>ДДС</th>
                    <th>Әрекеттер</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.entries.map((entry) => (
                    <tr key={entry.id}>
                      <td>{entry.date}</td>
                      <td>{entryKinds[entry.kind] || entry.kind}</td>
                      <td data-no-i18n>{entry.label}</td>
                      <td className="num">{money(entry.amount_cents)}</td>
                      <td>
                        {entry.cash_effect || entry.kind.startsWith("cash_")
                          ? "✓"
                          : "—"}
                      </td>
                      <td>
                        {entry.expense_id ? (
                          <span className="subtle">Қызметкерлер шығындары</span>
                        ) : (
                          <>
                            <button
                              className="secondary"
                              data-admin="edit-entry"
                              data-id={entry.id}
                              onClick={() => setDialog({ kind: "edit", entry })}
                            >
                              Өзгерту
                            </button>{" "}
                            <button
                              className="link-button"
                              data-admin="remove-entry"
                              data-id={entry.id}
                              onClick={() =>
                                setDialog({ kind: "delete", entry })
                              }
                            >
                              Жазбаны есептен алу
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                  {!data?.entries.length && (
                    <tr>
                      <td colSpan={6} className="empty">
                        Жазбалар жоқ
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
        {dialog && (
          <FormModal
            id={
              dialog.kind === "create"
                ? "finance-entry-form"
                : dialog.kind === "edit"
                  ? "entry-edit-form"
                  : "entry-delete-form"
            }
            title={
              dialog.kind === "create"
                ? "Жазба қосу"
                : dialog.kind === "edit"
                  ? "Өзгерту"
                  : "Жазбаны есептен алу"
            }
            onClose={close}
            onSubmit={submit}
            busy={action.busy}
            error={action.error}
          >
            {dialog.kind === "create" ? (
              <>
                <div className="form-grid">
                  <label>
                    Күні
                    <input
                      name="date"
                      type="date"
                      required
                      defaultValue={today()}
                    />
                  </label>
                  <label>
                    Есеп түрі
                    <select name="kind" defaultValue="opex">
                      {Object.entries(entryKinds).map(([kind, label]) => (
                        <option key={kind} value={kind}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Сома, ₸
                    <input
                      name="amount"
                      type="number"
                      min="0.01"
                      step="0.01"
                      required
                    />
                  </label>
                  <label>
                    Бап атауы
                    <input name="label" required maxLength={200} />
                  </label>
                  <label className="wide">
                    Түсініктеме
                    <textarea name="note" maxLength={1000} rows={2} />
                  </label>
                </div>
                <label className="checkbox-label">
                  <input name="cash_effect" type="checkbox" /> Осы жазбаны
                  ДДС-ке де қосу
                </label>
              </>
            ) : dialog.kind === "edit" ? (
              <>
                <label>
                  Сома, ₸
                  <input
                    name="amount"
                    type="number"
                    min="0.01"
                    step="0.01"
                    required
                    defaultValue={dialog.entry.amount_cents / 100}
                  />
                </label>
                <label>
                  Түзету себебі
                  <input name="reason" required maxLength={1000} />
                </label>
              </>
            ) : (
              <label>
                Түзету себебі
                <input
                  name="reason"
                  required
                  maxLength={1000}
                  style={{ width: "100%" }}
                />
              </label>
            )}
          </FormModal>
        )}
      </>
    </Localized>
  );
}
