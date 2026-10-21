import { AccessError } from '../auth/guards.mjs';
import { FinanceError, id } from '../finance/validation.mjs';

export async function assertReportScope(db, principal, scopeInput) {
  const scopeId = id(scopeInput, 'scope ID');
  const scope = (await db.query('SELECT organization_id FROM qarzhy.report_scopes WHERE id=$1', [scopeId])).rows[0];
  if (!scope) throw new FinanceError('Report scope not found', 404);
  if (principal.organization_id && String(principal.organization_id) !== String(scope.organization_id))
    throw new AccessError('Forbidden scope');
  return scopeId;
}
