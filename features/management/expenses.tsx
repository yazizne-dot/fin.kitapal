import { useMemo, useState, type FormEvent } from "react";
import { Icon } from "../../components/ui/icon";
import {
  FormModal,
  Localized,
  money,
  statusName,
  today,
  useAction,
  useResource,
  type Expense,
  type ExpensesResponse,
  type ManagementProps,
} from "./common";

type ExpenseDialog =
  | { kind: "create" }
  | { kind: "edit" | "delete" | "approve" | "reject"; row: Expense };
const fallbackCategories = [
  "Кеңсе / Офис",
  "Жол / Транспорт",
  "Тамақ / Питание",
  "Іссапар / Командировка",
  "Сатып алу / Покупка",
  "Басқа / Прочее",
];

export function ExpensesView({ page, api, refresh }: ManagementProps) {
  const management = page === "employee-expenses";
  const { data, loading, error, reload } = useResource<ExpensesResponse>(
    api,
    "/api/expenses",
  );
  const action = useAction(api, refresh, reload);
  const [dialog, setDialog] = useState<ExpenseDialog | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const rows = useMemo(
    () =>
      data?.expenses.filter(
        (row) =>
          (!status || row.status === status) &&
          (!query ||
            [row.user_name, row.description, row.vendor].some((value) =>
              String(value || "")
                .toLowerCase()
                .includes(query.toLowerCase()),
            )),
      ) || [],
    [data, query, status],
  );
  const sum = (status?: Expense["status"]) =>
    (data?.expenses || [])
      .filter((row) => !status || row.status === status)
      .reduce((total, row) => total + row.amount_cents, 0);
  const close = () => {
    setDialog(null);
    action.setError("");
  };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!dialog) return;
    const form = new FormData(event.currentTarget);
    let body: object;
    let method: "POST" | "PATCH" = "PATCH";
    if (dialog.kind === "create" || dialog.kind === "edit") {
      body = {
        ...(dialog.kind === "edit"
          ? { id: dialog.row.id, version: dialog.row.version }
          : {}),
        date: String(form.get("date")),
        amount_cents: Math.round(Number(form.get("amount")) * 100),
        category: String(form.get("category")),
        vendor: String(form.get("vendor") || ""),
        description: String(form.get("description") || ""),
      };
      if (dialog.kind === "create") method = "POST";
    } else if (dialog.kind === "delete")
      body = {
        id: dialog.row.id,
        version: dialog.row.version,
        action: "delete",
      };
    else
      body = {
        id: dialog.row.id,
        version: dialog.row.version,
        action: "review",
        status: dialog.kind === "approve" ? "approved" : "rejected",
        note: String(form.get("note") || ""),
      };
    const result = await action.run<{ ok: boolean }>(
      "/api/expenses",
      body,
      method,
    );
    if (result) close();
  };
  return (
    <Localized>
      <>
        {!management && (
          <section className="detail-stats">
            <div className="kpi">
              <div className="kpi-top">
                Менің шығындарымның сомасы <Icon name="wallet" />
              </div>
              <div className="personal-amount">{money(sum())}</div>
            </div>
            <div className="kpi">
              <div className="kpi-top">
                Қаралуда <Icon name="clock" />
              </div>
              <div className="personal-amount">{money(sum("submitted"))}</div>
            </div>
            <div className="kpi">
              <div className="kpi-top">
                Есепке қосылған <Icon name="check" />
              </div>
              <div className="personal-amount">{money(sum("approved"))}</div>
            </div>
          </section>
        )}
        <div className="panel">
          {management ? (
            <div className="toolbar">
              <input
                id="admin-expense-search"
                placeholder="Пайдаланушы немесе сипаттама…"
                aria-label="Іздеу"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              <select
                id="admin-expense-status"
                aria-label="Мәртебе"
                value={status}
                onChange={(event) => setStatus(event.target.value)}
              >
                <option value="">Барлығы</option>
                <option value="submitted">Қаралуда</option>
                <option value="approved">Есепке қосылған</option>
                <option value="rejected">Қайтарылған</option>
              </select>
            </div>
          ) : (
            <div className="panel-head table-top">
              <div>
                <h2>Мен енгізген шығындар</h2>
                <p>
                  Бұл бөлімде тек өз шығындарыңыз көрсетіледі. Компанияның
                  есептері қолжетімсіз.
                </p>
              </div>
              <button
                className="primary"
                data-admin="add-expense"
                onClick={() => setDialog({ kind: "create" })}
              >
                <Icon name="plus" size={14} /> Шығын қосу
              </button>
            </div>
          )}
          {loading ? (
            <div className="loading">Жүктелуде…</div>
          ) : error ? (
            <div className="error-message" role="alert">
              {error}
            </div>
          ) : (
            <div
              id={management ? "admin-expense-table" : undefined}
              className="table-wrap"
            >
              <table className="table">
                <thead>
                  <tr>
                    <th>Күні</th>
                    {management && <th>Пайдаланушы</th>}
                    <th>Шығын санаты</th>
                    <th>Сипаттама</th>
                    <th className="num">Сома, ₸</th>
                    <th>Мәртебе</th>
                    <th>Әрекеттер</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id}>
                      <td>{row.date}</td>
                      {management && <td data-no-i18n>{row.user_name}</td>}
                      <td>{row.category}</td>
                      <td style={{ whiteSpace: "normal", minWidth: 180 }}>
                        <span data-no-i18n>{row.description}</span>
                        <small className="cell-note" data-no-i18n>
                          {row.vendor}
                          {row.review_note ? ` · ${row.review_note}` : ""}
                        </small>
                      </td>
                      <td className="num">{money(row.amount_cents)}</td>
                      <td>
                        <span
                          className={`status ${row.status === "rejected" ? "warn" : ""}`}
                        >
                          {statusName(row.status)}
                        </span>
                      </td>
                      <td>
                        <div className="row-actions">
                          {management ? (
                            <>
                              {row.status === "submitted" && (
                                <button
                                  className="secondary"
                                  data-admin="review"
                                  data-id={row.id}
                                  data-status="approved"
                                  onClick={() =>
                                    setDialog({ kind: "approve", row })
                                  }
                                >
                                  Есепке қосу
                                </button>
                              )}
                              {row.status === "submitted" && (
                                <button
                                  className="link-button"
                                  data-admin="review"
                                  data-id={row.id}
                                  data-status="rejected"
                                  onClick={() =>
                                    setDialog({ kind: "reject", row })
                                  }
                                >
                                  Қайтару
                                </button>
                              )}
                            </>
                          ) : (
                            row.status !== "approved" && (
                              <>
                                <button
                                  className="secondary"
                                  data-admin="edit-expense"
                                  data-id={row.id}
                                  aria-label="Өзгерту"
                                  onClick={() =>
                                    setDialog({ kind: "edit", row })
                                  }
                                >
                                  <Icon name="settings" size={14} />
                                </button>
                                <button
                                  className="link-button"
                                  data-admin="delete-expense"
                                  data-id={row.id}
                                  onClick={() =>
                                    setDialog({ kind: "delete", row })
                                  }
                                >
                                  Жазбаны өшіру
                                </button>
                              </>
                            )
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!rows.length && (
                    <tr>
                      <td colSpan={management ? 7 : 6} className="empty">
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
              management
                ? "expense-review-form"
                : dialog.kind === "delete"
                  ? "expense-delete-form"
                  : "personal-expense-form"
            }
            title={
              (
                {
                  create: "Шығын қосу",
                  edit: "Шығынды өзгерту",
                  delete: "Жазбаны өшіру",
                  approve: "Есепке қосу",
                  reject: "Қайтару",
                } as Record<ExpenseDialog["kind"], string>
              )[dialog.kind]
            }
            onClose={close}
            onSubmit={submit}
            busy={action.busy}
            error={action.error}
          >
            {dialog.kind === "create" || dialog.kind === "edit" ? (
              <div className="form-grid">
                <label>
                  Күні
                  <input
                    name="date"
                    type="date"
                    required
                    defaultValue={
                      dialog.kind === "edit" ? dialog.row.date : today()
                    }
                  />
                </label>
                <label>
                  Сома, ₸
                  <input
                    name="amount"
                    type="number"
                    min="0.01"
                    step="0.01"
                    required
                    defaultValue={
                      dialog.kind === "edit"
                        ? dialog.row.amount_cents / 100
                        : undefined
                    }
                  />
                </label>
                <label>
                  Шығын санаты
                  <select
                    name="category"
                    defaultValue={
                      dialog.kind === "edit" ? dialog.row.category : undefined
                    }
                  >
                    {(data?.categories || fallbackCategories).map(
                      (category) => (
                        <option key={category} value={category}>
                          {category}
                        </option>
                      ),
                    )}
                  </select>
                </label>
                <label>
                  Жеткізуші / дүкен
                  <input
                    name="vendor"
                    maxLength={200}
                    defaultValue={
                      dialog.kind === "edit" ? dialog.row.vendor : ""
                    }
                  />
                </label>
                <label className="wide">
                  Не үшін жұмсалды?
                  <textarea
                    name="description"
                    required
                    maxLength={1000}
                    rows={3}
                    defaultValue={
                      dialog.kind === "edit" ? dialog.row.description : ""
                    }
                  />
                </label>
              </div>
            ) : (
              <>
                <p data-no-i18n>
                  {dialog.kind === "delete" ? "" : `${dialog.row.user_name} · `}
                  {dialog.row.description} · {money(dialog.row.amount_cents)}
                </p>
                {dialog.kind === "approve" && (
                  <p className="note">
                    Бұл әрекет шығынды P&amp;L мен ДДС-ке бір рет қосады.
                  </p>
                )}
                {(dialog.kind === "approve" || dialog.kind === "reject") && (
                  <label>
                    Себеп / ескертпе
                    <input
                      name="note"
                      style={{ width: "100%" }}
                      required={dialog.kind === "reject"}
                    />
                  </label>
                )}
              </>
            )}
          </FormModal>
        )}
      </>
    </Localized>
  );
}
