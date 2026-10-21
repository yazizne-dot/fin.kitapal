import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { assertSchema } from '../db/connection.mjs';
import { sendError, sendJson } from './response.mjs';

export function createApi({ pool, clock = () => new Date(), registerRoutes } = {}) {
  const routes = new Map();
  const router = {
    add(method, path, handler) {
      const key = `${method.toUpperCase()} ${path}`;
      if (routes.has(key)) throw new Error(`Duplicate route: ${key}`);
      routes.set(key, handler);
    },
  };
  registerRoutes?.(router);
  return createServer(async (request, response) => {
    const requestId = randomUUID();
    try {
      const path = new URL(request.url, 'http://localhost').pathname;
      if (request.method === 'GET' && path === '/health') {
        await pool.query('SELECT 1');
        sendJson(response, 200, { ok: true }, requestId);
        return;
      }
      const handler = routes.get(`${request.method} ${path}`);
      if (!handler) return sendError(response, 404, 'Not found', requestId);
      await handler({ request, response, pool, clock, requestId });
    } catch (error) {
      if (response.headersSent) return response.destroy();
      const status = error.status || (typeof error.code === 'string' && error.code.startsWith('08') ? 503 : 500);
      if (status >= 500) console.error(`[${requestId}] API request failed: ${error.message}`);
      sendError(response, status, status >= 500 ? 'Service unavailable' : error.message, requestId);
    }
  });
}

export async function startApi({ pool, host = '127.0.0.1', port = 3139, clock, registerRoutes } = {}) {
  await assertSchema(pool);
  const server = createApi({ pool, clock, registerRoutes });
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, resolve);
    });
    return server;
  } catch (error) {
    server.close();
    throw error;
  }
}
