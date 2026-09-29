import { openDatabase } from "../db/open.mjs";
import { seedDemoData } from "../db/seed.mjs";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { ledger, kinds, validate, debts } from "../finance/accounting.mjs";
import { workbook } from "../exports/xlsx.mjs";
import { workbookDataset } from "../finance/workbook.mjs";
import {
  initializeAccounts,
  createAccountHandlers,
  verifyPassword,
  publicUser,
  privileged,
} from "../auth/accounts.mjs";
import { createFinancialWorkspace } from "../finance/workspace.mjs";
export function createPortalHandler() {
  const db = openDatabase();
  const orgs = ["Qalam Books", "Kitap Retail", "Dara Distribution"];
  const audit = (u, a, d) =>
    db
      .prepare("INSERT INTO audit(time,author,action,detail) VALUES(?,?,?,?)")
      .run(new Date().toISOString(), u.name, a, d);
  if (workbookDataset) {
    const report = workbookDataset.report();
    const signature = report.metadata.sha256;
    if (
      !db
        .prepare(
          "SELECT id FROM audit WHERE action='Excel деректері' AND detail LIKE ?",
        )
        .get("%" + signature + "%")
    )
      audit(
        { name: "Жүйе" },
        "Excel деректері",
        JSON.stringify({
          file: report.metadata.file,
          sha256: signature,
          period: report.latest,
          method: "P&L және бюджет: жеке есеп дереккөзі",
        }),
      );
  }
  const insert = db.prepare(
    "INSERT INTO operations(external_id,source,date,org,point,counterparty,document,kind,amount,cost,due,article) VALUES(@external_id,@source,@date,@org,@point,@counterparty,@document,@kind,@amount,@cost,@due,@article)",
  );
  if (
    process.env.DEMO_DATA !== "0" &&
    !db.prepare("SELECT COUNT(*) n FROM operations").get().n
  )
    seedDemoData(db, insert, orgs, audit);
  if (!db.prepare("SELECT COUNT(*) n FROM users").get().n) {
    for (const [name, role, org, point] of [
      ["Қаржыгер", "finance", "", ""],
      ["Басшы", "director", "", ""],
      ["Бухгалтер", "accountant", "", ""],
      ["Дүкен менеджері", "manager", "Kitap Retail", "Астана"],
    ]) {
      let salt = randomBytes(16).toString("hex");
      db.prepare(
        "INSERT INTO users(name,role,org,point,salt,password) VALUES(?,?,?,?,?,?)",
      ).run(
        name,
        role,
        org,
        point,
        salt,
        scryptSync(
          process.env.PORTAL_PASSWORD || "demo2026",
          salt,
          64,
        ).toString("hex"),
      );
    }
  }
  initializeAccounts(db, audit);
  const financial = createFinancialWorkspace(db, audit);
  const json = (res, status, data) => {
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(JSON.stringify(data));
  };
  async function body(req) {
    let s = "";
    for await (const c of req) {
      s += c;
      if (s.length > 2000000) throw Error("Файл тым үлкен (2 MB шегі)");
    }
    return JSON.parse(s || "{}");
  }
  const accountHandlers = createAccountHandlers({
    db,
    audit,
    json,
    body,
    refreshFinancial: () => financial.refresh(),
  });
  function user(req) {
    const token = (req.headers.cookie || "")
      .split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith("session="))
      ?.slice(8);
    return db
      .prepare(
        "SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires>? AND u.active=1",
      )
      .get(token || "", Date.now());
  }
  function access(u, o) {
    return u.role !== "manager" || (u.org === o.org && u.point === o.point);
  }
  const attempts = new Map();
  const handle = async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      const path = url.pathname;
      if (path === "/api/login" && req.method === "POST") {
        const ip = req.socket.remoteAddress;
        let a = attempts.get(ip) || { n: 0, until: Date.now() + 60000 };
        if (a.until < Date.now()) a = { n: 0, until: Date.now() + 60000 };
        if (a.n >= 15)
          return json(res, 429, { error: "Бір минуттан кейін қайталаңыз" });
        a.n++;
        attempts.set(ip, a);
        const b = await body(req),
          u = db
            .prepare(
              "SELECT * FROM users WHERE username=? COLLATE NOCASE AND active=1",
            )
            .get(String(b.username || "").trim());
        if (!verifyPassword(b.password, u))
          return json(res, 401, { error: "Логин немесе құпиясөз қате" });
        const token = randomBytes(32).toString("hex"),
          remember = b.remember === true || b.remember === "true",
          duration = remember ? 30 * 86400000 : 86400000;
        db.prepare("INSERT INTO sessions VALUES(?,?,?)").run(
          token,
          u.id,
          Date.now() + duration,
        );
        res.setHeader(
          "Set-Cookie",
          `session=${token}; HttpOnly; SameSite=Strict; Path=/${remember ? "; Max-Age=2592000" : ""}`,
        );
        audit(u, "Кіру", "Пайдаланушы жүйеге кірді");
        return json(res, 200, { ok: true });
      }
      if (path.startsWith("/api/")) {
        const u = user(req);
        if (!u) return json(res, 401, { error: "Жүйеге кіріңіз" });
        if (req.method !== "GET") {
          const origin = req.headers.origin;
          if (
            origin &&
            origin !== `http://${req.headers.host}` &&
            origin !== `https://${req.headers.host}`
          )
            return json(res, 403, { error: "Сұрау көзіне рұқсат жоқ" });
        }
        if (path === "/api/logout") {
          const token = (req.headers.cookie || "").match(
            /session=([^;]+)/,
          )?.[1];
          db.prepare("DELETE FROM sessions WHERE token=?").run(token || "");
          res.setHeader(
            "Set-Cookie",
            "session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0",
          );
          return json(res, 200, { ok: true });
        }
        const sessionToken =
          (req.headers.cookie || "").match(/session=([^;]+)/)?.[1] || "";
        if (await accountHandlers.route(req, res, path, u, sessionToken))
          return;
        if (u.role === "employee") {
          if (path === "/api/data" && req.method === "GET")
            return json(res, 200, {
              source: "personal",
              user: publicUser(u),
              expenses: accountHandlers.ownOrAll(u),
              categories: accountHandlers.categories,
            });
          return json(res, 403, { error: "Рұқсат жоқ" });
        }
        if (await financial.route(req, res, path, u, { body, json, url }))
          return;
        if (
          path === "/api/data" &&
          (url.searchParams.get("source") === "workbook" ||
            (url.searchParams.get("source") === "auto" &&
              workbookDataset &&
              u.role !== "manager"))
        ) {
          if (u.role === "manager")
            return json(res, 403, {
              error:
                "Бұл тіркелгіге компанияның Excel есебін көруге рұқсат берілмеген",
            });
          if (!financial.available)
            return json(res, 404, { error: "Excel деректері жүктелмеген" });
          const report = financial.report({
            month: url.searchParams.get("month") || undefined,
            range: url.searchParams.get("range") || "month",
            channel: url.searchParams.get("channel") || "",
          });
          const cashflow = financial.cashflow(report.month, report.range),
            statementChecks = [];
          if (cashflow?.summary && cashflow.business) {
            const delta =
              cashflow.business.inflow - cashflow.summary.inflow.value;
            if (Math.abs(delta) > 0.02)
              statementChecks.push({
                id: "cash-summary",
                period: report.month,
                kind: "cash-reconciliation",
                title: "ДДС: бастапқы кірістер мен «свод» парағының айырмасы",
                reported: cashflow.summary.inflow.value,
                calculated: cashflow.business.inflow,
                difference: delta,
                sheet: "свод",
                cell: cashflow.summary.inflow.cell,
                detail:
                  cashflow.metadata.file +
                  " · касса толықтыруларынсыз; барлық компания бойынша.",
              });
          }
          if (financial.balance)
            for (const c of financial.balance.checks) {
              if (Math.abs(c.calculated - c.reported) > 0.02)
                statementChecks.push({
                  id: "balance-" + c.label,
                  period: financial.balance.date,
                  kind: "balance-reconciliation",
                  title: "Баланс: " + c.label,
                  reported: c.reported,
                  calculated: c.calculated,
                  difference: c.calculated - c.reported,
                  sheet: "Баланс",
                  cell: c.label.startsWith("Тауарлар:") ? "C7" : "C15",
                  detail:
                    financial.balance.metadata.file +
                    " · бастапқы қор жолдары мен қорытындыны салыстыру.",
                });
            }
          return json(res, 200, {
            ...report,
            checks: [...report.checks, ...statementChecks],
            statements: { balance: financial.balance, cashflow },
            user: publicUser(u),
            audit: db
              .prepare(
                "SELECT * FROM audit WHERE action IN ('Excel деректері','Кіру') ORDER BY id DESC LIMIT 100",
              )
              .all(),
          });
        }
        if (path === "/api/data") {
          let all = db
            .prepare("SELECT * FROM operations ORDER BY date,id")
            .all()
            .filter((o) => access(u, o));
          const org = url.searchParams.get("org") || "",
            month = url.searchParams.get("month") || "2026-09";
          if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))
            return json(res, 400, { error: "Ай қате" });
          if (org) all = all.filter((o) => o.org === org);
          const end = new Date(Date.UTC(+month.slice(0, 4), +month.slice(5), 0))
              .toISOString()
              .slice(0, 10),
            start = month + "-01",
            previous = `${+month.slice(0, 4) - 1}${month.slice(4)}`;
          const current = all.filter((o) => o.date >= start && o.date <= end),
            opening = ledger(all.filter((o) => o.date < start)),
            balance = ledger(all.filter((o) => o.date <= end));
          const history = Array.from({ length: 9 }, (_, i) => {
            const d = new Date(
                Date.UTC(+month.slice(0, 4), +month.slice(5) - 9 + i, 1),
              ),
              m = d.toISOString().slice(0, 7);
            return {
              month: m,
              ...ledger(all.filter((o) => o.date.startsWith(m))),
            };
          });
          const plans =
            u.role === "manager"
              ? []
              : db
                  .prepare("SELECT * FROM plans ORDER BY date")
                  .all()
                  .filter((p) => !org || p.org === org);
          return json(res, 200, {
            source: "ledger",
            workbookAvailable: !!workbookDataset && u.role !== "manager",
            user: publicUser(u),
            orgs: u.role === "manager" ? [u.org] : orgs,
            kinds,
            month,
            end,
            operations: current,
            allOperations: all.filter((o) => o.date <= end),
            budget: db
              .prepare("SELECT * FROM budgets WHERE month=?")
              .all(month)
              .filter((p) => (!org || p.org === org) && u.role !== "manager"),
            report: ledger(current),
            opening,
            balance,
            previous: ledger(all.filter((o) => o.date.startsWith(previous))),
            history,
            debts: debts(
              all.filter((o) => o.date <= end),
              end,
            ),
            plans,
            closed: !!db
              .prepare("SELECT closed FROM periods WHERE month=?")
              .get(month)?.closed,
            audit:
              u.role === "manager"
                ? []
                : db
                    .prepare("SELECT * FROM audit ORDER BY id DESC LIMIT 100")
                    .all(),
            demo: all.some((o) => o.source === "demo"),
          });
        }
        if (path === "/api/export" && req.method === "POST") {
          const { rows } = await body(req);
          if (
            !Array.isArray(rows) ||
            rows.length > 5001 ||
            rows.some((r) => !Array.isArray(r) || r.length > 30)
          )
            throw Error("Экспорт өлшемі қате");
          const file = workbook(rows);
          res.writeHead(200, {
            "Content-Type":
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "Content-Disposition": "attachment; filename=qarzhy.xlsx",
          });
          return res.end(file);
        }
        if (path === "/api/budget" && req.method === "POST") {
          if (!privileged(u)) return json(res, 403, { error: "Рұқсат жоқ" });
          const b = await body(req);
          if (
            !/^\d{4}-(0[1-9]|1[0-2])$/.test(b.month) ||
            !orgs.includes(b.org) ||
            !["revenue", "cost", "opex", "depreciation", "tax"].includes(
              b.metric,
            ) ||
            !Number.isSafeInteger(b.amount) ||
            b.amount < 0
          )
            throw Error("Бюджет деректері қате");
          if (
            db.prepare("SELECT closed FROM periods WHERE month=?").get(b.month)
              ?.closed
          )
            throw Error("Кезең жабық");
          const previous = db
            .prepare(
              "SELECT amount FROM budgets WHERE month=? AND org=? AND metric=?",
            )
            .get(b.month, b.org, b.metric);
          db.prepare(
            "INSERT INTO budgets VALUES(?,?,?,?) ON CONFLICT(month,org,metric) DO UPDATE SET amount=excluded.amount",
          ).run(b.month, b.org, b.metric, b.amount);
          audit(
            u,
            "Бюджет өзгерді",
            JSON.stringify({ before: previous?.amount ?? null, after: b }),
          );
          return json(res, 200, { ok: true });
        }
        if (path === "/api/correction" && req.method === "POST") {
          if (!privileged(u)) return json(res, 403, { error: "Рұқсат жоқ" });
          const b = await body(req),
            old = db
              .prepare("SELECT * FROM operations WHERE id=?")
              .get(Number(b.id));
          if (!old) throw Error("Операция табылмады");
          if (!String(b.reason || "").trim())
            throw Error("Түзету себебін көрсетіңіз");
          if (
            db
              .prepare("SELECT closed FROM periods WHERE month=?")
              .get(old.date.slice(0, 7))?.closed
          )
            throw Error("Кезең жабық");
          const updated = { ...old, amount: b.amount, cost: b.cost };
          validate(updated);
          db.prepare("UPDATE operations SET amount=?,cost=? WHERE id=?").run(
            b.amount,
            b.cost,
            old.id,
          );
          audit(
            u,
            "Операция түзетілді",
            JSON.stringify({
              id: old.id,
              reason: b.reason,
              before: { amount: old.amount, cost: old.cost },
              after: { amount: b.amount, cost: b.cost },
            }),
          );
          return json(res, 200, { ok: true });
        }
        if (path === "/api/operations" && req.method === "POST") {
          if (!privileged(u))
            return json(res, 403, { error: "Операция енгізуге рұқсат жоқ" });
          const b = await body(req);
          validate(b);
          if (!orgs.includes(b.org)) throw Error("Ұйым табылмады");
          if (
            db
              .prepare("SELECT closed FROM periods WHERE month=?")
              .get(b.date.slice(0, 7))?.closed
          )
            throw Error("Кезең жабық");
          insert.run({
            point: "",
            counterparty: "",
            cost: 0,
            due: "",
            article: "",
            ...b,
          });
          audit(u, "Жаңа операция", `${b.document}: ${b.amount} ₸`);
          return json(res, 201, { ok: true });
        }
        if (path === "/api/import" && req.method === "POST") {
          if (!privileged(u))
            return json(res, 403, {
              error: "Импортқа тек қаржыгердің құқығы бар",
            });
          const { rows } = await body(req);
          if (!Array.isArray(rows) || rows.length > 5000)
            throw Error("5000 жолға дейін рұқсат");
          let added = 0,
            duplicates = 0,
            errors = [];
          db.exec("BEGIN");
          try {
            for (let i = 0; i < rows.length; i++) {
              try {
                const o = {
                  point: "",
                  counterparty: "",
                  cost: 0,
                  due: "",
                  article: "",
                  ...rows[i],
                };
                validate(o);
                if (!orgs.includes(o.org)) throw Error("Ұйым табылмады");
                if (
                  db
                    .prepare("SELECT closed FROM periods WHERE month=?")
                    .get(o.date.slice(0, 7))?.closed
                )
                  throw Error("Кезең жабық");
                if (
                  db
                    .prepare(
                      "SELECT id FROM operations WHERE source=? AND external_id=?",
                    )
                    .get(o.source, o.external_id)
                ) {
                  duplicates++;
                  continue;
                }
                insert.run(o);
                added++;
              } catch (e) {
                errors.push({ row: i + 2, message: e.message });
              }
            }
            audit(u, "Импорт", JSON.stringify({ added, duplicates, errors }));
            db.exec("COMMIT");
          } catch (e) {
            db.exec("ROLLBACK");
            throw e;
          }
          return json(res, 200, { added, duplicates, errors });
        }
        if (path === "/api/period" && req.method === "POST") {
          if (!privileged(u)) return json(res, 403, { error: "Рұқсат жоқ" });
          const b = await body(req);
          if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(b.month))
            throw Error("Кезең қате");
          if (!b.closed && !String(b.reason || "").trim())
            throw Error("Қайта ашу себебін көрсетіңіз");
          db.prepare(
            "INSERT INTO periods VALUES(?,?) ON CONFLICT(month) DO UPDATE SET closed=excluded.closed",
          ).run(b.month, b.closed ? 1 : 0);
          audit(
            u,
            b.closed ? "Кезең жабылды" : "Кезең қайта ашылды",
            b.month + " " + (b.reason || ""),
          );
          return json(res, 200, { ok: true });
        }
        if (path === "/api/plans" && req.method === "POST") {
          if (!privileged(u))
            return json(res, 403, { error: "Жоспарлауға рұқсат жоқ" });
          const b = await body(req);
          validate({
            ...b,
            kind: "receipt",
            external_id: "plan",
            source: "manual",
            document: "plan",
          });
          if (!orgs.includes(b.org) || !["in", "out"].includes(b.direction))
            throw Error("Жоспар деректері қате");
          db.prepare(
            "INSERT INTO plans(date,org,article,amount,direction) VALUES(?,?,?,?,?)",
          ).run(b.date, b.org, String(b.article || ""), b.amount, b.direction);
          audit(u, "Жоспар қосылды", `${b.date}: ${b.article} ${b.amount} ₸`);
          return json(res, 201, { ok: true });
        }
        return json(res, 404, { error: "Табылмады" });
      }
      return json(res, 404, { error: "Табылмады" });
    } catch (e) {
      json(res, 400, {
        error: e.message.includes("users.username")
          ? "Бұл логин бос емес"
          : e.message.includes("UNIQUE")
            ? "Бұл операция бұрын енгізілген"
            : e.message,
      });
    }
  };
  return { handle, close: () => db.close() };
}
