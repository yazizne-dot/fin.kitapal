import { NextResponse, type NextRequest } from "next/server";

export function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const portalPaths = new Set([
    "/",
    "/pnl",
    "/balance",
    "/cashflow",
    "/analytics",
    "/plans",
    "/operations",
    "/checks",
    "/imports",
    "/settings",
    "/debts",
    "/audit",
    "/users",
    "/employee-expenses",
    "/my-expenses",
    "/financial-entries",
    "/financial-editor",
    "/account",
    "/admin-audit",
  ]);
  if (!portalPaths.has(pathname))
    return new NextResponse("Not Found", { status: 404 });
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const development = process.env.NODE_ENV !== "production";
  const policy = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src 'self'${development ? " ws: wss:" : ""}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", policy);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("Content-Security-Policy", policy);
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "same-origin");
  return response;
}
export const config = {
  matcher: [
    "/((?!api/|_next/static|_next/image|favicon.ico|kitapal-logo.png|login-library.png).*)",
  ],
};
