export const kinds = {
  sale: "Сату",
  receipt: "Клиент төлемі",
  purchase: "Тауар сатып алу",
  supplier_payment: "Жеткізушіге төлем",
  expense: "Операциялық шығыс",
  expense_payment: "Шығысты төлеу",
  depreciation: "Амортизация",
  tax: "Салық есептеу",
  tax_payment: "Салық төлеу",
  capital: "Капитал салымы",
  loan: "Қарыз алу",
  loan_payment: "Қарызды өтеу",
  asset: "Негізгі құрал сатып алу",
  transfer: "Ішкі аударым",
  return: "Сату қайтарымы",
};
export function ledger(operations) {
  const a = {
    cash: 0,
    receivables: 0,
    inventory: 0,
    fixed: 0,
    payables: 0,
    taxes: 0,
    loans: 0,
    capital: 0,
    revenue: 0,
    cost: 0,
    opex: 0,
    depreciation: 0,
    tax: 0,
    operating: 0,
    investing: 0,
    financing: 0,
    inflow: 0,
    outflow: 0,
  };
  for (const o of operations) {
    const n = o.amount,
      c = o.cost || 0;
    let flow = 0;
    switch (o.kind) {
      case "sale":
        a.revenue += n;
        a.receivables += n;
        a.cost += c;
        a.inventory -= c;
        break;
      case "return":
        a.revenue -= n;
        a.receivables -= n;
        a.cost -= c;
        a.inventory += c;
        break;
      case "receipt":
        a.receivables -= n;
        flow = n;
        a.operating += n;
        break;
      case "purchase":
        a.inventory += n;
        a.payables += n;
        break;
      case "supplier_payment":
        a.payables -= n;
        flow = -n;
        a.operating -= n;
        break;
      case "expense":
        a.opex += n;
        a.payables += n;
        break;
      case "expense_payment":
        a.payables -= n;
        flow = -n;
        a.operating -= n;
        break;
      case "depreciation":
        a.fixed -= n;
        a.depreciation += n;
        break;
      case "tax":
        a.tax += n;
        a.taxes += n;
        break;
      case "tax_payment":
        a.taxes -= n;
        flow = -n;
        a.operating -= n;
        break;
      case "capital":
        a.capital += n;
        flow = n;
        a.financing += n;
        break;
      case "loan":
        a.loans += n;
        flow = n;
        a.financing += n;
        break;
      case "loan_payment":
        a.loans -= n;
        flow = -n;
        a.financing -= n;
        break;
      case "asset":
        a.fixed += n;
        flow = -n;
        a.investing -= n;
        break;
    }
    a.cash += flow;
    if (flow > 0) a.inflow += flow;
    else a.outflow -= flow;
  }
  a.gross = a.revenue - a.cost;
  a.ebitda = a.gross - a.opex;
  a.pretax = a.ebitda - a.depreciation;
  a.profit = a.pretax - a.tax;
  a.assets = a.cash + a.receivables + a.inventory + a.fixed;
  a.liabilities = a.payables + a.taxes + a.loans;
  a.equity = a.capital + a.profit;
  a.difference = a.assets - a.liabilities - a.equity;
  return a;
}
export function validate(o) {
  if (!o.external_id || !o.source || !o.org || !o.document)
    throw Error("ID, дереккөз, ұйым және құжат міндетті");
  if (!Object.hasOwn(kinds, o.kind)) throw Error("Белгісіз операция түрі");
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(o.date) ||
    !Number.isFinite(Date.parse(o.date)) ||
    new Date(o.date).toISOString().slice(0, 10) !== o.date
  )
    throw Error("Күн YYYY-MM-DD форматында болуы керек");
  if (
    !Number.isSafeInteger(o.amount) ||
    o.amount <= 0 ||
    !Number.isSafeInteger(o.cost || 0) ||
    (o.cost || 0) < 0
  )
    throw Error("Сома оң бүтін теңгемен көрсетілуі керек");
  if (
    o.due &&
    (!/^\d{4}-\d{2}-\d{2}$/.test(o.due) ||
      !Number.isFinite(Date.parse(o.due)) ||
      new Date(o.due).toISOString().slice(0, 10) !== o.due)
  )
    throw Error("Төлем мерзімі қате");
}
export function debts(operations, asof) {
  const map = new Map();
  for (const o of operations) {
    let side,
      amount = 0;
    if (["sale", "return", "receipt"].includes(o.kind)) {
      side = "receivable";
      amount = o.kind === "sale" ? o.amount : -o.amount;
    } else if (
      ["purchase", "expense", "supplier_payment", "expense_payment"].includes(
        o.kind,
      )
    ) {
      side = "payable";
      amount = ["purchase", "expense"].includes(o.kind) ? o.amount : -o.amount;
    } else continue;
    const key = [o.org, o.counterparty, o.document, side].join("|");
    const d = map.get(key) || {
      org: o.org,
      counterparty: o.counterparty,
      document: o.document,
      due: o.due || o.date,
      side,
      amount: 0,
    };
    d.amount += amount;
    map.set(key, d);
  }
  return [...map.values()]
    .filter((d) => d.amount !== 0)
    .map((d) => ({
      ...d,
      days: Math.max(
        0,
        Math.floor((Date.parse(asof) - Date.parse(d.due)) / 86400000),
      ),
    }));
}
