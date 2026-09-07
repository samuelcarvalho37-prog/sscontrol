BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles
    WHERE rolname = 'fab_control_runtime'
  ) THEN
    CREATE ROLE fab_control_runtime
      NOLOGIN
      NOSUPERUSER
      NOCREATEDB
      NOCREATEROLE
      NOINHERIT
      NOBYPASSRLS;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles
    WHERE rolname = 'fab_control_readonly'
  ) THEN
    CREATE ROLE fab_control_readonly
      NOLOGIN
      NOSUPERUSER
      NOCREATEDB
      NOCREATEROLE
      NOINHERIT
      NOBYPASSRLS;
  END IF;
END;
$$;

ALTER ROLE fab_control_runtime
  NOLOGIN
  NOCREATEDB
  NOCREATEROLE
  NOINHERIT;

ALTER ROLE fab_control_readonly
  NOLOGIN
  NOCREATEDB
  NOCREATEROLE
  NOINHERIT;

DO $$
BEGIN
  EXECUTE format(
    'GRANT CONNECT ON DATABASE %I TO fab_control_runtime, fab_control_readonly',
    current_database()
  );
END;
$$;

GRANT USAGE
ON SCHEMA platform, iam, cmms, maintenance, workflow, governance, audit
TO fab_control_runtime;

GRANT USAGE
ON SCHEMA platform, iam, cmms, maintenance, workflow, governance, audit
TO fab_control_readonly;

GRANT SELECT, INSERT, UPDATE, DELETE
ON ALL TABLES IN SCHEMA platform, iam, cmms, maintenance, workflow, governance
TO fab_control_runtime;

GRANT SELECT, INSERT
ON ALL TABLES IN SCHEMA audit
TO fab_control_runtime;

REVOKE INSERT, UPDATE, DELETE
ON platform.schema_migrations
FROM fab_control_runtime;

GRANT SELECT
ON ALL TABLES IN SCHEMA platform, iam, cmms, maintenance, workflow, governance, audit
TO fab_control_readonly;

GRANT USAGE, SELECT
ON ALL SEQUENCES IN SCHEMA platform, iam, cmms, maintenance, workflow, governance, audit
TO fab_control_runtime;

GRANT SELECT
ON ALL SEQUENCES IN SCHEMA platform, iam, cmms, maintenance, workflow, governance, audit
TO fab_control_readonly;

GRANT EXECUTE
ON ALL FUNCTIONS IN SCHEMA platform, iam, cmms, maintenance, workflow, governance, audit
TO fab_control_runtime, fab_control_readonly;

ALTER DEFAULT PRIVILEGES IN SCHEMA platform
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO fab_control_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA iam
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO fab_control_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA cmms
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO fab_control_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA maintenance
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO fab_control_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA workflow
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO fab_control_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA governance
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO fab_control_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA audit
  GRANT SELECT, INSERT ON TABLES TO fab_control_runtime;

ALTER DEFAULT PRIVILEGES IN SCHEMA platform
  GRANT SELECT ON TABLES TO fab_control_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA iam
  GRANT SELECT ON TABLES TO fab_control_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA cmms
  GRANT SELECT ON TABLES TO fab_control_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA maintenance
  GRANT SELECT ON TABLES TO fab_control_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA workflow
  GRANT SELECT ON TABLES TO fab_control_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA governance
  GRANT SELECT ON TABLES TO fab_control_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA audit
  GRANT SELECT ON TABLES TO fab_control_readonly;

ALTER DEFAULT PRIVILEGES IN SCHEMA platform
  GRANT USAGE, SELECT ON SEQUENCES TO fab_control_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA iam
  GRANT USAGE, SELECT ON SEQUENCES TO fab_control_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA cmms
  GRANT USAGE, SELECT ON SEQUENCES TO fab_control_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA maintenance
  GRANT USAGE, SELECT ON SEQUENCES TO fab_control_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA workflow
  GRANT USAGE, SELECT ON SEQUENCES TO fab_control_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA governance
  GRANT USAGE, SELECT ON SEQUENCES TO fab_control_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA audit
  GRANT USAGE, SELECT ON SEQUENCES TO fab_control_runtime;

ALTER DEFAULT PRIVILEGES IN SCHEMA platform
  GRANT EXECUTE ON FUNCTIONS TO fab_control_runtime, fab_control_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA iam
  GRANT EXECUTE ON FUNCTIONS TO fab_control_runtime, fab_control_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA cmms
  GRANT EXECUTE ON FUNCTIONS TO fab_control_runtime, fab_control_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA maintenance
  GRANT EXECUTE ON FUNCTIONS TO fab_control_runtime, fab_control_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA workflow
  GRANT EXECUTE ON FUNCTIONS TO fab_control_runtime, fab_control_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA governance
  GRANT EXECUTE ON FUNCTIONS TO fab_control_runtime, fab_control_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA audit
  GRANT EXECUTE ON FUNCTIONS TO fab_control_runtime, fab_control_readonly;

REVOKE CREATE
ON SCHEMA platform, iam, cmms, maintenance, workflow, governance, audit
FROM fab_control_runtime, fab_control_readonly;

COMMIT;
