import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { parsePreflightSettings } from '../backend/db/preflight-config.mjs';
import { assertSchema } from '../backend/db/connection.mjs';
import { getPnlPeriod } from '../backend/reports/pnl.mjs';

const mode = process.argv[2];
if (!['--check', '--apply'].includes(mode)) throw new Error('Use --check or --apply');
const config = parsePreflightSettings(await readFile(new URL('../.env.pg-preflight.local', import.meta.url), 'utf8'));
if (config.database !== 'fin' || config.host !== '127.0.0.1' || config.port !== 5436)
  throw new Error('Unexpected PostgreSQL target');
const pool = new pg.Pool({ ...config, max: 2 });
try {
  await assertSchema(pool);
  const target = (await pool.query(`SELECT d.id AS dataset_id,s.id AS scope_id
    FROM qarzhy.datasets d CROSS JOIN qarzhy.report_scopes s
    WHERE d.kind='imported_finance' AND s.scope_type='consolidated'
      AND s.organization_id IS NULL`)).rows;
  if (target.length !== 1) throw new Error('Expected one imported finance dataset and consolidated scope');
  const { dataset_id: datasetId, scope_id: scopeId } = target[0];
  const principal = { id: '1', role: 'admin', organization_id: null, permissions: ['finance.read'] };
  const months = [];
  for (let index = 1; index <= 8; index++) {
    const month = String(index).padStart(2, '0');
    const next = String(index + 1).padStart(2, '0');
    const period = await getPnlPeriod({ pool, principal, scopeId, source: 'historical',
      start: `2026-${month}-01`, end: `2026-${next}-01` });
    if (['revenue', 'cost', 'profit'].some(key => period.figures[key] === null) ||
      period.warnings.some(warning => ![
        'Ambiguous historical metric: profit',
        'Missing historical P&L figures: dividends',
      ].includes(warning))) throw new Error(`Unexpected P&L data in 2026-${month}`);
    months.push({ month: `2026-${month}`, revenue: period.figures.revenue,
      profit: period.figures.profit, warnings: period.warnings });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['coverage:consolidated:pnl:2026-01..08']);
    const overlap = (await client.query(`SELECT id,dataset_id,scope_id,source_kind,
      to_char(starts_on,'YYYY-MM-DD') AS starts_on,to_char(ends_on,'YYYY-MM-DD') AS ends_on
      FROM qarzhy.coverage_rules WHERE scope_id=$1 AND report_family='pnl'
        AND starts_on<'2026-09-01' AND ends_on>'2026-01-01' FOR UPDATE`, [scopeId])).rows;
    const already = overlap.length === 1 && String(overlap[0].dataset_id) === String(datasetId) &&
      overlap[0].source_kind === 'historical' && overlap[0].starts_on === '2026-01-01' &&
      overlap[0].ends_on === '2026-09-01';
    if (overlap.length && !already) throw new Error('Conflicting P&L coverage already exists');
    if (mode === '--apply' && !already) {
      await client.query(`INSERT INTO qarzhy.coverage_rules
        (dataset_id,scope_id,report_family,starts_on,ends_on,source_kind)
        VALUES($1,$2,'pnl','2026-01-01','2026-09-01','historical')`,
      [datasetId, scopeId]);
    }
    if (mode === '--apply') await client.query('COMMIT');
    else await client.query('ROLLBACK');
    console.info(JSON.stringify({ mode, coverage: already ? 'already present' : mode === '--apply' ? 'added' : 'ready',
      months }, null, 2));
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
} finally { await pool.end(); }
