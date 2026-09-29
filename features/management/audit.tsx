import {
  Localized,
  useResource,
  type AuditRecord,
  type ManagementProps,
} from "./common";

export function AuditView({ api }: ManagementProps) {
  const { data, loading, error } = useResource<{ audit: AuditRecord[] }>(
    api,
    "/api/finance/audit",
  );
  return (
    <Localized>
      <div className="panel">
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
                  <th>Уақыты</th>
                  <th>Пайдаланушы</th>
                  <th>Әрекет</th>
                  <th>Мәлімет</th>
                </tr>
              </thead>
              <tbody>
                {data?.audit.map((record) => (
                  <tr key={record.id}>
                    <td>{new Date(record.time).toLocaleString("ru-RU")}</td>
                    <td data-no-i18n>{record.author}</td>
                    <td>{record.action}</td>
                    <td
                      style={{
                        whiteSpace: "normal",
                        maxWidth: 500,
                        overflowWrap: "anywhere",
                      }}
                      data-no-i18n
                    >
                      {record.detail}
                    </td>
                  </tr>
                ))}
                {!data?.audit.length && (
                  <tr>
                    <td colSpan={4} className="empty">
                      Жазбалар жоқ
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Localized>
  );
}
