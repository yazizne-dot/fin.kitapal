import { test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { assertTestDatabaseUrl } from './helpers/test-db.mjs';
import { withTransaction } from '../../backend/db/connection.mjs';
import { createDocument, postDocument, reverseDocument } from '../../backend/finance/documents.mjs';

test('posting one live sale is idempotent and preserves exact money', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const pool = new pg.Pool({ connectionString: assertTestDatabaseUrl(process.env.TEST_DATABASE_URL) });
  try {
    const org = (await pool.query("INSERT INTO qarzhy.organizations(code,name) VALUES('finance_doc_org','Finance Document Org') RETURNING id")).rows[0];
    await pool.query("INSERT INTO qarzhy.report_scopes(scope_type,organization_id) VALUES('organization',$1)", [org.id]);
    const counterparty = (await pool.query("INSERT INTO qarzhy.counterparties(name) VALUES('Document Test Customer') RETURNING id")).rows[0];
    const user = (await pool.query(`INSERT INTO qarzhy.users(username,name,role_id,password_salt,password_hash)
      VALUES('documentfinance','Document Finance',(SELECT id FROM qarzhy.roles WHERE code='finance'),$1,$2) RETURNING id`, ['0'.repeat(32), '0'.repeat(128)])).rows[0];
    const principal = { id: user.id, name: 'Document Finance', role: 'finance', organization_id: org.id, permissions: ['finance.write'] };
    const input = { organizationId: org.id, counterpartyId: counterparty.id, kind: 'sale', mode: 'summary',
      number: 'SALE-001', date: '2026-10-21', amount: '1234.56', cogs: '345.67', idempotencyKey: 'sale-001' };
    const document = await withTransaction(pool, client => createDocument({ client, principal, input }));
    assert.equal(document.status, 'draft');
    const [first, second] = await Promise.all([
      withTransaction(pool, client => postDocument({ client, principal, id: document.id, version: document.version, idempotencyKey: input.idempotencyKey })),
      withTransaction(pool, client => postDocument({ client, principal, id: document.id, version: document.version, idempotencyKey: input.idempotencyKey })),
    ]);
    assert.equal(first.id, second.id);
    const events = await pool.query('SELECT amount::text,cost_amount::text,posting_key FROM qarzhy.financial_events WHERE document_id=$1', [document.id]);
    assert.equal(events.rows.length, 1);
    assert.equal(events.rows[0].amount, '1234.56');
    assert.equal(events.rows[0].cost_amount, '345.67');
    const datasets = await pool.query('SELECT d.kind FROM qarzhy.documents x JOIN qarzhy.datasets d ON d.id=x.dataset_id WHERE x.id=$1', [document.id]);
    assert.equal(datasets.rows[0].kind, 'live');
  } finally { await pool.end(); }
});

test('closed period rejects document creation without a partial row', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const pool = new pg.Pool({ connectionString: assertTestDatabaseUrl(process.env.TEST_DATABASE_URL) });
  try {
    const org = (await pool.query("SELECT id FROM qarzhy.organizations WHERE code='finance_doc_org'")).rows[0];
    const user = (await pool.query("SELECT id FROM qarzhy.users WHERE username='documentfinance'")).rows[0];
    await pool.query("INSERT INTO qarzhy.accounting_periods(organization_id,starts_on,closed) VALUES($1,'2026-10-01',true)", [org.id]);
    const before = (await pool.query('SELECT count(*)::integer AS n FROM qarzhy.documents WHERE organization_id=$1', [org.id])).rows[0].n;
    await assert.rejects(withTransaction(pool, client => createDocument({ client,
      principal: { id: user.id, name: 'Document Finance', permissions: ['finance.write'], organization_id: org.id },
      input: { organizationId: org.id, kind: 'sale', mode: 'summary', number: 'SALE-002', date: '2026-10-22',
        amount: '10.00', idempotencyKey: 'sale-002' },
    })), /closed period/i);
    const after = (await pool.query('SELECT count(*)::integer AS n FROM qarzhy.documents WHERE organization_id=$1', [org.id])).rows[0].n;
    assert.equal(after, before);
  } finally { await pool.end(); }
});

test('itemized lines must match totals and reused keys cannot change the document', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const pool = new pg.Pool({ connectionString: assertTestDatabaseUrl(process.env.TEST_DATABASE_URL) });
  try {
    const org = (await pool.query("SELECT id FROM qarzhy.organizations WHERE code='finance_doc_org'")).rows[0];
    const user = (await pool.query("SELECT id FROM qarzhy.users WHERE username='documentfinance'")).rows[0];
    const customer = (await pool.query("SELECT id FROM qarzhy.counterparties WHERE name='Document Test Customer'")).rows[0];
    const product = (await pool.query("INSERT INTO qarzhy.products(name) VALUES('Test Book') RETURNING id")).rows[0];
    const warehouse = (await pool.query("INSERT INTO qarzhy.warehouses(organization_id,code,name) VALUES($1,'wh-test','Test Warehouse') RETURNING id", [org.id])).rows[0];
    const principal = { id: user.id, name: 'Document Finance', permissions: ['finance.write'], organization_id: org.id };
    const input = { organizationId: org.id, counterpartyId: customer.id, kind: 'sale', mode: 'itemized',
      number: 'SALE-ITEM-001', date: '2026-11-01', amount: '19.99', cogs: '8.50', idempotencyKey: 'sale-item-001',
      lines: [{ productId: product.id, warehouseId: warehouse.id, quantity: '2', unitPrice: '10.00', discount: '0.01', cogs: '8.50' }] };
    const document = await withTransaction(pool, client => createDocument({ client, principal, input }));
    await withTransaction(pool, client => postDocument({ client, principal, id: document.id, version: document.version, idempotencyKey: input.idempotencyKey }));
    const lines = await pool.query('SELECT line_amount::text FROM qarzhy.document_lines WHERE document_id=$1', [document.id]);
    assert.equal(lines.rows[0].line_amount, '19.99');
    await assert.rejects(withTransaction(pool, client => createDocument({ client, principal,
      input: { ...input, amount: '29.99' },
    })), /idempotency|conflict/i);
  } finally { await pool.end(); }
});

test('reversal preserves original fact and records a compensating event', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const pool = new pg.Pool({ connectionString: assertTestDatabaseUrl(process.env.TEST_DATABASE_URL) });
  try {
    const doc = (await pool.query("SELECT id,organization_id FROM qarzhy.documents WHERE number='SALE-ITEM-001'")).rows[0];
    const user = (await pool.query("SELECT id FROM qarzhy.users WHERE username='documentfinance'")).rows[0];
    const principal = { id: user.id, name: 'Document Finance', permissions: ['finance.write'] };
    await withTransaction(pool, client => reverseDocument({ client, principal, id: doc.id, reason: 'Test correction', now: new Date('2026-11-06T00:00:00Z') }));
    const events = await pool.query('SELECT amount::text,reverses_event_id FROM qarzhy.financial_events WHERE document_id=$1 ORDER BY id', [doc.id]);
    assert.equal(events.rows.length, 2);
    assert.equal(events.rows[0].reverses_event_id, null);
    assert.equal(String(events.rows[1].reverses_event_id) !== '', true);
    const net = (await pool.query('SELECT sum(amount)::text AS amount FROM qarzhy.financial_events WHERE document_id=$1', [doc.id])).rows[0].amount;
    assert.equal(Number(net), 0);
    assert.equal((await pool.query('SELECT status FROM qarzhy.documents WHERE id=$1', [doc.id])).rows[0].status, 'reversed');
  } finally { await pool.end(); }
});
