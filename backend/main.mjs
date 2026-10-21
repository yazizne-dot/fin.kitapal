import { createPool } from './db/connection.mjs';
import { startApi } from './http/server.mjs';
import { registerAccountRoutes } from './http/account-routes.mjs';
import { registerFinanceRoutes } from './http/finance-routes.mjs';
import { registerReportRoutes } from './http/report-routes.mjs';
import { registerPortalRoutes } from './http/portal-routes.mjs';
import { registerAuditRoutes } from './http/audit-routes.mjs';

const pool = createPool({ connectionString: process.env.DATABASE_URL });
const port = Number(process.env.API_PORT || 3139);
const host = process.env.API_HOST || '127.0.0.1';
const server = await startApi({ pool, port, host, registerRoutes: router => {
  const services = { pool, publicOrigin: process.env.PUBLIC_APP_ORIGIN, csrfSecret: process.env.CSRF_SECRET };
  registerAccountRoutes(router, services);
  registerFinanceRoutes(router, services);
  registerReportRoutes(router, services);
  registerPortalRoutes(router, services);
  registerAuditRoutes(router, services);
} });
console.info(`API listening on ${host}:${server.address().port}`);

async function shutdown() {
  await new Promise(resolve => server.close(resolve));
  await pool.end();
}
process.once('SIGINT', () => { shutdown().then(() => process.exit(0)); });
process.once('SIGTERM', () => { shutdown().then(() => process.exit(0)); });
