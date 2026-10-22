import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { once } from 'node:events';
import pg from 'pg';
import { chromium } from 'playwright';
import { assertTestDatabaseUrl, resetTestDatabase } from '../backend/helpers/test-db.mjs';
import { hashPassword } from '../../backend/auth/passwords.mjs';
import { startApi } from '../../backend/http/server.mjs';
import { registerAccountRoutes } from '../../backend/http/account-routes.mjs';
import { registerFinanceRoutes } from '../../backend/http/finance-routes.mjs';
import { registerReportRoutes } from '../../backend/http/report-routes.mjs';
import { registerPortalRoutes } from '../../backend/http/portal-routes.mjs';
import { registerAuditRoutes } from '../../backend/http/audit-routes.mjs';
import { registerExportRoutes } from '../../backend/http/export-routes.mjs';

async function unusedPort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

test('Next login and report navigation use the PostgreSQL Node API without opening SQLite',
  { skip: !process.env.TEST_DATABASE_URL, timeout: 120_000 }, async () => {
    const url = assertTestDatabaseUrl(process.env.TEST_DATABASE_URL);
    await resetTestDatabase(url);
    const pool = new pg.Pool({ connectionString: url });
    let api, next, browser;
    const sqlitePath = join(tmpdir(), `qarzhy-cutover-${randomUUID()}.sqlite`);
    let output = '';
    try {
      const org = (await pool.query("INSERT INTO qarzhy.organizations(code,name) VALUES('browser_org','Browser Org') RETURNING id")).rows[0];
      const scope = (await pool.query("INSERT INTO qarzhy.report_scopes(scope_type,organization_id) VALUES('organization',$1) RETURNING id", [org.id])).rows[0];
      const consolidated = (await pool.query("SELECT id FROM qarzhy.report_scopes WHERE scope_type='consolidated'")).rows[0];
      const dataset = (await pool.query("SELECT id FROM qarzhy.datasets WHERE kind='live'")).rows[0];
      await pool.query(`INSERT INTO qarzhy.coverage_rules
        (dataset_id,scope_id,report_family,starts_on,ends_on,source_kind)
        VALUES($1,$2,'pnl','2026-08-01','2026-09-01','events'),
          ($1,$3,'pnl','2026-08-01','2026-09-01','events')`, [dataset.id, scope.id, consolidated.id]);
      await pool.query(`INSERT INTO qarzhy.financial_events
        (dataset_id,scope_id,organization_id,occurred_on,event_kind,amount,posting_key)
        VALUES($1,$2,$3,'2026-08-12','revenue',100,'browser-revenue'),
          ($1,$2,$3,'2026-08-12','cost',40,'browser-cost')`,
      [dataset.id, scope.id, org.id]);
      const password = 'browser postgres private phrase 2026';
      const hashed = await hashPassword(password);
      await pool.query(`INSERT INTO qarzhy.users
        (username,name,role_id,organization_id,password_salt,password_hash,must_change_password,password_changed_at)
        VALUES('browserfinance','Browser Finance',(SELECT id FROM qarzhy.roles WHERE code='finance'),
          $1,$2,$3,false,now())`, [org.id, hashed.password_salt, hashed.password_hash]);
      const adminPassword = 'browser admin initial password 2026';
      const adminHash = await hashPassword(adminPassword);
      await pool.query(`INSERT INTO qarzhy.users
        (username,name,role_id,password_salt,password_hash,must_change_password)
        VALUES('browseradmin','Browser Admin',(SELECT id FROM qarzhy.roles WHERE code='admin'),
          $1,$2,true)`, [adminHash.password_salt, adminHash.password_hash]);
      const employeePassword = 'browser employee private phrase 2026';
      const employeeHash = await hashPassword(employeePassword);
      await pool.query(`INSERT INTO qarzhy.users
        (username,name,role_id,organization_id,password_salt,password_hash,must_change_password,password_changed_at)
        VALUES('browseremployee','Browser Employee',(SELECT id FROM qarzhy.roles WHERE code='employee'),
          $1,$2,$3,false,now())`, [org.id, employeeHash.password_salt, employeeHash.password_hash]);
      const nextPort = await unusedPort();
      const origin = `http://127.0.0.1:${nextPort}`;
      const services = { pool, publicOrigin: origin, csrfSecret: randomBytes(32).toString('hex') };
      api = await startApi({ pool, port: 0, registerRoutes: router => {
        registerAccountRoutes(router, services);
        registerFinanceRoutes(router, services);
        registerReportRoutes(router, services);
        registerPortalRoutes(router, services);
        registerAuditRoutes(router, services);
        registerExportRoutes(router, services);
      } });
      next = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start',
        '--hostname', '127.0.0.1', '--port', String(nextPort)], {
        cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, API_INTERNAL_URL: `http://127.0.0.1:${api.address().port}`,
          DB_PATH: sqlitePath, NEXT_TELEMETRY_DISABLED: '1' },
      });
      next.stdout.on('data', chunk => { output += chunk; });
      next.stderr.on('data', chunk => { output += chunk; });
      const deadline = Date.now() + 60_000;
      let ready = false;
      while (Date.now() < deadline) {
        if (next.exitCode !== null) throw new Error(`Next exited: ${output}`);
        try { if ((await fetch(origin)).ok) { ready = true; break; } } catch { /* startup */ }
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      if (!ready) throw new Error(`Next startup timed out: ${output}`);
      const systemChrome = 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe';
      const chrome = process.env.PLAYWRIGHT_CHROME_PATH ||
        (existsSync(systemChrome) ? systemChrome : null);
      browser = await chromium.launch({ headless: true,
        ...(chrome ? { executablePath: chrome } : {}) });
      const context = await browser.newContext();
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(origin);
      await page.locator('#login-form').waitFor();
      await page.locator('[name="username"]').fill('browserfinance');
      await page.locator('[name="password"]').fill(password);
      await page.locator('#login-form button[type="submit"]').click();
      await page.locator('[data-page="pnl"]').first().waitFor();
      assert.ok((await context.cookies()).some(cookie =>
        cookie.name === 'qarzhy_session' && cookie.httpOnly));
      const report = await page.request.get(`${origin}/api/data?month=2026-08`);
      assert.equal(report.status(), 200);
      assert.equal((await report.json()).report.profit, 60);
      for (const section of ['pnl', 'balance', 'cashflow', 'analytics', 'plans',
        'operations', 'checks', 'imports', 'settings', 'debts',
        'users', 'employee-expenses', 'financial-entries', 'admin-audit', 'account']) {
        await page.goto(`${origin}/${section}?month=2026-08`);
        await page.waitForURL(url => url.pathname === `/${section}`);
        await page.locator('.content').waitFor();
        assert.doesNotMatch(await page.locator('.content').innerText(), /\bNaN\b|\bundefined\b/);
      }
      for (const section of ['audit', 'my-expenses']) {
        await page.goto(`${origin}/${section}?source=ledger&month=2026-09`);
        await page.locator('.content').waitFor();
        assert.doesNotMatch(await page.locator('.content').innerText(), /\bNaN\b|\bundefined\b/);
      }
      const revenueMetric = (await pool.query("SELECT id FROM qarzhy.report_metrics WHERE code='live.pnl.revenue'")).rows[0];
      await page.locator('[data-page="financial-editor"]').first().click();
      await page.waitForURL(url => url.pathname === '/financial-editor');
      await page.locator('#editor-book').selectOption(`pnl-live-${scope.id}`);
      await page.locator(`[data-admin="edit-cell"][data-cell="${revenueMetric.id}:0:0"]`).click();
      await page.locator('#finance-cell-form [name="value"]').fill('120');
      await page.locator('#finance-cell-form [name="reason"]').fill('Browser report correction');
      await page.locator('#finance-cell-form button[type="submit"]').click();
      await page.locator('#finance-cell-form').waitFor({ state: 'hidden' });
      const corrected = await page.request.get(`${origin}/api/data?month=2026-08`);
      assert.equal(corrected.status(), 200);
      assert.equal((await corrected.json()).report.profit, 80);
      await page.goto(`${origin}/pnl?month=2026-08`);
      assert.match(await page.locator('.workbook-pill').innerText(), /PostgreSQL/);
      const profitRow = page.locator('.wb-pnl tr.total').filter({ has: page.locator('[data-wb-drill="profit"]') });
      assert.match(await profitRow.innerText(), /80/);
      await page.locator('[data-wb-range="ytd"]').click();
      await page.waitForURL(url => url.searchParams.get('range') === 'ytd');
      const yearToDate = await page.request.get(`${origin}/api/data?month=2026-08&range=ytd`);
      assert.equal(yearToDate.status(), 200);
      const yearToDateData = await yearToDate.json();
      assert.equal(yearToDateData.actualAvailable, false);
      assert.ok(yearToDateData.checks.some(check => /YTD P&L requires covered monthly/i.test(check.title)));
      await page.locator('button.source-warning[data-page="checks"]').waitFor();
      assert.doesNotMatch(await page.locator('.content').innerText(), /\bNaN\b|\bundefined\b/);
      await page.locator('[data-wb-range="month"]').click();
      await page.waitForURL(url => url.searchParams.get('range') !== 'ytd');
      const events = await pool.query("SELECT event_kind,amount::text FROM qarzhy.financial_events ORDER BY event_kind");
      assert.deepEqual(events.rows, [
        { event_kind: 'cost', amount: '40' },
        { event_kind: 'revenue', amount: '100' },
      ]);
      assert.equal((await pool.query('SELECT count(*)::int AS n FROM qarzhy.documents')).rows[0].n, 0);
      assert.equal((await pool.query('SELECT count(*)::int AS n FROM qarzhy.cash_movements')).rows[0].n, 0);
      assert.equal((await pool.query('SELECT count(*)::int AS n FROM qarzhy.report_override_history')).rows[0].n, 1);
      const csrf = await page.request.get(`${origin}/api/csrf`);
      assert.equal(csrf.status(), 200);
      const { csrf_token: csrfToken } = await csrf.json();
      const seeded = await page.request.post(`${origin}/api/operations`, {
        headers: { origin, 'x-csrf-token': csrfToken },
        data: { source: 'manual', external_id: 'browser-ledger-seed', date: '2026-09-05',
          org: 'Browser Org', point: 'Center', counterparty: 'Buyer One', document: 'SALE-LEDGER-1',
          kind: 'sale', amount: 1000, cost: 400, due: '2026-09-25', article: 'Books' },
      });
      assert.equal(seeded.status(), 201);
      await page.goto(`${origin}/operations?source=ledger&month=2026-09`);
      await page.locator('#ops-table').waitFor();
      assert.match(await page.locator('#ops-table').innerText(), /SALE-LEDGER-1/);
      await page.locator('[data-action="add-operation"]').click();
      const operationForm = page.locator('#operation-form');
      await operationForm.locator('[name="date"]').fill('2026-09-06');
      await operationForm.locator('[name="kind"]').selectOption('sale');
      await operationForm.locator('[name="org"]').selectOption('Browser Org');
      await operationForm.locator('[name="amount"]').fill('500');
      await operationForm.locator('[name="cost"]').fill('200');
      await operationForm.locator('[name="counterparty"]').fill('Buyer Two');
      await operationForm.locator('[name="document"]').fill('SALE-LEDGER-2');
      await operationForm.locator('[name="article"]').fill('Books');
      await operationForm.locator('button[type="submit"]').click();
      await operationForm.waitFor({ state: 'hidden' });
      assert.match(await page.locator('#ops-table').innerText(), /SALE-LEDGER-2/);
      assert.equal((await pool.query('SELECT count(*)::int AS n FROM qarzhy.portal_operations')).rows[0].n, 2);
      await page.locator('#ops-table tr').filter({ hasText: 'SALE-LEDGER-2' }).locator('[data-correct]').click();
      const correctionForm = page.locator('#correction-form');
      await correctionForm.locator('[name="amount"]').fill('600');
      await correctionForm.locator('[name="cost"]').fill('250');
      await correctionForm.locator('[name="reason"]').fill('Browser ledger correction');
      await correctionForm.locator('button[type="submit"]').click();
      await correctionForm.waitFor({ state: 'hidden' });
      assert.match(await page.locator('#ops-table tr').filter({ hasText: 'SALE-LEDGER-2' }).innerText(), /600/);
      const correctedDocuments = (await pool.query(`SELECT status,total_amount::text AS amount
        FROM qarzhy.documents WHERE number='SALE-LEDGER-2' ORDER BY id`)).rows;
      assert.deepEqual(correctedDocuments, [
        { status: 'reversed', amount: '500.00' },
        { status: 'posted', amount: '600.00' },
      ]);
      assert.equal((await pool.query('SELECT count(*)::int AS n FROM qarzhy.cash_movements')).rows[0].n, 0);
      await page.goto(`${origin}/plans?source=ledger&month=2026-09`);
      await page.locator('[data-action="add-plan"]').click();
      const planForm = page.locator('#plan-form');
      await planForm.locator('[name="date"]').fill('2026-09-12');
      await planForm.locator('[name="org"]').selectOption('Browser Org');
      await planForm.locator('[name="direction"]').selectOption('in');
      await planForm.locator('[name="amount"]').fill('700');
      await planForm.locator('[name="article"]').fill('Browser Plan');
      await planForm.locator('button[type="submit"]').click();
      await planForm.waitFor({ state: 'hidden' });
      assert.equal((await pool.query("SELECT count(*)::int AS n FROM qarzhy.payment_plans WHERE amount=700")).rows[0].n, 1);
      await page.goto(`${origin}/pnl?source=ledger&month=2026-09`);
      await page.locator('[data-action="budget"]').click();
      const budgetForm = page.locator('#budget-form');
      await budgetForm.locator('[name="org"]').selectOption('Browser Org');
      await budgetForm.locator('[name="metric"]').selectOption('revenue');
      await budgetForm.locator('[name="amount"]').fill('900');
      await budgetForm.locator('button[type="submit"]').click();
      await budgetForm.waitFor({ state: 'hidden' });
      assert.match(await page.locator('.content').innerText(), /900/);
      await page.goto(`${origin}/imports?source=ledger&month=2026-09`);
      await page.locator('[data-action="import"]').first().click();
      const importForm = page.locator('#import-form');
      const csv = 'external_id,source,date,org,point,counterparty,document,kind,amount,cost,due,article\n' +
        'browser-csv-1,browser,2026-09-13,Browser Org,Center,Buyer Three,SALE-CSV-1,sale,300,100,2026-09-30,Books\n';
      await importForm.locator('#csv-file').setInputFiles({ name: 'browser.csv',
        mimeType: 'text/csv', buffer: Buffer.from(csv) });
      await importForm.locator('[data-action="run-import"]').click();
      await importForm.locator('#import-result').waitFor();
      assert.match(await importForm.locator('#import-result').innerText(), /1/);
      assert.equal((await pool.query("SELECT count(*)::int AS n FROM qarzhy.portal_operations WHERE external_id='browser-csv-1'")).rows[0].n, 1);
      await importForm.locator('[data-action="run-import"]').click();
      await page.waitForFunction(() => document.querySelector('#import-result b')?.textContent === '0');
      assert.deepEqual(await importForm.locator('#import-result b').allInnerTexts(), ['0', '1', '0']);
      assert.equal((await pool.query("SELECT count(*)::int AS n FROM qarzhy.portal_operations WHERE external_id='browser-csv-1'")).rows[0].n, 1);
      await page.goto(`${origin}/settings?source=ledger&month=2026-09`);
      await page.locator('[data-action="period"]').click();
      const periodForm = page.locator('#period-form');
      await periodForm.locator('button[type="submit"]').click();
      await periodForm.waitFor({ state: 'hidden' });
      assert.equal((await pool.query("SELECT count(*)::int AS n FROM qarzhy.accounting_periods WHERE starts_on='2026-09-01' AND closed=true")).rows[0].n, 1);
      await page.locator('[data-action="period"]').click();
      const reopenForm = page.locator('#period-form');
      await reopenForm.locator('[name="reason"]').fill('Browser acceptance test');
      await reopenForm.locator('button[type="submit"]').click();
      await reopenForm.waitFor({ state: 'hidden' });
      assert.equal((await pool.query("SELECT count(*)::int AS n FROM qarzhy.accounting_periods WHERE starts_on='2026-09-01' AND closed=false")).rows[0].n, 1);
      assert.deepEqual(errors, []);
      assert.equal(existsSync(sqlitePath), false);
      await context.close();

      const adminContext = await browser.newContext();
      try {
        const adminPage = await adminContext.newPage();
        await adminPage.goto(origin);
        await adminPage.locator('#login-form').waitFor();
        await adminPage.locator('[name="username"]').fill('browseradmin');
        await adminPage.locator('[name="password"]').fill(adminPassword);
        await adminPage.locator('#login-form button[type="submit"]').click();
        await adminPage.locator('#password-form').waitFor();
        const previousCookie = (await adminContext.cookies()).find(cookie => cookie.name === 'qarzhy_session');
        assert.ok(previousCookie?.httpOnly);
        assert.equal((await adminPage.request.get(`${origin}/api/data?month=2026-08`)).status(), 403);
        assert.equal((await adminPage.request.get(`${origin}/api/users`)).status(), 403);
        const rotatedPassword = 'browser admin rotated password 2026';
        await adminPage.locator('#password-form [name="current_password"]').fill(adminPassword);
        await adminPage.locator('#password-form [name="new_password"]').fill(rotatedPassword);
        await adminPage.locator('#password-form [name="confirmation"]').fill(rotatedPassword);
        await adminPage.locator('#password-form button[type="submit"]').click();
        await adminPage.locator('#password-form [role="status"]').waitFor();
        await adminPage.waitForFunction(async () => {
          const response = await fetch('/api/me');
          return response.ok && (await response.json()).user.must_change_password === 0;
        });
        const newCookie = (await adminContext.cookies()).find(cookie => cookie.name === 'qarzhy_session');
        assert.ok(newCookie?.httpOnly);
        assert.notEqual(newCookie.value, previousCookie.value);
        const report = await adminPage.request.get(`${origin}/api/data?month=2026-08`);
        assert.equal(report.status(), 200);
        assert.equal((await report.json()).report.profit, 60);
        assert.equal((await adminPage.request.get(`${origin}/api/users`)).status(), 200);
      } finally { await adminContext.close(); }

      const employeeContext = await browser.newContext();
      try {
        const employeePage = await employeeContext.newPage();
        await employeePage.goto(origin);
        await employeePage.locator('#login-form').waitFor();
        await employeePage.locator('[name="username"]').fill('browseremployee');
        await employeePage.locator('[name="password"]').fill(employeePassword);
        await employeePage.locator('#login-form button[type="submit"]').click();
        await employeePage.waitForURL(url => url.pathname === '/my-expenses');
        const personal = await employeePage.request.get(`${origin}/api/data`);
        assert.equal(personal.status(), 200);
        assert.equal((await personal.json()).source, 'personal');
        assert.equal((await employeePage.request.get(`${origin}/api/users`)).status(), 403);
        assert.equal((await employeePage.request.get(`${origin}/api/reports/pnl?scope_id=${scope.id}&start=2026-08-01&end=2026-09-01`)).status(), 403);
      } finally { await employeeContext.close(); }
    } finally {
      await browser?.close();
      if (next && next.exitCode === null) {
        next.kill('SIGTERM');
        await once(next, 'exit');
      }
      if (api) await new Promise(resolve => api.close(resolve));
      await pool.end();
    }
  });
