import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';

// Copies schema and capability catalog only. Never copies users, sessions or operational data.
const source = new URL(process.env.DATABASE_URL);
if (
  !['localhost', '127.0.0.1'].includes(source.hostname) ||
  process.env.APP_ENVIRONMENT === 'PRODUCTION'
) {
  throw new Error('This helper requires a local development database.');
}
const name = `vorqix_roles_test_${Date.now()}`;
const pool = new pg.Pool({ connectionString: source.href });
await pool.query(`CREATE DATABASE "${name}" TEMPLATE template0`);
await pool.end();
const folder = resolve('var/role-tests');
mkdirSync(folder, { recursive: true });
const bin = process.env.POSTGRES_BIN ?? 'C:/Program Files/PostgreSQL/16/bin';
const env = {
  ...process.env,
  PGHOST: source.hostname,
  PGPORT: source.port,
  PGUSER: decodeURIComponent(source.username),
  PGPASSWORD: decodeURIComponent(source.password),
};
function run(command, args) {
  const result = spawnSync(`${bin}/${command}.exe`, args, {
    env,
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.status !== 0) throw new Error(result.stderr || `${command} failed`);
}
const schema = resolve(folder, 'schema.sql');
const catalog = resolve(folder, 'catalog.sql');
run('pg_dump', [
  '-d',
  source.pathname.slice(1),
  '--schema-only',
  '--no-owner',
  '--no-privileges',
  '-f',
  schema,
]);
run('pg_dump', [
  '-d',
  source.pathname.slice(1),
  '--data-only',
  '--no-owner',
  '--no-privileges',
  '-t',
  'iam.capabilities',
  '-t',
  'platform.schema_migrations',
  '-f',
  catalog,
]);
run('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-d', name, '-f', schema]);
run('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-d', name, '-f', catalog]);
writeFileSync(resolve(folder, 'database.txt'), name);
console.log(`Isolated test database ready: ${name}`);
