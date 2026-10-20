"""Explicit workbook layouts; cached values are preserved, never recalculated."""
import re
from collections import defaultdict
from datetime import date, timedelta
from decimal import Decimal
from .core import number, excel_date, next_month, key, dump


def rows(cells):
    out = defaultdict(dict)
    for address, cell in cells.items():
        match = re.fullmatch(r'([A-Z]+)([1-9][0-9]*)', address)
        if not match:
            raise ValueError('Invalid source address: ' + address)
        out[int(match[2])][match[1]] = cell.get('value')
    return dict(sorted(out.items()))


def column(n):
    result = ''
    while n:
        n, r = divmod(n - 1, 26)
        result = chr(65 + r) + result
    return result


def cash_rows(b, cells, namespace):
    for r, values in rows(cells).items():
        if r == 1:
            continue
        ref = f'{namespace}/{r}'
        amounts = [('D', 'in', number(values.get('D'))), ('E', 'out', number(values.get('E')))]
        for col, _, n in amounts:
            if n is None and values.get(col) not in (None, ''):
                b.issue('invalid_cash_amount', ref+'/'+col, {'value':values.get(col)})
        if not any(n for _, _, n in amounts):
            continue
        day = excel_date(values.get('C'))
        if day is None:
            b.issue('invalid_cash_date', ref, values)
            continue
        if number(values.get('A')) != int(day[:4]) or number(values.get('B')) != int(day[5:7]):
            b.issue('cash_period_mismatch', ref, {'date': day, 'year': values.get('A'), 'month': values.get('B')})
        article = b.named('financial_articles', values.get('G') or 'Не указано', namespace='cashflow')
        responsible = b.named('persons', values.get('F'), namespace='cashflow')
        author = b.named('persons', values.get('I'), namespace='cashflow')
        for col, direction, n in amounts:
            if n is None or n == 0:
                continue
            if n < 0:
                b.issue('negative_cash', ref + '/' + col, {'original': n, 'direction': direction}, accepted=True)
                direction = 'out' if direction == 'in' else 'in'
            b.add('cash_movements', ref + '/' + col, dataset_id=2, scope_id=1,
                  organization_id=None, cash_account_id=None, occurred_on=day,
                  direction=direction, amount=abs(n), article_id=article,
                  responsible_person_id=responsible, author_person_id=author,
                  note=str(values.get('H') or ''), posting_key=ref + '/' + col)


def cashflow(b, book):
    cells = book['sheets']['База']['cells']
    cash_rows(b, cells, 'cashflow/База')
    raw_rows = rows(cells)
    for col, direction in [('D', 'in'), ('E', 'out')]:
        # Signed sums allow a negative expense to remain a cash correction.
        source = sum((number(v.get(col)) or Decimal(0) for r, v in raw_rows.items() if r > 1), Decimal(0))
        target = sum((x['amount'] if x['direction'] == direction else -x['amount']
                      for x in b.tables['cash_movements'] if x['external_key'].endswith('/' + col)), Decimal(0))
        b.compare('cashflow signed ' + col, source, target)
    b.issue('unassigned_cash_context', 'cashflow/База',
            'Source has no confirmed organization/account; preserve consolidated imported context.')
    for name, sheet in book['sheets'].items():
        b.sources.append(dict(book='cashflow', sheet=name, cells=len(sheet['cells']),
                              route='cash_movements' if name == 'База' else 'control/archive'))


def sales_report(b, rr, name, year):
    section, periods = '', {}
    for r,row in rr.items():
        label=row.get('B')
        if not isinstance(label,str):
            continue
        label=label.strip()
        if str(row.get('C')).strip() in ('Месяц','Ай'):
            section=label
            periods={}
            continue
        if label in ('Канал продаж','Статья'):
            periods={}
            for c in range(3,15):
                n=number(row.get(column(c)))
                if n is not None and n==int(n) and 1<=n<=12:
                    day=f'{year}-{int(n):02}-01'
                    periods[column(c)]=(day,next_month(day))
            continue
        if label in ('Поставщик','Дата','Год','Номенклатура'):
            periods={}
            continue
        if not periods:
            continue
        metric=f'{name}: {section} / {label}'
        for c,(start,end) in periods.items():
            b.historical('sales',metric,start,end,row.get(c),'monthly',f'pnl/{name}/{r}/{c}')
        if 'O' in row:
            b.historical('sales',metric,f'{year}-01-01',f'{year+1}-01-01',row['O'],'source_ytd',f'pnl/{name}/{r}/O')


def statements(b, book):
    for name, sheet in book['sheets'].items():
        rr = rows(sheet['cells'])
        b.sources.append(dict(book='pnl', sheet=name, cells=len(sheet['cells']), route='historical/control/archive'))
        if not rr:
            continue
        year_match = re.search(r'(20\d{2})$', name.strip())
        if not year_match:
            if any(number(v) is not None for row in rr.values() for v in row.values()):
                b.issue('undated_supporting_sheet', 'pnl/' + name,
                        'Supporting values retained in source archive; no confirmed reporting period.')
            continue
        year = int(year_match[1])
        year_start, year_end = f'{year}-01-01', f'{year+1}-01-01'
        is_pnl = name.startswith('P&L_')
        is_budget = name.startswith('Бюджет')
        is_sales = name.startswith('Отчет по продажам')
        if not (is_pnl or is_budget or is_sales):
            b.issue('unknown_report_layout', name, 'Unrecognized report layout')
            continue
        family = 'pnl' if is_pnl else 'budget' if is_budget else 'sales'
        if is_sales:
            sales_report(b,rr,name,year)
            continue
        periods = {}
        if is_pnl:
            for c in range(3, 15):
                start = excel_date(rr.get(3, {}).get(column(c)))
                if start:
                    periods[column(c)] = (start, next_month(start), 'actual')
            first = 4
        elif is_budget:
            for c in range(2, 36, 3):
                start = excel_date(rr.get(2, {}).get(column(c)))
                if start:
                    for offset, variant in enumerate(('plan', 'actual', 'fulfilment')):
                        periods[column(c+offset)] = (start, next_month(start), variant)
            first = 4
        section = ''
        occurrences = defaultdict(int)
        for r, row in rr.items():
            if r < first:
                continue
            label = row.get('A')
            if not isinstance(label, str) or not label.strip():
                if any(number(row.get(c)) is not None for c in periods):
                    b.issue('unlabelled_report_row', f'pnl/{name}/{r}', row)
                continue
            label = label.strip()
            row_year_match=re.search(r',\s*(20\d{2})$',label) if is_pnl else None
            row_year=int(row_year_match[1]) if row_year_match else year
            row_year_start,row_year_end=f'{row_year}-01-01',f'{row_year+1}-01-01'
            # Excel's helper month ordinal on section headings is not revenue.
            structural = (is_pnl and [number(row.get(column(c))) for c in range(3,15)] == list(map(Decimal, range(2,14))))
            if structural:
                section = label
                continue
            metric_label = f'{name}: {section + "/" if section else ""}{label}'
            occurrences[metric_label] += 1
            if occurrences[metric_label] > 1:
                metric_label += f' (строка группы {occurrences[metric_label]})'
            has_amount = False
            for c, (start,end,variant) in periods.items():
                if row_year!=year:
                    start=f'{row_year}'+start[4:]
                    end=next_month(start)
                value = row.get(c)
                if value is None and not any(row.get(x) is not None for x in periods):
                    continue
                unit = 'ratio' if variant == 'fulfilment' or '%' in label or 'Конверсия' in label else 'quantity' if 'Количество' in label else 'amount'
                b.historical(family, metric_label, start, end, value, 'monthly',
                             f'pnl/{name}/{r}/{c}', unit=unit, variant=variant)
                has_amount = True
            totals = [('O','actual')] if is_pnl else [('AL','plan'),('AM','actual'),('AN','fulfilment')]
            for c, variant in totals:
                if c in row:
                    unit = 'ratio' if variant=='fulfilment' or '%' in label or 'Конверсия' in label else 'quantity' if variant=='Количество' or 'Количество' in label else 'amount'
                    b.historical(family, metric_label, row_year_start, row_year_end, row[c], 'source_ytd',
                                 f'pnl/{name}/{r}/{c}', unit=unit, variant=variant)
                    has_amount = True
            if is_pnl and number(row.get('B')) is not None:
                b.historical(family, metric_label+' / Расчётная доля',row_year_start,row_year_end,row['B'],
                    'source_ytd',f'pnl/{name}/{r}/B',unit='ratio',variant='share')
                has_amount=True
            if is_pnl:
                if number(row.get('P')) is not None and label.startswith('ИТОГО НЕРАСПРЕДЕЛЁННАЯ'):
                    b.historical(family,metric_label+' / Рентабельность',row_year_start,row_year_end,row['P'],
                        'source_ytd',f'pnl/{name}/{r}/P',unit='ratio',variant='margin')
                extras={c:v for c,v in row.items() if c not in set(periods)|{'A','B','O'} and number(v) is not None}
                if label.startswith('ИТОГО НЕРАСПРЕДЕЛЁННАЯ'):
                    extras.pop('P',None)
                if extras:
                    b.issue('unmapped_auxiliary_columns',f'pnl/{name}/{r}',extras)
            if not has_amount and any(number(v) is not None for v in row.values()):
                b.issue('unmapped_report_value', f'pnl/{name}/{r}', row)
            if not has_amount:
                section = label


def balance(b, book):
    snapshot = b.add('balance_snapshots', 'balance/snapshot/2026-09-01', dataset_id=2,
                     scope_id=1, as_of_date='2026-09-01', label='Баланс 01.09.2026', status='draft')
    start, end = '2026-09-01', '2026-09-02'
    for name, sheet in book['sheets'].items():
        b.sources.append(dict(book='balance', sheet=name, cells=len(sheet['cells']), route='references/snapshot/control'))
    def product(row, publisher):
        sku = str(row.get('A') or '').strip()
        # The full source tuple prevents accidental merging of conflicting SKUs.
        namespace = 'balance/' + key((sku, publisher, row.get('B')))
        return b.named('products', row.get('B'), namespace=namespace,
                       sku_namespace=namespace if sku else None, sku=sku or None)
    inventory = []
    for name in ('Данные', 'Справочник'):
        for r, row in rows(book['sheets'][name]['cells']).items():
            if r < 3 or not isinstance(row.get('B'), str) or not row['B'].strip():
                continue
            publisher_name = row.get('D' if name=='Данные' else 'C')
            publisher = b.named('counterparties', publisher_name, namespace='balance-publisher')
            if publisher and ('publisher-role', publisher) not in b.registry:
                b.registry['publisher-role', publisher] = b.add('counterparty_roles', counterparty_id=publisher, role='publisher')
            agreement = b.named('agreement_types', row.get('E' if name=='Данные' else 'D'))
            p = product(row, publisher_name)
            if name != 'Данные':
                continue
            qty, value = number(row.get('C')), number(row.get('G'))
            if qty is None or value is None:
                b.issue('incomplete_inventory_position', f'balance/{name}/{r}', row)
                continue
            b.add('inventory_positions', f'balance/{name}/{r}', snapshot_id=snapshot,
                  product_id=p, publisher_id=publisher, agreement_type_id=agreement,
                  quantity=qty, unit_cost=number(row.get('F')), total_value=value)
            inventory.append((row.get('E'),value))
    main = rows(book['sheets']['Баланс']['cells'])
    section = ''
    for r, row in main.items():
        if r in (4,14):
            section = str(row.get('B') or '')
        if isinstance(row.get('B'),str) and 'C' in row:
            b.historical('balance', section+' / '+row['B'].strip(), start,end,row['C'],'snapshot', f'balance/main/{r}')
    b.compare('inventory prepaid', main.get(7,{}).get('C'), sum((v for a,v in inventory if a=='Предоплата'),Decimal(0)))
    b.compare('inventory consignment', main.get(15,{}).get('C'), sum((v for a,v in inventory if a=='Реализация'),Decimal(0)))
    for r, row in rows(book['sheets']['касса']['cells']).items():
        if r < 5 or not isinstance(row.get('B'),str):
            continue
        ref=f'balance/cash/{r}'
        account=b.named('cash_accounts',row['B'],namespace='balance',code=key(ref),
                        organization_id=None,account_type='other')
        n=number(row.get('C'))
        if n is not None:
            b.add('cash_balances',ref,snapshot_id=snapshot,cash_account_id=account,amount=n)
        else:
            b.issue('missing_cash_balance',ref,{'account':row['B'],'amount':row.get('C')})
        if number(row.get('F')) is not None:
            b.historical('balance', 'Касса дополнительная расшифровка: '+row['B'],start,end,row['F'],'snapshot',ref+'/detail')
    b.compare('cash account breakdown',main.get(5,{}).get('C'),sum((x['amount'] for x in b.tables['cash_balances']),Decimal(0)))
    supplier_sheet='Свод для $Отчет2025 '
    for r,row in rows(book['sheets'][supplier_sheet]['cells']).items():
        if r < 5 or not isinstance(row.get('A'),str):
            continue
        if r <= 41 and number(row.get('B')) is not None:
            cp=b.named('counterparties',row['A'],namespace='balance-publisher')
            b.add('counterparty_balances',f'balance/supplier/{r}',snapshot_id=snapshot,
                  counterparty_id=cp,balance_kind='payable',amount=number(row['B']))
        for col,day in [('D','2026-07-30'),('F','2026-06-30')]:
            if number(row.get(col)) is not None:
                # Dates are read from actual source headers below, never inferred from name.
                header=rows(book['sheets'][supplier_sheet]['cells']).get(4,{}).get(col)
                day=excel_date(header)
                if day:
                    b.historical('balance', 'Долг поставщику: '+row['A'], day,
                        (date.fromisoformat(day)+timedelta(days=1)).isoformat(),row[col],'snapshot',f'balance/supplier/{r}/{col}')
    for r,row in rows(book['sheets']['Свод для кассы']['cells']).items():
        if not 3<=r<=10 or not isinstance(row.get('G'),str):
            continue
        group=b.named('asset_groups',row['G'],namespace='balance-summary')
        if number(row.get('I')) is not None:
            b.add('asset_group_balances',f'balance/asset/{r}',snapshot_id=snapshot,
                  asset_group_id=group,amount=number(row['I']))
        if number(row.get('H')) is not None:
            b.historical('balance','ОС исходная стоимость 2025: '+row['G'],start,end,row['H'],'snapshot',f'balance/asset/{r}/prior')
    # Detailed OS quantities and values are separate supporting metrics, not additive balances.
    for r,row in rows(book['sheets']['ОС']['cells']).items():
        if r<4 or not isinstance(row.get('A'),str):
            continue
        for col,v in row.items():
            if col=='A' or number(v) is None:
                continue
            label=rows(book['sheets']['ОС']['cells']).get(3,{}).get(col,col)
            b.historical('balance', f'ОС детализация: {row["A"]} / {label}',start,end,v,'snapshot',f'balance/os/{r}/{col}',
                         unit='quantity' if col in 'BCDEFGHI' else 'amount')
    b.issue('opening_balance_unverified','balance/snapshot',
            'Snapshot remains draft; reconcile cash details, supplier and asset totals before using as opening balance.')
