import { randomBytes } from 'node:crypto';
import { readFile, writeFile, rm } from 'node:fs/promises';
import pg from 'pg';
import { parsePreflightSettings } from '../backend/db/preflight-config.mjs';

const mode = process.argv[2];
if (!['--check', '--apply', '--repair-session-grant'].includes(mode))
  throw new Error('Use --check, --apply, or --repair-session-grant');
const config = parsePreflightSettings(await readFile(new URL('../.env.pg-preflight.local', import.meta.url), 'utf8'));
if (config.database !== 'fin' || config.host !== '127.0.0.1' || config.port !== 5436)
  throw new Error('Unexpected PostgreSQL target');

const role = 'qarzhy_app';
const INSERT = ['login_attempts', 'sessions', 'audit_log', 'users', 'report_overrides',
  'report_override_history', 'coverage_rules', 'documents', 'document_lines',
  'financial_events', 'payment_plans', 'financial_articles', 'budget_items',
  'report_scopes', 'budget_versions', 'report_metrics', 'accounting_periods',
  'employee_expenses', 'expense_reviews', 'cash_movements', 'document_settlements',
  'counterparties', 'locations', 'portal_operations'];
const UPDATE = ['login_attempts', 'sessions', 'users', 'report_overrides', 'financial_state',
  'balance_snapshots', 'documents', 'employee_expenses', 'budget_items',
  'accounting_periods'];
const DELETE = ['sessions', 'login_attempts', 'report_overrides'];
const tables = names => names.map(name => `qarzhy.${name}`).join(',');
const client = new pg.Client(config);
await client.connect();
try {
  const target = (await client.query(`SELECT current_database() AS db,current_user AS actor,
    (SELECT rolsuper FROM pg_roles WHERE rolname=current_user) AS superuser`)).rows[0];
  if (target.db !== 'fin' || !target.superuser) throw new Error('Expected fin and an administrative migration role');
  const existing = (await client.query('SELECT rolsuper,rolcanlogin FROM pg_roles WHERE rolname=$1', [role])).rows[0];
  if (mode === '--check') {
    console.info(JSON.stringify({ database: target.db, applicationRole: role,
      present: Boolean(existing), superuser: existing?.rolsuper ?? null,
      sessionsUpdate: existing ? (await client.query(
        "SELECT has_table_privilege($1, 'qarzhy.sessions', 'UPDATE') AS allowed", [role])).rows[0].allowed : null }));
  } else if (mode === '--repair-session-grant') {
    if (!existing || existing.rolsuper || !existing.rolcanlogin)
      throw new Error('Expected an existing non-superuser application role');
    await client.query('GRANT UPDATE ON TABLE qarzhy.sessions TO qarzhy_app');
    console.info(JSON.stringify({ database: target.db, applicationRole: role,
      sessionsUpdate: true }));
  } else {
    if (existing) throw new Error('Application role already exists; refusing to rotate its password');
    const password = randomBytes(32).toString('hex');
    const csrf = randomBytes(32).toString('hex');
    const databaseUrl = new URL('postgresql://127.0.0.1:5436/fin');
    databaseUrl.username = role;
    databaseUrl.password = password;
    const backendSettings = `DATABASE_URL=${databaseUrl}\nPUBLIC_APP_ORIGIN=http://127.0.0.1:3000\nCSRF_SECRET=${csrf}\n`;
    const nextSettings = 'API_INTERNAL_URL=http://127.0.0.1:3139\n';
    let backendWritten = false, nextWritten = false, committed = false;
    try {
      await client.query('BEGIN');
      await client.query(`CREATE ROLE qarzhy_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
        NOREPLICATION NOBYPASSRLS PASSWORD '${password}'`);
      await client.query('GRANT CONNECT ON DATABASE fin TO qarzhy_app');
      await client.query('GRANT USAGE ON SCHEMA qarzhy TO qarzhy_app');
      await client.query('GRANT SELECT ON ALL TABLES IN SCHEMA qarzhy TO qarzhy_app');
      await client.query('GRANT USAGE ON ALL SEQUENCES IN SCHEMA qarzhy TO qarzhy_app');
      await client.query(`GRANT INSERT ON TABLE ${tables(INSERT)} TO qarzhy_app`);
      await client.query(`GRANT UPDATE ON TABLE ${tables(UPDATE)} TO qarzhy_app`);
      await client.query(`GRANT DELETE ON TABLE ${tables(DELETE)} TO qarzhy_app`);
      await client.query("ALTER ROLE qarzhy_app SET statement_timeout='30s'");
      await client.query("ALTER ROLE qarzhy_app SET idle_in_transaction_session_timeout='15s'");
      await writeFile(new URL('../.env.backend.local', import.meta.url), backendSettings,
        { flag: 'wx', mode: 0o600 });
      backendWritten = true;
      await writeFile(new URL('../.env.local', import.meta.url), nextSettings,
        { flag: 'wx', mode: 0o600 });
      nextWritten = true;
      await client.query('COMMIT');
      committed = true;
      console.info(JSON.stringify({ database: 'fin', applicationRole: role,
        superuser: false, configuration: ['.env.backend.local', '.env.local'] }));
    } catch (error) {
      if (!committed) {
        await client.query('ROLLBACK');
        if (nextWritten) await rm(new URL('../.env.local', import.meta.url));
        if (backendWritten) await rm(new URL('../.env.backend.local', import.meta.url));
      }
      throw error;
    }
  }
} finally { await client.end(); }
