const REQUIRED_VERSIONS = ['0001_relational_finance', '0002_relational_source_resolution',
  '0003_node_api_security', '0004_report_overrides'];

export async function inspectDatabase(pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const target = (await client.query(`SELECT current_database() AS database,current_user AS role,
      current_setting('server_version') AS postgres_version`)).rows[0];
    const versions = (await client.query('SELECT version FROM qarzhy.schema_migrations ORDER BY version'))
      .rows.map(row => row.version);
    const counts = (await client.query(`SELECT
      (SELECT count(*)::int FROM qarzhy.users) AS users,
      (SELECT count(*)::int FROM qarzhy.documents) AS documents,
      (SELECT count(*)::int FROM qarzhy.payment_plans) AS payment_plans,
      (SELECT count(*)::int FROM qarzhy.cash_movements) AS cash_movements,
      (SELECT count(*)::int FROM qarzhy.financial_events) AS financial_events,
      (SELECT count(*)::int FROM qarzhy.historical_values) AS historical_values,
      (SELECT count(*)::int FROM qarzhy.datasets) AS datasets,
      (SELECT count(*)::int FROM qarzhy.import_issues WHERE status='open') AS open_import_issues,
      (SELECT count(*)::int FROM qarzhy.balance_snapshots WHERE status='verified') AS verified_openings`)).rows[0];
    const coverage = (await client.query(`SELECT report_family,source_kind,count(*)::int AS rules
      FROM qarzhy.coverage_rules GROUP BY report_family,source_kind
      ORDER BY report_family,source_kind`)).rows;
    const datasets = (await client.query(`SELECT d.kind,
      (SELECT count(*)::int FROM qarzhy.financial_events e WHERE e.dataset_id=d.id) AS events,
      (SELECT count(*)::int FROM qarzhy.cash_movements m WHERE m.dataset_id=d.id) AS movements
      FROM qarzhy.datasets d ORDER BY d.kind`)).rows;
    const pnlSample = (await client.query(`SELECT h.period_start::text AS period,m.code,m.name,h.value::text AS value
      FROM qarzhy.historical_values h
      JOIN qarzhy.historical_series s ON s.id=h.series_id
      JOIN qarzhy.report_metrics m ON m.id=s.metric_id
      WHERE s.report_family='pnl' AND h.period_kind='monthly' AND h.availability='reported'
        AND s.article_id IS NULL AND s.channel_id IS NULL
      ORDER BY h.period_start DESC,m.code LIMIT 5`)).rows;
    const overrideCount = versions.includes('0004_report_overrides')
      ? (await client.query('SELECT count(*)::int AS n FROM qarzhy.report_overrides')).rows[0].n
      : null;
    await client.query('COMMIT');
    return { ...target, versions, missingVersions: REQUIRED_VERSIONS.filter(version => !versions.includes(version)),
      counts: { users: counts.users, documents: counts.documents, paymentPlans: counts.payment_plans,
        cashMovements: counts.cash_movements, financialEvents: counts.financial_events,
        historicalValues: counts.historical_values, datasets: counts.datasets,
        openImportIssues: counts.open_import_issues, verifiedOpenings: counts.verified_openings,
        overrides: overrideCount }, coverage, datasets, pnlSample };
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* preserve original failure */ }
    throw error;
  } finally { client.release(); }
}
