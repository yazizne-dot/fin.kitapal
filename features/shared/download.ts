import type { ExportCell } from "./types";
export function downloadFile(content: Blob, filename: string) {
  const url = URL.createObjectURL(content);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function exportRows(rows: ExportCell[][], filename: string) {
  const tokenResponse = await fetch("/api/csrf", { cache: "no-store" });
  if (!tokenResponse.ok) throw Error("Қауіпсіздік токенін алу мүмкін болмады");
  const { csrf_token } = await tokenResponse.json() as { csrf_token: string };
  const response = await fetch("/api/export", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf_token },
    cache: "no-store",
    body: JSON.stringify({ rows }),
  });
  if (!response.ok) {
    const error = await response.json();
    throw Error(error.error || "Экспорт орындалмады");
  }
  downloadFile(await response.blob(), filename);
}
