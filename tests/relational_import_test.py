"""Meaningful migration edge cases; no private fixtures committed."""
import sys
import unittest
from decimal import Decimal
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from relational_import.core import Builder, excel_date
from relational_import.workbooks import cash_rows, balance, statements
from relational_import.sqlite_data import migrate


class MigrationTest(unittest.TestCase):
    def test_excel_dates_and_invalid_values(self):
        self.assertEqual(excel_date(44287), '2021-04-01')
        for value in (True, None, 'unknown', -1):
            self.assertIsNone(excel_date(value))

    def test_two_directions_exact_decimals_and_negative_reversal(self):
        b = Builder()
        cells = {k: {'value': v} for k, v in {
            'A2': 2021, 'B2': 4, 'C2': 44287,
            'D2': Decimal('123.456789'), 'E2': Decimal('-2.25'),
            'G2': 'Rent', 'I2': 'Author'}.items()}
        cash_rows(b, cells, 'cashflow/База')
        rows = b.tables['cash_movements']
        self.assertEqual([(r['direction'], r['amount']) for r in rows],
                         [('in', Decimal('123.456789')), ('in', Decimal('2.25'))])
        self.assertNotEqual(rows[0]['external_key'], rows[1]['external_key'])
        self.assertTrue(any(r['code'] == 'negative_cash' for r in b.tables['import_issues']))

    def test_invalid_cash_date_is_reported_not_silently_dropped(self):
        b = Builder()
        cash_rows(b, {'D2': {'value': 500}}, 'cashflow/База')
        self.assertFalse(b.tables['cash_movements'])
        self.assertTrue(any(r['code'] == 'invalid_cash_date' for r in b.tables['import_issues']))

    def test_text_in_cash_amount_is_reported(self):
        b=Builder()
        cash_rows(b,{'C2':{'value':44287},'E2':{'value':'#REF!'}},'cashflow/База')
        self.assertTrue(any(r['code']=='invalid_cash_amount' for r in b.tables['import_issues']))

    def test_registry_distinguishes_namespaces(self):
        b = Builder()
        a = b.named('counterparties', 'A', namespace='one')
        self.assertEqual(a, b.named('counterparties', 'A', namespace='one'))
        self.assertNotEqual(a, b.named('counterparties', 'A', namespace='two'))

    def test_source_missing_is_not_zero(self):
        b = Builder()
        b.historical('pnl', 'Revenue', '2026-01-01', '2026-02-01', None, 'monthly', 'pnl/r/Jan')
        row = b.tables['historical_values'][0]
        self.assertIsNone(row['value'])
        self.assertEqual(row['availability'], 'missing')

    def test_balance_totals_with_same_label_are_distinct_metrics(self):
        b = Builder()
        empty = {'cells': {}}
        book = {'sheets': {n: empty for n in ('Данные', 'Справочник', 'касса', 'Свод для $Отчет2025 ', 'Свод для кассы', 'ОС')}}
        book['sheets']['Баланс'] = {'cells': {k: {'value': v} for k,v in {
            'B4':'Активы','B12':'Итого','C12':100,
            'B14':'Обязательства','B21':'Итого','C21':100}.items()}}
        balance(b, book)
        values=b.tables['historical_values']
        self.assertEqual(len(values),2)
        self.assertNotEqual(values[0]['series_id'],values[1]['series_id'])

    def test_annual_ratio_uses_same_metric_as_monthly_and_keeps_side_ratio(self):
        b=Builder()
        book={'sheets':{'P&L_2026':{'cells':{k:{'value':v} for k,v in {
            'C3':46023,'A5':'Маржа %','B5':Decimal('0.2'),
            'C5':Decimal('0.1'),'O5':Decimal('0.15')}.items()}}}}
        statements(b,book)
        monthly=next(x for x in b.tables['historical_values'] if x['external_key'].endswith('/C'))
        annual=next(x for x in b.tables['historical_values'] if x['external_key'].endswith('/O'))
        self.assertEqual(monthly['series_id'],annual['series_id'])
        self.assertTrue(any(x['external_key'].endswith('/B') for x in b.tables['historical_values']))

    def test_sales_2022_uses_month_headers_and_distinct_cost_section(self):
        b=Builder()
        values={'B22':' Продажи, сумма','C22':'Месяц','B23':'Канал продаж','C23':1,'D23':2,
                'B24':'Shop','C24':100,'D24':200,'O24':300,
                'B45':'Сумма по полю Себес сумма','C45':'Месяц','B46':'Канал продаж','C46':1,'D46':2,
                'B47':'Shop','C47':50,'D47':60,'O47':110}
        statements(b,{'sheets':{'Отчет по продажам_2022':{'cells':{k:{'value':v} for k,v in values.items()}}}})
        monthly=[x for x in b.tables['historical_values'] if x['period_kind']=='monthly']
        self.assertEqual(len(monthly),4)
        self.assertEqual(sorted(x['value'] for x in monthly),list(map(Decimal,[50,60,100,200])))
        self.assertEqual(len(set(x['series_id'] for x in monthly)),2)

    def test_sales_cash_control_pivot_is_preserved_without_cash_movements(self):
        b=Builder()
        values={'B55':'Сумма по полю Кіріс','C55':'Месяц','B57':'Статья','C57':1,
                'B58':'Rent','C58':Decimal('12.34'),'O58':Decimal('12.34')}
        statements(b,{'sheets':{'Отчет по продажам_2023':{'cells':{k:{'value':v} for k,v in values.items()}}}})
        self.assertEqual(len(b.tables['historical_values']),2)
        self.assertEqual(len(b.tables['cash_movements']),0)

    def test_real_confirmed_sqlite_sale_and_partial_payment_are_separate(self):
        b=Builder()
        source={t:[] for t in ('users','operations','plans','budgets','employee_expenses','financial_entries','audit','periods','financial_overrides')}
        base=dict(source='demo',external_id='demo',date='2026-01-01',org='Company',point='Shop',
                  counterparty='Buyer',document='D1',cost=0,due='',article='Sales')
        source['operations']=[dict(base,id=1,kind='sale',amount=100),dict(base,id=2,kind='receipt',amount=75)]
        source['plans']=[dict(id=1,date='2026-02-01',org='Company',article='Sales',amount=25,direction='in')]
        migrate(b,source)
        self.assertEqual(len(b.tables['documents']),1)
        self.assertEqual(len(b.tables['financial_events']),1)
        self.assertEqual(len(b.tables['cash_movements']),1)
        self.assertEqual(b.tables['document_settlements'][0]['amount'],Decimal(75))
        self.assertEqual(len(b.tables['payment_plans']),1)
        self.assertEqual(b.tables['financial_events'][0]['dataset_id'],3)


if __name__ == '__main__':
    unittest.main()
