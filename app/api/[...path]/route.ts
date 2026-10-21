import { getPortalHandler } from "../../../server/runtime";
import { forwardApiRequest } from "../../../server/http/api-forward.mjs";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function handle(request: Request): Promise<Response> {
  if (process.env.API_INTERNAL_URL)
    return forwardApiRequest(request, process.env.API_INTERNAL_URL);
  return (await getPortalHandler())(request);
}
export {
  handle as GET,
  handle as POST,
  handle as PATCH,
  handle as DELETE,
  handle as PUT,
  handle as HEAD,
};
