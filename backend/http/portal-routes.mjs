import { resolveSession } from '../auth/sessions.mjs';
import { requirePrincipal, requirePermission, AccessError } from '../auth/guards.mjs';
import { listExpenses, listExpenseCategories } from '../finance/expenses.mjs';
import { readCookie, userJson } from './account-routes.mjs';
import { sendJson } from './response.mjs';

export function registerPortalRoutes(router, { pool }) {
  router.add('GET', '/api/data', async ({ request, response, requestId }) => {
    const principal = requirePrincipal(await resolveSession({ pool, token: readCookie(request) }));
    if (principal.role !== 'employee')
      throw new AccessError('Financial portal data contract is not ready', 503);
    requirePermission(principal, 'expenses.own');
    const expenses = await listExpenses({ pool, principal });
    const categories = await listExpenseCategories(pool, principal);
    sendJson(response, 200, { source: 'personal', user: userJson(principal), expenses, categories }, requestId);
  });
}
