"""Verify generated INSERT values locally; not a PostgreSQL integration test.

SQLite is used only as an independent SQL string parser and TEXT row store.
PostgreSQL DDL, constraints, DO blocks and triggers require PostgreSQL testing.
"""
import hashlib
import json
import sqlite3
from itertools import zip_longest
from decimal import Decimal
from pathlib import Path

from export_postgres import ROOT, map_tables, read_sources


def verify():
    output = ROOT / 'data/postgres-data.sql'
    manifest = json.loads(output.with_suffix('.manifest.json').read_text())
    assert hashlib.sha256(output.read_bytes()).hexdigest() == manifest['sql_sha256']
    source, books, hashes = read_sources(ROOT / 'data/portal.sqlite', ROOT / 'data')
    assert hashes == manifest['json_files_sha256'], 'JSON changed after snapshot'
    snapshot = {k: v for k, v in source.items() if k != 'sessions'}
    assert hashlib.sha256(json.dumps(snapshot, sort_keys=True, ensure_ascii=False).encode()).hexdigest() == manifest['sqlite_rows_sha256'], 'SQLite changed after snapshot'
    tables = map_tables(source, books, manifest['snapshot_at'])
    db = sqlite3.connect(':memory:')
    db.row_factory = sqlite3.Row
    db.execute("ATTACH DATABASE ':memory:' AS qarzhy")
    for name, rows in tables.items():
        columns = list(rows[0]) if rows else ['unused']
        db.execute(f'CREATE TABLE qarzhy.{name} (' + ','.join(f'"{c}" TEXT' for c in columns) + ')')
    for row in tables['organizations'][:3]:
        db.execute('INSERT INTO qarzhy.organizations VALUES(?,?,?)', (row['id'], row['name'], 'true'))
    db.execute("INSERT INTO qarzhy.schema_migrations VALUES('0001_postgres_schema',?)", (manifest['snapshot_at'],))
    db.execute("INSERT INTO qarzhy.financial_state VALUES('1','0')")
    statement = ''
    with output.open() as handle:
        for line in handle:
            if statement or line.startswith('INSERT INTO qarzhy.'):
                statement += line
                if sqlite3.complete_statement(statement):
                    db.execute(statement)
                    statement = ''
            elif line.startswith('UPDATE qarzhy.financial_state SET revision='):
                db.execute(line)
    assert not statement, 'Incomplete INSERT'

    def textual(value):
        return None if value is None else ('true' if value else 'false') if isinstance(value, bool) else str(value)

    for name, expected in tables.items():
        actual = db.execute(f'SELECT * FROM qarzhy.{name}')
        if name == 'schema_migrations':
            next(actual)  # Initial schema row exists before importing data.
        count = 0
        for row, want in zip_longest(actual, expected):
            assert dict(row) == {k: textual(v) for k, v in want.items()}, f'INSERT mismatch: {name}/{count}'
            count += 1
        assert count == len(expected)
    # Reconstruct each complete source object independently of the mapper.
    restored = {}
    for row in db.execute('SELECT * FROM qarzhy.source_workbooks'):
        restored[row['book']] = dict(file=row['file_name'], sha256=row['sha256'],
                                     importedAt=row['imported_at'], sheets={})
    for row in db.execute('SELECT * FROM qarzhy.source_sheets ORDER BY book, CAST(position AS INTEGER)'):
        restored[row['book']]['sheets'][row['name']] = dict(cells={}, dimension=row['dimension'], hidden=row['hidden'] == 'true')
    for row in db.execute('SELECT * FROM qarzhy.source_cells'):
        kind = row['value_type']
        value = (Decimal(row['value_number']) if kind == 'number' else row['value_text'] if kind == 'string'
                 else row['value_boolean'] == 'true' if kind == 'boolean' else None)
        cell = dict(value=value)
        if row['has_formula'] == 'true':
            cell['formula'] = row['formula']
        cell.update(json.loads(row['metadata']))
        restored[row['book']]['sheets'][row['sheet']]['cells'][row['address']] = cell
    assert restored == books, 'Reconstructed workbook differs from source JSON'
    for name in books:
        assert list(restored[name]['sheets']) == list(books[name]['sheets']), 'Sheet order changed'
    for name in ('employee_expenses', 'financial_entries'):
        old = {r['id']: r for r in source[name]}
        for row in db.execute(f'SELECT * FROM qarzhy.{name}'):
            assert Decimal(row['amount']) * 100 == old[int(row['id'])]['amount_cents']
    for name in ('operations', 'plans', 'budgets'):
        if not source[name]:
            continue
        assert sum((Decimal(r['amount']) for r in db.execute(f'SELECT amount FROM qarzhy.{name}')), Decimal(0)) == sum(r['amount'] for r in source[name])
    db.close()
    print(f"PASS: every INSERT row, all 3 reconstructed workbooks, {len(tables['source_cells'])} cells, money, revision and excluded sessions")


if __name__ == '__main__':
    verify()
