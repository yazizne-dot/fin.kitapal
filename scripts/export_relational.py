"""Generate private, reviewable SQL for the new relational schema; never connect to it."""
import argparse
import hashlib
import os
import re
import tempfile
from datetime import datetime, timezone
from decimal import Decimal, getcontext
from pathlib import Path
from export_postgres import read_sources, literal
from relational_import.core import Builder, dump
from relational_import.sqlite_data import migrate
from relational_import.workbooks import cashflow, balance, statements

ROOT=Path(__file__).resolve().parents[1]
ORDER=['organizations','locations','warehouses','users','persons','counterparties','counterparty_roles',
       'products','agreement_types','financial_articles','sales_channels','cash_accounts','asset_groups',
       'report_scopes','report_metrics','balance_snapshots','documents','document_lines','employee_expenses',
       'expense_reviews','financial_events','cash_movements','cash_transfers','document_settlements',
       'inventory_positions','inventory_movements','cash_balances','counterparty_balances','asset_group_balances',
       'payment_plans','budget_versions','budget_items','historical_series','historical_values',
       'financial_adjustments','audit_log','accounting_periods','import_entity_mappings','import_issues']


def emit_rows(handle,table,rows):
    if not rows:return
    columns=list(dict.fromkeys(c for row in rows for c in row))
    for start in range(0,len(rows),500):
        batch=rows[start:start+500]
        handle.write(f'INSERT INTO qarzhy.{table} ({",".join(columns)}) VALUES\n')
        for i,row in enumerate(batch):
            handle.write('('+','.join(literal(row[c]) if c in row else 'DEFAULT' for c in columns)+')')
            handle.write(';\n' if i==len(batch)-1 else ',\n')


def write_sql(handle,b,fingerprint,timestamp,manifest):
    schema=(ROOT/'docs/sql/postgres-relational-schema.sql').read_text()
    tables=re.findall(r'CREATE TABLE qarzhy\.(\w+)\s*\(',schema)
    seeded={'roles':3,'permissions':5,'role_permissions':10,'datasets':3,'report_scopes':1,
            'financial_state':1,'schema_migrations':1}
    handle.write('-- PRIVATE: password hashes and financial data. NEW RELATIONAL SCHEMA ONLY.\n')
    handle.write('-- One transaction. Review manifest before executing the entire script.\n')
    handle.write("BEGIN;\nSET LOCAL standard_conforming_strings=on;\nSET LOCAL client_encoding='UTF8';\nSET LOCAL timezone='UTC';\n")
    handle.write('LOCK TABLE '+','.join('qarzhy.'+t for t in sorted(tables))+' IN ACCESS EXCLUSIVE MODE;\n')
    handle.write('DO $$ BEGIN\n')
    for table in tables:
        count=seeded.get(table,0)
        handle.write(f"IF (SELECT count(*) FROM qarzhy.{table}) <> {count} THEN RAISE EXCEPTION 'Expected initial relational seed: {table}'; END IF;\n")
    handle.write("IF NOT EXISTS(SELECT 1 FROM qarzhy.schema_migrations WHERE version='0001_relational_finance') THEN RAISE EXCEPTION 'Wrong schema version'; END IF;\n")
    for table,col,items in [('roles','code',[(1,'admin'),(2,'finance'),(3,'employee')]),
                            ('datasets','kind',[(1,'live'),(2,'imported_finance'),(3,'legacy_ledger')])]:
        for ident,value in items:
            handle.write(f"IF NOT EXISTS(SELECT 1 FROM qarzhy.{table} WHERE id={ident} AND {col}={literal(value)}) THEN RAISE EXCEPTION 'Unexpected metadata IDs'; END IF;\n")
    handle.write("IF NOT EXISTS(SELECT 1 FROM qarzhy.report_scopes WHERE id=1 AND scope_type='consolidated') THEN RAISE EXCEPTION 'Expected consolidated scope 1'; END IF;\nEND $$;\n")
    emit_rows(handle,'import_batches',[dict(id=1,fingerprint=fingerprint,started_at=timestamp,status='running',summary=dump(manifest))])
    for table in ORDER:emit_rows(handle,table,b.tables[table])
    # Statement triggers deferred by the DDL execute before counts/sequences/COMMIT.
    handle.write('SET CONSTRAINTS ALL IMMEDIATE;\nDO $$ BEGIN\n')
    for table in tables:
        count=len(b.tables[table])+seeded.get(table,0)+(1 if table=='import_batches' else 0)
        handle.write(f"IF (SELECT count(*) FROM qarzhy.{table}) <> {count} THEN RAISE EXCEPTION 'Count mismatch: {table}'; END IF;\n")
    handle.write('END $$;\n')
    revision=int(manifest['sqlite_revision'])
    handle.write(f'UPDATE qarzhy.financial_state SET revision={revision};\n')
    if not manifest['open_issues']:
        handle.write("UPDATE qarzhy.import_batches SET status='completed',finished_at=now() WHERE id=1;\n")
    for table in tables:
        handle.write(f"SELECT setval(pg_get_serial_sequence('qarzhy.{table}','id'),coalesce((SELECT max(id) FROM qarzhy.{table}),1),EXISTS(SELECT 1 FROM qarzhy.{table}));\n")
    handle.write('COMMIT;\n')


def export(db_path,data_dir,output):
    getcontext().prec=60
    source,books,hashes=read_sources(db_path,data_dir)
    digest=hashlib.sha256(dump({k:v for k,v in source.items() if k!='sessions'}).encode()).hexdigest()
    fingerprint=hashlib.sha256(dump({'sqlite':digest,'books':hashes,'mapping':'relational-v1'}).encode()).hexdigest()
    b=Builder()
    migrate(b,source)
    cashflow(b,books['cashflow'])
    balance(b,books['balance'])
    statements(b,books['pnl'])
    unknown=set(b.tables)-set(ORDER)
    if unknown:raise ValueError('Unordered output tables: '+str(unknown))
    open_issues=sum(r['status']=='open' for r in b.tables['import_issues'])
    manifest=dict(format='relational-v1',fingerprint=fingerprint,source_hashes=hashes,
        sqlite_rows_sha256=digest,source_counts={t:len(v) for t,v in source.items()},
        target_counts={t:len(v) for t,v in b.tables.items()},excluded_sessions=len(source['sessions']),
        sqlite_revision=source['financial_state'][0]['revision'],open_issues=open_issues,
        issues_by_code={code:sum(x['code']==code for x in b.tables['import_issues'])
                        for code in sorted({x['code'] for x in b.tables['import_issues']})},
        sources=b.sources,checks=b.checks,
        notes=['User confirmed demo-tagged SQLite operations/plans as real.',
               'Datasets remain separate; no automatic coverage_rules added.',
               'Snapshot is draft; import batch remains running while source issues are open.',
               'Private source files must be retained; importer does not replace application reporting logic.'])
    output.parent.mkdir(parents=True,exist_ok=True)
    fd,tmp=tempfile.mkstemp(prefix=output.stem+'.',suffix='.tmp',dir=output.parent)
    try:
        with os.fdopen(fd,'w',encoding='utf-8') as handle:
            write_sql(handle,b,fingerprint,datetime.now(timezone.utc).isoformat(),manifest)
        manifest['sql_sha256']=hashlib.sha256(Path(tmp).read_bytes()).hexdigest()
        os.replace(tmp,output)
        manifest_path=output.with_suffix('.manifest.json')
        fd,mtmp=tempfile.mkstemp(prefix=output.stem+'.',suffix='.tmp',dir=output.parent)
        try:
            with os.fdopen(fd,'w',encoding='utf-8') as h:h.write(dump(manifest)+'\n')
            os.replace(mtmp,manifest_path)
        finally:Path(mtmp).unlink(missing_ok=True)
        report_path=output.with_suffix('.report.md')
        lines=['# Отчёт переноса Qarzhy','',
               f'Статус: данные подготовлены; открытых вопросов источника: **{open_issues}**.',
               'SQL проверяет пустую новую схему и загружает данные одной транзакцией.',
               'При открытых вопросах batch остаётся running, snapshot — draft.',
               'Отчёт не означает завершённую сверку или подключение программы к новой БД.','',
               '## Количество записей','', '| Таблица | Строк |','| --- | ---: |']
        lines += [f'| {t} | {len(v)} |' for t,v in sorted(b.tables.items()) if v]
        lines += ['', '## Сверка сумм','', '| Проверка | Источник | Цель | Разница |','| --- | ---: | ---: | ---: |']
        lines += [f'| {x["label"]} | {x["source"]} | {x["target"]} | {x["difference"]} |' for x in b.checks]
        lines += ['', '## Открытые вопросы','']
        lines += [f'- `{x["code"]}` — `{x["source_ref"]}`: {x["detail"]}' for x in b.tables['import_issues'] if x['status']=='open']
        lines += ['', '## Источники','', '| Книга | Лист | Ячеек | Назначение |','| --- | --- | ---: | --- |']
        lines += [f'| {x["book"]} | {x["sheet"].strip() or "(разделитель)"} | {x["cells"]} | {x["route"]} |' for x in b.sources]
        fd,rtmp=tempfile.mkstemp(prefix=output.stem+'.',suffix='.tmp',dir=output.parent)
        try:
            with os.fdopen(fd,'w',encoding='utf-8') as h:h.write('\n'.join(lines)+'\n')
            os.replace(rtmp,report_path)
        finally:Path(rtmp).unlink(missing_ok=True)
    finally:Path(tmp).unlink(missing_ok=True)
    print(dump({'sql':str(output),'rows':sum(len(v) for v in b.tables.values()),'open_issues':open_issues,
                'issues_by_code':manifest['issues_by_code'],'checks':b.checks}))
    return manifest


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data-dir',type=Path,default=ROOT/'data')
    parser.add_argument('--db',type=Path,default=ROOT/'data/portal.sqlite')
    parser.add_argument('--output',type=Path,default=ROOT/'data/postgres-relational-data.sql')
    args=parser.parse_args()
    export(args.db,args.data_dir,args.output)
