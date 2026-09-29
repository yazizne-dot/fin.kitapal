import { readFileSync, existsSync } from "node:fs";
import { createWorkbookDataset } from "./workbook.mjs";
import { createStatements } from "./statements.mjs";
import { privileged } from "../auth/accounts.mjs";
const colIndex = (s) =>
  [...s].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
const column = (n) => {
  let s = "";
  for (; n; n = Math.floor((n - 1) / 26))
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};
const number = (v) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const sum = (xs) => xs.reduce((s, n) => s + number(n), 0);
const books = {
  pnl: "data/workbook-source.json",
  balance: "data/balance-source.json",
  cashflow: "data/cashflow-source.json",
};
export function createFinancialWorkspace(db, audit) {
  const originals = Object.fromEntries(
    Object.entries(books)
      .filter(([, p]) => existsSync(p))
      .map(([id, p]) => [id, JSON.parse(readFileSync(p, "utf8"))]),
  );
  let models, raws;
  function build() {
    const overrides = db.prepare("SELECT * FROM financial_overrides").all(),
      next = Object.fromEntries(
        Object.entries(originals).map(([k, v]) => [k, structuredClone(v)]),
      ),
      dirty = {};
    const explicit = new Set();
    for (const p of overrides) {
      if (next[p.book]?.sha256 !== p.base_hash) continue;
      const c = next[p.book].sheets[p.sheet]?.cells[p.cell];
      if (!c) throw Error("Бастапқы ұяшық табылмады");
      c.value = p.value;
      c.manualOverride = true;
      explicit.add([p.book, p.sheet, p.cell].join("|"));
      (dirty[p.book] ??= {})[p.sheet] ??= new Set();
      dirty[p.book][p.sheet].add(p.cell);
    }
    const write = (book, sheet, cell, value) => {
      if (
        !Number.isFinite(value) ||
        explicit.has([book, sheet, cell].join("|"))
      )
        return;
      const c = (next[book].sheets[sheet].cells[cell] ??= {});
      c.value = value;
      c.recalculatedOnSite = true;
    };
    // Recalculate the financial hierarchy for affected P&L months, retaining explicit total overrides.
    if (next.pnl) {
      const parsed = createWorkbookDataset(next.pnl);
      for (const p of parsed.monthly.values()) {
        const sheet = p.refs.revenue.sheet,
          changed = dirty.pnl?.[sheet];
        if (!changed) continue;
        const affected = new Set(),
          prefix = p.refs.revenue.cell.replace(/\d/g, "");
        for (const d of p.details)
          if (changed.has(d.cell)) affected.add(d.group);
        for (const [key, ref] of Object.entries(p.refs))
          if (changed.has(ref.cell)) affected.add(key);
        if (!affected.size) continue;
        const values = { ...p.metrics };
        for (const group of [
          "revenue",
          "cost",
          "opex",
          "otherExpense",
          "taxes",
          "bonuses",
          "otherIncome",
          "dividends",
        ])
          if (affected.has(group)) {
            const ref = p.refs[group];
            if (!ref || !explicit.has(["pnl", sheet, ref.cell].join("|")))
              values[group] = sum(
                p.details.filter((d) => d.group === group).map((d) => d.value),
              );
            if (ref) write("pnl", sheet, ref.cell, values[group]);
          }
        const derive = (key, deps, fn) => {
          if (!deps.some((d) => affected.has(d)) && !affected.has(key)) return;
          affected.add(key);
          const ref = p.refs[key];
          if (!explicit.has(["pnl", sheet, ref.cell].join("|")))
            values[key] = fn();
          write("pnl", sheet, ref.cell, values[key]);
        };
        derive(
          "gross",
          ["revenue", "cost"],
          () => values.revenue - values.cost,
        );
        derive(
          "operatingProfit",
          ["gross", "opex"],
          () => values.gross - values.opex,
        );
        derive(
          "profit",
          [
            "operatingProfit",
            "otherExpense",
            "taxes",
            "bonuses",
            "otherIncome",
          ],
          () =>
            values.operatingProfit -
            values.otherExpense -
            values.taxes -
            values.bonuses +
            values.otherIncome,
        );
        derive(
          "retained",
          ["profit", "dividends"],
          () => values.profit - values.dividends,
        );
        for (const key of affected) {
          const ref = p.refs[key];
          if (!ref) continue;
          const row = ref.cell.replace(/[A-Z]/g, ""),
            annual = "O" + row,
            old = number(originals.pnl.sheets[sheet].cells[ref.cell]?.value),
            baseAnnual = number(next.pnl.sheets[sheet].cells[annual]?.value);
          write("pnl", sheet, annual, baseAnnual + values[key] - old);
        }
        const bsheet = "Бюджет-е " + p.period.slice(0, 4),
          budget = next.pnl.sheets[bsheet],
          m = +p.period.slice(5);
        if (budget)
          for (const d of p.details.filter((d) => changed.has(d.cell))) {
            for (const [a, c] of Object.entries(budget.cells))
              if (/^A\d+$/.test(a) && String(c.value).trim() === d.label) {
                const target = column(3 + (m - 1) * 3) + a.slice(1);
                write("pnl", bsheet, target, d.value);
                (dirty.pnl[bsheet] ??= new Set()).add(target);
              }
          }
      }
      for (const [sheet, changed] of Object.entries(dirty.pnl || {}))
        if (sheet.startsWith("Бюджет-е "))
          recalculateSimple(next.pnl.sheets[sheet].cells, changed, (a) =>
            explicit.has(["pnl", sheet, a].join("|")),
          );
    }
    if (next.balance && Object.keys(dirty.balance || {}).length) {
      const raw = next.balance,
        at = (sheet, a) => number(raw.sheets[sheet].cells[a]?.value);
      const totals = (sheet, col, start, end) =>
        sum(
          Array.from({ length: end - start + 1 }, (_, i) =>
            at(sheet, col + (start + i)),
          ),
        );
      if (dirty.balance["касса"]) {
        write("balance", "касса", "C3", totals("касса", "C", 5, 13));
        write("balance", "Баланс", "C5", at("касса", "C3"));
      }
      if (dirty.balance["Данные"]) {
        const rows = Object.keys(raw.sheets["Данные"].cells).filter(
          (a) => /^G\d+$/.test(a) && +a.slice(1) >= 3,
        );
        for (const [contract, target] of [
          ["Предоплата", "C7"],
          ["Реализация", "C15"],
        ])
          write(
            "balance",
            "Баланс",
            target,
            sum(
              rows
                .filter(
                  (a) =>
                    raw.sheets["Данные"].cells["E" + a.slice(1)]?.value ===
                    contract,
                )
                .map((a) => at("Данные", a)),
            ),
          );
      }
      if (dirty.balance["Свод для кассы"]) {
        write(
          "balance",
          "Свод для кассы",
          "I12",
          totals("Свод для кассы", "I", 3, 10),
        );
        write("balance", "Баланс", "C8", at("Свод для кассы", "I12"));
      }
      const supplier = "Свод для $Отчет2025 ";
      if (dirty.balance[supplier]) {
        write("balance", supplier, "B42", totals(supplier, "B", 5, 41));
        write("balance", "Баланс", "C15", at(supplier, "B42"));
      }
      write("balance", "Баланс", "C12", totals("Баланс", "C", 5, 11));
      write("balance", "Баланс", "C17", totals("Баланс", "C", 15, 16));
      write(
        "balance",
        "Баланс",
        "C19",
        at("Баланс", "C12") - at("Баланс", "C17"),
      );
      write(
        "balance",
        "Баланс",
        "C21",
        at("Баланс", "C17") + at("Баланс", "C19"),
      );
    }
    const built = {
      dataset: next.pnl ? createWorkbookDataset(next.pnl) : null,
      statements: createStatements(next.balance, next.cashflow),
    };
    return { next, built };
  }
  function refresh() {
    const { next, built } = build();
    raws = next;
    models = built;
  }
  refresh();
  function entries() {
    return db
      .prepare(
        "SELECT e.*,u.name author FROM financial_entries e JOIN users u ON u.id=e.author_id WHERE e.active=1 ORDER BY e.date,e.id",
      )
      .all();
  }
  function applyEntries(report, list) {
    const d = structuredClone(report);
    const selected = list.filter((e) =>
      d.range === "ytd"
        ? e.date.startsWith(d.month.slice(0, 4)) &&
          e.date.slice(0, 7) <= d.month
        : e.date.startsWith(d.month),
    );
    const apply = (metrics, rows) => {
      for (const e of rows) {
        const v = e.amount_cents / 100;
        if (e.kind.startsWith("cash_")) continue;
        for (const k of Object.keys(metrics))
          if (metrics[k] === null) metrics[k] = 0;
        metrics[e.kind] = (metrics[e.kind] || 0) + v;
        const sign = ["revenue", "otherIncome"].includes(e.kind) ? 1 : -1;
        if (e.kind === "revenue" || e.kind === "cost")
          metrics.gross = (metrics.gross || 0) + sign * v;
        if (["revenue", "cost", "opex"].includes(e.kind))
          metrics.operatingProfit = (metrics.operatingProfit || 0) + sign * v;
        metrics.profit = (metrics.profit || 0) + sign * v;
        metrics.retained = (metrics.retained || 0) + sign * v;
      }
    };
    if (!d.channel) {
      const pnl = selected.filter((e) => !e.kind.startsWith("cash_"));
      if (pnl.length) {
        apply(d.report, pnl);
        d.recalculated ??= { ...report.report };
        apply(d.recalculated, pnl);
        d.actualAvailable = true;
        d.actualThrough = d.month;
        for (const e of pnl)
          d.details.push({
            id: "entry:" + e.id,
            label: e.label,
            display: e.label,
            group: e.kind,
            value: e.amount_cents / 100,
            sources: [
              {
                period: e.date.slice(0, 7),
                sheet: "Сайт жазбалары",
                cell: String(e.id),
                value: e.amount_cents / 100,
                formula: null,
              },
            ],
            manual: true,
          });
      }
      const priorYear = String(+d.month.slice(0, 4) - 1);
      const prior = list.filter(
        (e) =>
          !e.kind.startsWith("cash_") &&
          (d.range === "ytd"
            ? e.date.startsWith(priorYear) &&
              e.date.slice(5, 7) <= d.month.slice(5)
            : e.date.startsWith(priorYear + d.month.slice(4))),
      );
      if (prior.length) {
        d.previous ??= Object.fromEntries(
          Object.keys(d.report).map((k) => [k, 0]),
        );
        apply(d.previous, prior);
      }
      for (const h of d.history)
        apply(
          h,
          list.filter(
            (e) => e.date.startsWith(h.month) && !e.kind.startsWith("cash_"),
          ),
        );
      for (const p of [...new Set(pnl.map((e) => e.date.slice(0, 7)))])
        if (!d.history.some((h) => h.month === p)) {
          const h = {
            month: p,
            ...Object.fromEntries(Object.keys(d.report).map((k) => [k, 0])),
          };
          apply(
            h,
            pnl.filter((e) => e.date.startsWith(p)),
          );
          d.history.push(h);
        }
      d.history.sort((a, b) => a.month.localeCompare(b.month));
    }
    return d;
  }
  function report(options) {
    let base;
    try {
      base = models.dataset.report(options);
    } catch (e) {
      const month = options.month;
      if (
        !/^\d{4}-(0[1-9]|1[0-2])$/.test(month) ||
        !entries().some((e) => e.date.startsWith(month))
      )
        throw e;
      const template = models.dataset.report();
      base = {
        ...template,
        month,
        range: options.range || "month",
        channel: "",
        actualAvailable: false,
        actualThrough: null,
        report: Object.fromEntries(
          Object.keys(template.report).map((k) => [k, null]),
        ),
        recalculated: null,
        details: [],
        refs: {},
        previous: null,
        budgetRows: [],
        budgetTimeline: [],
        channels: [],
        history: [],
        checks: [],
        aggregation: "monthly",
      };
    }
    const list = entries(),
      d = applyEntries(base, list);
    d.periods = [
      ...new Set([...d.periods, ...list.map((e) => e.date.slice(0, 7))]),
    ].sort();
    d.financialRevision = revision();
    d.siteEntryCount = list.length;
    d.overrideCount = db
      .prepare("SELECT COUNT(*) n FROM financial_overrides")
      .get().n;
    return d;
  }
  function cashflow(month, range) {
    const f = models.statements.cashflow(month, range);
    if (!f) return null;
    const added = entries().filter(
      (e) =>
        (e.cash_effect || e.kind.startsWith("cash_")) &&
        (range === "ytd"
          ? e.date.startsWith(month.slice(0, 4)) && e.date.slice(0, 7) <= month
          : e.date.startsWith(month)),
    );
    if (!added.length) return f;
    const out = structuredClone(f);
    out.available = true;
    out.totals ??= { inflow: 0, outflow: 0, net: 0 };
    out.business ??= { inflow: 0, outflow: 0, net: 0 };
    for (const e of added) {
      const v = e.amount_cents / 100,
        inflow = ["revenue", "otherIncome", "cash_in"].includes(e.kind) ? v : 0,
        outflow = inflow ? 0 : v;
      out.rows.push({
        id: "site-" + e.id,
        date: e.date,
        article: e.label,
        note: e.note,
        period: e.date.slice(0, 7),
        inflow,
        outflow,
        cashReplenishment: false,
        source: { file: "Qarzhy", sheet: "Сайт жазбалары", cell: String(e.id) },
      });
      let article = out.articles.find((a) => a.article === e.label);
      if (!article) {
        article = {
          article: e.label,
          inflow: 0,
          outflow: 0,
          count: 0,
          cashReplenishment: false,
        };
        out.articles.push(article);
      }
      article.inflow += inflow;
      article.outflow += outflow;
      article.count++;
      for (const key of ["totals", "business"]) {
        out[key].inflow += inflow;
        out[key].outflow += outflow;
        out[key].net += inflow - outflow;
      }
    }
    const daily = new Map();
    for (const r of out.rows) {
      const day = daily.get(r.date) || { date: r.date, inflow: 0, outflow: 0 };
      day.inflow += r.inflow;
      day.outflow += r.outflow;
      daily.set(r.date, day);
    }
    out.daily = [...daily.values()].sort((a, b) =>
      a.date.localeCompare(b.date),
    );
    out.periods = [
      ...new Set([...out.periods, ...added.map((e) => e.date.slice(0, 7))]),
    ].sort();
    out.manualCount = added.length;
    return out;
  }
  function revision() {
    return db.prepare("SELECT revision FROM financial_state WHERE id=1").get()
      .revision;
  }
  return {
    refresh,
    report,
    cashflow,
    get balance() {
      return models.statements.balance;
    },
    get available() {
      return !!models.dataset;
    },
    revision,
    entries,
    async route(req, res, path, u, { body, json, url }) {
      if (!path.startsWith("/api/finance/")) return false;
      if (!privileged(u))
        return (json(res, 403, { error: "Рұқсат жоқ" }), true);
      if (path === "/api/finance/editor" && req.method === "GET") {
        const book = url.searchParams.get("book") || "pnl",
          raw = raws[book];
        if (!raw) throw Error("Файл табылмады");
        const sheets = Object.keys(raw.sheets),
          sheet =
            url.searchParams.get("sheet") ||
            sheets.find((s) => s === "P&L_2026") ||
            sheets[0];
        if (!raw.sheets[sheet]) throw Error("Парақ табылмады");
        const cells = raw.sheets[sheet].cells,
          q = (url.searchParams.get("q") || "").trim().toLowerCase(),
          offset = Math.max(0, Number(url.searchParams.get("offset")) || 0),
          rows = [];
        for (const [cell, c] of Object.entries(cells)) {
          if (typeof c.value !== "number") continue;
          const r = cell.replace(/[A-Z]/g, ""),
            label =
              ["A", "B", "G"]
                .map((col) => cells[col + r]?.value)
                .find((v) => typeof v === "string") || "";
          if (q && !`${cell} ${label}`.toLowerCase().includes(q)) continue;
          rows.push({
            cell,
            value: c.value,
            label,
            formula: c.formula || null,
            original: originals[book].sheets[sheet].cells[cell]?.value,
            overridden: !!c.manualOverride,
            recalculated: !!c.recalculatedOnSite,
          });
        }
        json(res, 200, {
          books: Object.entries(raws).map(([id, raw]) => ({
            id,
            file: raw.file,
          })),
          book,
          sheet,
          sheets,
          rows: rows.slice(offset, offset + 60),
          total: rows.length,
          offset,
          revision: revision(),
        });
        return true;
      }
      if (path === "/api/finance/cell" && req.method === "POST") {
        const b = await body(req);
        if (Number(b.revision) !== revision())
          return (
            json(res, 409, { error: "Есеп өзгерген. Бетті жаңартыңыз" }),
            true
          );
        const raw = originals[b.book],
          old = raws[b.book]?.sheets[b.sheet]?.cells[b.cell];
        if (
          !raw ||
          !old ||
          typeof old.value !== "number" ||
          typeof b.value !== "number" ||
          !Number.isFinite(b.value) ||
          Math.abs(b.value) > 1e15
        )
          throw Error("Ұяшық немесе сан қате");
        if (!String(b.reason || "").trim())
          throw Error("Түзету себебін көрсетіңіз");
        db.exec("BEGIN");
        let built;
        try {
          if (b.reset)
            db.prepare(
              "DELETE FROM financial_overrides WHERE book=? AND sheet=? AND cell=?",
            ).run(b.book, b.sheet, b.cell);
          else
            db.prepare(
              "INSERT INTO financial_overrides VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(book,sheet,cell) DO UPDATE SET value=excluded.value,reason=excluded.reason,base_hash=excluded.base_hash,author_id=excluded.author_id,updated_at=excluded.updated_at",
            ).run(
              b.book,
              b.sheet,
              b.cell,
              b.value,
              String(b.reason).slice(0, 1000),
              raw.sha256,
              u.id,
              new Date().toISOString(),
            );
          built = build();
          db.exec("UPDATE financial_state SET revision=revision+1 WHERE id=1");
          audit(
            u,
            "Есеп саны түзетілді",
            JSON.stringify({
              book: b.book,
              sheet: b.sheet,
              cell: b.cell,
              before: old.value,
              after: b.reset
                ? raw.sheets[b.sheet].cells[b.cell].value
                : b.value,
              reason: b.reason,
              reset: !!b.reset,
            }),
          );
          db.exec("COMMIT");
          raws = built.next;
          models = built.built;
        } catch (e) {
          if (db.isTransaction) db.exec("ROLLBACK");
          throw e;
        }
        json(res, 200, { ok: true, revision: revision() });
        return true;
      }
      if (path === "/api/finance/entries") {
        if (req.method === "GET") {
          json(res, 200, { entries: entries(), revision: revision() });
          return true;
        }
        if (req.method === "POST") {
          const b = await body(req);
          if (
            !/^\d{4}-\d{2}-\d{2}$/.test(b.date) ||
            !Number.isFinite(Date.parse(b.date)) ||
            new Date(b.date).toISOString().slice(0, 10) !== b.date ||
            ![
              "revenue",
              "cost",
              "opex",
              "otherExpense",
              "taxes",
              "bonuses",
              "otherIncome",
              "cash_in",
              "cash_out",
            ].includes(b.kind) ||
            !Number.isSafeInteger(b.amount_cents) ||
            b.amount_cents <= 0 ||
            b.amount_cents > 1e14 ||
            !String(b.label || "").trim()
          )
            throw Error("Жаңа жазба деректері қате");
          const now = new Date().toISOString();
          const r = db
            .prepare(
              "INSERT INTO financial_entries(date,kind,amount_cents,label,note,cash_effect,author_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)",
            )
            .run(
              b.date,
              b.kind,
              b.amount_cents,
              String(b.label).slice(0, 200),
              String(b.note || "").slice(0, 1000),
              b.cash_effect ? 1 : 0,
              u.id,
              now,
              now,
            );
          db.exec("UPDATE financial_state SET revision=revision+1 WHERE id=1");
          audit(
            u,
            "Есепке жазба қосылды",
            JSON.stringify({ id: Number(r.lastInsertRowid), ...b }),
          );
          json(res, 201, { ok: true });
          return true;
        }
        if (req.method === "PATCH") {
          const b = await body(req),
            entry = db
              .prepare(
                "SELECT * FROM financial_entries WHERE id=? AND active=1",
              )
              .get(Number(b.id));
          if (!entry) throw Error("Жазба табылмады");
          if (entry.expense_id)
            throw Error("Қызметкер шығынын шығындар бөлімінде қайтарыңыз");
          if (Number(b.revision) !== revision())
            return (
              json(res, 409, { error: "Есеп өзгерген. Бетті жаңартыңыз" }),
              true
            );
          if (
            !Number.isSafeInteger(b.amount_cents) ||
            b.amount_cents <= 0 ||
            b.amount_cents > 1e14 ||
            !String(b.reason || "").trim()
          )
            throw Error("Сома немесе себеп қате");
          db.prepare(
            "UPDATE financial_entries SET amount_cents=?,updated_at=? WHERE id=?",
          ).run(b.amount_cents, new Date().toISOString(), entry.id);
          db.exec("UPDATE financial_state SET revision=revision+1 WHERE id=1");
          audit(
            u,
            "Есеп жазбасы түзетілді",
            JSON.stringify({
              id: entry.id,
              before: entry.amount_cents,
              after: b.amount_cents,
              reason: String(b.reason).slice(0, 1000),
            }),
          );
          json(res, 200, { ok: true });
          return true;
        }
        if (req.method === "DELETE") {
          const b = await body(req),
            entry = db
              .prepare(
                "SELECT * FROM financial_entries WHERE id=? AND active=1",
              )
              .get(Number(b.id));
          if (!entry) throw Error("Жазба табылмады");
          if (entry.expense_id)
            throw Error("Қызметкер шығынын шығындар бөлімінде қайтарыңыз");
          if (!String(b.reason || "").trim())
            throw Error("Түзету себебін көрсетіңіз");
          db.prepare(
            "UPDATE financial_entries SET active=0,updated_at=? WHERE id=?",
          ).run(new Date().toISOString(), entry.id);
          db.exec("UPDATE financial_state SET revision=revision+1 WHERE id=1");
          audit(
            u,
            "Есеп жазбасы алынды",
            JSON.stringify({ id: entry.id, reason: b.reason }),
          );
          json(res, 200, { ok: true });
          return true;
        }
      }
      if (path === "/api/finance/audit" && req.method === "GET") {
        json(res, 200, {
          audit: db
            .prepare("SELECT * FROM audit ORDER BY id DESC LIMIT 300")
            .all(),
        });
        return true;
      }
      return false;
    },
  };
}
function recalculateSimple(cells, changed, isExplicit) {
  const expand = (range) => {
    const m = range.match(/^(\$?[A-Z]+)(\$?\d+):(\$?[A-Z]+)(\$?\d+)$/);
    if (!m) return null;
    const [a, b, c, d] = m.slice(1).map((s) => s.replaceAll("$", "")),
      out = [];
    for (let col = colIndex(a); col <= colIndex(c); col++)
      for (let row = +b; row <= +d; row++) out.push(column(col) + row);
    return out;
  };
  for (let pass = 0; pass < 8; pass++) {
    let did = false;
    for (const [addr, c] of Object.entries(cells)) {
      if (isExplicit(addr)) continue;
      let formula = c.formula;
      if (!formula && c.sharedFormulaOrigin) {
        const origin = c.sharedFormulaOrigin,
          base = cells[origin]?.formula;
        if (base) {
          const dx =
              colIndex(addr.replace(/\d/g, "")) -
              colIndex(origin.replace(/\d/g, "")),
            dy = +addr.replace(/[A-Z]/g, "") - +origin.replace(/[A-Z]/g, "");
          formula = base.replace(
            /(\$?)([A-Z]{1,3})(\$?)(\d+)/g,
            (_, ac, col, ar, row) =>
              ac +
              column(colIndex(col) + (ac ? 0 : dx)) +
              ar +
              (+row + (ar ? 0 : dy)),
          );
        }
      }
      if (!formula || formula.includes("!")) continue;
      const dependencies = [];
      let f = formula.replace(/SUM\(([^)]+)\)/gi, (_, range) => {
        const list = expand(range);
        if (!list) return "UNKNOWN";
        dependencies.push(...list);
        return String(sum(list.map((a) => cells[a]?.value)));
      });
      f = f.replace(/\$?([A-Z]{1,3})\$?(\d+)/g, (_, a, b) => {
        dependencies.push(a + b);
        return String(number(cells[a + b]?.value));
      });
      if (
        !dependencies.some((a) => changed.has(a)) ||
        !/^[\d.\s+*/()-]+$/.test(f)
      )
        continue;
      // Restricted arithmetic parser: numbers and operators only; never evaluate source code.
      const tokens = f.match(/\d+(?:\.\d+)?|[()+*/-]/g) || [];
      let at = 0;
      function primary() {
        if (tokens[at] === "-") {
          at++;
          return -primary();
        }
        if (tokens[at] === "+") {
          at++;
          return primary();
        }
        if (tokens[at] === "(") {
          at++;
          const v = expr();
          if (tokens[at++] !== ")") throw Error("formula");
          return v;
        }
        return Number(tokens[at++]);
      }
      function product() {
        let n = primary();
        while (["*", "/"].includes(tokens[at])) {
          const op = tokens[at++],
            v = primary();
          n = op === "*" ? n * v : n / v;
        }
        return n;
      }
      function expr() {
        let n = product();
        while (["+", "-"].includes(tokens[at])) {
          const op = tokens[at++],
            v = product();
          n = op === "+" ? n + v : n - v;
        }
        return n;
      }
      try {
        const result = expr();
        if (
          at === tokens.length &&
          Number.isFinite(result) &&
          result !== c.value
        ) {
          c.value = result;
          c.recalculatedOnSite = true;
          changed.add(addr);
          did = true;
        }
      } catch {}
    }
    if (!did) break;
  }
}
