import { workbook } from '../../server/exports/xlsx.mjs';
import { resolveSession } from '../auth/sessions.mjs';
import { AccessError, requirePrincipal, requirePermission } from '../auth/guards.mjs';
import { readCookie, readJson } from './account-routes.mjs';
import { checkMutationRequest } from './security.mjs';

function validRows(rows) {
  return Array.isArray(rows) && rows.length > 0 && rows.length <= 5001 &&
    rows.every(row => Array.isArray(row) && row.length > 0 && row.length <= 30 &&
      row.every(cell => cell == null ||
        (typeof cell === 'string' && cell.length <= 10_000) ||
        (typeof cell === 'number' && Number.isFinite(cell))));
}

export function registerExportRoutes(router, { pool, publicOrigin, csrfSecret }) {
  router.add('POST', '/api/export', async ({ request, response, requestId }) => {
    const token = readCookie(request);
    const principal = requirePermission(requirePrincipal(await resolveSession({ pool, token })), 'finance.read');
    checkMutationRequest(request, { ...principal, token }, { origin: publicOrigin, csrfSecret });
    const { rows } = await readJson(request, 1_000_000);
    if (!validRows(rows)) throw new AccessError('Invalid export rows', 400);
    const file = workbook(rows);
    response.writeHead(200, {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': 'attachment; filename="qarzhy.xlsx"',
      'content-length': file.length,
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
      'x-request-id': requestId,
    });
    response.end(file);
  });
}
