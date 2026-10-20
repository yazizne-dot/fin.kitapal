"""Run with: python3 -m unittest discover -s tests -p 'postgres_export_test.py'."""
import importlib.util
import json
import sqlite3
import unittest
from itertools import zip_longest
from decimal import Decimal
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts/export_postgres.py'


class ExportTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if SCRIPT.exists():
            spec = importlib.util.spec_from_file_location('export_postgres', SCRIPT)
            cls.module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(cls.module)

    def test_exporter_exists(self):
        self.assertTrue(SCRIPT.exists(), 'Reproducible PostgreSQL exporter is missing')

    def module_or_skip(self):
        if not SCRIPT.exists():
            self.skipTest('Exporter not implemented yet')
        return self.module

    def test_money_keeps_cents_and_large_integers(self):
        m = self.module_or_skip()
        self.assertEqual(m.from_cents(12345), Decimal('123.45'))
        self.assertEqual(m.from_cents(9007199254740993), Decimal('90071992547409.93'))
        with self.assertRaises(ValueError):
            m.from_cents(1.5)

    def test_sql_literals_roundtrip_quotes_unicode_newlines_and_backslashes(self):
        m = self.module_or_skip()
        db = sqlite3.connect(':memory:')
        for value in [None, '', "O'Brien", 'Қаржы\n\t\\N\\path', 'x\r\ny', 'NULL']:
            self.assertEqual(db.execute('SELECT ' + m.literal(value)).fetchone()[0], value)
        with self.assertRaises(ValueError):
            m.literal('bad\0text')
        db.close()

    def test_cells_preserve_types_and_formula_presence(self):
        m = self.module_or_skip()
        originals = [
            {'value': Decimal('0.1234567890123456789012345')},
            {'value': ''}, {'value': None}, {'value': False},
            {'value': '#REF!', 'error': True, 'formula': None,
             'formulaAttributes': {'t': 'shared', 'si': '0'},
             'sharedFormulaOrigin': None},
            {'value': Decimal('10'), 'formula': 'SUM(A1:A9)',
             'sharedFormulaOrigin': 'A1'},
        ]
        for original in originals:
            row = m.cell_row('pnl', 'Лист с пробелом ', 'A1', original)
            values = { 'number': row['value_number'], 'string': row['value_text'],
                      'boolean': row['value_boolean'], 'null': None }
            restored = {'value': values[row['value_type']]}
            if row['has_formula']:
                restored['formula'] = row['formula']
            restored.update(json.loads(row['metadata']))
            self.assertEqual(restored, original)
        with self.assertRaises(ValueError):
            m.cell_row('pnl', 'Sheet', 'A1', {'value': []})

    def test_insert_batches_execute_without_changing_text_or_decimal_precision(self):
        import io
        m = self.module_or_skip()
        db = sqlite3.connect(':memory:')
        db.execute("ATTACH DATABASE ':memory:' AS qarzhy")
        db.execute('CREATE TABLE qarzhy.example (id TEXT, value TEXT, amount TEXT)')
        values = ["'); DELETE FROM qarzhy.example; --", 'text\nwith; newline', '\\N', '', None]
        rows = [dict(id=i, value=values[i % len(values)], amount=Decimal('0.1234567890123456789'))
                for i in range(501)]
        handle = io.StringIO()
        m.insert_batches(handle, 'example', rows)
        db.executescript(handle.getvalue())
        self.assertEqual(db.execute('SELECT count(*) FROM qarzhy.example').fetchone()[0], 501)
        for actual, expected in zip_longest(db.execute('SELECT * FROM qarzhy.example'), rows):
            self.assertEqual(actual, (str(expected['id']), expected['value'], str(expected['amount'])))
        db.close()


if __name__ == '__main__':
    unittest.main()
