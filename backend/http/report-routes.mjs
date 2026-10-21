import { resolveSession } from '../auth/sessions.mjs';
import { requirePrincipal, requirePermission } from '../auth/guards.mjs';
import { checkMutationRequest } from './security.mjs';
import { readCookie, readJson } from './account-routes.mjs';
import { sendJson } from './response.mjs';
import { withTransaction } from '../db/connection.mjs';
import { getCoverage, saveCoverage, verifyOpeningSnapshot } from '../reports/coverage.mjs';
import { getPnlPeriod } from '../reports/pnl.mjs';
import { getCashflowPeriod } from '../reports/cashflow.mjs';
import { listEditableFigures, setReportOverride, resetReportOverride } from '../reports/overrides.mjs';

export function registerReportRoutes(router, { pool, publicOrigin, csrfSecret }) {
  async function principalFor(request, permission = 'finance.read') {
    return requirePermission(requirePrincipal(await resolveSession({ pool, token: readCookie(request) })), permission);
  }
  async function mutate({ request, response, requestId }, action) {
    const principal = await principalFor(request, 'finance.write');
    checkMutationRequest(request, { ...principal, token: readCookie(request) },
      { origin: publicOrigin, csrfSecret });
    const input = await readJson(request);
    const result = await withTransaction(pool, client => action({ client, principal, input }));
    sendJson(response, 200, result, requestId);
  }
  router.add('GET', '/api/reports/pnl', async ({ request, response, requestId }) => {
    const principal = await principalFor(request);
    const query = new URL(request.url, 'http://localhost').searchParams;
    sendJson(response, 200, await getPnlPeriod({ pool, principal, scopeId: query.get('scope_id'),
      start: query.get('start'), end: query.get('end'), periodKind: query.get('kind') || 'monthly',
      source: query.get('source') || 'auto' }), requestId);
  });
  router.add('GET', '/api/reports/cashflow', async ({ request, response, requestId }) => {
    const principal = await principalFor(request);
    const query = new URL(request.url, 'http://localhost').searchParams;
    sendJson(response, 200, await getCashflowPeriod({ pool, principal, scopeId: query.get('scope_id'),
      start: query.get('start'), end: query.get('end'), source: query.get('source') || 'auto' }), requestId);
  });
  router.add('GET', '/api/reports/coverage', async ({ request, response, requestId }) => {
    const principal = await principalFor(request);
    const query = new URL(request.url, 'http://localhost').searchParams;
    sendJson(response, 200, await getCoverage({ pool, principal, family: query.get('family'),
      scopeId: query.get('scope_id'), metricId: query.get('metric_id'),
      start: query.get('start'), end: query.get('end') }), requestId);
  });
  router.add('POST', '/api/reports/coverage', context => mutate(context,
    ({ client, principal, input }) => saveCoverage({ client, principal, input })));
  router.add('POST', '/api/reports/opening-snapshot/verify', context => mutate(context,
    ({ client, principal, input }) => verifyOpeningSnapshot({ client, principal, id: input.id, version: input.version })));
  router.add('GET', '/api/reports/figures', async ({ request, response, requestId }) => {
    const principal = await principalFor(request);
    const query = new URL(request.url, 'http://localhost').searchParams;
    sendJson(response, 200, await listEditableFigures({ pool, principal, filters: {
      datasetId: query.get('dataset_id'), scopeId: query.get('scope_id'), reportFamily: query.get('family'),
      periodStart: query.get('start'), periodEnd: query.get('end'), periodKind: query.get('kind'),
    } }), requestId);
  });
  router.add('POST', '/api/reports/figures', context => mutate(context,
    ({ client, principal, input }) => setReportOverride({ client, principal, key: input.key,
      value: input.value, revision: input.revision, reason: input.reason })));
  router.add('POST', '/api/reports/figures/reset', context => mutate(context,
    ({ client, principal, input }) => resetReportOverride({ client, principal, key: input.key,
      revision: input.revision, reason: input.reason })));
}
