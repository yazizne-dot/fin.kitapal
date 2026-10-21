import { resolveSession } from '../auth/sessions.mjs';
import { requirePrincipal, requirePermission } from '../auth/guards.mjs';
import { checkMutationRequest } from './security.mjs';
import { readCookie, readJson } from './account-routes.mjs';
import { sendJson } from './response.mjs';
import { withTransaction } from '../db/connection.mjs';
import { createDocument, postDocument, reverseDocument, listOperations } from '../finance/documents.mjs';
import { recordMovement, settleDocument, listMovements } from '../finance/movements.mjs';
import { createExpense, reviewExpense, listExpenses, listExpenseCategories, updateExpense, deleteExpense } from '../finance/expenses.mjs';
import { savePlan, saveBudgetItem, setPeriodClosed, listPlanning } from '../finance/planning.mjs';

export function registerFinanceRoutes(router, { pool, publicOrigin, csrfSecret }) {
  const security = { origin: publicOrigin, csrfSecret };
  async function principalFor(request) {
    const token = readCookie(request);
    return requirePrincipal(await resolveSession({ pool, token }));
  }
  async function mutation(request, permission) {
    const principal = await principalFor(request);
    checkMutationRequest(request, { ...principal, token: readCookie(request) }, security);
    return requirePermission(principal, permission);
  }
  function route(method, path, permission, action, status = 200) {
    router.add(method, path, async ({ request, response, requestId }) => {
      const principal = await mutation(request, permission);
      const input = await readJson(request);
      const result = await withTransaction(pool, client => action({ client, principal, input }));
      sendJson(response, status, result, requestId);
    });
  }

  route('POST', '/api/documents', 'finance.write', async ({ client, principal, input }) =>
    ({ document: await createDocument({ client, principal, input }) }), 201);
  route('POST', '/api/documents/post', 'finance.write', async ({ client, principal, input }) =>
    ({ document: await postDocument({ client, principal, id: input.id, version: input.version, idempotencyKey: input.idempotencyKey }) }));
  route('POST', '/api/documents/reverse', 'finance.write', async ({ client, principal, input }) =>
    ({ document: await reverseDocument({ client, principal, id: input.id, reason: input.reason }) }));
  router.add('GET', '/api/documents', async ({ request, response, requestId }) => {
    const principal = requirePermission(await principalFor(request), 'finance.read');
    const query = new URL(request.url, 'http://localhost').searchParams;
    const documents = await listOperations({ pool, principal, filters: {
      organizationId: query.get('organization_id'), start: query.get('start'), end: query.get('end'),
    } });
    sendJson(response, 200, { documents }, requestId);
  });

  route('POST', '/api/movements', 'finance.write', async ({ client, principal, input }) =>
    ({ movement: await recordMovement({ client, principal, input }) }), 201);
  route('POST', '/api/settlements', 'finance.write', async ({ client, principal, input }) =>
    ({ settlement: await settleDocument({ client, principal, documentId: input.documentId,
      movementId: input.movementId, amount: input.amount }) }), 201);
  router.add('GET', '/api/movements', async ({ request, response, requestId }) => {
    const principal = requirePermission(await principalFor(request), 'finance.read');
    const query = new URL(request.url, 'http://localhost').searchParams;
    sendJson(response, 200, { movements: await listMovements({ pool, principal, filters: {
      datasetKind: query.get('dataset'), start: query.get('start'), end: query.get('end'),
    } }) }, requestId);
  });

  route('POST', '/api/expenses', 'expenses.own', async ({ client, principal, input }) =>
    ({ expense: await createExpense({ client, principal, input }) }), 201);
  router.add('PATCH', '/api/expenses', async ({ request, response, requestId }) => {
    const principal = await principalFor(request);
    checkMutationRequest(request, { ...principal, token: readCookie(request) }, security);
    const input = await readJson(request);
    const result = await withTransaction(pool, async client => {
      if (input.action === 'delete') return deleteExpense({ client, principal, id: input.id, version: input.version });
      if (input.action === 'review' || input.decision)
        return reviewExpense({ client, principal, id: input.id, version: input.version,
          decision: input.decision ?? input.status, note: input.note });
      return updateExpense({ client, principal, input });
    });
    sendJson(response, 200, { ok: true, expense: result }, requestId);
  });
  router.add('GET', '/api/expenses', async ({ request, response, requestId }) => {
    const principal = await principalFor(request);
    const expenses = await listExpenses({ pool, principal });
    const categories = await listExpenseCategories(pool, principal);
    sendJson(response, 200, { expenses, categories }, requestId);
  });

  route('POST', '/api/plans', 'finance.write', async ({ client, principal, input }) =>
    ({ plan: await savePlan({ client, principal, input }) }), 201);
  route('POST', '/api/budget/items', 'finance.write', async ({ client, principal, input }) =>
    ({ item: await saveBudgetItem({ client, principal, input }) }));
  route('POST', '/api/period', 'finance.write', async ({ client, principal, input }) =>
    ({ period: await setPeriodClosed({ client, principal, organizationId: input.organizationId,
      month: input.month, closed: input.closed, reason: input.reason }) }));
  router.add('GET', '/api/plans', async ({ request, response, requestId }) => {
    const principal = requirePermission(await principalFor(request), 'finance.read');
    const organizationId = new URL(request.url, 'http://localhost').searchParams.get('organization_id');
    sendJson(response, 200, await listPlanning({ pool, principal, organizationId }), requestId);
  });
}
