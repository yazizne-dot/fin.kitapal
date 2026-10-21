import { test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { assertTestDatabaseUrl } from './helpers/test-db.mjs';
import { getBalanceAt } from '../../backend/reports/balance.mjs';

test('balance requires verified opening snapshot and calculates cash without changing movements', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const pool = new pg.Pool({ connectionString: assertTestDatabaseUrl(process.env.TEST_DATABASE_URL) });
  try {
    const org = (await pool.query("INSERT INTO qarzhy.organizations(code,name) VALUES('balance_org','Balance Org') RETURNING id")).rows[0];
    const scope = (await pool.query("INSERT INTO qarzhy.report_scopes(scope_type,organization_id) VALUES('organization',$1) RETURNING id", [org.id])).rows[0];
    const dataset = (await pool.query("SELECT id FROM qarzhy.datasets WHERE kind='live'")).rows[0];
    const principal = { id: '1', permissions: ['finance.read'] };
    const absent = await getBalanceAt({ pool, principal, scopeId: scope.id, asOf: '2027-01-01' });
    assert.equal(absent.totals.cash, null);
    assert.equal(absent.complete, false);
    const snapshot = (await pool.query(`INSERT INTO qarzhy.balance_snapshots(dataset_id,scope_id,as_of_date,label,status)
      VALUES($1,$2,'2026-12-01','Opening','draft') RETURNING id`, [dataset.id, scope.id])).rows[0];
    const account = (await pool.query(`INSERT INTO qarzhy.cash_accounts(organization_id,code,name,account_type)
      VALUES($1,'balance_account','Balance Account','bank') RETURNING id`, [org.id])).rows[0];
    await pool.query('INSERT INTO qarzhy.cash_balances(snapshot_id,cash_account_id,amount) VALUES($1,$2,100.10)', [snapshot.id, account.id]);
    const draft = await getBalanceAt({ pool, principal, scopeId: scope.id, asOf: '2027-01-01', source: 'opening_and_movements' });
    assert.equal(draft.totals.cash, null);
    await pool.query("UPDATE qarzhy.balance_snapshots SET status='verified' WHERE id=$1", [snapshot.id]);
    await pool.query(`INSERT INTO qarzhy.coverage_rules(dataset_id,scope_id,report_family,starts_on,ends_on,source_kind,opening_snapshot_id)
      VALUES($1,$2,'balance','2026-12-01','2027-02-01','opening_and_movements',$3)`, [dataset.id, scope.id, snapshot.id]);
    await pool.query(`INSERT INTO qarzhy.cash_movements(dataset_id,scope_id,organization_id,cash_account_id,occurred_on,direction,amount,posting_key)
      VALUES($1,$2,$3,$4,'2026-12-12','in',10.25,'balance-in'),
            ($1,$2,$3,$4,'2026-12-13','out',4.00,'balance-out')`, [dataset.id, scope.id, org.id, account.id]);
    const result = await getBalanceAt({ pool, principal, scopeId: scope.id, asOf: '2027-01-01' });
    assert.equal(result.source, 'opening_and_movements');
    assert.equal(result.totals.cash, '106.35');
    assert.equal(result.totals.assets, null);
    assert.equal(result.complete, false);
    assert.match(result.warnings.join(' '), /inventory|asset/i);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM qarzhy.cash_movements WHERE posting_key IN ('balance-in','balance-out')")).rows[0].n, 2);
  } finally { await pool.end(); }
});

test('consolidated cash balance includes live movements recorded under organization scopes', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const pool = new pg.Pool({ connectionString: assertTestDatabaseUrl(process.env.TEST_DATABASE_URL) });
  try {
    const consolidated = (await pool.query("SELECT id FROM qarzhy.report_scopes WHERE scope_type='consolidated'")).rows[0];
    const first = (await pool.query("SELECT id FROM qarzhy.organizations WHERE code='balance_org'")).rows[0];
    const second = (await pool.query("INSERT INTO qarzhy.organizations(code,name) VALUES('balance_second_org','Second Org') RETURNING id")).rows[0];
    const secondScope = (await pool.query("INSERT INTO qarzhy.report_scopes(scope_type,organization_id) VALUES('organization',$1) RETURNING id", [second.id])).rows[0];
    const dataset = (await pool.query("SELECT id FROM qarzhy.datasets WHERE kind='live'")).rows[0];
    const account = (await pool.query("SELECT id FROM qarzhy.cash_accounts WHERE code='balance_account'")).rows[0];
    const secondAccount = (await pool.query(`INSERT INTO qarzhy.cash_accounts(organization_id,code,name,account_type)
      VALUES($1,'balance_second_account','Second Account','bank') RETURNING id`, [second.id])).rows[0];
    const snapshot = (await pool.query(`INSERT INTO qarzhy.balance_snapshots(dataset_id,scope_id,as_of_date,label,status)
      VALUES($1,$2,'2028-01-01','Consolidated','verified') RETURNING id`, [dataset.id, consolidated.id])).rows[0];
    await pool.query('INSERT INTO qarzhy.cash_balances(snapshot_id,cash_account_id,amount) VALUES($1,$2,100)', [snapshot.id, account.id]);
    await pool.query('INSERT INTO qarzhy.cash_balances(snapshot_id,cash_account_id,amount) VALUES($1,$2,20)', [snapshot.id, secondAccount.id]);
    await pool.query(`INSERT INTO qarzhy.coverage_rules(dataset_id,scope_id,report_family,starts_on,ends_on,source_kind,opening_snapshot_id)
      VALUES($1,$2,'balance','2028-01-01','2028-03-01','opening_and_movements',$3)`, [dataset.id, consolidated.id, snapshot.id]);
    const firstScope = (await pool.query('SELECT id FROM qarzhy.report_scopes WHERE organization_id=$1', [first.id])).rows[0];
    for (const [organization, scope, cashAccount, amount, postingKey] of [
      [first.id, firstScope.id, account.id, '10.25', 'balance-consolidated-first'],
      [second.id, secondScope.id, secondAccount.id, '5.50', 'balance-consolidated-second'],
    ]) await pool.query(`INSERT INTO qarzhy.cash_movements(dataset_id,scope_id,organization_id,cash_account_id,occurred_on,direction,amount,posting_key)
      VALUES($1,$2,$3,$4,'2028-01-15','in',$5,$6)`, [dataset.id, scope, organization, cashAccount, amount, postingKey]);
    const result = await getBalanceAt({ pool, principal: { id: '1', permissions: ['finance.read'] },
      scopeId: consolidated.id, asOf: '2028-02-01' });
    assert.equal(result.totals.cash, '135.75');
  } finally { await pool.end(); }
});

test('balance debt components account for posted documents and partial settlements', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const pool = new pg.Pool({ connectionString: assertTestDatabaseUrl(process.env.TEST_DATABASE_URL) });
  try {
    const org = (await pool.query("SELECT id FROM qarzhy.organizations WHERE code='balance_org'")).rows[0];
    const scope = (await pool.query('SELECT id FROM qarzhy.report_scopes WHERE organization_id=$1', [org.id])).rows[0];
    const dataset = (await pool.query("SELECT id FROM qarzhy.datasets WHERE kind='live'")).rows[0];
    const account = (await pool.query("SELECT id FROM qarzhy.cash_accounts WHERE code='balance_account'")).rows[0];
    const counterparty = (await pool.query("INSERT INTO qarzhy.counterparties(name) VALUES('Balance Customer') RETURNING id")).rows[0];
    const snapshot = (await pool.query(`INSERT INTO qarzhy.balance_snapshots(dataset_id,scope_id,as_of_date,label,status)
      VALUES($1,$2,'2029-01-01','Debt opening','verified') RETURNING id`, [dataset.id, scope.id])).rows[0];
    await pool.query('INSERT INTO qarzhy.cash_balances(snapshot_id,cash_account_id,amount) VALUES($1,$2,100)', [snapshot.id, account.id]);
    await pool.query(`INSERT INTO qarzhy.counterparty_balances(snapshot_id,counterparty_id,balance_kind,amount)
      VALUES($1,$2,'receivable',50),($1,$2,'payable',20)`, [snapshot.id, counterparty.id]);
    await pool.query(`INSERT INTO qarzhy.coverage_rules(dataset_id,scope_id,report_family,starts_on,ends_on,source_kind,opening_snapshot_id)
      VALUES($1,$2,'balance','2029-01-01','2029-03-01','opening_and_movements',$3)`, [dataset.id, scope.id, snapshot.id]);
    async function document(kind, amount, key) {
      const doc = (await pool.query(`INSERT INTO qarzhy.documents(dataset_id,organization_id,counterparty_id,kind,input_mode,number,
        document_date,status,total_amount,idempotency_key) VALUES($1,$2,$3,$4,'summary',$5,'2029-01-10','posted',$6,$5) RETURNING id`,
      [dataset.id, org.id, counterparty.id, kind, key, amount])).rows[0];
      await pool.query(`INSERT INTO qarzhy.financial_events(dataset_id,scope_id,organization_id,occurred_on,event_kind,
        counterparty_id,document_id,amount,posting_key) VALUES($1,$2,$3,'2029-01-10',$4,$5,$6,$7,$8)`,
      [dataset.id, scope.id, org.id, kind === 'sale' ? 'revenue' : 'purchase', counterparty.id, doc.id, amount, `event-${key}`]);
      return doc;
    }
    const sale = await document('sale', '40.00', 'debt-sale');
    const purchase = await document('purchase', '15.00', 'debt-purchase');
    async function settle(doc, direction, value, key) {
      const movement = (await pool.query(`INSERT INTO qarzhy.cash_movements(dataset_id,scope_id,organization_id,cash_account_id,
        occurred_on,direction,amount,counterparty_id,posting_key)
        VALUES($1,$2,$3,$4,'2029-01-15',$5,$6,$7,$8) RETURNING id`,
      [dataset.id, scope.id, org.id, account.id, direction, value, counterparty.id, key])).rows[0];
      await pool.query('INSERT INTO qarzhy.document_settlements(document_id,cash_movement_id,amount) VALUES($1,$2,$3)',
        [doc.id, movement.id, value]);
    }
    await settle(sale, 'in', '12.50', 'debt-sale-payment');
    await settle(purchase, 'out', '5.00', 'debt-purchase-payment');
    const result = await getBalanceAt({ pool, principal: { id: '1', permissions: ['finance.read'] },
      scopeId: scope.id, asOf: '2029-02-01' });
    assert.equal(result.totals.cash, '107.50');
    assert.equal(result.totals.receivable, '77.50');
    assert.equal(result.totals.payable, '30.00');
    assert.equal((await pool.query('SELECT total_amount::text FROM qarzhy.documents WHERE id=$1', [sale.id])).rows[0].total_amount, '40.00');
    await pool.query(`INSERT INTO qarzhy.cash_movements(dataset_id,scope_id,organization_id,cash_account_id,
      occurred_on,direction,amount,counterparty_id,posting_key)
      VALUES($1,$2,$3,$4,'2029-01-20','in',1.00,$5,'debt-unallocated')`,
    [dataset.id, scope.id, org.id, account.id, counterparty.id]);
    const unresolved = await getBalanceAt({ pool, principal: { id: '1', permissions: ['finance.read'] },
      scopeId: scope.id, asOf: '2029-02-01' });
    assert.equal(unresolved.totals.receivable, null);
    assert.equal(unresolved.totals.payable, null);
    assert.match(unresolved.warnings.join(' '), /Unallocated/);
  } finally { await pool.end(); }
});
