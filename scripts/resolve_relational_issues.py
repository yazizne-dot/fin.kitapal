"""Generate an audited correction for the already imported relational snapshot.

Decisions confirmed by the user in this session (2026-10-20).
Does not modify source files, the original export, or a database connection.
"""
import hashlib
import json
import os
import tempfile
from decimal import Decimal
from pathlib import Path
from export_postgres import literal
from relational_import.core import dump, number, key
from relational_import.workbooks import rows, column

ROOT=Path(__file__).resolve().parents[1]
VERSION='0002_relational_source_resolution'


def text_is_responsible(row):
    return (isinstance(row.get('D'),str) and row['D']==row.get('F')
            and number(row.get('E')) is not None and number(row['E'])>0
            and row.get('J')=='Шығыс')


def subtotal_is_duplicate(details,total,parts):
    for c in map(column,range(3,15)):
        n=number(total.get(c))
        if n is None:return False
        values=[details.get(r,{}).get(c) for r in parts]
        if any(v is not None and number(v) is None for v in values):return False
        if abs(n-sum((number(v) or Decimal(0) for v in values),Decimal(0)))>Decimal('0.00000001'):
            return False
    return True


def write_private(path,text):
    fd,tmp=tempfile.mkstemp(prefix=path.stem+'.',suffix='.tmp',dir=path.parent)
    try:
        with os.fdopen(fd,'w',encoding='utf-8') as h:h.write(text)
        os.replace(tmp,path)
    finally:Path(tmp).unlink(missing_ok=True)


def generate():
    manifest=json.loads((ROOT/'data/postgres-relational-data.manifest.json').read_text())
    if manifest['open_issues']!=21:
        raise ValueError('This correction is for the reviewed 21-issue snapshot only')
    books={}
    for filename,sha in manifest['source_hashes'].items():
        raw=(ROOT/'data'/filename).read_bytes()
        if hashlib.sha256(raw).hexdigest()!=sha:raise ValueError('Source changed: '+filename)
        books[filename]=json.loads(raw,parse_float=Decimal)
    cash=rows(books['cashflow-source.json']['sheets']['База']['cells'])
    pnl=books['workbook-source.json']['sheets']
    bal=rows(books['balance-source.json']['sheets']['касса']['cells'])
    resolutions=[]
    def resolve(code,ref,status,reason):
        resolutions.append(dict(code=code,source_ref=ref,status=status,reason=reason))
    for r in (5157,5268):
        if not text_is_responsible(cash[r]):raise ValueError('Unproven text duplicate')
        resolve('invalid_cash_amount',f'cashflow/База/{r}/D','resolved',
                'D repeats responsible person Қасым from F; J marks expense, numeric expense E was imported. No missing income inferred.')
    for sheet,target,parts in [('P&L_2022',124,[113,114,115]),('P&L_2024',104,[90,91,92,93])]:
        detail=rows(pnl[sheet]['cells'])
        if not subtotal_is_duplicate(detail,detail[target],parts):raise ValueError('Unproven repeated subtotal')
        resolve('unlabelled_report_row',f'pnl/{sheet}/{target}','resolved',
                f'Control subtotal of already imported rows {parts}; all 12 cached months match within 1e-8. Not an additional financial fact.')
    dates=[(5441,'D','2022-01-24','2023-01-24','377600'),
           (30520,'D','2026-12-31','2025-12-31','532600'),
           (30521,'E','2026-12-31','2025-12-31','517500'),
           (30522,'E','2026-12-31','2025-12-31','15100')]
    for r,col,old,new,amount in dates:
        if number(cash[r].get(col))!=Decimal(amount):raise ValueError('Changed source amount')
        resolve('cash_period_mismatch',f'cashflow/База/{r}','resolved',
                f'User confirmed {new}; original imported date {old} retained in audit. Amount unchanged.')
    for code,ref in [('legacy_account_unknown','sqlite/operations'),('unassigned_cash_context','cashflow/База')]:
        resolve(code,ref,'accepted','User confirmed historical context with unknown account/organization; retain NULL, no invented links.')
    for r in (6,7,8,10,11,12):
        if bal[r].get('C') is not None:raise ValueError('Expected blank source balance')
        resolve('missing_cash_balance',f'balance/cash/{r}','resolved',
                f'User explicitly confirmed zero for {bal[r]["B"].strip()}; source blank is retained in audit.')
    for label in ('inventory prepaid','inventory consignment'):
        resolve('source_total_mismatch',label,'accepted',
                'User confirmed detailed inventory positions authoritative. Original inconsistent Excel summary is preserved as historical reported value; no balancing plug or invented debt.')
    for sheet in ('Бауыржан ағай ескертулері','Амортизация'):
        resolve('undated_supporting_sheet','pnl/'+sheet,'accepted',
                'User confirmed supporting/reference-only material; preserve source archive, do not create duplicate or undated financial operations.')
    resolve('opening_balance_unverified','balance/snapshot','accepted',
            'Historical import accepted with documented limitations. Keep snapshot draft: no verified opening coverage or fabricated organization/account links. Completing import is not approval of an opening balance.')
    assert len(resolutions)==21
    expected=json.loads(dump([{k:r[k] for k in ('code','source_ref')} for r in resolutions]))
    sql=["-- PRIVATE. Apply AFTER the imported relational data, not instead of it.",
         '-- User-confirmed source corrections; all changes audited; repeat run is a no-op.',
         "BEGIN;", "SET LOCAL standard_conforming_strings=on;", "SET LOCAL timezone='UTC';",
         'DO $resolution$', 'DECLARE batch bigint; before_rows jsonb; affected integer; account bigint;',
         'BEGIN',
         'LOCK TABLE qarzhy.import_batches,qarzhy.import_issues,qarzhy.cash_movements,qarzhy.cash_balances,qarzhy.cash_accounts,qarzhy.balance_snapshots,qarzhy.audit_log,qarzhy.financial_state,qarzhy.schema_migrations IN SHARE ROW EXCLUSIVE MODE;',
         f"IF EXISTS(SELECT 1 FROM qarzhy.schema_migrations WHERE version={literal(VERSION)}) THEN",
         " RAISE NOTICE 'Source correction already applied'; RETURN; END IF;",
         f"SELECT id INTO batch FROM qarzhy.import_batches WHERE fingerprint={literal(manifest['fingerprint'])} FOR UPDATE;",
         "IF batch IS NULL THEN RAISE EXCEPTION 'Expected imported snapshot not found'; END IF;",
         "IF (SELECT count(*) FROM qarzhy.import_issues WHERE import_batch_id=batch AND status='open')<>21 THEN RAISE EXCEPTION 'Expected exactly the reviewed 21 open issues'; END IF;",
         f"IF EXISTS(SELECT 1 FROM jsonb_to_recordset({literal(dump(expected))}::jsonb) AS x(code text,source_ref text) WHERE (SELECT count(*) FROM qarzhy.import_issues i WHERE i.import_batch_id=batch AND i.status='open' AND i.code=x.code AND i.source_ref=x.source_ref)<>1) THEN RAISE EXCEPTION 'Source issue set differs from reviewed snapshot'; END IF;",
         "IF (SELECT count(*) FROM qarzhy.balance_snapshots WHERE import_batch_id=batch AND external_key='balance/snapshot/2026-09-01' AND status='draft')<>1 THEN RAISE EXCEPTION 'Expected draft historical snapshot'; END IF;",
         "SELECT jsonb_build_object('issues',(SELECT jsonb_agg(to_jsonb(i)) FROM qarzhy.import_issues i WHERE import_batch_id=batch AND status='open'),'movements',(SELECT jsonb_agg(jsonb_build_object('id',id,'external_key',external_key,'occurred_on',occurred_on,'amount',amount)) FROM qarzhy.cash_movements WHERE import_batch_id=batch AND external_key IN ('cashflow/База/5441/D','cashflow/База/30520/D','cashflow/База/30521/E','cashflow/База/30522/E'))) INTO before_rows;"]
    for r,col,old,new,amount in dates:
        sql += [f"UPDATE qarzhy.cash_movements SET occurred_on={literal(new)}::date,version=version+1,updated_at=now() WHERE import_batch_id=batch AND external_key={literal(f'cashflow/База/{r}/{col}')} AND occurred_on={literal(old)}::date AND amount={amount};",
                "GET DIAGNOSTICS affected=ROW_COUNT; IF affected<>1 THEN RAISE EXCEPTION 'Cash movement changed since review'; END IF;"]
    for r in (6,7,8,10,11,12):
        registry_ref='registry/'+key(('cash_accounts','balance',bal[r]['B'].strip()))
        sql += [f"SELECT id INTO account FROM qarzhy.cash_accounts WHERE import_batch_id=batch AND external_key={literal(registry_ref)};",
                "IF account IS NULL THEN RAISE EXCEPTION 'Expected cash account missing'; END IF;",
                "IF EXISTS(SELECT 1 FROM qarzhy.cash_balances c JOIN qarzhy.balance_snapshots s ON s.id=c.snapshot_id WHERE s.import_batch_id=batch AND s.external_key='balance/snapshot/2026-09-01' AND c.cash_account_id=account) THEN RAISE EXCEPTION 'Blank balance already changed'; END IF;",
                f"INSERT INTO qarzhy.cash_balances(snapshot_id,cash_account_id,amount,import_batch_id,external_key) SELECT id,account,0,batch,{literal(f'resolution/zero/cash/{r}')} FROM qarzhy.balance_snapshots WHERE import_batch_id=batch AND external_key='balance/snapshot/2026-09-01';"]
    for r in resolutions:
        sql += [f"UPDATE qarzhy.import_issues SET status={literal(r['status'])},detail=jsonb_build_object('original_detail',detail,'resolution',{literal(r['reason'])},'decision_date','2026-10-20')::text WHERE import_batch_id=batch AND code={literal(r['code'])} AND source_ref={literal(r['source_ref'])} AND status='open';",
                "GET DIAGNOSTICS affected=ROW_COUNT; IF affected<>1 THEN RAISE EXCEPTION 'Issue changed since review'; END IF;"]
    sql += ["IF EXISTS(SELECT 1 FROM qarzhy.import_issues WHERE import_batch_id=batch AND status='open') THEN RAISE EXCEPTION 'Unexpected remaining open issues'; END IF;",
            f"INSERT INTO qarzhy.audit_log(actor_name,action,entity_type,entity_id,before_data,after_data,reason,import_batch_id,external_key) VALUES('Миграция: подтверждённые решения','import.source_resolution','import_batches',batch,before_rows,{literal(dump({'decisions':resolutions,'new_zero_balances':6,'changed_dates':4,'snapshot_status':'draft'}))}::jsonb,'Подтверждено пользователем 20.10.2026; доказанные дубликаты проверены по исходным файлам',batch,'resolution/2026-10-20');",
            "UPDATE qarzhy.import_batches SET status='completed',finished_at=now(),summary=coalesce(summary,'{}'::jsonb)||jsonb_build_object('open_issues',0,'resolved_in_correction',14,'accepted_limitations',7,'inventory_authority','inventory_positions','historical_summary','reported_only','resolution_migration','0002_relational_source_resolution','snapshot_status','draft','coverage_configured',false) WHERE id=batch;",
            'UPDATE qarzhy.financial_state SET revision=revision+1;',
            f"INSERT INTO qarzhy.schema_migrations(version) VALUES({literal(VERSION)});",
            'END $resolution$;', 'COMMIT;','']
    output=ROOT/'data/postgres-relational-corrections.sql'
    write_private(output,'\n'.join(sql))
    report=['# Исправления импортированных данных','',
            'Пакет подготовлен, но ещё не применён к вашей PostgreSQL. Исходный SQL и исходные файлы не изменены.',
            '14 замечаний будут исправлены; 7 исторических ограничений явно приняты пользователем. После применения открытых замечаний: 0.',
            'Изменения: четыре даты, шесть нулевых остатков, статусы замечаний; денежные суммы движений и товарные строки не меняются.',
            'Проверенный начальный баланс не заявляется: snapshot остаётся draft, coverage_rules не создаются.',
            'Повторный запуск безопасен: запись миграции превращает его в пропуск. Все изменения фиксируются в audit_log.','',
            '| Код | Источник | Результат | Основание |','| --- | --- | --- | --- |']
    report += [f'| {r["code"]} | {r["source_ref"]} | {r["status"]} | {r["reason"]} |' for r in resolutions]
    write_private(output.with_suffix('.report.md'),'\n'.join(report)+'\n')
    print(dump({'sql':str(output),'resolved':14,'accepted':7,'open_after':0}))


if __name__=='__main__':generate()
