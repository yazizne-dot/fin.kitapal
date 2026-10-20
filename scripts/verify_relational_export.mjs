// Execute generated private SQL in an isolated PostgreSQL WASM database only.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
const modulePath=process.env.PGLITE_MODULE;
if(!modulePath)throw new Error('PGLITE_MODULE must point to an installed PGlite module');
const {PGlite}=await import(pathToFileURL(modulePath).href);
const db=new PGlite();
const dataPath=process.argv[2] || 'data/postgres-relational-data.sql';
const sql=fs.readFileSync(dataPath,'utf8');
const manifest=JSON.parse(fs.readFileSync(dataPath.replace(/\.sql$/,'.manifest.json'),'utf8'));
assert.equal(createHash('sha256').update(sql).digest('hex'),manifest.sql_sha256);
try {
 await db.exec(fs.readFileSync('docs/sql/postgres-relational-schema.sql','utf8'));
 // Failed seed guard must leave every business table empty.
 await db.exec("INSERT INTO qarzhy.organizations(code,name) VALUES('guard','guard')");
 await assert.rejects(db.exec(sql),/Expected initial relational seed/);
 await db.exec('ROLLBACK');
 assert.equal((await db.query('SELECT count(*)::int n FROM qarzhy.users')).rows[0].n,0);
 await db.exec("DELETE FROM qarzhy.organizations WHERE code='guard'");
 await db.exec(sql);
 for(const [table,count] of Object.entries(manifest.target_counts)){
  assert.match(table,/^[a-z_]+$/);
  const actual=(await db.query(`SELECT count(*)::int n FROM qarzhy.${table}`)).rows[0].n;
  assert.equal(actual,count+(table==='report_scopes'?1:0),table);
 }
 const invariants=(await db.query(`SELECT
 (SELECT count(*)::int FROM qarzhy.users) users,
 (SELECT count(*)::int FROM qarzhy.sessions) sessions,
 (SELECT count(*)::int FROM qarzhy.payment_plans) plans,
 (SELECT count(*)::int FROM qarzhy.employee_expenses WHERE status='approved') approved,
 (SELECT sum(amount)::text FROM qarzhy.financial_events WHERE expense_id IS NOT NULL AND active) recognized,
 (SELECT count(*)::int FROM qarzhy.coverage_rules) coverage,
 (SELECT count(*)::int FROM qarzhy.import_issues WHERE status='open') issues`)).rows[0];
 assert.equal(invariants.users,manifest.source_counts.users);
 assert.equal(invariants.plans,manifest.source_counts.plans);
 assert.equal(invariants.sessions,0);
 assert.equal(invariants.coverage,0);
 assert.equal(invariants.issues,manifest.open_issues);
 assert.match(invariants.recognized,/^580000(?:\.0+)?$/);
 const represented=(await db.query(`SELECT count(DISTINCT split_part(external_key,'/',3))::int n FROM (
  SELECT external_key FROM qarzhy.financial_events WHERE external_key LIKE 'sqlite/operation/%'
  UNION ALL SELECT external_key FROM qarzhy.cash_movements WHERE external_key LIKE 'sqlite/operation/%'
 ) s`)).rows[0].n;
 assert.equal(represented,manifest.source_counts.operations,'every source operation represented');
 for(const [label,selector,direction] of [
  ['cashflow signed D','cashflow/База/%/D','in'],
  ['cashflow signed E','cashflow/База/%/E','out'],
  ['sqlite cash in','sqlite/operation/%/cash','in'],
  ['sqlite cash out','sqlite/operation/%/cash','out']]){
  const expected=manifest.checks.find(x=>x.label===label).source;
  const signed=label.startsWith('cashflow');
  const query=signed
   ? 'SELECT sum(CASE WHEN direction=$2 THEN amount ELSE -amount END)=$3::numeric ok FROM qarzhy.cash_movements WHERE external_key LIKE $1'
   : 'SELECT sum(amount)=$3::numeric ok FROM qarzhy.cash_movements WHERE external_key LIKE $1 AND direction=$2';
  assert.equal((await db.query(query,[selector,direction,expected])).rows[0].ok,true,label);
 }
 const sums=(await db.query("SELECT dataset_id,direction,sum(amount)::text amount FROM qarzhy.cash_movements GROUP BY dataset_id,direction ORDER BY dataset_id,direction")).rows;
 // A second run fails without duplicates; ROLLBACK leaves the imported data intact.
 await assert.rejects(db.exec(sql),/Expected initial relational seed/);
 await db.exec('ROLLBACK');
 assert.equal((await db.query('SELECT count(*)::int n FROM qarzhy.users')).rows[0].n,invariants.users);
 console.log(JSON.stringify({result:'PASS',invariants,sums,checks:manifest.checks},null,2));
} catch(error) {
 console.error(JSON.stringify({message:error.message,detail:error.detail,constraint:error.constraint,where:error.where}));
 process.exitCode=1;
} finally {await db.close();}
