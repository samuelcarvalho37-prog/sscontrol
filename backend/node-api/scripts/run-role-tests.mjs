import { readFileSync, openSync, closeSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
const name = readFileSync('var/role-tests/database.txt', 'utf8').trim();
if (!/^vorqix_roles_test_\d+$/.test(name)) throw new Error('Invalid isolated database');
const target = new URL(process.env.DATABASE_URL);
if (!['localhost', '127.0.0.1'].includes(target.hostname)) throw new Error('Local tests only');
target.pathname = `/${name}`;
const files = process.argv.slice(2);
const logPath = `var/role-tests/results-${Date.now()}.log`;
const log = openSync(logPath, 'w');
console.log(`Running tests; output: ${logPath}`);
const result = spawnSync(
  process.execPath,
  files.length ? [
    '--import',
    'tsx',
    '--test',
    '--test-reporter=tap',
    '--test-concurrency=1',
    ...files,
  ] : [resolve(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'), 'test'],
  {
    env: {
      ...process.env,
      NODE_ENV: 'test',
      DATABASE_URL: target.href,
      TEST_DATABASE_URL: target.href,
      TEST_MIGRATION_DATABASE_URL: target.href,
    },
    stdio: ['ignore', log, log],
    windowsHide: true,
  },
);
closeSync(log);
console.log(readFileSync(logPath, 'utf8'));
process.exitCode = result.status ?? 1;
