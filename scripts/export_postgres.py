"""Export SQLite + extracted workbooks as PostgreSQL INSERTs. Python stdlib only.

Run from any directory: python3 scripts/export_postgres.py
The application and source files are never modified. Import schema first.
"""
import argparse
import hashlib
import json
import os
import re
import sqlite3
import tempfile
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SEED_ORGS = ['Qalam Books', 'Kitap Retail', 'Dara Distribution']
BOOK_FILES = {'pnl': 'workbook-source.json', 'balance': 'balance-source.json',
              'cashflow': 'cashflow-source.json'}
IDENTITIES = ['organizations', 'users', 'operations', 'plans',
              'employee_expenses', 'financial_entries', 'audit']


def literal(value):
    if value is None:
        return 'NULL'
    if isinstance(value, bool):
        value = 'true' if value else 'false'
    if isinstance(value, Decimal) and not value.is_finite():
        raise ValueError('Non-finite decimal')
    value = str(value)
    if '\0' in value:
        raise ValueError('PostgreSQL text cannot contain NUL')
    # All numbers are quoted decimal strings: PostgreSQL converts by target type.
    # standard_conforming_strings=on preserves backslashes, including JSON escapes.
    return "'" + value.replace("'", "''") + "'"


def from_cents(value):
    if type(value) is not int:
        raise ValueError('amount_cents must be an integer')
    return Decimal(value).scaleb(-2)


def boolean(value):
    if value not in (0, 1) or value is None:
        raise ValueError('Expected SQLite boolean 0/1')
    return bool(value)


def cell_row(book, sheet, address, cell):
    if 'value' not in cell or not re.fullmatch(r'[A-Z]+[1-9][0-9]*', address):
        raise ValueError(f'Invalid source cell: {book}/{sheet}/{address}')
    value = cell['value']
    kind = ('null' if value is None else 'boolean' if isinstance(value, bool)
            else 'number' if isinstance(value, (int, Decimal))
            else 'string' if isinstance(value, str) else None)
    if kind is None:
        raise ValueError('Unsupported cell value type')
    return dict(book=book, sheet=sheet, address=address, value_type=kind,
                value_number=value if kind == 'number' else None,
                value_text=value if kind == 'string' else None,
                value_boolean=value if kind == 'boolean' else None,
                formula=cell.get('formula'), has_formula='formula' in cell,
                metadata=json.dumps({k: v for k, v in cell.items()
                                     if k not in ('value', 'formula')},
                                    ensure_ascii=False, allow_nan=False))


def read_sources(db_path, data_dir):
    db = sqlite3.connect(db_path.resolve().as_uri() + '?mode=ro', uri=True)
    db.row_factory = sqlite3.Row
    try:
        db.execute('BEGIN')
        # Force one SQLite snapshot, including committed WAL data.
        db.execute('SELECT count(*) FROM sqlite_master').fetchone()
        names = [r['name'] for r in db.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")]
        expected = {'operations', 'audit', 'periods', 'plans', 'users', 'budgets',
                    'sessions', 'app_migrations', 'employee_expenses',
                    'financial_entries', 'financial_overrides', 'financial_state'}
        if set(names) != expected:
            raise ValueError('Unexpected SQLite tables; review exporter before proceeding')
        tables = {name: [dict(r) for r in db.execute(f'SELECT * FROM "{name}"')]
                  for name in sorted(names)}
    finally:
        db.close()
    books, hashes = {}, {}
    for book, filename in BOOK_FILES.items():
        raw = (data_dir / filename).read_bytes()
        hashes[filename] = hashlib.sha256(raw).hexdigest()
        books[book] = json.loads(raw, parse_float=Decimal,
                                parse_constant=lambda x: (_ for _ in ()).throw(ValueError(x)))
    return tables, books, hashes


def map_tables(source, books, timestamp):
    org_names = list(SEED_ORGS)
    org_names += sorted({r['org'] for name in ('users', 'operations', 'plans', 'budgets')
                         for r in source[name] if r.get('org')} - set(org_names))
    org_ids = {name: i + 1 for i, name in enumerate(org_names)}
    out = {'organizations': [dict(id=i, name=n, active=True) for n, i in org_ids.items()]}

    def organization(row, optional=False):
        if not row.get('org') and optional:
            return None
        return org_ids[row['org']]

    out['users'] = [dict(id=r['id'], username=r['username'], name=r['name'],
                         role=r['role'], org_id=organization(r, True), point=r['point'],
                         language=r['language'], active=boolean(r['active']),
                         must_change_password=boolean(r['must_change_password']),
                         password_salt=r['salt'], password_hash=r['password'],
                         created_at=timestamp) for r in source['users']]
    out['source_workbooks'], out['source_sheets'], out['source_cells'] = [], [], []
    for book, raw in books.items():
        if set(raw) != {'file', 'sha256', 'importedAt', 'sheets'}:
            raise ValueError('Unexpected workbook properties')
        out['source_workbooks'].append(dict(book=book, file_name=raw['file'],
                                            sha256=raw['sha256'], imported_at=raw['importedAt']))
        for position, (name, sheet) in enumerate(raw['sheets'].items(), 1):
            if set(sheet) != {'cells', 'dimension', 'hidden'}:
                raise ValueError('Unexpected sheet properties')
            out['source_sheets'].append(dict(book=book, name=name, position=position,
                                             dimension=sheet['dimension'], hidden=sheet['hidden']))
            out['source_cells'].extend(cell_row(book, name, a, c) for a, c in sheet['cells'].items())
    out['operations'] = []
    for r in source['operations']:
        row = {k: r[k] for k in ('id', 'source', 'external_id', 'date', 'point',
                                 'counterparty', 'document', 'kind', 'amount', 'cost', 'article')}
        row.update(org_id=organization(r), due=r['due'] or None, created_at=timestamp)
        out['operations'].append(row)
    out['plans'] = [dict(id=r['id'], date=r['date'], org_id=organization(r),
                         article=r['article'], amount=r['amount'], direction=r['direction'])
                    for r in source['plans']]
    out['budgets'] = [dict(month=r['month'] + '-01', org_id=organization(r),
                           metric=r['metric'], amount=r['amount']) for r in source['budgets']]
    out['employee_expenses'] = []
    for r in source['employee_expenses']:
        row = {k: r[k] for k in ('id', 'user_id', 'date', 'category', 'description', 'vendor',
                                 'status', 'review_note', 'version', 'created_at', 'updated_at')}
        row.update(amount=from_cents(r['amount_cents']),
                   deleted_at=r['updated_at'] if boolean(r['deleted']) else None)
        out['employee_expenses'].append(row)
    out['financial_entries'] = []
    for r in source['financial_entries']:
        row = {k: r[k] for k in ('id', 'date', 'kind', 'label', 'note', 'expense_id',
                                 'author_id', 'created_at', 'updated_at')}
        row.update(amount=from_cents(r['amount_cents']), active=boolean(r['active']),
                   cash_effect=boolean(r['cash_effect']))
        out['financial_entries'].append(row)
    out['financial_overrides'] = [dict(r, value=Decimal(str(r['value'])))
                                   for r in source['financial_overrides']]
    out['audit'] = [dict(id=r['id'], at=r['time'], author_id=None, author_name=r['author'],
                         action=r['action'], detail=r['detail'], detail_json=None)
                    for r in source['audit']]
    # Historical data must load before closed periods.
    out['periods'] = [dict(month=r['month'] + '-01', closed=boolean(r['closed']),
                           updated_at=timestamp, updated_by=None) for r in source['periods']]
    out['schema_migrations'] = [dict(version='legacy:sqlite:' + r['name'], applied_at=timestamp)
                                for r in source['app_migrations']]
    if len(source['financial_state']) != 1 or source['financial_state'][0]['id'] != 1:
        raise ValueError('Expected singleton financial_state')
    out['financial_state'] = source['financial_state']
    out['sessions'] = []  # Deliberate: invalidate sessions, preserve password hashes.
    return out


def insert_batches(handle, name, rows):
    if not rows:
        return
    columns = list(rows[0])
    for start in range(0, len(rows), 500):
        handle.write(f'INSERT INTO qarzhy.{name} ({",".join(columns)}) VALUES\n')
        batch = rows[start:start + 500]
        for i, row in enumerate(batch):
            if list(row) != columns:
                raise ValueError('Inconsistent row columns')
            handle.write('(' + ','.join(literal(row[c]) for c in columns) + ')')
            handle.write(';\n' if i == len(batch) - 1 else ',\n')


def write_sql(handle, tables, timestamp):
    handle.write('-- Qarzhy private data snapshot: ' + timestamp + '\n')
    handle.write('-- Import AFTER docs/sql/postgres-schema.sql. Sessions excluded.\n')
    handle.write('BEGIN;\nSET LOCAL standard_conforming_strings = on;\n')
    handle.write("SET LOCAL client_encoding = 'UTF8';\nSET LOCAL timezone = 'UTC';\n")
    handle.write('LOCK TABLE ' + ','.join('qarzhy.' + n for n in tables) + ' IN ACCESS EXCLUSIVE MODE;\n')
    handle.write('DO $$ BEGIN\n')
    for name in tables:
        if name in ('organizations', 'financial_state', 'schema_migrations'):
            continue
        handle.write(f"IF EXISTS (SELECT 1 FROM qarzhy.{name}) THEN RAISE EXCEPTION 'Target {name} is not empty'; END IF;\n")
    handle.write("IF (SELECT count(*) FROM qarzhy.organizations) <> 3 OR EXISTS (\n"
                 "SELECT 1 FROM qarzhy.organizations WHERE NOT (\n"
                 "(id=1 AND name='Qalam Books' AND active) OR (id=2 AND name='Kitap Retail' AND active) OR\n"
                 "(id=3 AND name='Dara Distribution' AND active))) THEN\n"
                 "RAISE EXCEPTION 'Expected initial organization seed'; END IF;\n"
                 "IF (SELECT count(*) FROM qarzhy.financial_state) <> 1 OR NOT EXISTS (\n"
                 "SELECT 1 FROM qarzhy.financial_state WHERE id=1 AND revision=0) THEN\n"
                 "RAISE EXCEPTION 'Expected initial revision'; END IF;\n"
                 "IF (SELECT count(*) FROM qarzhy.schema_migrations) <> 1 OR NOT EXISTS (\n"
                 "SELECT 1 FROM qarzhy.schema_migrations WHERE version='0001_postgres_schema') THEN\n"
                 "RAISE EXCEPTION 'Expected initial schema migration'; END IF;\nEND $$;\n")
    for name, rows in tables.items():
        if name == 'financial_state':
            handle.write('UPDATE qarzhy.financial_state SET revision=' + literal(rows[0]['revision']) + ' WHERE id=1;\n')
        else:
            insert_batches(handle, name, rows[3:] if name == 'organizations' else rows)
    # Identity sequence values are not transactional; do this only after all checks.
    handle.write('DO $$ BEGIN\n')
    for name, rows in tables.items():
        expected = len(rows) + (1 if name == 'schema_migrations' else 0)
        handle.write(f"IF (SELECT count(*) FROM qarzhy.{name}) <> {expected} THEN RAISE EXCEPTION 'Row count mismatch: {name}'; END IF;\n")
    handle.write('END $$;\n')
    for name in IDENTITIES:
        handle.write(f"SELECT setval(pg_get_serial_sequence('qarzhy.{name}','id'),"
                     f"COALESCE((SELECT max(id) FROM qarzhy.{name}),1),"
                     f"EXISTS(SELECT 1 FROM qarzhy.{name}));\n")
    handle.write('COMMIT;\n')


def export(db_path, data_dir, output):
    timestamp = datetime.now(timezone.utc).isoformat()
    source, books, hashes = read_sources(db_path, data_dir)
    tables = map_tables(source, books, timestamp)
    # Canonical source snapshot digest includes WAL-visible rows, never raw tokens.
    digest_source = {k: v for k, v in source.items() if k != 'sessions'}
    source_hash = hashlib.sha256(json.dumps(digest_source, sort_keys=True,
                                            ensure_ascii=False).encode()).hexdigest()
    manifest = dict(snapshot_at=timestamp, sqlite_rows_sha256=source_hash,
                    json_files_sha256=hashes,
                    source_counts={k: len(v) for k, v in source.items()},
                    target_counts={k: len(v) + (k == 'schema_migrations') for k, v in tables.items()},
                    excluded_sessions=len(source['sessions']),
                    notes=['Sessions excluded: sign in again.',
                           'deleted_at uses updated_at when deleted=1.',
                           'Missing historical timestamps use snapshot_at.'],
                    totals={name: str(sum((Decimal(str(r[field])) for r in rows), Decimal(0)))
                            for name, rows, field in [
                                ('operations_amount_kzt', tables['operations'], 'amount'),
                                ('operations_cost_kzt', tables['operations'], 'cost'),
                                ('plans_amount_kzt', tables['plans'], 'amount'),
                                ('expenses_amount_kzt', tables['employee_expenses'], 'amount'),
                                ('entries_amount_kzt', tables['financial_entries'], 'amount')]})
    output.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=output.stem + '.', suffix='.tmp', dir=output.parent)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8', newline='\n') as handle:
            write_sql(handle, tables, timestamp)
        manifest['sql_sha256'] = hashlib.sha256(Path(temporary).read_bytes()).hexdigest()
        os.replace(temporary, output)
    finally:
        Path(temporary).unlink(missing_ok=True)
    manifest_path = output.with_suffix('.manifest.json')
    fd = os.open(manifest_path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, 'w', encoding='utf-8') as handle:
        json.dump(manifest, handle, ensure_ascii=False, indent=2)
        handle.write('\n')
    return manifest


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--sqlite', type=Path, default=ROOT / 'data/portal.sqlite')
    parser.add_argument('--data-dir', type=Path, default=ROOT / 'data')
    parser.add_argument('--output', type=Path, default=ROOT / 'data/postgres-data.sql')
    args = parser.parse_args()
    result = export(args.sqlite, args.data_dir, args.output)
    print(json.dumps(dict(output=str(args.output), target_counts=result['target_counts'],
                          excluded_sessions=result['excluded_sessions']), ensure_ascii=False, indent=2))
