import calendar
import hashlib
import json
from collections import defaultdict
from datetime import date, timedelta
from decimal import Decimal, localcontext


def number(value):
    if isinstance(value, bool) or not isinstance(value, (int, float, Decimal)):
        return None
    out = Decimal(str(value))
    return out if out.is_finite() else None


def excel_date(value):
    n = number(value)
    if n is None or n < 1 or n > 2958465:
        return None
    try:
        return (date(1899, 12, 30) + timedelta(days=int(n))).isoformat()
    except (ValueError, OverflowError):
        return None


def next_month(day):
    d = date.fromisoformat(day)
    return (d + timedelta(days=calendar.monthrange(d.year, d.month)[1])).isoformat()


def key(value):
    return hashlib.sha256(str(value).encode()).hexdigest()


def dump(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, default=str)


class Builder:
    def __init__(self):
        self.tables = defaultdict(list)
        self.registry = {}
        self.sources = []
        self.checks = []
        self.batch = 1

    def add(self, table, source=None, **fields):
        row = dict(id=len(self.tables[table]) + 1, **fields)
        if source is not None:
            row.update(import_batch_id=self.batch, external_key=source)
        self.tables[table].append(row)
        return row['id']

    def named(self, table, name, namespace='shared', **fields):
        if name is None or not str(name).strip():
            return None
        name = str(name).strip()
        ref = (table, namespace, name)
        if ref in self.registry:
            return self.registry[ref]
        if table in ('financial_articles', 'agreement_types', 'sales_channels', 'organizations', 'asset_groups'):
            fields.setdefault('code', key(ref))
        result = self.add(table, 'registry/' + key(ref), name=name, **fields)
        self.registry[ref] = result
        return result

    def issue(self, code, ref, detail, accepted=False):
        self.add('import_issues', import_batch_id=self.batch, source_ref=ref,
                 code=code, detail=dump(detail), status='accepted' if accepted else 'open')

    def historical(self, family, label, start, end, value, kind, ref,
                   unit='amount', dataset=2, variant='actual'):
        metric_key = (family, label, unit, variant)
        metric = self.named('report_metrics', label, namespace=str(metric_key),
                            code='metric-' + key(metric_key), unit=unit, calculation_kind='input')
        series_key = ('series', dataset, metric)
        if series_key not in self.registry:
            self.registry[series_key] = self.add('historical_series', 'series/' + key(series_key),
                dataset_id=dataset, scope_id=1, report_family=family, metric_id=metric)
        n = number(value)
        if value is not None and n is None:
            self.issue('unavailable_historical_value', ref, {'value': value, 'label': label}, accepted=True)
        return self.add('historical_values', ref, series_id=self.registry[series_key],
                        period_start=start, period_end=end, period_kind=kind, value=n,
                        availability='reported' if n is not None else 'missing' if value is None else 'not_available')

    def compare(self, label, source, target):
        source, target = number(source), number(target)
        with localcontext() as ctx:
            ctx.prec = 60
            delta = target - source if source is not None and target is not None else None
        self.checks.append(dict(label=label, source=source, target=target, difference=delta))
        if delta is not None and abs(delta) > Decimal('0.02'):
            self.issue('source_total_mismatch', label, self.checks[-1])
