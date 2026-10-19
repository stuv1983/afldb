/** Local-only build/start harness. Invoke through isolated-pg run; never reads a .env. */
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { existsSync, cpSync } from 'node:fs';
import { createHash } from 'node:crypto';

const root = process.cwd();
const [mode, version] = process.argv.slice(2);
if (!['previous', 'v2'].includes(version) || process.env.AFLDB_V2_ISOLATED_PG !== '1') {
  throw new Error('usage (inside isolated-pg run): local-release.mjs build|start previous|v2');
}
const directory = version === 'previous' ? resolve(root, '.local-release/previous') : root;
const port = version === 'previous' ? '3911' : '3912';
const env = { ...process.env, NEXT_TELEMETRY_DISABLED: '1', AFLDB_BUILD_WORKERS: '4',
  HOSTNAME: '127.0.0.1', PORT: port,
  AFLDB_SESSION_SECRET: createHash('sha256').update(process.env.AFLDB_TEST_AUTH_DATABASE_URL ?? '').digest('hex') };
if (mode === 'build') {
  const build = spawnSync(process.execPath, [resolve(root, 'node_modules/next/dist/bin/next'), 'build', '--webpack'], {
    cwd: directory, env, stdio: 'inherit', shell: false,
  });
  if (build.status) process.exit(build.status);
  const prepared = spawnSync(process.execPath, ['tools/build/prepare-standalone.mjs'], {
    cwd: directory, env, stdio: 'inherit', shell: false,
  });
  process.exit(prepared.status ?? 1);
}
if (mode === 'start') {
  const server = version === 'previous'
    ? resolve(directory, '.next/standalone/.local-release/previous/server.js')
    : resolve(directory, '.next/standalone/server.js');
  if (!existsSync(server)) throw new Error(`Standalone server missing for ${version}; build first`);
  if (version === 'previous') {
    cpSync(resolve(directory, '.next/static'), resolve(server, '../.next/static'), { recursive: true });
    cpSync(resolve(directory, 'public'), resolve(server, '../public'), { recursive: true });
  }
  const child = spawnSync(process.execPath, [server], { cwd: resolve(server, '..'), env, stdio: 'inherit', shell: false });
  process.exit(child.status ?? 1);
}
throw new Error('Unknown local release mode');
