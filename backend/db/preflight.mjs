const REQUIRED_VERSIONS = ['0001_relational_finance', '0002_relational_source_resolution',
  '0003_node_api_security', '0004_report_overrides', '0005_portal_operations'];

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
    const historicalFamilies = (await client.query(`SELECT s.report_family,h.period_kind,
      count(*)::int AS values_count,
      count(*) FILTER (WHERE h.availability='reported')::int AS reported_count,
      count(*) FILTER (WHERE h.value<>0)::int AS nonzero_count,
      min(h.period_start)::text AS first_period,
      max(h.period_start)::text AS last_period,
      max(h.period_start) FILTER (WHERE h.value<>0)::text AS last_nonzero_period
      FROM qarzhy.historical_values h JOIN qarzhy.historical_series s ON s.id=h.series_id
      GROUP BY s.report_family,h.period_kind ORDER BY s.report_family,h.period_kind`)).rows;
    const scopeSummary = (await client.query(`SELECT rs.scope_type,
      coalesce(o.code,'ALL') AS organization,count(*)::int AS historical_series
      FROM qarzhy.historical_series s JOIN qarzhy.report_scopes rs ON rs.id=s.scope_id
      LEFT JOIN qarzhy.organizations o ON o.id=rs.organization_id
      GROUP BY rs.scope_type,o.code ORDER BY rs.scope_type,o.code`)).rows;
    const salesDimensions = (await client.query(`SELECT count(*)::int AS series,
      count(*) FILTER (WHERE channel_id IS NOT NULL)::int AS mapped_channels
      FROM qarzhy.historical_series WHERE report_family='sales'`)).rows[0];
    const cashDateRanges = (await client.query(`SELECT d.kind,count(*)::int AS movements,
      count(*) FILTER (WHERE m.organization_id IS NULL)::int AS missing_organization,
      count(*) FILTER (WHERE m.cash_account_id IS NULL)::int AS missing_cash_account,
      count(*) FILTER (WHERE m.article_id IS NULL)::int AS missing_article,
      min(m.occurred_on)::text AS first_date,max(m.occurred_on)::text AS last_date
      FROM qarzhy.cash_movements m JOIN qarzhy.datasets d ON d.id=m.dataset_id
      GROUP BY d.kind ORDER BY d.kind`)).rows;
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
        overrides: overrideCount }, coverage, historicalFamilies, scopeSummary,
      salesDimensions: { series: salesDimensions.series, mappedChannels: salesDimensions.mapped_channels },
      cashDateRanges, datasets, pnlSample };
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* preserve original failure */ }
    throw error;
  } finally { client.release(); }
}
