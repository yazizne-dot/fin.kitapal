-- Анықтамалық: әр блок бөлек сұрау/транзакция. Файлды түгел орындамаңыз.
-- $1, $2 ... параметрлері pg client.query(sql, values) арқылы беріледі.
-- ID/numeric мәндерін Node.js-та string ретінде қабылдау керек.
-- Рұқсат серверде тексеріледі. employee үшін user_id — сессиядан алынған ID.

-- 1. Ұйымдар; пайдаланушы қосу. Тұз бен хэш Node.js scrypt арқылы жасалады.
SELECT id,name,active FROM qarzhy.organizations ORDER BY id;
INSERT INTO qarzhy.organizations(name) VALUES ($1) RETURNING id;
INSERT INTO qarzhy.users(username,name,role,org_id,point,password_salt,password_hash,must_change_password)
VALUES(lower($1),$2,$3,$4,$5,$6,$7,true) RETURNING id,username,name,role;

-- 2. Логин: парольді серверде verifyPassword арқылы тексеріңіз, хэшті API-ға қайтармаңыз.
SELECT id,username,name,role,active,must_change_password,password_salt,password_hash
FROM qarzhy.users WHERE lower(username)=lower($1) AND active;

-- 3. Сессия: $1 — Node.js sha256(token) нәтижесі, Buffer (32 байт).
INSERT INTO qarzhy.sessions(token_hash,user_id,expires_at) VALUES($1,$2,$3);
SELECT u.id,u.username,u.name,u.role,u.org_id,u.point,u.language,u.must_change_password
FROM qarzhy.sessions s JOIN qarzhy.users u ON u.id=s.user_id
WHERE s.token_hash=$1 AND s.expires_at>now() AND u.active;
DELETE FROM qarzhy.sessions WHERE token_hash=$1;
DELETE FROM qarzhy.sessions WHERE expires_at<=now();

-- 4. Пароль ауыстыру: бір pg client-та; ағымдағы пароль алдымен тексеріледі.
BEGIN;
UPDATE qarzhy.users SET password_salt=$2,password_hash=$3,must_change_password=false WHERE id=$1;
DELETE FROM qarzhy.sessions WHERE user_id=$1;
INSERT INTO qarzhy.audit(author_id,author_name,action) VALUES($1,$4,'password_changed');
COMMIT;
-- Қолданушыны бұғаттау да UPDATE + DELETE sessions + audit транзакциясында.
-- Соңғы белсенді админді қорғау үшін барлық admin жолдарын ID ретімен
-- SELECT ... FOR UPDATE арқылы құлыптап, қалған белсенді админ санын тексеріңіз.

-- 5. Операциялар: интервал [бастапқы күн, соңғы күн), optional org_id.
SELECT o.*,g.name AS org FROM qarzhy.operations o
JOIN qarzhy.organizations g ON g.id=o.org_id
WHERE o.date >= $1::date AND o.date < $2::date
AND ($3::smallint IS NULL OR o.org_id=$3) ORDER BY o.date,o.id;
INSERT INTO qarzhy.operations(source,external_id,date,org_id,point,counterparty,document,kind,amount,cost,due,article)
VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
ON CONFLICT(source,external_id) DO NOTHING RETURNING id;
-- RETURNING бос болса: қайталанған импорт. Бар жазба өзгермейді.
UPDATE qarzhy.operations SET amount=$2,cost=$3,due=$4,article=$5 WHERE id=$1 RETURNING id;
DELETE FROM qarzhy.operations WHERE id=$1 RETURNING id;

-- 6. Кезең жабу/ашу. $1 — айдың бірінші күні; admin/finance ғана.
BEGIN;
INSERT INTO qarzhy.periods(month,closed,updated_by) VALUES($1,$2,$3)
ON CONFLICT(month) DO UPDATE SET closed=excluded.closed,updated_by=excluded.updated_by,updated_at=now();
INSERT INTO qarzhy.audit(author_id,author_name,action,detail) VALUES($3,$4,'period_changed',$5);
COMMIT;
SELECT month,closed,updated_at FROM qarzhy.periods ORDER BY month;

-- 7. Төлем жоспары және бюджет.
INSERT INTO qarzhy.plans(date,org_id,article,amount,direction) VALUES($1,$2,$3,$4,$5) RETURNING id;
SELECT * FROM qarzhy.plans WHERE date >= $1::date AND date < $2::date ORDER BY date,id;
UPDATE qarzhy.plans SET date=$2,article=$3,amount=$4,direction=$5 WHERE id=$1;
DELETE FROM qarzhy.plans WHERE id=$1;
INSERT INTO qarzhy.budgets(month,org_id,metric,amount) VALUES($1,$2,$3,$4)
ON CONFLICT(month,org_id,metric) DO UPDATE SET amount=excluded.amount;
SELECT * FROM qarzhy.budgets WHERE month=$1 ORDER BY org_id,metric;

-- 8. Қызметкердің өз шығындары; $1 міндетті түрде сессиядағы user_id.
SELECT * FROM qarzhy.employee_expenses WHERE user_id=$1 AND deleted_at IS NULL ORDER BY date DESC,id DESC;
INSERT INTO qarzhy.employee_expenses(user_id,date,amount,category,description,vendor)
VALUES($1,$2,$3,$4,$5,$6) RETURNING id,version;
UPDATE qarzhy.employee_expenses
SET date=$4,amount=$5,category=$6,description=$7,vendor=$8,status='submitted',
review_note='',version=version+1,updated_at=now()
WHERE id=$1 AND user_id=$2 AND version=$3 AND status<>'approved' AND deleted_at IS NULL
RETURNING id,version;
-- 0 жол: 409/404; иесі, нұсқа немесе мәртебе сәйкес емес.
UPDATE qarzhy.employee_expenses SET deleted_at=now(),version=version+1,updated_at=now()
WHERE id=$1 AND user_id=$2 AND version=$3 AND status<>'approved' AND deleted_at IS NULL RETURNING id;

-- 9. Мақұлдау: бір client, admin/finance ғана, $1 expense_id, $2 күтілетін version.
-- SELECT нөл жол қайтарса немесе version сәйкес болмаса ROLLBACK; кейінгі SQL орындалмайды.
BEGIN;
SELECT * FROM qarzhy.employee_expenses WHERE id=$1 AND deleted_at IS NULL FOR UPDATE;
UPDATE qarzhy.employee_expenses SET status='approved',review_note=$3,version=version+1,updated_at=now()
WHERE id=$1 AND version=$2 AND deleted_at IS NULL RETURNING id,version;
-- UPDATE нөл жол болса ROLLBACK. $4 — reviewer ID.
INSERT INTO qarzhy.financial_entries(date,kind,amount,label,note,cash_effect,expense_id,author_id)
SELECT date,'opex',amount,category,description,true,id,$4
FROM qarzhy.employee_expenses WHERE id=$1 AND status='approved' AND deleted_at IS NULL
ON CONFLICT(expense_id) DO UPDATE SET date=excluded.date,amount=excluded.amount,
label=excluded.label,note=excluded.note,cash_effect=true,active=true,updated_at=now();
INSERT INTO qarzhy.audit(author_id,author_name,action,detail_json)
VALUES($4,$5,'expense_approved',jsonb_build_object('expense_id',$1::bigint));
COMMIT;
-- Қайтару дәл сондай құлып/нұсқа тексеруімен, бір транзакцияда:
-- UPDATE employee_expenses SET status='rejected', ... version=version+1 ...;
-- UPDATE financial_entries SET active=false,updated_at=now() WHERE expense_id=$1;
-- INSERT audit ...; COMMIT. Жабық ай болса транзакция түгел қайтарылады.

-- 10. Қолмен қаржылық жазба (admin/finance).
INSERT INTO qarzhy.financial_entries(date,kind,amount,label,note,cash_effect,author_id)
VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id;
SELECT e.*,u.name AS author FROM qarzhy.financial_entries e
JOIN qarzhy.users u ON u.id=e.author_id WHERE e.active ORDER BY e.date,e.id;
UPDATE qarzhy.financial_entries SET amount=$2,updated_at=now() WHERE id=$1 AND active AND expense_id IS NULL;
UPDATE qarzhy.financial_entries SET active=false,updated_at=now() WHERE id=$1 AND active AND expense_id IS NULL;

-- 11. Excel ұяшығын түзету: revision optimistic concurrency, бір client.
BEGIN;
SELECT revision FROM qarzhy.financial_state WHERE id=1 FOR UPDATE;
-- Алынған revision клиент жіберген нұсқамен сәйкес болмаса ROLLBACK + HTTP 409.
-- base_hash-ті сервердегі ағымдағы Excel SHA-256-пен салыстырыңыз.
INSERT INTO qarzhy.financial_overrides(book,sheet,cell,value,reason,base_hash,author_id)
VALUES($1,$2,$3,$4,$5,$6,$7)
ON CONFLICT(book,sheet,cell) DO UPDATE SET value=excluded.value,reason=excluded.reason,
base_hash=excluded.base_hash,author_id=excluded.author_id,updated_at=now();
SELECT revision FROM qarzhy.financial_state WHERE id=1;
COMMIT;
SELECT * FROM qarzhy.financial_overrides WHERE book=$1 AND base_hash=$2;
DELETE FROM qarzhy.financial_overrides WHERE book=$1 AND sheet=$2 AND cell=$3;
-- DELETE үшін де жоғарыдағы revision құлпы/тексеруі және audit қажет.

-- 12. Операциялар бойынша P&L: workbook үстемелері бөлек есептеледі.
WITH totals AS (
 SELECT
 COALESCE(sum(CASE WHEN kind='sale' THEN amount WHEN kind='return' THEN -amount ELSE 0 END),0) AS revenue,
 COALESCE(sum(CASE WHEN kind='sale' THEN cost WHEN kind='return' THEN -cost ELSE 0 END),0) AS cost,
 COALESCE(sum(amount) FILTER(WHERE kind='expense'),0) AS opex,
 COALESCE(sum(amount) FILTER(WHERE kind='depreciation'),0) AS depreciation,
 COALESCE(sum(amount) FILTER(WHERE kind='tax'),0) AS tax
 FROM qarzhy.operations WHERE date >= $1::date AND date < $2::date
 AND ($3::smallint IS NULL OR org_id=$3)
)
SELECT *,revenue-cost AS gross,revenue-cost-opex AS ebitda,
revenue-cost-opex-depreciation-tax AS profit FROM totals;

-- 13. ДДС: қазіргі accounting.mjs ережелері. transfer есепке кірмейді.
SELECT date_trunc('month',date)::date AS month,
 sum(CASE WHEN kind='receipt' THEN amount
 WHEN kind IN ('supplier_payment','expense_payment','tax_payment') THEN -amount ELSE 0 END) AS operating,
 sum(CASE WHEN kind='asset' THEN -amount ELSE 0 END) AS investing,
 sum(CASE WHEN kind IN ('capital','loan') THEN amount WHEN kind='loan_payment' THEN -amount ELSE 0 END) AS financing
FROM qarzhy.operations WHERE date >= $1::date AND date < $2::date
AND ($3::smallint IS NULL OR org_id=$3) GROUP BY 1 ORDER BY 1;

-- 14. Аудит және миграция журналы (құпиясөз/токен detail_json-ға жазылмайды).
INSERT INTO qarzhy.audit(author_id,author_name,action,detail,detail_json) VALUES($1,$2,$3,$4,$5::jsonb);
SELECT * FROM qarzhy.audit WHERE ($1::bigint IS NULL OR id<$1) ORDER BY id DESC LIMIT 100;
SELECT version,applied_at FROM qarzhy.schema_migrations ORDER BY version;
-- version қосу тек миграция рөлінің транзакциясында орындалады.

-- 15. Исходные книги для текущего интерфейса: соберите прежнюю структуру
-- {file,sha256,importedAt,sheets:{[name]:{cells,dimension,hidden}}} на сервере.
-- numeric приходит строкой: не округляйте исходные значения при чтении.
SELECT book,file_name,sha256,imported_at FROM qarzhy.source_workbooks ORDER BY book;
SELECT name,position,dimension,hidden FROM qarzhy.source_sheets
WHERE book=$1 ORDER BY position;
SELECT sheet,address,value_type,value_number,value_text,value_boolean,
       formula,has_formula,metadata
FROM qarzhy.source_cells WHERE book=$1 ORDER BY sheet,address;
-- value_type определяет поле значения. При has_formula=true включите поле
-- formula, даже если оно NULL. metadata добавляется к полям каждой ячейки.
-- Не меняйте хэш книги: financial_overrides.base_hash сверяется с ним.

-- 16. Контроль объёма после импорта; сравните с postgres-data.manifest.json.
SELECT book,count(*) AS cells FROM qarzhy.source_cells GROUP BY book ORDER BY book;
SELECT count(*) AS operations,sum(amount) AS amount_kzt,sum(cost) AS cost_kzt
FROM qarzhy.operations;
SELECT revision FROM qarzhy.financial_state WHERE id=1;
