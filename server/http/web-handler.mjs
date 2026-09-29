import { Readable } from "node:stream";

/** Adapt the tested API contract to Next.js Web Request/Response without a loopback server. */
export function createWebHandler(handle) {
  return async function handleRequest(request) {
    const url = new URL(request.url);
    const req = request.body
      ? Readable.fromWeb(request.body)
      : Readable.from([]);
    req.url = url.pathname + url.search;
    req.method = request.method;
    req.headers = Object.fromEntries(request.headers);
    req.headers.host ??= url.host;
    // This app binds to loopback. Do not accept spoofable proxy headers for throttling.
    req.socket = { remoteAddress: "local" };
    const headers = new Headers({ "Cache-Control": "private, no-store" });
    let status = 200,
      payload = null,
      ended = false;
    const res = {
      setHeader(name, value) {
        headers.set(name, String(value));
      },
      writeHead(code, values = {}) {
        status = code;
        for (const [name, value] of Object.entries(values))
          headers.set(name, String(value));
      },
      end(body) {
        payload = body ?? null;
        ended = true;
      },
    };
    try {
      await handle(req, res);
    } finally {
      req.destroy();
    }
    if (!ended) throw new Error("API handler did not finish the response");
    // Every API response is user-specific, including binary downloads.
    headers.set("Cache-Control", "private, no-store");
    return new Response(
      request.method === "HEAD" || [204, 304].includes(status) ? null : payload,
      { status, headers },
    );
  };
}
