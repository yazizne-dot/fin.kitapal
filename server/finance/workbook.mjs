import { readFileSync, existsSync } from "node:fs";
const norm = (s) =>
  String(s || "")
    .trim()
    .replace(/\s+/g, " ");
const number = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const sum = (values) => values.reduce((s, v) => s + (number(v) ?? 0), 0);
const column = (n) => {
  let out = "";
  for (; n; n = Math.floor((n - 1) / 26))
    out = String.fromCharCode(65 + ((n - 1) % 26)) + out;
  return out;
};
const near = (a, b) => Math.abs(a - b) < 0.02;
export const metricLabels = {
  revenue: "Сатудан түскен түсім",
  cost: "Сатылған өнімнің өзіндік құны",
  gross: "Жалпы пайда",
  opex: "Операциялық шығыстар",
  operatingProfit: "Операциялық пайда",
  otherExpense: "Өзге шығыстар",
  taxes: "Салықтар",
  bonuses: "Дистрибьюторларға ретро-бонустар",
  otherIncome: "Негізгі емес қызметтен кіріс",
  profit: "Таза пайда / залал",
  dividends: "Құрылтайшыларға төлемдер",
  retained: "Бөлінбеген пайда / залал",
};
const groups = [
  "revenue",
  "cost",
  "opex",
  "otherExpense",
  "taxes",
  "bonuses",
  "otherIncome",
  "dividends",
];
export function channelLabel(label) {
  return label.startsWith("Продажи_по_магазинам_")
    ? label.replace("Продажи_по_магазинам_", "").replaceAll("_", " · ")
    : {
        Продажи_по_дитрибьюторам: "Дистрибьюторлар",
        Продажи_интернет_операторы: "Интернет операторлар",
        Продажи_оптовые: "Көтерме сату",
        Продажи_Каспи: "Kaspi",
        Продажи_Сайт: "Сайт",
        Продажи_Тендер: "Тендер",
        Продажи_Экстра: "Экстра",
      }[label] || label.replaceAll("_", " ");
}
export function createWorkbookDataset(raw) {
  const sheets = raw.sheets,
    monthly = new Map(),
    yearRows = {},
    budgetMonths = new Map(),
    warnings = [];
  function cell(sheet, ref) {
    const c = sheets[sheet]?.cells[ref] || {};
    const origin = c.sharedFormulaOrigin;
    return {
      value: number(c.value),
      raw: c.value ?? null,
      sheet,
      cell: ref,
      formula: c.formula || null,
      formulaOrigin: origin
        ? { cell: origin, formula: sheets[sheet].cells[origin]?.formula }
        : null,
    };
  }
  function labels(sheet) {
    return Object.entries(sheets[sheet].cells)
      .filter(([a, c]) => /^A\d+$/.test(a) && typeof c.value === "string")
      .map(([a, c]) => ({ row: +a.slice(1), label: norm(c.value) }))
      .sort((a, b) => a.row - b.row);
  }
  const issue = (o) =>
    warnings.push({ ...o, id: `check-${warnings.length + 1}` });
  for (const year of [2023, 2024, 2025, 2026]) {
    const sheet = `P&L_${year}`;
    if (!sheets[sheet]) continue;
    const ls = labels(sheet),
      find = (fn) => ls.find((x) => fn(x.label))?.row;
    const r = {
      revenue: find((s) => s.startsWith("ТОТАЛ ВЫРУЧКА")),
      cost: find((s) => s === "ИТОГО СЕБЕСТОИМОСТЬ"),
      gross: find((s) => s.startsWith("ВАЛОВЫЙ ДОХОД")),
      opex: find((s) => s.startsWith("ИТОГО АДМИНИСТРАТИВНЫЕ")),
      operatingProfit: find((s) => s.startsWith("ОПЕРАЦИОННАЯ ПРИБЫЛЬ")),
      otherExpense: find((s) => s === "ПРОЧИЕ РАСХОДЫ"),
      taxes: find((s) => s === "НАЛОГИ"),
      bonuses: find((s) => s === "РЕТРО-БОНУСЫ ДИСТРАМ"),
      otherIncome: find(
        (s) => s === "ПРОЧИЕ ДОХОДЫ ОТ НЕОСНОВНОЙ ДЕЯТЕЛЬНОСТИ",
      ),
      profit: find((s) => s === "ЧИСТАЯ ПРИБЫЛЬ"),
      retained: find((s) => s.startsWith("ИТОГО НЕРАСПРЕДЕЛЁННАЯ")),
    };
    if (Object.values(r).some((v) => !v))
      throw Error(`P&L құрылымы танылмады: ${sheet}`);
    const sections = {
      revenue: [5, r.revenue - 1],
      cost: [
        find((s) => s === "СЕБЕСТОИМОСТЬ РЕАЛИЗОВАННОЙ ПРОДУКЦИИ") + 1,
        r.cost - 1,
      ],
      opex: [find((s) => s.startsWith("АДМИНИСТРАТИВНЫЕ")) + 1, r.opex - 1],
      otherExpense: [r.otherExpense + 1, r.taxes - 1],
      taxes: [r.taxes + 1, r.bonuses - 1],
      bonuses: [r.bonuses + 1, r.otherIncome - 1],
      otherIncome: [r.otherIncome + 1, r.profit - 1],
      dividends: [r.profit + 2, r.retained - 1],
    };
    yearRows[year] = { sheet, rows: r };
    const salesSheet = sheets[`Отчет по продажам_${year}`];
    const observed =
      year === 2026
        ? Math.max(
            ...Object.entries(salesSheet.cells)
              .filter(
                ([a, c]) => /^[C-N]11$/.test(a) && number(c.value) !== null,
              )
              .map(([, c]) => c.value),
          )
        : 12;
    for (let m = 1; m <= observed; m++) {
      const col = column(m + 2),
        period = `${year}-${String(m).padStart(2, "0")}`,
        details = [];
      for (const group of groups) {
        const [start, end] = sections[group];
        for (const x of ls.filter(
          (x) =>
            x.row >= start &&
            x.row <= end &&
            !x.label.includes("ПРИБЫЛЬ ОТ РЕАЛИЗАЦИИ"),
        )) {
          const c = cell(sheet, col + x.row);
          details.push({
            id: group + ":" + x.label,
            label: x.label,
            display:
              group === "revenue" || group === "cost"
                ? channelLabel(x.label)
                : x.label.replaceAll("_", " "),
            group,
            ...c,
          });
        }
      }
      const metrics = Object.fromEntries(
        Object.entries(r).map(([key, row]) => [
          key,
          cell(sheet, col + row).value,
        ]),
      );
      metrics.dividends = sum(
        details.filter((x) => x.group === "dividends").map((x) => x.value),
      );
      const calculated = Object.fromEntries(
        groups.map((g) => [
          g,
          sum(details.filter((x) => x.group === g).map((x) => x.value)),
        ]),
      );
      calculated.gross = calculated.revenue - calculated.cost;
      calculated.operatingProfit = calculated.gross - calculated.opex;
      calculated.profit =
        calculated.operatingProfit -
        calculated.otherExpense -
        calculated.taxes -
        calculated.bonuses +
        calculated.otherIncome;
      calculated.retained = calculated.profit - calculated.dividends;
      const refs = Object.fromEntries(
        Object.entries(r).map(([key, row]) => [key, cell(sheet, col + row)]),
      );
      for (const g of Object.keys(metrics)) {
        if (!near(metrics[g], calculated[g]))
          issue({
            period,
            kind: "arithmetic",
            metric: g,
            title: `${metricLabels[g]}: қорытынды мен баптар сомасы сәйкес емес`,
            reported: metrics[g],
            calculated: calculated[g],
            difference: calculated[g] - metrics[g],
            sheet,
            cell: refs[g]?.cell || "",
            detail:
              "Негізгі көрсеткіш Excel-де сақталған қорытындыны көрсетеді. Баптардан қайта есептелген сома бөлек берілген.",
          });
      }
      monthly.set(period, { period, metrics, calculated, refs, details });
    }
    const lastPeriod = `${year}-${String(observed).padStart(2, "0")}`;
    for (const [metric, row] of Object.entries(r)) {
      const total = cell(sheet, "O" + row),
        monthsTotal = sum(
          [...monthly.values()]
            .filter((p) => p.period.startsWith(year + "-"))
            .map((p) => p.metrics[metric]),
        );
      if (total.value !== null && !near(total.value, monthsTotal))
        issue({
          period: lastPeriod,
          range: "ytd",
          kind: "annual-rollup",
          metric,
          title: `${metricLabels[metric]}: жылдық баған айлық қорытындылармен сәйкес емес`,
          reported: total.value,
          calculated: monthsTotal,
          difference: monthsTotal - total.value,
          sheet,
          cell: total.cell,
          detail:
            "Файлдың O бағаны мен айлық қорытындылар қосындысы салыстырылды. Жыл басынан толық қолжетімді кезең таңдалғанда негізгі есеп O бағанын көрсетеді.",
        });
    }
  }
  for (const year of [2023, 2024, 2026]) {
    const sheet = `Бюджет-е ${year}`;
    if (!sheets[sheet]) continue;
    const ls = labels(sheet),
      last = ls.find((x) => x.label === "Тотал")?.row;
    if (!last) continue;
    for (let m = 1; m <= 12; m++) {
      const period = `${year}-${String(m).padStart(2, "0")}`,
        pcol = column(2 + (m - 1) * 3),
        acol = column(3 + (m - 1) * 3),
        fact = monthly.get(period),
        detailMap = new Map(
          fact?.details
            .filter(
              (d) => !["revenue", "cost", "otherIncome"].includes(d.group),
            )
            .map((d) => [d.label, d]) || [],
        ),
        rows = [];
      for (const x of ls.filter((x) => x.row >= 4 && x.row <= last)) {
        if (x.label.includes("Бонус дистрибьюторам")) continue;
        const plan = cell(sheet, pcol + x.row),
          saved = cell(sheet, acol + x.row),
          total =
            x.label.startsWith("ИТОГО") ||
            x.label === "ПРОЧИЕ РАСХОДЫ" ||
            x.label === "Тотал";
        const mapped = detailMap.get(x.label);
        const actual = fact ? saved.value : null;
        rows.push({
          id: String(x.row),
          label: x.label,
          display: x.label.replaceAll("_", " "),
          total,
          plan: plan.value,
          actual,
          referenceActual: mapped?.value ?? null,
          source: plan,
          actualSource: saved,
          pnlSource: mapped ? { sheet: mapped.sheet, cell: mapped.cell } : null,
        });
        if (
          fact &&
          mapped &&
          number(actual) !== null &&
          number(mapped.value) !== null &&
          !near(actual, mapped.value)
        )
          issue({
            period,
            kind: "cross-sheet",
            title: "Бюджет фактісі мен P&L бабының айырмасы",
            metric: mapped.group,
            reported: actual,
            calculated: mapped.value,
            difference: mapped.value - actual,
            sheet,
            cell: saved.cell,
            detail: x.label + ` · P&L: ${mapped.sheet}!${mapped.cell}`,
          });
        if (plan.value > 0 && plan.value < 1)
          issue({
            period,
            kind: "budget-input",
            title: "Бюджетте 1 теңгеден аз сома бар",
            reported: plan.value,
            calculated: null,
            difference: null,
            sheet,
            cell: plan.cell,
            detail:
              x.label +
              " · Бастапқы 0,1 мәні сақталған; оны салық мөлшерлемесіне айналдырмадық.",
          });
        const formula = saved.formula || saved.formulaOrigin?.formula || "";
        if (
          formula &&
          /P&L_20\d{2}/.test(formula) &&
          !formula.includes("P&L_" + year) &&
          m <= 8 &&
          year === 2026
        )
          issue({
            period,
            kind: "formula-reference",
            title: "Бюджет формуласы басқа жылға сілтейді",
            reported: actual,
            calculated: null,
            difference: null,
            sheet,
            cell: saved.cell,
            detail: formula,
          });
      }
      budgetMonths.set(period, rows);
    }
  }
  // Independent cross-sheet control; P&L remains authoritative, including any adjustments.
  const sales = sheets["Отчет по продажам_2026"];
  if (sales)
    for (let m = 1; m <= 8; m++) {
      const period = `2026-${String(m).padStart(2, "0")}`,
        ref = cell("Отчет по продажам_2026", column(m + 2) + "22"),
        p = monthly.get(period);
      if (!near(ref.value, p.metrics.revenue))
        issue({
          period,
          kind: "cross-sheet",
          metric: "revenue",
          title: "Сату есебі мен P&L түсімінің айырмасы",
          reported: p.metrics.revenue,
          calculated: ref.value,
          difference: ref.value - p.metrics.revenue,
          sheet: "P&L_2026",
          cell: p.refs.revenue.cell,
          detail: `${ref.sheet}!${ref.cell} салыстыруы. P&L түзетулерін бухгалтериямен тексеріңіз.`,
        });
    }
  const periods = [...monthly.keys()].sort(),
    latest = periods.at(-1),
    allPeriods = [...new Set([...periods, ...budgetMonths.keys()])].sort();
  function aggregate(keys, channel = "") {
    const selected = keys.map((k) => monthly.get(k)).filter(Boolean);
    if (!selected.length) return null;
    const metrics = {},
      calculated = {},
      details = new Map(),
      refs = {};
    for (const g of Object.keys(metricLabels)) {
      metrics[g] =
        channel && !["revenue", "cost", "gross"].includes(g) ? null : 0;
      calculated[g] = metrics[g];
      refs[g] = [];
    }
    for (const p of selected) {
      for (const g of Object.keys(metrics)) {
        if (metrics[g] !== null) {
          metrics[g] += p.metrics[g] || 0;
          calculated[g] += p.calculated[g] || 0;
        }
        if (p.refs[g]) refs[g].push(p.refs[g]);
      }
      for (const d of p.details) {
        if (
          channel &&
          (!["revenue", "cost"].includes(d.group) || d.label !== channel)
        )
          continue;
        let entry = details.get(d.id);
        if (!entry) {
          entry = { ...d, value: null, sources: [] };
          details.set(d.id, entry);
        }
        if (d.value !== null) entry.value = (entry.value ?? 0) + d.value;
        entry.sources.push({
          period: p.period,
          sheet: d.sheet,
          cell: d.cell,
          value: d.value,
          raw: d.raw,
          formula: d.formula,
          formulaOrigin: d.formulaOrigin,
        });
      }
    }
    if (channel) {
      for (const g of ["revenue", "cost"]) {
        const vals = [...details.values()].filter((x) => x.group === g);
        metrics[g] = vals.length ? sum(vals.map((x) => x.value)) : null;
        calculated[g] = metrics[g];
        refs[g] = vals.flatMap((x) => x.sources);
      }
      metrics.gross =
        metrics.revenue === null || metrics.cost === null
          ? null
          : metrics.revenue - metrics.cost;
      calculated.gross = metrics.gross;
      refs.gross = [];
    }
    return { metrics, calculated, details: [...details.values()], refs };
  }
  function report({ month = latest, range = "month", channel = "" } = {}) {
    if (!allPeriods.includes(month)) throw Error("Таңдалған кезең файлда жоқ");
    if (!["month", "ytd"].includes(range)) throw Error("Кезең түрі қате");
    const year = +month.slice(0, 4),
      count = +month.slice(5),
      factCount = periods.filter(
        (p) => p.startsWith(year + "-") && p <= month,
      ).length;
    const keys =
      range === "ytd"
        ? periods.filter((p) => p.startsWith(year + "-") && p <= month)
        : [month];
    const priorKeys = keys
      .filter((k) => monthly.has(k))
      .map((k) => `${+k.slice(0, 4) - 1}${k.slice(4)}`);
    const selected = aggregate(keys, channel),
      previous = aggregate(priorKeys, channel),
      company = aggregate(keys),
      channels = [];
    let aggregation = range === "ytd" ? "monthly-sum" : "monthly";
    const yearPeriods = periods.filter((p) => p.startsWith(year + "-"));
    if (
      selected &&
      !channel &&
      range === "ytd" &&
      keys.length === yearPeriods.length &&
      keys.length
    ) {
      const { sheet, rows } = yearRows[year];
      const futureEmpty = Object.values(rows).every((row) =>
        Array.from(
          { length: 12 - yearPeriods.length },
          (_, i) => cell(sheet, column(yearPeriods.length + i + 3) + row).value,
        ).every((v) => !v),
      );
      if (futureEmpty) {
        aggregation = "year-total";
        for (const [key, row] of Object.entries(rows)) {
          const annual = cell(sheet, "O" + row);
          if (annual.value !== null) {
            selected.metrics[key] = annual.value;
            selected.refs[key] = [annual];
          }
        }
      }
    }
    for (const d of company?.details.filter((d) => d.group === "revenue") ||
      []) {
      const costs = company.details.find(
          (c) => c.group === "cost" && c.label === d.label,
        ),
        prev = aggregate(priorKeys, d.label);
      channels.push({
        id: d.label,
        label: d.display,
        revenue: d.value,
        cost: costs?.value ?? null,
        gross:
          d.value === null || costs?.value === null
            ? null
            : d.value - costs.value,
        previousRevenue: prev?.metrics.revenue ?? null,
        sources: d.sources,
      });
    }
    if (channel && !channels.some((c) => c.id === channel))
      throw Error("Бұл кезеңде сату арнасы жоқ");
    const budgetKeys =
      range === "ytd"
        ? Array.from(
            { length: factCount || count },
            (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`,
          )
        : [month];
    const budgets = new Map();
    if (!channel)
      for (const key of budgetKeys)
        for (const b of budgetMonths.get(key) || []) {
          let row = budgets.get(b.id);
          if (!row) {
            row = {
              ...b,
              plan: null,
              actual: null,
              referenceActual: null,
              sources: [],
            };
            budgets.set(b.id, row);
          }
          for (const f of ["plan", "actual", "referenceActual"])
            if (b[f] !== null) row[f] = (row[f] ?? 0) + b[f];
          row.sources.push({
            period: key,
            plan: b.source,
            actual: b.actualSource,
            pnl: b.pnlSource,
          });
        }
    const selectedWarnings = warnings.filter(
      (w) =>
        keys.includes(w.period) && (!w.range || w.range === range) && !channel,
    );
    const history = periods
      .filter((p) => p.startsWith(year + "-") && p <= month)
      .map((p) => ({ month: p, ...aggregate([p], channel).metrics }));
    const lastMonth = monthly.has(month)
      ? month
      : keys.filter((k) => monthly.has(k)).at(-1) || null;
    return {
      source: "workbook",
      demo: false,
      month,
      range,
      aggregation,
      channel,
      periods: allPeriods,
      latest,
      actualThrough: lastMonth,
      actualAvailable: !!selected,
      report:
        selected?.metrics ??
        Object.fromEntries(Object.keys(metricLabels).map((k) => [k, null])),
      recalculated: selected?.calculated ?? null,
      previous: previous?.metrics ?? null,
      details: selected?.details ?? [],
      refs: selected?.refs ?? {},
      channels,
      history,
      budgetRows: [...budgets.values()],
      budgetTimeline: Array.from({ length: 12 }, (_, i) => {
        const p = `${year}-${String(i + 1).padStart(2, "0")}`,
          b = budgetMonths.get(p)?.find((b) => b.label === "Тотал");
        return { month: p, plan: b?.plan ?? null, actual: b?.actual ?? null };
      }),
      checks: selectedWarnings,
      allCheckCount: warnings.length,
      metadata: {
        file: raw.file,
        sha256: raw.sha256,
        importedAt: raw.importedAt || null,
        unit: "KZT",
        precision: 2,
        sheets: Object.keys(yearRows)
          .map((y) => `P&L_${y}`)
          .concat(["Отчет по продажам_2026", "Бюджет-е 2026"]),
        method: "Excel-де сақталған мәндер; түпнұсқа файл өзгертілмеген",
        limitations: [
          "Қорытынды айлық есеп: бастапқы операциялар емес",
          "Ақша қалдығы, баланс және берешек деректері берілмеген",
          "Шығыстар сату арналарына бөлінбеген",
        ],
      },
    };
  }
  return { report, monthly, budgetMonths, warnings, latest, periods };
}
const file = process.env.WORKBOOK_PATH || "data/workbook-source.json";
export const workbookDataset =
  process.env.WORKBOOK_PATH === "disabled" ||
  !existsSync(/* turbopackIgnore: true */ file)
    ? null
    : createWorkbookDataset(
        JSON.parse(readFileSync(/* turbopackIgnore: true */ file, "utf8")),
      );
