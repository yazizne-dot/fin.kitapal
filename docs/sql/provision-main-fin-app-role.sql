-- Main fin only. Run in ONE transaction after parameterized set_config below.
-- Do not execute with a real password substituted into a saved SQL file.
DO $guard$
DECLARE app_password text := current_setting('qarzhy.provision_app_password', true);
BEGIN
 IF current_database() <> 'fin' THEN RAISE EXCEPTION 'Expected fin'; END IF;
 IF NOT EXISTS (SELECT 1 FROM qarzhy.import_batches
  WHERE fingerprint='7571a6620bb7f03f578ecb8eca24ce9f5ae2be949518032e8541c72c4ddec1f3')
 THEN RAISE EXCEPTION 'Wrong imported database'; END IF;
 IF (SELECT array_agg(version ORDER BY version) FROM qarzhy.schema_migrations)
  IS DISTINCT FROM ARRAY['0001_relational_finance','0002_relational_source_resolution',
   '0003_node_api_security','0004_report_overrides','0005_portal_operations']::text[]
 THEN RAISE EXCEPTION 'Unexpected migrations'; END IF;
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='qarzhy_app')
 THEN RAISE EXCEPTION 'qarzhy_app already exists; inspect, do not rotate password'; END IF;
 IF app_password IS NULL OR app_password !~ '^[0-9a-f]{64}$'
 THEN RAISE EXCEPTION 'Expected generated application password in transaction setting'; END IF;
 EXECUTE format('CREATE ROLE qarzhy_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L', app_password);
END $guard$;
GRANT CONNECT ON DATABASE fin TO qarzhy_app;
GRANT USAGE ON SCHEMA qarzhy TO qarzhy_app;
GRANT SELECT ON TABLE
 qarzhy.accounting_periods,
 qarzhy.asset_group_balances,
 qarzhy.audit_log,
 qarzhy.balance_snapshots,
 qarzhy.budget_items,
 qarzhy.budget_versions,
 qarzhy.cash_accounts,
 qarzhy.cash_balances,
 qarzhy.cash_movements,
 qarzhy.cash_transfers,
 qarzhy.counterparties,
 qarzhy.counterparty_balances,
 qarzhy.coverage_rules,
 qarzhy.datasets,
 qarzhy.document_lines,
 qarzhy.document_settlements,
 qarzhy.documents,
 qarzhy.employee_expenses,
 qarzhy.expense_reviews,
 qarzhy.financial_articles,
 qarzhy.financial_events,
 qarzhy.financial_state,
 qarzhy.historical_series,
 qarzhy.historical_values,
 qarzhy.import_issues,
 qarzhy.inventory_positions,
 qarzhy.locations,
 qarzhy.login_attempts,
 qarzhy.organizations,
 qarzhy.payment_plans,
 qarzhy.permissions,
 qarzhy.portal_operations,
 qarzhy.report_metrics,
 qarzhy.report_override_history,
 qarzhy.report_overrides,
 qarzhy.report_scopes,
 qarzhy.role_permissions,
 qarzhy.roles,
 qarzhy.sales_channels,
 qarzhy.schema_migrations,
 qarzhy.sessions,
 qarzhy.user_permissions,
 qarzhy.users,
 qarzhy.warehouses TO qarzhy_app;
GRANT INSERT ON TABLE
 qarzhy.login_attempts,
 qarzhy.sessions,
 qarzhy.audit_log,
 qarzhy.users,
 qarzhy.report_overrides,
 qarzhy.report_override_history,
 qarzhy.coverage_rules,
 qarzhy.documents,
 qarzhy.document_lines,
 qarzhy.financial_events,
 qarzhy.payment_plans,
 qarzhy.financial_articles,
 qarzhy.budget_items,
 qarzhy.report_scopes,
 qarzhy.budget_versions,
 qarzhy.report_metrics,
 qarzhy.accounting_periods,
 qarzhy.employee_expenses,
 qarzhy.expense_reviews,
 qarzhy.cash_movements,
 qarzhy.document_settlements,
 qarzhy.counterparties,
 qarzhy.locations,
 qarzhy.portal_operations TO qarzhy_app;
GRANT UPDATE ON TABLE
 qarzhy.login_attempts,
 qarzhy.sessions,
 qarzhy.users,
 qarzhy.report_overrides,
 qarzhy.financial_state,
 qarzhy.balance_snapshots,
 qarzhy.documents,
 qarzhy.employee_expenses,
 qarzhy.budget_items,
 qarzhy.accounting_periods,
 qarzhy.financial_articles,
 qarzhy.coverage_rules TO qarzhy_app;
GRANT DELETE ON TABLE
 qarzhy.sessions,
 qarzhy.login_attempts,
 qarzhy.report_overrides TO qarzhy_app;
-- Identity sequences only for tables into which the API inserts.
DO $sequences$
DECLARE table_name text; sequence_name text;
BEGIN
 FOREACH table_name IN ARRAY ARRAY['sessions','audit_log','users','report_overrides','report_override_history','coverage_rules','documents','document_lines','financial_events','payment_plans','financial_articles','budget_items','report_scopes','budget_versions','report_metrics','accounting_periods','employee_expenses','expense_reviews','cash_movements','document_settlements','counterparties','locations','portal_operations'] LOOP
  sequence_name := pg_get_serial_sequence('qarzhy.' || table_name, 'id');
  IF sequence_name IS NOT NULL THEN
   EXECUTE format('GRANT USAGE ON SEQUENCE %s TO qarzhy_app', sequence_name::regclass);
  END IF;
 END LOOP;
END $sequences$;
ALTER ROLE qarzhy_app SET statement_timeout='30s';
ALTER ROLE qarzhy_app SET idle_in_transaction_session_timeout='15s';
