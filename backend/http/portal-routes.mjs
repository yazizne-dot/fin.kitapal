import { resolveSession } from '../auth/sessions.mjs';
import { requirePrincipal, requirePermission } from '../auth/guards.mjs';
import { listExpenses, listExpenseCategories } from '../finance/expenses.mjs';
import { readCookie, userJson } from './account-routes.mjs';
import { sendJson } from './response.mjs';
import { buildPortalFinanceData } from '../reports/portal-data.mjs';
import { buildLegacyLedgerData } from '../reports/legacy-ledger.mjs';

export function registerPortalRoutes(router, { pool }) {
  router.add('GET', '/api/data', async ({ request, response, requestId }) => {
    const principal = requirePrincipal(await resolveSession({ pool, token: readCookie(request) }));
    if (principal.role === 'employee') {
      requirePermission(principal, 'expenses.own');
      const expenses = await listExpenses({ pool, principal });
      const categories = await listExpenseCategories(pool, principal);
      sendJson(response, 200, { source: 'personal', user: userJson(principal), expenses, categories }, requestId);
      return;
    }
    const query = new URL(request.url, 'http://localhost').searchParams;
    const filters = {
      month: query.get('month'), range: query.get('range'), channel: query.get('channel'),
      org: query.get('org'), source: query.get('source'),
    };
    sendJson(response, 200, await (filters.source === 'ledger'
      ? buildLegacyLedgerData({ pool, principal, filters })
      : buildPortalFinanceData({ pool, principal, filters })), requestId);
  });
}
