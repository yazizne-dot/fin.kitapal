import { resolveSession } from '../auth/sessions.mjs';
import { requirePrincipal, requirePermission } from '../auth/guards.mjs';
import { readCookie } from './account-routes.mjs';
import { sendJson } from './response.mjs';

export function registerAuditRoutes(router, { pool }) {
  router.add('GET', '/api/finance/audit', async ({ request, response, requestId }) => {
    requirePermission(requirePrincipal(await resolveSession({ pool, token: readCookie(request) })),
      'accounts.manage');
    const rows = (await pool.query(`SELECT id,occurred_at,actor_name,action,entity_type,entity_id,reason
      FROM qarzhy.audit_log ORDER BY occurred_at DESC,id DESC LIMIT 100`)).rows;
    const audit = rows.map(row => ({ id: row.id, time: row.occurred_at, author: row.actor_name,
      action: row.action, detail: [row.entity_type ? `${row.entity_type} #${row.entity_id ?? '?'}` : '',
        row.reason ?? ''].filter(Boolean).join(' · ') }));
    sendJson(response, 200, { audit }, requestId);
  });
}
