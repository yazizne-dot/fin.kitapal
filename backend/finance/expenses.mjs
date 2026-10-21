import { requirePermission, AccessError } from '../auth/guards.mjs';
import { FinanceError, money, dateOnly, id, assertOpenPeriod } from './validation.mjs';
import { audit } from './audit.mjs';

export async function createExpense({ client, principal, input }) {
  const owns = principal.permissions?.includes('expenses.own');
  if (!owns && !principal.permissions?.includes('expenses.review')) throw new AccessError('Forbidden');
  if (principal.password_change_due) throw new AccessError('Password change required');
  const userId = owns ? principal.id : id(input.userId ?? principal.id, 'user ID');
  const organizationId = principal.organization_id || (owns ? null : input.organizationId);
  const articleId = id(input.articleId, 'article ID');
  const occurredOn = dateOnly(input.date);
  const amount = money(input.amount, { allowZero: false });
  if (typeof input.description !== 'string' || !input.description.trim() || input.description.length > 2000)
    throw new FinanceError('Invalid expense description');
  if (organizationId) await assertOpenPeriod(client, organizationId, occurredOn);
  const expense = (await client.query(`INSERT INTO qarzhy.employee_expenses
    (user_id,organization_id,article_id,occurred_on,amount,description,vendor_label,created_by)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, [userId, organizationId ?? null, articleId,
    occurredOn, amount, input.description.trim(), String(input.vendor ?? '').slice(0, 200), principal.id])).rows[0];
  await audit(client, principal, 'expense_create', 'employee_expense', expense.id,
    { after: { user_id: userId, amount, status: 'submitted' } });
  return expense;
}

export async function reviewExpense({ client, principal, id: expenseId, version, decision, note = '' }) {
  requirePermission(principal, 'expenses.review');
  if (!['approved', 'rejected'].includes(decision)) throw new FinanceError('Invalid review decision');
  if (typeof note !== 'string' || note.length > 2000) throw new FinanceError('Invalid review note');
  const expense = (await client.query('SELECT * FROM qarzhy.employee_expenses WHERE id=$1 FOR UPDATE', [id(expenseId)])).rows[0];
  if (!expense || expense.deleted_at) throw new FinanceError('Expense not found', 404);
  if (principal.organization_id && String(principal.organization_id) !== String(expense.organization_id)) throw new AccessError('Forbidden organization');
  if (expense.status !== 'submitted') throw new FinanceError('Expense status conflict', 409);
  if (Number(expense.version) !== Number(version)) throw new FinanceError('Expense version conflict', 409);
  if (!expense.organization_id) throw new FinanceError('Expense requires an organization before review');
  await assertOpenPeriod(client, expense.organization_id, expense.occurred_on);
  const updated = (await client.query(`UPDATE qarzhy.employee_expenses SET status=$2,reviewed_by=$3,
    reviewed_at=now(),updated_at=now(),version=version+1 WHERE id=$1 RETURNING *`,
    [expense.id, decision, principal.id])).rows[0];
  await client.query(`INSERT INTO qarzhy.expense_reviews(expense_id,reviewer_id,decision,note,expense_version)
    VALUES($1,$2,$3,$4,$5)`, [expense.id, principal.id, decision, note, expense.version]);
  if (decision === 'approved') {
    const dataset = (await client.query("SELECT id FROM qarzhy.datasets WHERE kind='live'")).rows[0];
    const scope = (await client.query("SELECT id FROM qarzhy.report_scopes WHERE scope_type='organization' AND organization_id=$1",
      [expense.organization_id])).rows[0];
    if (!dataset || !scope) throw new FinanceError('Live report scope is missing');
    await client.query(`INSERT INTO qarzhy.financial_events
      (dataset_id,scope_id,organization_id,occurred_on,event_kind,article_id,expense_id,amount,author_id,posting_key,created_by)
      VALUES($1,$2,$3,$4,'opex',$5,$6,$7,$8,$9,$8)`, [dataset.id, scope.id, expense.organization_id,
      expense.occurred_on, expense.article_id, expense.id, expense.amount, principal.id,
      `expense:${expense.id}:recognition`]);
  }
  await audit(client, principal, 'expense_review', 'employee_expense', expense.id,
    { before: { status: 'submitted' }, after: { status: decision }, reason: note });
  return updated;
}

export async function listExpenses({ pool, principal, filters = {} }) {
  if (principal.password_change_due) throw new AccessError('Password change required');
  const reviewer = principal.permissions?.includes('expenses.review');
  const own = principal.permissions?.includes('expenses.own');
  if (!reviewer && !own) throw new AccessError('Forbidden');
  const params = [];
  const where = ['e.deleted_at IS NULL'];
  if (!reviewer) { params.push(principal.id); where.push(`e.user_id=$${params.length}`); }
  if (principal.organization_id) { params.push(principal.organization_id); where.push(`e.organization_id=$${params.length}`); }
  if (filters.status) { params.push(filters.status); where.push(`e.status=$${params.length}`); }
  const rows = (await pool.query(`SELECT e.id,e.user_id,u.name AS user_name,e.organization_id,e.article_id,
    e.occurred_on,e.amount::text,e.description,e.vendor_label,e.status,e.version,
    coalesce(r.note,'') AS review_note FROM qarzhy.employee_expenses e
    JOIN qarzhy.users u ON u.id=e.user_id
    LEFT JOIN LATERAL (SELECT note FROM qarzhy.expense_reviews WHERE expense_id=e.id ORDER BY reviewed_at DESC LIMIT 1) r ON true
    WHERE ${where.join(' AND ')} ORDER BY e.occurred_on DESC,e.id DESC LIMIT 500`, params)).rows;
  return rows;
}
