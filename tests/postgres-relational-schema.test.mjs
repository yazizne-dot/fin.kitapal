// PostgreSQL WASM integration checks. Supply PGLITE_MODULE as an absolute module path.
// Example: PGLITE_MODULE=/tmp/pg-check/node_modules/@electric-sql/pglite/dist/index.js node --test tests/postgres-relational-schema.test.mjs
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
const modulePath=process.env.PGLITE_MODULE;
let db;
before(async()=>{
 if(!modulePath)return;
 const {PGlite}=await import(pathToFileURL(modulePath).href);
 db=new PGlite();
 await db.exec(fs.readFileSync(new URL('../docs/sql/postgres-relational-schema.sql',import.meta.url),'utf8'));
 await db.exec(`
 INSERT INTO qarzhy.organizations(id,code,name) VALUES(100,'A','A'),(200,'B','B');
 INSERT INTO qarzhy.report_scopes(id,scope_type,organization_id) VALUES(100,'organization',100),(200,'organization',200);
 INSERT INTO qarzhy.counterparties(id,name) VALUES(100,'Buyer');
 INSERT INTO qarzhy.products(id,name) VALUES(100,'Book');
 INSERT INTO qarzhy.warehouses(id,organization_id,code,name) VALUES(100,100,'WH','WH'),(200,200,'WH','WH');
 INSERT INTO qarzhy.cash_accounts(id,organization_id,code,name,account_type) VALUES(100,100,'BANK','Bank','bank'),(101,100,'CASH','Cash','cash');
 INSERT INTO qarzhy.financial_articles(id,code,name) VALUES(100,'ROOT','Root'),(101,'CHILD','Child');
 `);
});
after(async()=>{if(db)await db.close();});
const check=(name,fn)=>test(name,{skip:!modulePath},fn);
async function valid(sql){
 await db.exec('BEGIN');
 try {await db.exec(sql);await db.exec('SET CONSTRAINTS ALL IMMEDIATE');}
 finally {await db.exec('ROLLBACK');}
}
async function invalid(sql,pattern){
 await db.exec('BEGIN');
 try {await assert.rejects(async()=>{await db.exec(sql);await db.exec('SET CONSTRAINTS ALL IMMEDIATE');},pattern);}
 finally {await db.exec('ROLLBACK');}
}
const doc=(total=100)=>`INSERT INTO qarzhy.documents(id,dataset_id,organization_id,counterparty_id,kind,input_mode,number,document_date,status,total_amount,idempotency_key) VALUES(1000,1,100,100,'sale','itemized','SALE','2026-10-20','posted',${total},'sale-1');`;
const line=(warehouse=100)=>`INSERT INTO qarzhy.document_lines(document_id,line_number,product_id,warehouse_id,quantity,unit_price,line_amount) VALUES(1000,1,100,${warehouse},1,100,100);`;
const movement=(id,direction,amount=100)=>`INSERT INTO qarzhy.cash_movements(id,dataset_id,scope_id,organization_id,cash_account_id,occurred_on,direction,amount,counterparty_id,posting_key) VALUES(${id},1,100,100,${id===1001?101:100},'2026-10-20','${direction}',${amount},100,'m-${id}');`;
check('DDL creates exactly the architecture tables and no source-cell tables',async()=>{
 const text=fs.readFileSync(new URL('../docs/database-architecture.md',import.meta.url),'utf8');
 const expected=[...text.matchAll(/^\| `(\w+)` \|/gm)].map(x=>x[1]).sort();
 const actual=(await db.query("SELECT table_name FROM information_schema.tables WHERE table_schema='qarzhy' AND table_type='BASE TABLE' ORDER BY table_name")).rows.map(x=>x.table_name);
 assert.deepEqual(actual,expected);
 assert.equal(actual.length,49);
 assert(!(await db.query("SELECT table_name FROM information_schema.tables WHERE table_schema='qarzhy' AND table_name LIKE 'source_%'")).rows.length);
});
check('existing schema is preserved on accidental rerun',async()=>{
 await assert.rejects(db.exec(fs.readFileSync(new URL('../docs/sql/postgres-relational-schema.sql',import.meta.url),'utf8')),/already exists/);
 await db.exec('ROLLBACK');
 assert.equal((await db.query('SELECT count(*)::int AS n FROM qarzhy.organizations')).rows[0].n,2);
});
check('complete itemized document succeeds; mismatched totals and organizations fail',async()=>{
 await valid(doc()+line());
 await invalid(doc(99)+line(),/matching its total/);
 await invalid(doc()+line(200),/organizations differ/);
 await invalid(doc(),/requires lines/);
});
check('cash movements use valid live context and preserve import precision',async()=>{
 await valid(movement(1000,'in'));
 await invalid(movement(1000,'in',1.001),/precision/);
 await invalid(movement(1000,'in').replace('1,100,100,100,','1,200,100,100,'),/scope/);
 await valid(`INSERT INTO qarzhy.import_batches(id,fingerprint) VALUES(100,'sample');
 INSERT INTO qarzhy.cash_movements(dataset_id,scope_id,occurred_on,direction,amount,posting_key,import_batch_id,external_key)
 VALUES(2,1,'2023-01-01','in',0.1234567890123456789,'old',100,'old');`);
});
check('transfers match both legs and cannot be double-counted as settlements',async()=>{
 await valid(movement(1000,'out')+movement(1001,'in')+`INSERT INTO qarzhy.cash_transfers(outgoing_id,incoming_id) VALUES(1000,1001);`);
 await invalid(movement(1000,'out')+movement(1001,'in',99)+`INSERT INTO qarzhy.cash_transfers(outgoing_id,incoming_id) VALUES(1000,1001);`,/Invalid internal/);
});
check('partial payment succeeds; over-allocation and subsequent amount reduction fail',async()=>{
 const setup=doc()+line()+movement(1000,'in');
 await valid(setup+`INSERT INTO qarzhy.document_settlements(document_id,cash_movement_id,amount) VALUES(1000,1000,50);`);
 await invalid(setup+`INSERT INTO qarzhy.document_settlements(document_id,cash_movement_id,amount) VALUES(1000,1000,101);`,/exceeds/);
 await invalid(setup+`INSERT INTO qarzhy.document_settlements(document_id,cash_movement_id,amount) VALUES(1000,1000,50); UPDATE qarzhy.cash_movements SET amount=49 WHERE id=1000;`,/exceeds/);
});
check('FKs, NULL dimensions, article cycles and append-only history are enforced',async()=>{
 await invalid("INSERT INTO qarzhy.persons(name,user_id) VALUES('X',999999)",/foreign key/);
 await invalid("INSERT INTO qarzhy.report_scopes(scope_type) VALUES('consolidated')",/unique/);
 await invalid('UPDATE qarzhy.financial_articles SET parent_id=101 WHERE id=100; UPDATE qarzhy.financial_articles SET parent_id=100 WHERE id=101;',/cycle/);
 await invalid("INSERT INTO qarzhy.audit_log(actor_name,action) VALUES('System','test'); DELETE FROM qarzhy.audit_log;",/append-only/);
});
check('coverage rules reject competing sources in overlapping ranges',async()=>{
 const rule=`INSERT INTO qarzhy.coverage_rules(dataset_id,scope_id,report_family,starts_on,ends_on,source_kind) VALUES(1,100,'pnl','2026-01-01','2027-01-01','events');`;
 await valid(rule);
 await invalid(rule+rule.replace("VALUES(1,","VALUES(2,"),/overlap/);
});

check('referenced opening snapshot cannot be invalidated',async()=>{
 const setup=`INSERT INTO qarzhy.balance_snapshots(id,dataset_id,scope_id,as_of_date,label,status) VALUES(1000,1,100,'2026-01-01','Opening','verified');
 INSERT INTO qarzhy.coverage_rules(dataset_id,scope_id,report_family,starts_on,ends_on,source_kind,opening_snapshot_id) VALUES(1,100,'balance','2026-01-01','2027-01-01','opening_and_movements',1000);`;
 await valid(setup);
 await invalid(setup+"UPDATE qarzhy.balance_snapshots SET status='draft' WHERE id=1000",/required as a verified opening/);
});
