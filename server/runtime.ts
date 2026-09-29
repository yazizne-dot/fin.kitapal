import "server-only";
import { createWebHandler } from "./http/web-handler.mjs";
type WebHandler = (request: Request) => Promise<Response>;
const runtime = globalThis as typeof globalThis & {
  qarzhyHandler?: Promise<WebHandler>;
};

/** Lazy initialization: next build and page rendering never open the database. */
export function getPortalHandler(): Promise<WebHandler> {
  runtime.qarzhyHandler ??= import("./http/portal.mjs")
    .then(({ createPortalHandler }) =>
      createWebHandler(createPortalHandler().handle),
    )
    .catch((error: unknown) => {
      delete runtime.qarzhyHandler;
      throw error;
    });
  return runtime.qarzhyHandler;
}
