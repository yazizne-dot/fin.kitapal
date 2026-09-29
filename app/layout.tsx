import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import "../public/style.css";

export const metadata: Metadata = {
  title: "Kitapal — Қаржылық басқару",
  description: "Kitapal қаржылық басқару порталы",
  robots: { index: false, follow: false },
};
export const viewport: Viewport = { themeColor: "#a4247a" };

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // Dynamic HTML is required for a fresh per-request CSP nonce.
  await headers();
  return (
    <html lang="kk">
      <body>{children}</body>
    </html>
  );
}
