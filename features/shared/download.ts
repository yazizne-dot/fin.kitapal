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
  const response = await fetch("/api/export", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rows }),
  });
  if (!response.ok) {
    const error = await response.json();
    throw Error(error.error || "Экспорт орындалмады");
  }
  downloadFile(await response.blob(), filename);
}
