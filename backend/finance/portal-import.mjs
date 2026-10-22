import { requirePermission, AccessError } from '../auth/guards.mjs';
import { FinanceError } from './validation.mjs';
import { createPortalOperation } from './portal-operations.mjs';
import { audit } from './audit.mjs';

export async function importPortalOperations({ client, principal, rows }) {
  requirePermission(principal, 'finance.write');
  if (!Array.isArray(rows) || rows.length > 5000)
    throw new FinanceError('Import accepts at most 5000 rows');
  let added = 0, duplicates = 0;
  const errors = [];
  for (let index = 0; index < rows.length; index++) {
    await client.query('SAVEPOINT portal_import_row');
    try {
      if (!rows[index] || typeof rows[index] !== 'object' || Array.isArray(rows[index]))
        throw new FinanceError('Invalid import row');
      const result = await createPortalOperation({ client, principal, input: rows[index] });
      if (result.duplicate) duplicates++;
      else added++;
      await client.query('RELEASE SAVEPOINT portal_import_row');
    } catch (error) {
      await client.query('ROLLBACK TO SAVEPOINT portal_import_row');
      await client.query('RELEASE SAVEPOINT portal_import_row');
      errors.push({ row: index + 2,
        message: error instanceof FinanceError || error instanceof AccessError
          ? error.message : 'Row could not be imported' });
    }
  }
  await audit(client, principal, 'portal_operations_import', 'portal_import', null,
    { after: { added, duplicates, errors } });
  return { added, duplicates, errors };
}
