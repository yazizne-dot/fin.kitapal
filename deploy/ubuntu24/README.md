# Установка Qarzhy на Ubuntu 24.04

Комплект исходников для сборки **на сервере**, не готовый Linux-бинарник.
Нужен администратор с sudo. SFTP-пользователь и пользователь туннеля не подходят.
Существующая fin сохраняется. Этот комплект не создаёт роли, не запускает миграции,
не восстанавливает дампы и не заменяет PostgreSQL. Порты 3000/3139 доступны только локально.

## Статус комплекта на 28.10.2026

Зависимости обновлены: Next.js 16.4.3 и source-map-js 1.2.2.
После обновления npm audit (включая devDependencies) не обнаружил известных уязвимостей.
Сборка проверяется локально из архива на macOS/Node 24; на Ubuntu администратор должен
повторить сборку и проверки запуска. Настройки production, TLS, вход и HTTPS
проверяются отдельно на целевом сервере. Сервер и база этим архивом не изменялись.

## 1. Подготовка администратором

Проверить свободное место, память, архитектуру и занятые порты. Не перезаписывать
существующие сайты Nginx. Для сборки Next.js предусмотреть несколько ГБ свободной памяти.
Установить Node.js **24 LTS** из доверенного источника с проверкой пакета/подписи.
Службы ниже ожидают Node по пути `/usr/bin/node`; если путь другой, изменить ExecStart
в обеих службах (также учесть путь Node в npm при сборке). Не использовать nvm из домашнего
каталога: ProtectHome запрещает службам доступ туда.

```bash
node --version
npm --version
command -v node
uname -m
sudo apt update
sudo apt install nginx certbot python3-certbot-nginx postgresql-client
sudo useradd --system --user-group --home-dir /opt/qarzhy --shell /usr/sbin/nologin qarzhy
sudo install -d -o root -g qarzhy -m 0750 /etc/qarzhy
sudo install -d -o qarzhy -g qarzhy -m 0750 /opt/qarzhy/releases
```

Если пользователь/каталоги существуют, сначала проверить их назначение, не создавать повторно.
Обновление версии Ubuntu или переустановка PostgreSQL не требуется.

## 2. Резервная копия fin

Использовать pg_dump той же основной версии PostgreSQL либо совместимой более новой.
Команды предполагают PostgreSQL доступен системному пользователю postgres через локальный сокет.
Если база в контейнере/другом кластере, администратор должен выбрать фактическое подключение.

```bash
sudo install -d -o postgres -g postgres -m 0700 /var/backups/qarzhy
# Подставить уникальную дату/время, НЕ перезаписывать старый файл.
sudo -u postgres pg_dump -Fc -d fin -f /var/backups/qarzhy/fin-before-deploy-YYYYMMDD-HHMM.dump
sudo -u postgres pg_restore --list /var/backups/qarzhy/fin-before-deploy-YYYYMMDD-HHMM.dump >/dev/null
sudo sha256sum /var/backups/qarzhy/fin-before-deploy-YYYYMMDD-HHMM.dump
```

Чтение оглавления и SHA256 проверяют формат/целостность файла; полная проверка восстановления
требует отдельной временной базы/кластера. **Не восстанавливать поверх fin.**
Зафиксировать до и после установки:

```bash
sudo -u postgres psql -X -d fin -c 'SELECT version FROM qarzhy.schema_migrations ORDER BY version'
sudo -u postgres psql -X -d fin -c 'SELECT (SELECT count(*) FROM qarzhy.documents) AS documents, (SELECT count(*) FROM qarzhy.cash_movements) AS movements'
```

Ожидаются версии 0001–0005. Ранее было 126 документов и 35 332 движения; если в базе шла работа,
ориентироваться на свежий замер до установки. При расхождении схемы остановиться,
миграции запускать только отдельным согласованным шагом после проверки SQL и backup.

## 3. Загрузка и сборка

Передать `qarzhy-ubuntu24.tar.gz` и `.sha256` через SFTP. В shell перейти в каталог загрузки:

```bash
sha256sum -c qarzhy-ubuntu24.tar.gz.sha256
# RELEASE заменить уникальным идентификатором, например 20261027-01.
sudo install -d -o qarzhy -g qarzhy -m 0750 /opt/qarzhy/releases/RELEASE
sudo tar -xzf qarzhy-ubuntu24.tar.gz --strip-components=1 -C /opt/qarzhy/releases/RELEASE --no-same-owner
sudo chown -R qarzhy:qarzhy /opt/qarzhy/releases/RELEASE
cd /opt/qarzhy/releases/RELEASE
sudo -u qarzhy env NEXT_TELEMETRY_DISABLED=1 npm ci
sudo -u qarzhy env NEXT_TELEMETRY_DISABLED=1 npm run build -- --webpack
sudo -u qarzhy npm audit --omit=dev
```

Не запускать audit fix --force. Замечания audit оценивать отдельно.
Сборка не требует пароля базы. В архиве нет data/, .env*, дампов, ключей или node_modules.
Строить новый release отдельно от работающего. Держать предыдущий release для отката.

## 4. Конфигурация и TLS

Скопировать примеры без секретов:

```bash
sudo install -o root -g qarzhy -m 0640 deploy/ubuntu24/backend.env.example /etc/qarzhy/backend.env
sudo install -o root -g qarzhy -m 0640 deploy/ubuntu24/frontend.env.example /etc/qarzhy/frontend.env
sudoedit /etc/qarzhy/backend.env
```

Заполнить DATABASE_URL с **существующей** ролью qarzhy_app, базой fin и фактическим портом
(при штатном локальном PostgreSQL 5432, не Mac-туннель 15433). Пароль URL-кодировать.
Поставить окончательный HTTPS origin без завершающего `/`.
CSRF_SECRET сгенерировать `openssl rand -hex 32` и сохранить только в защищённом env-файле.
Не передавать секреты через команды, историю shell, Git или переписку.
Формат env — KEY=value, без export и shell-подстановок; примеры совместимы с systemd и node --env-file.

Администратор должен предоставить **реальный CA/самоподписанный сертификат сервера**,
проверенный из доверенной серверной конфигурации. Установить публичный сертификат:

```bash
sudo install -o root -g qarzhy -m 0640 /PATH/TO/TRUSTED/CA.crt /etc/qarzhy/postgres-ca.crt
```

PG_TLS_SERVER_NAME — имя из сертификата. Текущий сервер ранее имел нестандартное имя
в сертификате; если штатная проверка имени не проходит, предпочтительно выпустить корректный сертификат.
Альтернатива: установить PG_TLS_CERT_SHA256 из **проверенного серверного сертификата**
(`openssl x509 -in /PATH/TO/SERVER.crt -noout -fingerprint -sha256`). Это точный pin сертификата
вместо DNS-проверки, а проверка доверенной цепочки остаётся включённой. При смене сертификата
обновить pin контролируемо. Ключ сервера приложению не передавать.

Не добавлять sslmode/sslrootcert в DATABASE_URL: TLS настраивается загрузчиком pg-tls.mjs.
Не отключать SSL или проверку сертификата. НЕ переносить Mac-файлы .env на сервер целиком.
Frontend не получает пароль БД; в его env только внутренний API URL.

## 5. Переключение и проверка до публикации

Запомнить предыдущий путь `readlink -f /opt/qarzhy/current`, если он существует.
При обновлении остановить обе службы непосредственно перед переключением.
Не подменять каталог работающего release во время сборки.

```bash
# Если службы уже установлены: sudo systemctl stop qarzhy-web qarzhy-api
sudo ln -sfn /opt/qarzhy/releases/RELEASE /opt/qarzhy/current
sudo install -m 0644 deploy/ubuntu24/systemd/qarzhy-api.service /etc/systemd/system/
sudo install -m 0644 deploy/ubuntu24/systemd/qarzhy-web.service /etc/systemd/system/
sudo systemctl daemon-reload
# Read-only проверка той же конфигурацией, что будет использовать API:
cd /opt/qarzhy/current
sudo -u qarzhy /usr/bin/node --env-file=/etc/qarzhy/backend.env --input-type=module -e '
process.env.PREFLIGHT_DATABASE_URL=process.env.DATABASE_URL;
await import("./deploy/ubuntu24/pg-tls.mjs");
await import("./scripts/preflight-postgres.mjs");'
sudo systemctl start qarzhy-api qarzhy-web
curl --fail http://127.0.0.1:3139/health
curl --fail -I http://127.0.0.1:3000
sudo systemctl status qarzhy-api qarzhy-web --no-pager
```

Остановиться при провале preflight/TLS/схемы, не менять данные наугад. Приложение использует
рабочие учётные записи fin; пароли автоматически не меняются. Не запускать интеграционные
тесты с TEST_DATABASE_URL=fin — такие тесты могут удалять схему тестовой базы.

## 6. Домен и HTTPS

Выбрать/зарегистрировать домен или попросить поддомен существующего домена компании.
Создать DNS A на публичный IPv4 сервера (AAAA только при настроенном IPv6).
В Nginx заменить finance.example.com реальным доменом, проверить конфликты существующих сайтов.

```bash
sudo cp deploy/ubuntu24/nginx/qarzhy.conf /etc/nginx/sites-available/qarzhy
sudoedit /etc/nginx/sites-available/qarzhy
sudo ln -s /etc/nginx/sites-available/qarzhy /etc/nginx/sites-enabled/qarzhy
sudo nginx -t
sudo systemctl reload nginx
# Администратору открыть 80/443; сохранить существующий SSH-доступ и правила PostgreSQL.
# Если UFW уже активен: sudo ufw allow 'Nginx Full'
# НЕ включать/сбрасывать firewall вслепую. 5432/3000/3139 наружу не открывать.
sudo certbot --nginx -d REAL.DOMAIN --redirect
sudo certbot renew --dry-run
```

До получения HTTPS не передавать логины/пароли через публичный HTTP.
Снаружи проверить HTTPS, вход действующего пользователя, обзор, статьи, бюджет, баланс
на 01.09.2026. Убедиться, что cookies имеют Secure, а API /api/me без входа не отдаёт данные.
Повторить счётчики документов/движений и версии миграций из шага 2.
После успешной проверки: `sudo systemctl enable qarzhy-api qarzhy-web`.

Без домена можно пока проверить через SSH-forward к localhost без публичного HTTP,
но для входа потребуется отдельный временный PUBLIC_APP_ORIGIN, совпадающий с URL проверки;
не оставлять его после перехода на окончательный HTTPS origin.

## Откат приложения

Остановить службы, вернуть `/opt/qarzhy/current` на предыдущий release, проверить совместимость
его версии со схемой и перезапустить обе службы. Это откат кода, не откат базы.
Backup поверх fin не восстанавливать. Для диагностики: `sudo journalctl -u qarzhy-api -u qarzhy-web -n 100`;
не публиковать логи с секретами/финансовыми данными.
