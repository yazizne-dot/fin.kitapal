import { forwardApiRequest } from "../../../server/http/api-forward.mjs";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function handle(request: Request): Promise<Response> {
  const backend = process.env.API_INTERNAL_URL;
  if (!backend)
    return Response.json({ error: "API unavailable" }, {
      status: 503, headers: { "cache-control": "private, no-store" },
    });
  return forwardApiRequest(request, backend);
}
export {
  handle as GET,
  handle as POST,
  handle as PATCH,
  handle as DELETE,
  handle as PUT,
  handle as HEAD,
};
