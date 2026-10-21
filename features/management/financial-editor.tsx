import { useState, type FormEvent } from "react";
import {
  FormModal,
  Localized,
  amount,
  useAction,
  useResource,
  type EditorResponse,
  type EditorRow,
  type ManagementProps,
} from "./common";

function editorAmount(value: number | string | null) {
  if (value === null) return "—";
  if (typeof value === "number") return amount(value);
  if (!/^-?\d+(?:\.\d+)?$/.test(value)) return "—";
  const [integer, fraction] = value.split(".");
  return integer.replace(/\B(?=(\d{3})+(?!\d))/g, " ") + (fraction ? `,${fraction}` : "");
}

export function FinancialEditorView({ api, refresh }: ManagementProps) {
  const [book, setBook] = useState("pnl");
  const [sheet, setSheet] = useState("");
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [row, setRow] = useState<EditorRow | null>(null);
  const params = new URLSearchParams({
    book,
    sheet,
    q: search,
    offset: String(offset),
  });
  const { data, loading, error, reload } = useResource<EditorResponse>(
    api,
    `/api/finance/editor?${params}`,
  );
  const action = useAction(api, refresh, reload);
  const close = () => {
    setRow(null);
    action.setError("");
  };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!data || !row) return;
    const form = new FormData(event.currentTarget);
    const result = await action.run<{ ok: boolean }>("/api/finance/cell", {
      book: data.book,
      sheet: data.sheet,
      cell: row.cell,
      value: data.book.startsWith("pnl-") ? String(form.get("value") || "") : Number(form.get("value")),
      reason: String(form.get("reason") || ""),
      revision: data.revision,
      reset: form.get("reset") === "on",
    });
    if (result) close();
  };
  return (
    <Localized>
      <>
        <p className="note">
          Есептерге түзетулер бастапқы деректерді өзгертпей сақталады. Өзгерткен
          адам мен себеп журналға жазылады.
        </p>
        <div className="panel">
          <div className="toolbar">
            <select
              id="editor-book"
              aria-label="Файл"
              value={data?.book || book}
              onChange={(event) => {
                setBook(event.target.value);
                setSheet("");
                setOffset(0);
              }}
            >
              {data?.books.map((item) => (
                <option key={item.id} value={item.id} data-no-i18n>
                  {item.file}
                </option>
              ))}
            </select>
            <select
              id="editor-sheet"
              aria-label="Парақ"
              value={data?.sheet || sheet}
              onChange={(event) => {
                setSheet(event.target.value);
                setOffset(0);
              }}
            >
              {data?.sheets.map((item) => (
                <option key={item} value={item} data-no-i18n>
                  {item}
                </option>
              ))}
            </select>
            <form
              id="editor-search-form"
              className="inline-form"
              onSubmit={(event) => {
                event.preventDefault();
                setSearch(query);
                setOffset(0);
              }}
            >
              <input
                name="q"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Іздеу: ұяшық немесе бап"
              />
              <button className="secondary" type="submit">
                Іздеу
              </button>
            </form>
          </div>
          {loading ? (
            <div className="loading">Жүктелуде…</div>
          ) : error ? (
            <div className="error-message" role="alert">
              {error}
            </div>
          ) : (
            <>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Ұяшық</th>
                      <th>Бап</th>
                      <th className="num">Бастапқы мән</th>
                      <th className="num">Ағымдағы мән</th>
                      <th>Әрекеттер</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data?.rows.map((item) => (
                      <tr key={item.cell}>
                        <td>{item.cell}</td>
                        <td
                          style={{ whiteSpace: "normal", maxWidth: 300 }}
                          data-no-i18n
                        >
                          {item.label}
                        </td>
                        <td className="num">{editorAmount(item.original)}</td>
                        <td className="num">
                          {editorAmount(item.value)}
                          {(item.overridden || item.recalculated) && (
                            <small className="cell-note">Түзетілді</small>
                          )}
                        </td>
                        <td>
                          <button
                            className="secondary"
                            data-admin="edit-cell"
                            data-cell={item.cell}
                            onClick={() => setRow(item)}
                          >
                            Өзгерту
                          </button>
                        </td>
                      </tr>
                    ))}
                    {!data?.rows.length && (
                      <tr>
                        <td colSpan={5} className="empty">
                          Жазбалар жоқ
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div className="toolbar">
                <span className="subtle">
                  {data?.total
                    ? `${data.offset + 1}–${Math.min(data.offset + 60, data.total)} / ${data.total}`
                    : "0 / 0"}
                </span>
                <button
                  className="secondary"
                  data-admin="editor-prev"
                  disabled={!data || data.offset === 0}
                  onClick={() => setOffset((value) => Math.max(0, value - 60))}
                >
                  Алдыңғы
                </button>
                <button
                  className="secondary"
                  data-admin="editor-next"
                  disabled={!data || data.offset + 60 >= data.total}
                  onClick={() => setOffset((value) => value + 60)}
                >
                  Келесі
                </button>
              </div>
            </>
          )}
        </div>
        {row && data && (
          <FormModal
            id="finance-cell-form"
            title="Есеп сандарын түзету"
            onClose={close}
            onSubmit={submit}
            busy={action.busy}
            error={action.error}
          >
            <p data-no-i18n>
              {data.book} · {data.sheet} · {row.cell}
              <br />
              {row.label}
            </p>
            <p className="note">Бастапқы мән: {editorAmount(row.original)}</p>
            <label>
              Жаңа мән
              <input
                name="value"
                type="number"
                step="any"
                required
                defaultValue={row.value ?? ""}
                style={{ width: "100%" }}
              />
            </label>
            <label className="stacked-label">
              Түзету себебі
              <input
                name="reason"
                required
                maxLength={1000}
                style={{ width: "100%" }}
              />
            </label>
            {row.overridden && (
              <label className="checkbox-label">
                <input type="checkbox" name="reset" /> Бастапқыға қайтару
              </label>
            )}
          </FormModal>
        )}
      </>
    </Localized>
  );
}
