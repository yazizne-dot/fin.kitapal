import { randomUUID } from 'node:crypto';
import { requirePermission, AccessError } from '../auth/guards.mjs';
import { FinanceError, money, dateOnly, id, assertOpenPeriod } from './validation.mjs';
import { audit } from './audit.mjs';

function monthStart(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}(?:-01)?$/.test(value)) throw new FinanceError('Invalid month');
  return dateOnly(value.length === 7 ? `${value}-01` : value);
}

const LEGACY_BUDGET_METRICS = Object.freeze({
  revenue: 'Revenue', cost: 'Cost', opex: 'Operating expense',
  depreciation: 'Depreciation', tax: 'Tax',
});

export async function savePlan({ client, principal, input }) {
  requirePermission(principal, 'finance.write');
  const organizationId = id(input.organizationId, 'organization ID');
  if (principal.organization_id && String(principal.organization_id) !== organizationId) throw new AccessError('Forbidden organization');
  const articleId = id(input.articleId, 'article ID');
  const plannedOn = dateOnly(input.date);
  const amount = money(input.amount, { allowZero: false });
  if (!['in', 'out'].includes(input.direction)) throw new FinanceError('Invalid plan direction');
  await assertOpenPeriod(client, organizationId, plannedOn);
  const row = (await client.query(`INSERT INTO qarzhy.payment_plans
    (organization_id,article_id,counterparty_id,document_id,planned_on,direction,amount,created_by)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, [organizationId, articleId,
    input.counterpartyId ? id(input.counterpartyId) : null, input.documentId ? id(input.documentId) : null,
    plannedOn, input.direction, amount, principal.id])).rows[0];
  await audit(client, principal, 'payment_plan_create', 'payment_plan', row.id,
    { after: { amount, planned_on: plannedOn } });
  return row;
}

export async function saveLegacyPlan({ client, principal, input }) {
  requirePermission(principal, 'finance.write');
  const orgName = typeof input.org === 'string' ? input.org.trim() : '';
  const articleName = typeof input.article === 'string' ? input.article.trim() : '';
  if (!orgName || orgName.length > 160 || !articleName || articleName.length > 160)
    throw new FinanceError('Invalid organization or article');
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0)
    throw new FinanceError('Invalid legacy plan amount');
  const organizations = (await client.query(`SELECT id FROM qarzhy.organizations
    WHERE active=true AND (code=$1 OR name=$1) ORDER BY id LIMIT 2`, [orgName])).rows;
  if (!organizations.length) throw new FinanceError('Organization not found', 404);
  if (organizations.length > 1) throw new FinanceError('Ambiguous organization', 409);
  const organizationId = organizations[0].id;
  if (principal.organization_id && String(principal.organization_id) !== String(organizationId))
    throw new AccessError('Forbidden organization');

  await client.query("SELECT pg_advisory_xact_lock(hashtext('plan-article:' || lower($1)))", [articleName]);
  let articles = (await client.query(`SELECT id FROM qarzhy.financial_articles
    WHERE active=true AND lower(name)=lower($1) ORDER BY id LIMIT 2`, [articleName])).rows;
  if (articles.length > 1) throw new FinanceError('Ambiguous financial article', 409);
  if (!articles.length) {
    const created = (await client.query(`INSERT INTO qarzhy.financial_articles(code,name)
      VALUES($1,$2) RETURNING id`, [`manual-plan-${randomUUID()}`, articleName])).rows[0];
    await audit(client, principal, 'financial_article_create', 'financial_article', created.id,
      { after: { name: articleName } });
    articles = [created];
  }
  return savePlan({ client, principal, input: {
    organizationId, articleId: articles[0].id, date: input.date,
    direction: input.direction, amount: String(input.amount),
  } });
}

export async function saveBudgetItem({ client, principal, input }) {
  requirePermission(principal, 'finance.write');
  const version = (await client.query(`SELECT b.*,s.organization_id,s.scope_type FROM qarzhy.budget_versions b
    JOIN qarzhy.report_scopes s ON s.id=b.scope_id WHERE b.id=$1 FOR UPDATE OF b`,
    [id(input.budgetVersionId, 'budget version ID')])).rows[0];
  if (!version) throw new FinanceError('Budget version not found', 404);
  if (version.status !== 'draft') throw new FinanceError('Only draft budgets can be edited', 409);
  if (version.scope_type !== 'organization') throw new FinanceError('Budget needs an organization scope');
  if (principal.organization_id && String(principal.organization_id) !== String(version.organization_id)) throw new AccessError('Forbidden organization');
  const month = monthStart(input.month);
  if (Number(month.slice(0, 4)) !== version.year) throw new FinanceError('Month is outside budget year');
  await assertOpenPeriod(client, version.organization_id, month);
  const amount = money(input.amount, { allowNegative: true });
  const row = (await client.query(`INSERT INTO qarzhy.budget_items
    (budget_version_id,month,metric_id,article_id,channel_id,amount,created_by)
    VALUES($1,$2,$3,$4,$5,$6,$7)
    ON CONFLICT (budget_version_id,month,metric_id,article_id,channel_id)
    DO UPDATE SET amount=EXCLUDED.amount,updated_at=now(),version=qarzhy.budget_items.version+1
    RETURNING *`, [version.id, month, id(input.metricId, 'metric ID'),
    input.articleId ? id(input.articleId) : null, input.channelId ? id(input.channelId) : null,
    amount, principal.id])).rows[0];
  await audit(client, principal, 'budget_item_save', 'budget_item', row.id,
    { after: { amount, month } });
  return row;
}

export async function saveLegacyBudget({ client, principal, input }) {
  requirePermission(principal, 'finance.write');
  const month = monthStart(input.month);
  const orgName = typeof input.org === 'string' ? input.org.trim() : '';
  const metric = input.metric;
  if (!orgName || orgName.length > 160) throw new FinanceError('Invalid organization');
  if (typeof metric !== 'string' || !Object.hasOwn(LEGACY_BUDGET_METRICS, metric))
    throw new FinanceError('Invalid budget metric');
  if (!Number.isSafeInteger(input.amount) || input.amount < 0)
    throw new FinanceError('Invalid legacy budget amount');
  const organizations = (await client.query(`SELECT id FROM qarzhy.organizations
    WHERE active=true AND name=$1 ORDER BY id LIMIT 2`, [orgName])).rows;
  if (!organizations.length) throw new FinanceError('Organization not found', 404);
  if (organizations.length > 1) throw new FinanceError('Ambiguous organization name', 409);
  const organizationId = organizations[0].id;
  if (principal.organization_id && String(principal.organization_id) !== String(organizationId))
    throw new AccessError('Forbidden organization');
  await assertOpenPeriod(client, organizationId, month);

  await client.query(`INSERT INTO qarzhy.report_scopes(scope_type,organization_id)
    VALUES('organization',$1) ON CONFLICT (scope_type,organization_id) DO NOTHING`, [organizationId]);
  const scope = (await client.query(`SELECT id FROM qarzhy.report_scopes
    WHERE scope_type='organization' AND organization_id=$1`, [organizationId])).rows[0];
  const year = Number(month.slice(0, 4));
  const name = `Legacy ledger budget ${year}`;
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`legacy-budget:${scope.id}:${year}`]);
  const drafts = (await client.query(`SELECT id FROM qarzhy.budget_versions
    WHERE scope_id=$1 AND year=$2 AND name=$3 AND status='draft' ORDER BY id LIMIT 2 FOR UPDATE`,
  [scope.id, year, name])).rows;
  if (drafts.length > 1) throw new FinanceError('Ambiguous legacy budget draft', 409);
  let versionId = drafts[0]?.id;
  if (!versionId) {
    versionId = (await client.query(`INSERT INTO qarzhy.budget_versions(scope_id,year,name,created_by)
      VALUES($1,$2,$3,$4) RETURNING id`, [scope.id, year, name, principal.id])).rows[0].id;
    await audit(client, principal, 'legacy_budget_draft_create', 'budget_version', versionId,
      { after: { organization_id: organizationId, year, name } });
  }
  const code = `legacy.ledger.${metric}`;
  await client.query(`INSERT INTO qarzhy.report_metrics(code,name,unit,calculation_kind)
    VALUES($1,$2,'amount','input') ON CONFLICT(code) DO NOTHING`,
  [code, LEGACY_BUDGET_METRICS[metric]]);
  const metricId = (await client.query('SELECT id FROM qarzhy.report_metrics WHERE code=$1', [code])).rows[0].id;
  const previous = (await client.query(`SELECT amount::text amount FROM qarzhy.budget_items
    WHERE budget_version_id=$1 AND month=$2 AND metric_id=$3
      AND article_id IS NULL AND channel_id IS NULL`, [versionId, month, metricId])).rows[0];
  const item = await saveBudgetItem({ client, principal, input: {
    budgetVersionId: versionId, month, metricId, amount: String(input.amount),
  } });
  await audit(client, principal, 'legacy_budget_save', 'budget_item', item.id,
    { before: previous ? { amount: previous.amount } : undefined,
      after: { amount: String(input.amount), month, organization_id: organizationId, metric } });
  return item;
}

export async function setPeriodClosed({ client, principal, organizationId: organizationInput, month, closed, reason }) {
  requirePermission(principal, 'finance.write');
  const organizationId = id(organizationInput, 'organization ID');
  if (principal.organization_id && String(principal.organization_id) !== organizationId) throw new AccessError('Forbidden organization');
  if (typeof closed !== 'boolean') throw new FinanceError('Invalid period state');
  if (typeof reason !== 'string' || !reason.trim() || reason.length > 2000) throw new FinanceError('Period change reason is required');
  const start = monthStart(month);
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`period:${organizationId}:${start}`]);
  const before = (await client.query('SELECT id,closed FROM qarzhy.accounting_periods WHERE organization_id=$1 AND starts_on=$2 FOR UPDATE',
    [organizationId, start])).rows[0];
  const row = (await client.query(`INSERT INTO qarzhy.accounting_periods(organization_id,starts_on,closed,updated_by)
    VALUES($1,$2,$3,$4) ON CONFLICT(organization_id,starts_on)
    DO UPDATE SET closed=EXCLUDED.closed,updated_by=EXCLUDED.updated_by,updated_at=now() RETURNING *`,
    [organizationId, start, closed, principal.id])).rows[0];
  await audit(client, principal, closed ? 'period_close' : 'period_reopen', 'accounting_period', row.id,
    { before: { closed: before?.closed ?? false }, after: { closed }, reason: reason.trim() });
  return row;
}

export async function setLegacyPeriodClosed({ client, principal, input }) {
  requirePermission(principal, 'finance.write');
  const month = monthStart(input.month);
  if (typeof input.closed !== 'boolean' || typeof input.reason !== 'string')
    throw new FinanceError('Invalid period state or reason');
  const reason = input.reason.trim() || (input.closed ? 'Closed from legacy period form' : '');
  if (!reason || reason.length > 2000) throw new FinanceError('Period change reason is required');
  const organizations = (await client.query(`SELECT id FROM qarzhy.organizations
    WHERE ($1::bigint IS NULL OR id=$1) ORDER BY id`, [principal.organization_id ?? null])).rows;
  if (!organizations.length) throw new FinanceError('Organization not found', 404);
  const periods = [];
  for (const organization of organizations) periods.push(await setPeriodClosed({
    client, principal, organizationId: organization.id, month,
    closed: input.closed, reason,
  }));
  return { periods };
}

export async function listPlanning({ pool, principal, organizationId }) {
  requirePermission(principal, 'finance.read');
  const scoped = principal.organization_id ?? organizationId;
  if (!scoped) throw new FinanceError('Organization is required');
  const plans = (await pool.query(`SELECT id,article_id,counterparty_id,document_id,planned_on,direction,
    amount::text,status,version FROM qarzhy.payment_plans WHERE organization_id=$1 ORDER BY planned_on,id LIMIT 500`,
    [scoped])).rows;
  const periods = (await pool.query(`SELECT starts_on,closed FROM qarzhy.accounting_periods
    WHERE organization_id=$1 ORDER BY starts_on DESC LIMIT 36`, [scoped])).rows;
  return { plans, periods };
}
