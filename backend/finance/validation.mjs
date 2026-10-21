import Decimal from 'decimal.js';

const Exact = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export class FinanceError extends Error {
  constructor(message, status = 422) { super(message); this.status = status; }
}

export function money(value, { allowZero = true, allowNegative = false } = {}) {
  if (typeof value !== 'string' || !/^-?(?:0|[1-9]\d{0,17})(?:\.\d{1,2})?$/.test(value)) throw new FinanceError('Invalid monetary amount');
  const number = new Exact(value);
  if (!allowNegative && number.isNegative()) throw new FinanceError('Amount cannot be negative');
  if (!allowZero && number.isZero()) throw new FinanceError('Amount must be positive');
  return number.toFixed(2);
}

export function quantity(value) {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d{0,17})(?:\.\d{1,6})?$/.test(value)) throw new FinanceError('Invalid quantity');
  const number = new Exact(value);
  if (!number.isPositive()) throw new FinanceError('Quantity must be positive');
  return number.toFixed(6);
}

export function dateOnly(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new FinanceError('Invalid date');
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new FinanceError('Invalid date');
  return value;
}

export function id(value, label = 'ID') {
  if (!/^[1-9]\d*$/.test(String(value))) throw new FinanceError(`Invalid ${label}`);
  return String(value);
}

export async function assertOpenPeriod(client, organizationId, occurredOn) {
  const result = await client.query(`SELECT closed FROM qarzhy.accounting_periods
    WHERE organization_id=$1 AND starts_on=date_trunc('month',$2::date)::date FOR UPDATE`, [organizationId, occurredOn]);
  if (result.rows[0]?.closed) throw new FinanceError('Closed period', 409);
}

export { Exact };
