import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { writeFileSync } from "node:fs";
export const privileged = (u) => ["admin", "finance"].includes(u?.role);
export const publicUser = (u) =>
  u
    ? Object.fromEntries(
        [
          "id",
          "name",
          "username",
          "role",
          "org",
          "point",
          "language",
          "active",
          "must_change_password",
        ].map((k) => [k, u[k]]),
      )
    : null;
export function verifyPassword(password, u) {
  if (!u || typeof password !== "string" || password.length > 128) return false;
  return timingSafeEqual(
    scryptSync(password, u.salt, 64),
    Buffer.from(u.password, "hex"),
  );
}
export function passwordHash(password) {
  if (
    typeof password !== "string" ||
    password.length < 8 ||
    password.length > 128
  )
    throw Error("Құпиясөз 8–128 таңба болуы керек");
  const salt = randomBytes(16).toString("hex");
  return { salt, password: scryptSync(password, salt, 64).toString("hex") };
}
export function validUsername(value) {
  const name = String(value || "")
    .trim()
    .toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{2,63}$/.test(name))
    throw Error("Логин: 3–64 латын әрпі, сан, нүкте, сызықша");
  return name;
}
const generatedPassword = () => `Qz!${randomBytes(9).toString("base64url")}`;
export function initializeAccounts(db, audit) {
  const cols = db
    .prepare("PRAGMA table_info(users)")
    .all()
    .map((c) => c.name);
  for (const [name, type] of [
    ["username", "TEXT"],
    ["language", "TEXT NOT NULL DEFAULT 'kk'"],
    ["active", "INTEGER NOT NULL DEFAULT 1"],
    ["must_change_password", "INTEGER NOT NULL DEFAULT 0"],
  ])
    if (!cols.includes(name))
      db.exec(`ALTER TABLE users ADD COLUMN ${name} ${type}`);
  db.exec(`CREATE TABLE IF NOT EXISTS app_migrations(name TEXT PRIMARY KEY); CREATE UNIQUE INDEX IF NOT EXISTS unique_username ON users(username COLLATE NOCASE);
 CREATE TABLE IF NOT EXISTS employee_expenses(id INTEGER PRIMARY KEY,user_id INTEGER NOT NULL,date TEXT NOT NULL,amount_cents INTEGER NOT NULL,category TEXT NOT NULL,description TEXT NOT NULL,vendor TEXT DEFAULT '',status TEXT NOT NULL DEFAULT 'submitted',review_note TEXT DEFAULT '',created_at TEXT NOT NULL,updated_at TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,deleted INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS financial_entries(id INTEGER PRIMARY KEY,date TEXT NOT NULL,kind TEXT NOT NULL,amount_cents INTEGER NOT NULL,label TEXT NOT NULL,note TEXT DEFAULT '',cash_effect INTEGER NOT NULL DEFAULT 0,expense_id INTEGER UNIQUE,active INTEGER NOT NULL DEFAULT 1,author_id INTEGER NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS financial_overrides(book TEXT,sheet TEXT,cell TEXT,value REAL NOT NULL,reason TEXT NOT NULL,base_hash TEXT NOT NULL,author_id INTEGER NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(book,sheet,cell));
 CREATE TABLE IF NOT EXISTS financial_state(id INTEGER PRIMARY KEY CHECK(id=1),revision INTEGER NOT NULL); INSERT OR IGNORE INTO financial_state VALUES(1,0);`);
  if (
    !db
      .prepare("SELECT name FROM app_migrations WHERE name=?")
      .get("accounts-v2")
  ) {
    const credentials = [];
    db.exec("BEGIN");
    try {
      for (const u of db.prepare("SELECT * FROM users").all()) {
        if (u.role === "finance")
          db.prepare("UPDATE users SET username=?,active=1 WHERE id=?").run(
            "finance",
            u.id,
          );
        else if (u.role === "director")
          db.prepare(
            "UPDATE users SET username='admin',role='admin',name='Әкімші',active=1 WHERE id=?",
          ).run(u.id);
        else if (u.role === "admin")
          db.prepare(
            "UPDATE users SET username='admin',active=1 WHERE id=?",
          ).run(u.id);
        else
          db.prepare(
            "UPDATE users SET username=?,role='employee',active=0 WHERE id=?",
          ).run("legacy" + u.id, u.id);
      }
      for (const [username, name, role] of [
        ["admin", "Әкімші", "admin"],
        ["finance", "Қаржыгер", "finance"],
      ])
        if (
          !db.prepare("SELECT id FROM users WHERE username=?").get(username)
        ) {
          const p = process.env.PORTAL_PASSWORD || generatedPassword(),
            h = passwordHash(p);
          db.prepare(
            "INSERT INTO users(name,role,org,point,salt,password,username) VALUES(?,?,?,?,?,?,?)",
          ).run(name, role, "", "", h.salt, h.password, username);
          credentials.push({ username, password: p });
        }
      for (const [name, username] of [
        ["Бухгалтер", "buhgalter"],
        ["Маркетолог", "marketolog"],
        ["РОП", "rop"],
        ["Логистик", "logist"],
        ["Курьер", "kurier"],
        ["Зав склад", "sklad"],
        ["Атырау филиал", "atyrau"],
        ["Сату менеджер", "sales"],
      ]) {
        const password = generatedPassword(),
          h = passwordHash(password);
        db.prepare(
          "INSERT INTO users(name,role,org,point,salt,password,username,must_change_password) VALUES(?,'employee','','',?,?,?,1)",
        ).run(name, h.salt, h.password, username);
        credentials.push({ username, password });
      }
      db.exec("DELETE FROM sessions");
      db.prepare("INSERT INTO app_migrations VALUES(?)").run("accounts-v2");
      audit(
        { name: "Жүйе" },
        "Қолжетімділік жаңартылды",
        "Админ, қаржыгер және 8 жеке кабинет жасалды. Ескі демо рөлдер өшірілді.",
      );
      if (credentials.length) {
        const path =
          (process.env.DB_PATH || "data/portal.sqlite") + ".initial-access.txt";
        writeFileSync(
          path,
          "Qarzhy — бастапқы кіру деректері / Первоначальные пароли\nҚызметкерлер бірінші кіргенде паролін ауыстырады. / При первом входе смените пароль.\n\n" +
            credentials.map((c) => `${c.username}\t${c.password}`).join("\n") +
            "\n",
          { mode: 0o600 },
        );
      }
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
}
export function createAccountHandlers({
  db,
  audit,
  json,
  body,
  refreshFinancial,
}) {
  const categories = [
    "Кеңсе / Офис",
    "Жол / Транспорт",
    "Тамақ / Питание",
    "Іссапар / Командировка",
    "Сатып алу / Покупка",
    "Басқа / Прочее",
  ];
  const ownOrAll = (u) =>
    db
      .prepare(
        `SELECT e.*,u.name user_name,u.username FROM employee_expenses e JOIN users u ON u.id=e.user_id WHERE e.deleted=0 ${privileged(u) ? "" : "AND e.user_id=?"} ORDER BY e.date DESC,e.id DESC`,
      )
      .all(...(privileged(u) ? [] : [u.id]));
  const rev = () =>
    db.exec("UPDATE financial_state SET revision=revision+1 WHERE id=1");
  function expenseValues(b) {
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(b.date) ||
      !Number.isFinite(Date.parse(b.date)) ||
      new Date(b.date).toISOString().slice(0, 10) !== b.date
    )
      throw Error("Күн қате");
    if (
      !Number.isSafeInteger(b.amount_cents) ||
      b.amount_cents <= 0 ||
      b.amount_cents > 1000000000000
    )
      throw Error("Сома қате");
    if (!categories.includes(b.category)) throw Error("Шығын санаты қате");
    const description = String(b.description || "").trim();
    if (!description || description.length > 1000)
      throw Error("Сипаттама 1–1000 таңба болуы керек");
    return {
      ...b,
      description,
      vendor: String(b.vendor || "")
        .trim()
        .slice(0, 200),
    };
  }
  return {
    categories,
    ownOrAll,
    async route(req, res, path, u, token) {
      if (path === "/api/me" && req.method === "GET") {
        json(res, 200, { user: publicUser(u) });
        return true;
      }
      if (path === "/api/profile" && req.method === "POST") {
        const b = await body(req);
        if (!["kk", "ru"].includes(b.language)) throw Error("Тіл қате");
        let username = u.username;
        if (b.username !== undefined) {
          if (!privileged(u))
            return (
              json(res, 403, { error: "Логинді тек әкімші өзгертеді" }),
              true
            );
          username = validUsername(b.username);
          if (!verifyPassword(b.current_password, u))
            throw Error("Қазіргі құпиясөз қате");
        }
        db.prepare("UPDATE users SET username=?,language=? WHERE id=?").run(
          username,
          b.language,
          u.id,
        );
        audit(
          u,
          "Жеке профиль өзгерді",
          JSON.stringify({ id: u.id, username, language: b.language }),
        );
        json(res, 200, {
          user: publicUser(
            db.prepare("SELECT * FROM users WHERE id=?").get(u.id),
          ),
        });
        return true;
      }
      if (path === "/api/password" && req.method === "POST") {
        const b = await body(req);
        if (!verifyPassword(b.current_password, u))
          throw Error("Қазіргі құпиясөз қате");
        const h = passwordHash(b.new_password);
        db.prepare(
          "UPDATE users SET salt=?,password=?,must_change_password=0 WHERE id=?",
        ).run(h.salt, h.password, u.id);
        db.prepare("DELETE FROM sessions WHERE user_id=? AND token<>?").run(
          u.id,
          token,
        );
        audit(u, "Құпиясөз өзгерді", String(u.id));
        json(res, 200, { ok: true });
        return true;
      }
      if (path === "/api/users") {
        if (!privileged(u))
          return (json(res, 403, { error: "Рұқсат жоқ" }), true);
        if (req.method === "GET") {
          json(res, 200, {
            users: db
              .prepare("SELECT * FROM users ORDER BY active DESC,id")
              .all()
              .map(publicUser),
          });
          return true;
        }
        if (req.method === "POST") {
          const b = await body(req),
            username = validUsername(b.username),
            name = String(b.name || "").trim();
          if (
            !name ||
            name.length > 100 ||
            !["admin", "finance", "employee"].includes(b.role)
          )
            throw Error("Пайдаланушы деректері қате");
          const p = b.password || generatedPassword(),
            h = passwordHash(p);
          const result = db
            .prepare(
              "INSERT INTO users(name,username,role,org,point,salt,password,must_change_password) VALUES(?,?,?,?,?,?,?,1)",
            )
            .run(name, username, b.role, "", "", h.salt, h.password);
          audit(
            u,
            "Пайдаланушы қосылды",
            JSON.stringify({
              id: Number(result.lastInsertRowid),
              name,
              username,
              role: b.role,
            }),
          );
          json(res, 201, {
            ok: true,
            id: Number(result.lastInsertRowid),
            temporary_password: p,
          });
          return true;
        }
        if (req.method === "PATCH") {
          const b = await body(req),
            target = db
              .prepare("SELECT * FROM users WHERE id=?")
              .get(Number(b.id));
          if (!target) throw Error("Пайдаланушы табылмады");
          if (b.action === "reset-password") {
            if (target.id === u.id)
              throw Error("Өз құпиясөзіңізді жеке кабинетте өзгертіңіз");
            const p = b.password || generatedPassword(),
              h = passwordHash(p);
            db.prepare(
              "UPDATE users SET salt=?,password=?,must_change_password=1 WHERE id=?",
            ).run(h.salt, h.password, target.id);
            db.prepare("DELETE FROM sessions WHERE user_id=?").run(target.id);
            audit(
              u,
              "Құпиясөз қайта берілді",
              JSON.stringify({ id: target.id, username: target.username }),
            );
            json(res, 200, { ok: true, temporary_password: p });
            return true;
          }
          const username = validUsername(b.username ?? target.username),
            name = String(b.name ?? target.name).trim(),
            role = b.role ?? target.role,
            active = b.active === undefined ? target.active : b.active ? 1 : 0;
          if (
            !name ||
            name.length > 100 ||
            !["admin", "finance", "employee"].includes(role)
          )
            throw Error("Пайдаланушы деректері қате");
          if (target.id === u.id && (!active || role !== u.role))
            throw Error(
              "Өзіңізді өшіруге немесе өз рөліңізді өзгертуге болмайды",
            );
          if (
            target.role === "admin" &&
            target.active &&
            (!active || role !== "admin") &&
            db
              .prepare(
                "SELECT COUNT(*) n FROM users WHERE role='admin' AND active=1",
              )
              .get().n <= 1
          )
            throw Error("Соңғы белсенді әкімшіні өшіруге болмайды");
          db.prepare(
            "UPDATE users SET username=?,name=?,role=?,active=? WHERE id=?",
          ).run(username, name, role, active, target.id);
          if (target.id !== u.id)
            db.prepare("DELETE FROM sessions WHERE user_id=?").run(target.id);
          audit(
            u,
            "Пайдаланушы өзгерді",
            JSON.stringify({
              before: publicUser(target),
              after: { username, name, role, active },
            }),
          );
          json(res, 200, { ok: true });
          return true;
        }
      }
      if (path === "/api/expenses") {
        if (req.method === "GET") {
          json(res, 200, { expenses: ownOrAll(u), categories });
          return true;
        }
        if (u.must_change_password)
          return (
            json(res, 403, { error: "Алдымен уақытша құпиясөзді ауыстырыңыз" }),
            true
          );
        if (req.method === "POST") {
          const b = expenseValues(await body(req)),
            now = new Date().toISOString();
          const result = db
            .prepare(
              "INSERT INTO employee_expenses(user_id,date,amount_cents,category,description,vendor,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)",
            )
            .run(
              u.id,
              b.date,
              b.amount_cents,
              b.category,
              b.description,
              b.vendor,
              now,
              now,
            );
          audit(
            u,
            "Жеке шығын қосылды",
            JSON.stringify({
              id: Number(result.lastInsertRowid),
              amount_cents: b.amount_cents,
            }),
          );
          json(res, 201, { ok: true });
          return true;
        }
        if (req.method === "PATCH") {
          const b = await body(req),
            old = db
              .prepare(
                "SELECT * FROM employee_expenses WHERE id=? AND deleted=0",
              )
              .get(Number(b.id));
          if (!old || (!privileged(u) && old.user_id !== u.id))
            return (json(res, 404, { error: "Жазба табылмады" }), true);
          if (Number(b.version) !== old.version)
            return (
              json(res, 409, { error: "Жазба өзгерген. Бетті жаңартыңыз" }),
              true
            );
          if (b.action === "review") {
            if (!privileged(u))
              return (json(res, 403, { error: "Рұқсат жоқ" }), true);
            if (!["approved", "rejected"].includes(b.status))
              throw Error("Мәртебе қате");
            const now = new Date().toISOString();
            db.exec("BEGIN");
            try {
              db.prepare(
                "UPDATE employee_expenses SET status=?,review_note=?,version=version+1,updated_at=? WHERE id=?",
              ).run(b.status, String(b.note || "").slice(0, 1000), now, old.id);
              if (b.status === "approved")
                db.prepare(
                  "INSERT INTO financial_entries(date,kind,amount_cents,label,note,cash_effect,expense_id,author_id,created_at,updated_at) VALUES(?,'opex',?,?,?,?,?,?,?,?) ON CONFLICT(expense_id) DO UPDATE SET date=excluded.date,amount_cents=excluded.amount_cents,label=excluded.label,note=excluded.note,cash_effect=excluded.cash_effect,active=1,updated_at=excluded.updated_at",
                ).run(
                  old.date,
                  old.amount_cents,
                  old.category,
                  old.description,
                  1,
                  old.id,
                  u.id,
                  now,
                  now,
                );
              else
                db.prepare(
                  "UPDATE financial_entries SET active=0,updated_at=? WHERE expense_id=?",
                ).run(now, old.id);
              rev();
              audit(
                u,
                "Шығын тексерілді",
                JSON.stringify({
                  id: old.id,
                  before: old.status,
                  after: b.status,
                  note: b.note || "",
                }),
              );
              db.exec("COMMIT");
              refreshFinancial();
            } catch (e) {
              if (db.isTransaction) db.exec("ROLLBACK");
              throw e;
            }
            json(res, 200, { ok: true });
            return true;
          }
          if (old.status === "approved")
            throw Error(
              "Есепке қосылған шығынды алдымен қаржыгер қайтаруы керек",
            );
          if (b.action === "delete") {
            db.prepare(
              "UPDATE employee_expenses SET deleted=1,version=version+1 WHERE id=?",
            ).run(old.id);
            audit(u, "Жеке шығын өшірілді", String(old.id));
            json(res, 200, { ok: true });
            return true;
          }
          const n = expenseValues(b);
          db.prepare(
            "UPDATE employee_expenses SET date=?,amount_cents=?,category=?,description=?,vendor=?,status='submitted',review_note='',version=version+1,updated_at=? WHERE id=?",
          ).run(
            n.date,
            n.amount_cents,
            n.category,
            n.description,
            n.vendor,
            new Date().toISOString(),
            old.id,
          );
          audit(
            u,
            "Жеке шығын түзетілді",
            JSON.stringify({
              id: old.id,
              before: { amount: old.amount_cents, date: old.date },
              after: { amount: n.amount_cents, date: n.date },
            }),
          );
          json(res, 200, { ok: true });
          return true;
        }
      }
      return false;
    },
  };
}
