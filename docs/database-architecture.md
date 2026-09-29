# Qarzhy — PostgreSQL дерекқор архитектурасы

2026-09-29

## Мақсат және қазіргі жағдай

Qarzhy деректерін қосымшаның ішіндегі SQLite файлынан бөлек PostgreSQL серверіне көшіреміз: 13 кесте (қазіргі 12 + жаңа organizations) бір `qarzhy` схемасына, қатаң типтермен, сыртқы кілттермен және нұсқаланған миграциялармен.

Қазір не бар (кодтан тексерілді):

- Қозғалтқыш — `node:sqlite` (`DatabaseSync`), файл `data/portal.sqlite`, WAL режимі (server/db/open.mjs).
- Схема қосымша іске қосылғанда `CREATE TABLE IF NOT EXISTS` арқылы жасалады; `users` кестесіне бағандар `ALTER TABLE` арқылы қосылады, миграция тек біреу — `accounts-v2` (server/auth/accounts.mjs).
- Барлық сұраулар синхронды (`db.prepare(...).get()`), транзакциялар қолмен `BEGIN/COMMIT`.
- Күндер `TEXT`, логикалық мәндер `INTEGER 0/1`, сыртқы кілттер жоқ, ұйымдар тізімі кодта қатаң жазылған (Qalam Books, Kitap Retail, Dara Distribution).

Неге көшеміз: бірнеше сервер/процесс бір базаға қатар жаза алады, бэкап пен репликация стандартты, деректер тұтастығын база өзі тексереді.

## Жалпы архитектура

Next.js сервері PostgreSQL-ге `pg` пулы арқылы тек `DATABASE_URL` бойынша қосылады; барлық SQL бір қабатқа — `server/db/` репозиторийлеріне жиналады.

| Құрамдас | Шешім |
| --- | --- |
| Сервер | PostgreSQL 17, бөлек хост немесе басқарылатын сервис |
| Дерекқор / схема | `qarzhy` дерекқоры, `qarzhy` схемасы (`public` бос қалады) |
| Драйвер | `pg` (node-postgres), `Pool`, `max` = 10 бір инстансқа |
| Қосылу | `DATABASE_URL`, өндірісте `sslmode=require` |
| Уақыт белдеуі | Серверде `timezone = 'UTC'`, күндер `date`, уақыт белгілері `timestamptz` |
| Миграциялар | `db/migrations/NNNN_name.sql` файлдары + `schema_migrations` кестесі; қосымша схеманы өзгертпейді |
| Орталар | `qarzhy_dev` (жергілікті Docker), `qarzhy_test` (тесттер, әр жүгіруде тазаланады), `qarzhy` (өндіріс) |

Кодқа әсері: `DatabaseSync` синхронды, ал `pg` асинхронды. Сондықтан portal.mjs, accounts.mjs, workspace.mjs ішіндегі барлық `db.prepare(...)` шақырулары `await` болып, транзакциялар `withTransaction(client => ...)` көмекшісіне ауысады (бір транзакция = бір `client`).

## Кестелер

Барлық 12 SQLite кестесі сақталады, бір жаңа кесте қосылады (`organizations`), `app_migrations` миграция құралының `schema_migrations` кестесімен ауысады. Сомалар теңгемен, бүтін сан ретінде `bigint`, жағдайлар `CHECK` арқылы шектеледі.

### Анықтамалықтар және қолданушылар

| Кесте | Бағандар (PostgreSQL типі) | Кілттер және шектеулер |
| --- | --- | --- |
| `organizations` (жаңа) | `id smallint identity`, `name text`, `active boolean` | PK `id`; `name` UNIQUE. Қазір кодтағы 3 ұйыммен толтырылады |
| `users` | `id bigint identity`, `username citext`, `name text`, `role text`, `org_id smallint NULL`, `point text`, `language text DEFAULT 'kk'`, `active boolean`, `must_change_password boolean`, `password_salt text`, `password_hash text`, `created_at timestamptz` | PK `id`; `username` UNIQUE (регистрсіз); `role IN ('admin','finance','employee')`; `language IN ('kk','ru')` |
| `sessions` | `token_hash bytea`, `user_id bigint`, `expires_at timestamptz`, `created_at timestamptz` | PK `token_hash`; FK `user_id → users ON DELETE CASCADE` |

### Бухгалтерлік операциялар

| Кесте | Бағандар (PostgreSQL типі) | Кілттер және шектеулер |
| --- | --- | --- |
| `operations` | `id bigint identity`, `source text`, `external_id text`, `date date`, `org_id smallint`, `point text`, `counterparty text`, `document text`, `kind text`, `amount bigint`, `cost bigint DEFAULT 0`, `due date NULL`, `article text`, `created_at timestamptz` | PK `id`; UNIQUE `(source, external_id)`; FK `org_id`; `kind` — accounting.mjs ішіндегі `kinds` тізімі (sale, receipt, purchase, …); `amount >= 0` |
| `periods` | `month date` (айдың 1-күні), `closed boolean`, `updated_at timestamptz`, `updated_by bigint` | PK `month`; `extract(day from month) = 1` |
| `plans` | `id bigint identity`, `date date`, `org_id smallint`, `article text`, `amount bigint`, `direction text` | PK `id`; FK `org_id`; `direction IN ('in','out')` |
| `budgets` | `month date`, `org_id smallint`, `metric text`, `amount bigint` | PK `(month, org_id, metric)`; FK `org_id` |

### Қаржылық жұмыс кеңістігі

| Кесте | Бағандар (PostgreSQL типі) | Кілттер және шектеулер |
| --- | --- | --- |
| `employee_expenses` | `id bigint identity`, `user_id bigint`, `date date`, `amount bigint`, `category text`, `description text`, `vendor text`, `status text DEFAULT 'submitted'`, `review_note text`, `version integer DEFAULT 1`, `deleted_at timestamptz NULL`, `created_at`, `updated_at timestamptz` | PK `id`; FK `user_id → users`; `status IN ('submitted','approved','rejected')`; `amount > 0` |
| `financial_entries` | `id bigint identity`, `date date`, `kind text`, `amount bigint`, `label text`, `note text`, `cash_effect boolean`, `expense_id bigint NULL`, `active boolean`, `author_id bigint`, `created_at`, `updated_at timestamptz` | PK `id`; FK `expense_id → employee_expenses` (UNIQUE); FK `author_id → users`; `kind IN ('revenue','cost','opex','otherExpense','taxes','bonuses','otherIncome','cash_in','cash_out')` |
| `financial_overrides` | `book text`, `sheet text`, `cell text`, `value numeric(20,4)`, `reason text`, `base_hash text`, `author_id bigint`, `updated_at timestamptz` | PK `(book, sheet, cell)`; FK `author_id → users` |
| `financial_state` | `id smallint`, `revision bigint` | PK `id`; `CHECK (id = 1)` — бір жолдық есептегіш |

### Жүйелік

| Кесте | Бағандар (PostgreSQL типі) | Кілттер және шектеулер |
| --- | --- | --- |
| `audit` | `id bigint identity`, `at timestamptz DEFAULT now()`, `author_id bigint NULL`, `author_name text`, `action text`, `detail text`, `detail_json jsonb NULL` | PK `id`; FK `author_id → users ON DELETE SET NULL`; тек INSERT (өзгертуге болмайды) |
| `schema_migrations` | `version text`, `applied_at timestamptz` | PK `version`; `app_migrations` орнына |

Тип ауыстыру ережелері: `INTEGER 0/1 → boolean`, `TEXT` күн → `date`, ISO уақыт → `timestamptz`, `expires` (миллисекунд) → `timestamptz`, `deleted 0/1 → deleted_at`, бос `due = ''` → `NULL`, `amount_cents` (тиын) → `amount` (теңге, ÷ 100). Қазіргі базада тиын қалдығы бар жазба жоқ: `employee_expenses` 4 жол, `financial_entries` 0 жол.

## ER диаграммасы және байланыстар

```mermaid
erDiagram
    organizations ||--o{ operations : org_id
    organizations ||--o{ plans : org_id
    organizations ||--o{ budgets : org_id
    organizations |o--o{ users : org_id
    users ||--o{ sessions : user_id
    users |o--o{ audit : author_id
    users ||--o{ employee_expenses : user_id
    users ||--o{ financial_entries : author_id
    users ||--o{ financial_overrides : author_id
    employee_expenses |o--o| financial_entries : expense_id
    periods {
        date month PK
        boolean closed
    }
    financial_state {
        smallint id PK
        bigint revision
    }
    schema_migrations {
        text version PK
        timestamptz applied_at
    }
```

`organizations` бухгалтерлік кестелерін, `users` сессияларды, аудитті және қаржылық жазбаларды байлайды. `periods` сыртқы кілтсіз, бірақ триггер арқылы `operations` пен `financial_entries` жазбаларын жабық айға жібермейді.

## Индекстер, шектеулер, тұтастық

Индекстер кодтағы нақты `WHERE` / `ORDER BY` сұрауларына қарай таңдалды; PK мен UNIQUE индекстері бөлек жазылмайды.

| Индекс | Қай сұрауға |
| --- | --- |
| `operations (date, id)` | Барлық операциялар күн бойынша (`ORDER BY date,id`) |
| `operations (org_id, date)` | Ұйым бойынша есептер |
| `sessions (user_id)`, `sessions (expires_at)` | Қолданушының сессияларын өшіру, ескіргендерді тазалау |
| `employee_expenses (user_id, date) WHERE deleted_at IS NULL` | Қызметкердің өз шығындары |
| `employee_expenses (status) WHERE deleted_at IS NULL` | Қараудағы өтінімдер тізімі |
| `financial_entries (date, id) WHERE active` | `WHERE e.active=1 ORDER BY e.date,e.id` |
| `audit (id DESC)` — PK жеткілікті | Соңғы 100/300 жазба |
| `plans (date)` | Жоспарлар күн бойынша |

Тұтастық ережелері:

- Жабық кезеңге жазуды қазір код тексереді. Келесі қадам — `operations` мен `financial_entries` үшін `BEFORE INSERT OR UPDATE` триггері, ол `periods.closed` болса қате лақтырады.
- Тұрақты жаңарту: `employee_expenses.version` — `UPDATE … WHERE id=$1 AND version=$2`; 0 жол жаңарса → 409.
- `financial_state.revision` өсуі жазбамен бір транзакцияда жүреді (`UPDATE … RETURNING revision`).
- Импортта қайталануды алдын ала `SELECT` емес, `INSERT … ON CONFLICT (source, external_id) DO NOTHING RETURNING id` тексереді.
- Қате хабарлары: қазір код `"UNIQUE"` және `"users.username"` мәтінін іздейді; PostgreSQL-де `err.code === '23505'` және `err.constraint` атын тексеру керек.

## Қауіпсіздік, рөлдер, бэкап

Қосымша базаға иесі емес, шектеулі рөлмен қосылады; схеманы тек миграция рөлі өзгертеді.

| Рөл | Құқықтары | Кім қолданады |
| --- | --- | --- |
| `qarzhy_owner` | Схема иесі, DDL | Миграциялар (CI/деплой) |
| `qarzhy_app` | `SELECT, INSERT, UPDATE, DELETE` барлық кестелерге; `audit`-қа тек `SELECT, INSERT` | Next.js сервері |
| `qarzhy_readonly` | Тек `SELECT` | Аналитика, қолмен тексеру |

- Парольдер бұрынғыдай scrypt арқылы қосымшада хэштеледі; база тек тұз бен хэшті сақтайды.
- Сессия токені базада ашық сақталмайды: `token_hash = sha256(token)`. База дампы тарап кетсе де, сессияларды ұрлау мүмкін емес.
- `.initial-access.txt` файлы қазір `DB_PATH` жанына жазылады; PostgreSQL-де бұл жол жоқ, сондықтан бастапқы аккаунттар бөлек `seed` скриптімен жасалады.
- Бэкап: тәулігіне `pg_dump -Fc`, 30 күн сақтау; WAL архиві арқылы уақыт нүктесіне қалпына келтіру (PITR). Айына бір рет `qarzhy_restore_check` базасына қалпына келтіріп тексеру.
- Ескірген сессияларды тазалау: `DELETE FROM sessions WHERE expires_at < now()` — кіру кезінде немесе cron арқылы.

## SQLite-тан көшу жоспары

Көшу бір жолғы кесумен жүреді: жазуды тоқтатып, деректерді скриптпен көшіріп, сандарын салыстырып, қосымшаны `DATABASE_URL`-ға ауыстырамыз.

1. `db/migrations/0001_init.sql` — жоғарыдағы кестелер, индекстер, рөлдер; `0002_closed_period_trigger.sql` — жабық кезең триггері.
2. `server/db/open.mjs` → `server/db/pool.mjs`: `Pool`, `query()`, `withTransaction()`. `CREATE TABLE IF NOT EXISTS` мен `ALTER TABLE` кодтан алынып тасталады.
3. Сұрауларды асинхронды ету: `?` → `$1, $2`, `INSERT OR IGNORE` → `ON CONFLICT DO NOTHING`, `COLLATE NOCASE` → `citext`, `db.isTransaction` → `withTransaction`.
4. Сомаларды теңгеге көшіру: accounts.mjs және workspace.mjs ішіндегі `amount_cents` → `amount`, `amount_cents / 100` бөлуі алынады; API мен фронтенд теңге жібереді.
5. `scripts/migrate-sqlite-to-pg.mjs`: әр кестені `node:sqlite`-пен оқып, типтерді ауыстырып («Кестелер» бөліміндегі ережелер), `id` мәндерін сақтап жазады. `amount_cents % 100 <> 0` болса, скрипт тоқтайды. Соңында `setval()` арқылы identity секвенцияларын жылжытады.
6. Сессиялар көшірілмейді — барлық қолданушылар қайта кіреді (токен енді хэшпен сақталады).
7. Тексеру: әр кестенің жол саны бірдей; `sum(amount)` PostgreSQL-де = SQLite-тағы `sum(amount)` немесе `sum(amount_cents) / 100`; `financial_state.revision` бірдей.
8. Тесттер: `tests/helpers` ішінде әр тест файлы өз схемасын (`test_<pid>`) жасап, соңында өшіреді; жергілікті PostgreSQL `docker compose` арқылы.
9. Деплой: жазуды тоқтату → SQLite бэкапы → 5–7 қадамдар → жаңа нұсқаны іске қосу. SQLite файлы қайтару үшін 30 күн сақталады.

Ашық сұрақ: PostgreSQL қайда орналасады — өз серверіңіз бе әлде басқарылатын сервис пе? Бэкап пен PITR баптауы соған байланысты.
