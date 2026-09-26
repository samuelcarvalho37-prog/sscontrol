import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

async function testFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return testFiles(path);
      return entry.isFile() && entry.name.endsWith('.test.ts') ? [path] : [];
    }),
  );
  return files.flat();
}

const files = (await testFiles('tests')).sort((left, right) => left.localeCompare(right, 'en'));
if (files.length === 0) throw new Error('Nenhum arquivo de teste foi encontrado.');

const child = spawn(
  process.execPath,
  ['--import', 'tsx', '--test', '--test-force-exit', '--test-concurrency=1', ...files],
  { env: process.env, stdio: 'inherit', windowsHide: true },
);

const [code, signal] = await once(child, 'exit');
process.exitCode = signal ? 1 : (code ?? 1);
