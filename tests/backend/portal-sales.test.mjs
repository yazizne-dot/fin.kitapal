import { test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { assertTestDatabaseUrl } from './helpers/test-db.mjs';
import { buildPortalFinanceData } from '../../backend/reports/portal-data.mjs';

test('live sales channels use scoped facts and a channel view does not invent overhead', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const pool = new pg.Pool({ connectionString: assertTestDatabaseUrl(process.env.TEST_DATABASE_URL) });
  try {
    const org = (await pool.query("INSERT INTO qarzhy.organizations(code,name) VALUES('portal_sales_org','Sales Org') RETURNING id")).rows[0];
    const otherOrg = (await pool.query("INSERT INTO qarzhy.organizations(code,name) VALUES('portal_sales_other','Other Org') RETURNING id")).rows[0];
    const scope = (await pool.query("INSERT INTO qarzhy.report_scopes(scope_type,organization_id) VALUES('organization',$1) RETURNING id", [org.id])).rows[0];
    const otherScope = (await pool.query("INSERT INTO qarzhy.report_scopes(scope_type,organization_id) VALUES('organization',$1) RETURNING id", [otherOrg.id])).rows[0];
    const channel = (await pool.query("INSERT INTO qarzhy.sales_channels(code,name) VALUES('portal_sales_web','Web') RETURNING id")).rows[0];
    const otherChannel = (await pool.query("INSERT INTO qarzhy.sales_channels(code,name) VALUES('portal_sales_other_web','Private') RETURNING id")).rows[0];
    const dataset = (await pool.query("SELECT id FROM qarzhy.datasets WHERE kind='live'")).rows[0];
    await pool.query(`INSERT INTO qarzhy.coverage_rules(dataset_id,scope_id,report_family,starts_on,ends_on,source_kind)
      VALUES($1,$2,'pnl','2032-03-01','2032-04-01','events')`, [dataset.id, scope.id]);
    await pool.query(`INSERT INTO qarzhy.financial_events(dataset_id,scope_id,organization_id,occurred_on,event_kind,channel_id,amount,cost_amount,posting_key)
      VALUES($1,$2,$3,'2032-03-10','revenue',$4,100,40,'portal-sales-revenue'),
            ($1,$2,$3,'2032-03-11','cost',$4,5,NULL,'portal-sales-cost'),
            ($1,$2,$3,'2032-03-12','opex',NULL,20,NULL,'portal-sales-overhead')`,
    [dataset.id, scope.id, org.id, channel.id]);
    await pool.query(`INSERT INTO qarzhy.financial_events(dataset_id,scope_id,organization_id,occurred_on,event_kind,channel_id,amount,posting_key)
      VALUES($1,$2,$3,'2032-03-12','revenue',$4,900,'portal-sales-private')`,
    [dataset.id, otherScope.id, otherOrg.id, otherChannel.id]);
    const principal = { id: '1', role: 'finance', organization_id: org.id, name: 'Finance', username: 'sales',
      language: 'ru', active: true, permissions: ['finance.read'] };
    const all = await buildPortalFinanceData({ pool, principal, filters: { month: '2032-03' } });
    assert.deepEqual(all.channels.map(row => row.label), ['Web']);
    assert.equal(all.channels[0].revenue, 100);
    assert.equal(all.channels[0].cost, 45);
    assert.equal(all.channels[0].gross, 55);
    assert.equal(all.report.profit, 35);
    const selected = await buildPortalFinanceData({ pool, principal,
      filters: { month: '2032-03', channel: String(channel.id) } });
    assert.equal(selected.channel, String(channel.id));
    assert.equal(selected.report.revenue, 100);
    assert.equal(selected.report.gross, 55);
    assert.equal(selected.report.profit, null);
    assert.equal(selected.statements.balance, null);
    assert.equal(selected.budgetRows.length, 0);
    await assert.rejects(buildPortalFinanceData({ pool, principal,
      filters: { month: '2032-03', channel: String(otherChannel.id) } }), /not available|not found/i);
  } finally { await pool.end(); }
});
