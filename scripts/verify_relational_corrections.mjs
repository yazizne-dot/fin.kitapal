// Test correction against an isolated import; never connect to the user's PostgreSQL.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const path=process.env.PGLITE_MODULE;
if(!path)throw Error('Set PGLITE_MODULE to installed PGlite module path');
const {PGlite}=await import(pathToFileURL(path).href);
const db=new PGlite();
const patch=fs.readFileSync('data/postgres-relational-corrections.sql','utf8');
try {
 await db.exec(fs.readFileSync('docs/sql/postgres-relational-schema.sql','utf8'));
 await db.exec(fs.readFileSync('data/postgres-relational-data.sql','utf8'));
 const sums=await db.query('SELECT dataset_id,direction,sum(amount)::text total FROM qarzhy.cash_movements GROUP BY dataset_id,direction ORDER BY 1,2');
 const inventory=await db.query('SELECT sum(quantity)::text quantity,sum(total_value)::text value FROM qarzhy.inventory_positions');
 const links=await db.query('SELECT count(*)::int n FROM qarzhy.cash_movements WHERE cash_account_id IS NULL');
 // Force a failure after date edits; the whole patch must roll back.
 await db.exec("INSERT INTO qarzhy.cash_balances(snapshot_id,cash_account_id,amount,import_batch_id,external_key) SELECT 1,id,1,1,'test/collision' FROM qarzhy.cash_accounts WHERE name='Букмейд'");
 await assert.rejects(db.exec(patch),/Blank balance already changed/);
 await db.exec('ROLLBACK');
 assert.equal((await db.query("SELECT count(*)::int n FROM qarzhy.import_issues WHERE status='open'")).rows[0].n,21);
 assert.equal((await db.query("SELECT occurred_on::text d FROM qarzhy.cash_movements WHERE external_key='cashflow/База/5441/D'")).rows[0].d,'2022-01-24');
 await db.exec("DELETE FROM qarzhy.cash_balances WHERE external_key='test/collision'");
 await db.exec(patch);
 const result=(await db.query(`SELECT
 (SELECT count(*)::int FROM qarzhy.import_issues WHERE status='open') open,
 (SELECT count(*)::int FROM qarzhy.cash_balances) balances,
 (SELECT count(*)::int FROM qarzhy.cash_balances WHERE external_key LIKE 'resolution/zero/%' AND amount=0) zeros,
 (SELECT status FROM qarzhy.import_batches WHERE id=1) batch,
 (SELECT status FROM qarzhy.balance_snapshots WHERE id=1) snapshot,
 (SELECT revision::text FROM qarzhy.financial_state) revision,
 (SELECT count(*)::int FROM qarzhy.audit_log) audits,
 (SELECT count(*)::int FROM qarzhy.coverage_rules) coverage,
 (SELECT count(*)::int FROM qarzhy.import_issues WHERE status='resolved') resolved`)).rows[0];
 assert.equal(result.open,0);assert.equal(result.resolved,14);
 assert.equal(result.balances,9);assert.equal(result.zeros,6);
 assert.equal(result.batch,'completed');assert.equal(result.snapshot,'draft');assert.equal(result.coverage,0);
 assert.equal(result.audits,43);
 const expected={'cashflow/База/5441/D':'2023-01-24','cashflow/База/30520/D':'2025-12-31','cashflow/База/30521/E':'2025-12-31','cashflow/База/30522/E':'2025-12-31'};
 for(const [ref,day] of Object.entries(expected))assert.equal((await db.query('SELECT occurred_on::text d FROM qarzhy.cash_movements WHERE external_key=$1',[ref])).rows[0].d,day);
 assert.deepEqual((await db.query('SELECT dataset_id,direction,sum(amount)::text total FROM qarzhy.cash_movements GROUP BY dataset_id,direction ORDER BY 1,2')).rows,sums.rows);
 assert.deepEqual((await db.query('SELECT sum(quantity)::text quantity,sum(total_value)::text value FROM qarzhy.inventory_positions')).rows,inventory.rows);
 assert.deepEqual((await db.query('SELECT count(*)::int n FROM qarzhy.cash_movements WHERE cash_account_id IS NULL')).rows,links.rows);
 await db.exec(patch);
 assert.equal((await db.query('SELECT count(*)::int n FROM qarzhy.audit_log')).rows[0].n,result.audits);
 assert.equal((await db.query('SELECT revision::text revision FROM qarzhy.financial_state')).rows[0].revision,result.revision);
 console.log(JSON.stringify({result:'PASS',checks:result,atomicRollback:true,idempotent:true,financialTotalsPreserved:true},null,2));
}catch(e){console.error(JSON.stringify({message:e.message,detail:e.detail,constraint:e.constraint}));process.exitCode=1;}
finally{await db.close();}
