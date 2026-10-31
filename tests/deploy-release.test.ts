import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import {
  appendFileSync, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync,
  utimesSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { verifyClaim } from '../src/lib/auth/tokens';
import {
  DEFAULTS,
  classifyDrift,
  formatManifest,
  hashTree,
  isReleaseId,
  isServerOutput,
  parseArgs,
  parseExecStartNode,
  parseManifest,
  parseMeminfo,
  parseUnsetEnvironment,
  linksOutside,
  readReleaseLink,
  releaseId,
  serviceEnvironment,
  smokeClaimCookie,
  smokeLogErrors,
  switchLink,
} from '../deploy/release.mjs';

/**
 * AFLDB-ISSUE-329 — the non-destructive release route (deploy/release.mjs).
 *
 * On 2026-10-31 an in-place `npm run build` deleted the live
 * `.next/standalone` before it failed, and production served 500s for every
 * asset. The route builds in a workspace outside the serving checkout and
 * switches only a validated release into service. The first block is pure
 * and runs anywhere; the second drives the real tool on Linux, against a
 * fixture repository, through every way a build can end, while a server keeps
 * serving from `current`. Design: issues/closed/AFLDB-ISSUE-329.md.
 */

const REPO = join(__dirname, '..');
const UNIT = readFileSync(join(REPO, 'deploy', 'afldb.service'), 'utf8');
const DROP_IN = readFileSync(join(REPO, 'deploy', 'afldb.service.d', 'release-route.conf'), 'utf8');
const TOOL = readFileSync(join(REPO, 'deploy', 'release.mjs'), 'utf8');

const REV = 'a'.repeat(40);

describe('AFLDB-ISSUE-329 — release identity and manifest rules', () => {
  it('names a release by revision prefix and BUILD_ID, and refuses anything else', () => {
    expect(releaseId(REV, 'QNEHXAtU53TzUjj0Mb7mv')).toBe('aaaaaaaaaaaa-QNEHXAtU53TzUjj0Mb7mv');
    expect(isReleaseId('9ed9c9dd3e84-QNEHXAtU53TzUjj0Mb7mv')).toBe(true);
    expect(() => releaseId('9ed9c9dd', 'QNEHXAtU53TzUjj0Mb7mv')).toThrow(/40-hex/);
    expect(() => releaseId(REV, '../x')).toThrow(/BUILD_ID/);
    expect(isReleaseId('../releases')).toBe(false);
  });

  it('classifies only the server\'s own ISR output as allowed drift', () => {
    expect(isServerOutput('.next/standalone/.next/cache/fetch-cache/x')).toBe(true);
    expect(isServerOutput('.next/standalone/.next/server/app/matches/123.html')).toBe(true);
    expect(isServerOutput('.next/standalone/.next/server/app/matches/123.rsc')).toBe(true);
    expect(isServerOutput('.next/standalone/.next/server/app/matches/123.meta')).toBe(true);
    expect(isServerOutput('.next/standalone/.next/server/app/matches/123.segments/_tree.segment.rsc')).toBe(true);
    expect(isServerOutput('.next/standalone/.next/server/app/matches/[id]/page.js')).toBe(false);
    expect(isServerOutput('.next/standalone/.next/static/chunks/main.js')).toBe(false);
    expect(isServerOutput('.next/standalone/server.js')).toBe(false);
    expect(isServerOutput('deploy/server-cluster.mjs')).toBe(false);
  });

  it('fails a missing, changed or added code file and reports ISR drift without failing', () => {
    const sha = (c: string) => c.repeat(64);
    const built = [
      { path: '.next/standalone/server.js', sha256: sha('1') },
      { path: '.next/standalone/.next/static/css/a.css', sha256: sha('2') },
      { path: '.next/standalone/.next/server/app/index.html', sha256: sha('3') },
    ];
    const isrOnly = classifyDrift(built, [
      built[0], built[1],
      { path: '.next/standalone/.next/server/app/index.html', sha256: sha('9') },
      { path: '.next/standalone/.next/server/app/matches/1.html', sha256: sha('8') },
    ]);
    expect(isrOnly.ok).toBe(true);
    expect(isrOnly.serverOutput).toHaveLength(2);

    const broken = classifyDrift(built, [
      { path: '.next/standalone/server.js', sha256: sha('7') },
      { path: '.next/standalone/.next/server/app/page.js', sha256: sha('6') },
    ]);
    expect(broken.ok).toBe(false);
    expect(broken.changed).toEqual(['.next/standalone/server.js']);
    expect(broken.missing).toEqual(['.next/standalone/.next/static/css/a.css']);
    expect(broken.added).toEqual(['.next/standalone/.next/server/app/page.js']);
  });

  it('round-trips a sha256sum-format manifest in path order', () => {
    const text = formatManifest([
      { path: 'b', sha256: 'b'.repeat(64) },
      { path: 'a b', sha256: 'a'.repeat(64) },
    ]);
    expect(text).toBe(`${'a'.repeat(64)}  a b\n${'b'.repeat(64)}  b\n`);
    expect(parseManifest(text).map((e: { path: string }) => e.path)).toEqual(['a b', 'b']);
    expect(() => parseManifest('nonsense\n')).toThrow(/malformed/);
  });

  it('treats Next render failures and health errors in the smoke log as failures', () => {
    expect(smokeLogErrors('▲ Next.js 16.3.1\n✓ Ready in 412ms\n')).toEqual([]);
    expect(smokeLogErrors(' ⨯ Error: relation "x" does not exist\n')).toHaveLength(1);
    expect(smokeLogErrors('[health] database unreachable\n')).toHaveLength(1);
  });

  it('reads MemAvailable and swap from /proc/meminfo', () => {
    const mem = parseMeminfo('MemTotal:        4014400 kB\nMemFree: 1 kB\nMemAvailable:     453632 kB\nSwapTotal:             0 kB\nSwapFree: 0 kB\n');
    expect(mem).toEqual({ memTotalMb: 3920, memAvailableMb: 443, swapTotalMb: 0, swapFreeMb: 0 });
  });

  it('parses its CLI options with the documented defaults', () => {
    const { command, args, opts } = parseArgs(['promote', 'x', '--root', '/r', '--no-live']);
    expect(command).toBe('promote');
    expect(args).toEqual(['x']);
    expect(opts.root).toBe('/r');
    expect(opts['no-live']).toBe(true);
    expect(opts['heap-mb']).toBe(3072);
    expect(opts['min-available-mb']).toBe(384);
    expect(opts.typecheck).toBe('in-build');
    expect(opts['require-available-mb']).toBeUndefined();
    // Admission defaults are the measured build need plus the guard floor, per type-check mode.
    expect(DEFAULTS.requireAvailableMb).toEqual({ 'in-build': 3200, 'off-host': 2100 });
  });

  it('signs a smoke beta claim the application middleware accepts, and none without a secret', async () => {
    const env = { AFLDB_SESSION_SECRET: 'test-secret-not-real', AFLDB_BETA_EPOCH: '3' };
    const cookie = smokeClaimCookie(env);
    expect(cookie).toMatch(/^afldb_beta=[\w-]+\.[\w-]+$/);
    const token = cookie!.slice('afldb_beta='.length);
    const claim = await verifyClaim(token, env.AFLDB_SESSION_SECRET, { kind: 'beta', minEpoch: 3 });
    expect(claim).toMatchObject({ v: 1, kind: 'beta', sub: 'release-smoke', epoch: 3 });
    expect(await verifyClaim(token, 'another-secret', { kind: 'beta', minEpoch: 3 })).toBeNull();
    expect(await verifyClaim(token, env.AFLDB_SESSION_SECRET, { kind: 'beta', minEpoch: 4 })).toBeNull();
    expect(smokeClaimCookie({})).toBeNull();
  });
});

describe('AFLDB-ISSUE-329 — the boot smoke starts the candidate with the service\'s environment', () => {
  it('derives the deny list from the unit, so every DSN the unit drops is dropped', () => {
    const names = parseUnsetEnvironment(UNIT);
    expect(names).toContain('AFLDB_OWNER_DATABASE_URL');
    expect(names).toContain('AFLDB_PROD_DATABASE_URL');
    expect(names).not.toContain('DATABASE_URL');
    expect(names).not.toContain('AFLDB_IMPORT_DATABASE_URL');
  });

  it('applies EnvironmentFile, then UnsetEnvironment, then Environment=, as systemd does', () => {
    const env = serviceEnvironment(
      'DATABASE_URL=postgres://app\nAFLDB_OWNER_DATABASE_URL="postgres://owner"\nNODE_ENV=development\nPORT=3100\n',
      UNIT,
    );
    expect(env.DATABASE_URL).toBe('postgres://app');
    expect(env.AFLDB_OWNER_DATABASE_URL).toBeUndefined();
    expect(env.NODE_ENV).toBe('production');
    expect(env.HOSTNAME).toBe('127.0.0.1');
    expect(parseExecStartNode(UNIT)).toMatch(/\/bin\/node$/);
  });
});

describe('AFLDB-ISSUE-329 — the systemd drop-in and the supervisor', () => {
  it('moves only the working directory and the writable path to the release root', () => {
    expect(DROP_IN).toMatch(/^\[Service\]$/m);
    expect(DROP_IN).toMatch(/^WorkingDirectory=\/home\/arm\/afldb-releases\/current$/m);
    const writable = DROP_IN.split('\n').filter((l) => l.startsWith('ReadWritePaths='));
    expect(writable).toEqual([
      'ReadWritePaths=',
      'ReadWritePaths=/home/arm/afldb-releases/releases',
      'ReadWritePaths=-/var/www/afldb-soon',
    ]);
    // The apex path is re-added exactly as the unit grants it.
    expect(UNIT).toMatch(/^ReadWritePaths=-\/var\/www\/afldb-soon$/m);
    for (const key of ['ExecStart', 'EnvironmentFile', 'UnsetEnvironment', 'Environment', 'User', 'Protect']) {
      expect(DROP_IN).not.toMatch(new RegExp(`^${key}`, 'm'));
    }
    // ExecStart stays relative, so it resolves inside the release.
    expect(UNIT).toMatch(/^ExecStart=\S+ deploy\/server-cluster\.mjs$/m);
  });

  it('logs the build identity at every start, outside the opt-in tracing branch', () => {
    const source = readFileSync(join(REPO, 'deploy', 'server-cluster.mjs'), 'utf8');
    const identity = source.indexOf('[afldb] serving build');
    expect(identity).toBeGreaterThan(-1);
    expect(identity).toBeLessThan(source.indexOf("AFLDB_TRACE_REQUESTS === 'on'"));
  });

  it('needs nothing but Node built-ins and the env-file guard, so it runs before npm ci', () => {
    const imports = [...TOOL.matchAll(/^import .* from '([^']+)';$/gm)].map((m) => m[1]);
    expect(imports.filter((s) => !s.startsWith('node:'))).toEqual(['../tools/build/env-in-standalone.mjs']);
  });
});

// ---------------------------------------------------------------------------- Linux route test

const FIXTURE_SERVER = `'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
process.chdir(__dirname);
const types = { '.css': 'text/css; charset=utf-8', '.js': 'application/javascript' };
const staticDir = path.join(__dirname, '.next', 'static');
http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api/health') {
    const leak = 'AFLDB_OWNER_DATABASE_URL' in process.env;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', database: leak ? 'leak' : process.env.DATABASE_URL ? 'ok' : 'missing' }));
    return;
  }
  if (url.pathname === '/' || url.pathname === '/beta') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><title>fixture</title>');
    return;
  }
  if (url.pathname.startsWith('/_next/static/')) {
    const file = path.join(staticDir, url.pathname.slice('/_next/static/'.length));
    if (file.startsWith(staticDir + path.sep) && fs.existsSync(file) && fs.statSync(file).isFile()) {
      res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' });
      res.end(fs.readFileSync(file));
      return;
    }
  }
  res.writeHead(404);
  res.end('not found');
}).listen(Number(process.env.PORT), process.env.HOSTNAME || '127.0.0.1');
`;

// The fixture build behaves like `next build` where it matters: it deletes its
// own .next first, then (mode "good") writes a complete standalone bundle.
const FIXTURE_BUILD = `import fs from 'node:fs';
import crypto from 'node:crypto';
const mode = fs.readFileSync('MODE', 'utf8').trim();
fs.rmSync('.next', { recursive: true, force: true });
fs.writeFileSync('build.pid', String(process.pid));
// Like next build's type-check phase, which AFLDB_BUILD_TYPECHECK=off-host skips (next.config.ts).
if (mode === 'typefail' && process.env.AFLDB_BUILD_TYPECHECK !== 'off-host') {
  console.error('fixture: Type error: TS2339');
  process.exit(1);
}
if (mode === 'fail') {
  fs.mkdirSync('.next/static', { recursive: true });
  console.error('fixture: type error');
  process.exit(1);
}
if (mode === 'hang') setInterval(() => {}, 1 << 30);
if (mode === 'hog') {
  const held = [];
  setInterval(() => { if (held.length < 48) held.push(Buffer.alloc(64 * 1024 * 1024, 1)); }, 100);
}
if (mode === 'good') {
  const id = crypto.randomBytes(12).toString('base64url');
  const hsts = process.env.AFLDB_ENV === 'production';
  const routes = JSON.stringify({ headers: [{ source: '/:path*', headers: [{ key: hsts ? 'Strict-Transport-Security' : 'X-Frame-Options', value: 'x' }] }] });
  fs.mkdirSync(\`.next/static/\${id}\`, { recursive: true });
  fs.mkdirSync('.next/static/css', { recursive: true });
  fs.writeFileSync('.next/BUILD_ID', id);
  fs.writeFileSync('.next/routes-manifest.json', routes);
  fs.writeFileSync('.next/static/css/app.css', \`body{color:\${fs.readFileSync('COLOR', 'utf8').trim()}}\`);
  fs.writeFileSync(\`.next/static/\${id}/_buildManifest.js\`, 'self.__BUILD_MANIFEST={}');
  fs.mkdirSync('.next/standalone/.next/server/app', { recursive: true });
  fs.copyFileSync('server.template.js', '.next/standalone/server.js');
  fs.writeFileSync('.next/standalone/.next/BUILD_ID', id);
  fs.writeFileSync('.next/standalone/.next/routes-manifest.json', routes);
  fs.writeFileSync('.next/standalone/.next/server/app/page.js', 'module.exports = 1;');
  fs.cpSync('.next/static', '.next/standalone/.next/static', { recursive: true });
}
`;

interface ToolRun { code: number | null; signal: NodeJS.Signals | null; out: string }

const linux = process.platform === 'linux';

describe.runIf(linux)('AFLDB-ISSUE-329 — route on Linux: failed builds never touch the serving release', () => {
  const RELEASE = join(REPO, 'deploy', 'release.mjs');
  let base: string;
  let root: string;
  let checkout: string;
  const revs: Record<string, string> = {};
  const servePort = 41000 + Math.floor(Math.random() * 2000);
  const smokePort = servePort + 2500;
  let server: ChildProcess | null = null;
  const ids: string[] = [];

  const git = (...args: string[]) => {
    const r = spawnSync('git', ['-C', checkout, '-c', 'user.email=t@example.invalid', '-c', 'user.name=t', ...args], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
    return r.stdout.trim();
  };

  const commit = (mode: string, color: string) => {
    writeFileSync(join(checkout, 'MODE'), `${mode}\n`);
    writeFileSync(join(checkout, 'COLOR'), `${color}\n`);
    git('add', '-A');
    git('commit', '-q', '-m', mode);
    return git('rev-parse', 'HEAD');
  };

  const startTool = (args: string[]) => {
    const child = spawn(process.execPath, [RELEASE, ...args, '--root', root], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout!.on('data', (d) => { out += d; });
    child.stderr!.on('data', (d) => { out += d; });
    const done = new Promise<ToolRun>((res) => child.on('exit', (code, signal) => res({ code, signal, out })));
    return { child, done, output: () => out };
  };
  const tool = (...args: string[]) => startTool(args).done;
  const build = (rev: string, ...extra: string[]) => startTool([
    'build', '--checkout', checkout, '--revision', rev, '--afldb-env', 'production',
    '--smoke-port', String(smokePort), ...extra,
  ]);

  const waitFor = async (predicate: () => boolean, ms: number, what: string) => {
    const until = Date.now() + ms;
    while (!predicate()) {
      if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
      await new Promise((r) => setTimeout(r, 100));
    }
  };

  const fetchStatus = async (path: string) => {
    try {
      return (await fetch(`http://127.0.0.1:${servePort}${path}`, { signal: AbortSignal.timeout(2000) })).status;
    } catch {
      return 0;
    }
  };

  const startServer = async () => {
    server = spawn(process.execPath, ['deploy/server-cluster.mjs'], {
      // As systemd's WorkingDirectory: the kernel resolves `current` at chdir.
      cwd: join(root, 'current'),
      env: { PATH: process.env.PATH, PORT: String(servePort), HOSTNAME: '127.0.0.1', AFLDB_WORKERS: '1', DATABASE_URL: 'postgres://fixture' } as unknown as NodeJS.ProcessEnv,
      detached: true,
      stdio: 'ignore',
    });
    const until = Date.now() + 20_000;
    while ((await fetchStatus('/api/health')) !== 200) {
      if (Date.now() > until) throw new Error('fixture server did not start');
      await new Promise((r) => setTimeout(r, 200));
    }
  };

  const stopServer = async () => {
    if (!server) return;
    const exited = new Promise((r) => server!.once('exit', r));
    process.kill(-server.pid!, 'SIGTERM');
    await exited;
    server = null;
  };

  /** Probe the live assets every 100 ms while `run` is in flight; returns the failures seen. */
  const whileServing = async (run: () => Promise<unknown>) => {
    const failures: string[] = [];
    let probes = 0;
    let stop = false;
    const loop = (async () => {
      while (!stop) {
        for (const path of ['/_next/static/css/app.css', '/api/health']) {
          const status = await fetchStatus(path);
          probes += 1;
          if (status !== 200) failures.push(`${path} ${status}`);
        }
        await new Promise((r) => setTimeout(r, 100));
      }
    })();
    try {
      await run();
    } finally {
      stop = true;
      await loop;
    }
    expect(probes).toBeGreaterThan(5);
    return failures;
  };

  const live = () => ['--pid', String(server!.pid), '--url', `http://127.0.0.1:${servePort}`];

  const assertIntact = async (current: string, previous: string | null) => {
    expect(readReleaseLink(root, 'current')).toBe(current);
    expect(readReleaseLink(root, 'previous')).toBe(previous);
    expect(readdirSync(join(root, 'releases')).sort()).toEqual([...ids].sort());
    for (const id of ids) expect((await tool('verify', id)).code, `verify ${id}`).toBe(0);
    const status = await tool('status', '--expect', current, ...live());
    expect(status.code, status.out).toBe(0);
  };

  const buildPid = () => {
    for (const ws of readdirSync(join(root, 'builds'))) {
      const file = join(root, 'builds', ws, 'src', 'build.pid');
      if (existsSync(file)) return Number(readFileSync(file, 'utf8'));
    }
    return null;
  };
  const clearBuildPids = () => {
    for (const ws of readdirSync(join(root, 'builds'))) rmSync(join(root, 'builds', ws, 'src', 'build.pid'), { force: true });
  };
  const alive = (pid: number) => {
    try { process.kill(pid, 0); return true; } catch { return false; }
  };

  beforeAll(() => {
    base = mkdtempSync(join(tmpdir(), 'afldb-329-route-'));
    root = join(base, 'afldb-releases');
    checkout = join(base, 'checkout');
    mkdirSync(join(checkout, 'deploy'), { recursive: true });
    spawnSync('git', ['init', '-q', checkout]);
    writeFileSync(join(checkout, 'package.json'), JSON.stringify({ name: 'fx', version: '1.0.0', private: true, scripts: { build: 'node build.mjs' } }));
    writeFileSync(join(checkout, 'package-lock.json'), JSON.stringify({ name: 'fx', version: '1.0.0', lockfileVersion: 3, requires: true, packages: { '': { name: 'fx', version: '1.0.0' } } }));
    writeFileSync(join(checkout, 'build.mjs'), FIXTURE_BUILD);
    writeFileSync(join(checkout, 'server.template.js'), FIXTURE_SERVER);
    writeFileSync(join(checkout, '.gitignore'), '.env\nnode_modules/\n.next/\n');
    copyFileSync(join(REPO, 'deploy', 'server-cluster.mjs'), join(checkout, 'deploy', 'server-cluster.mjs'));
    copyFileSync(join(REPO, 'deploy', 'afldb.service'), join(checkout, 'deploy', 'afldb.service'));
    // The serving checkout's .env: the owner DSN must not reach the smoke-started server.
    writeFileSync(join(checkout, '.env'), 'DATABASE_URL=postgres://fixture-app\nAFLDB_OWNER_DATABASE_URL=postgres://fixture-owner\nPORT=3100\n');
    revs.good1 = commit('good', 'red');
    revs.fail = commit('fail', 'red');
    revs.hang = commit('hang', 'red');
    revs.hog = commit('hog', 'red');
    revs.typefail = commit('typefail', 'red');
    revs.good2 = commit('good', 'blue');
  });

  afterAll(async () => {
    await stopServer();
    if (base) rmSync(base, { recursive: true, force: true });
  });

  it('builds outside the checkout, validates, boots the candidate and promotes it', async () => {
    const run = await build(revs.good1).done;
    expect(run.code, run.out).toBe(0);
    const id = /RELEASE READY (\S+)/.exec(run.out)![1];
    ids.push(id);
    expect(id.startsWith(revs.good1.slice(0, 12))).toBe(true);
    expect(run.out).toMatch(/smoke: health ok, _buildManifest\.js 200/);
    expect(existsSync(join(checkout, '.next'))).toBe(false); // the checkout was never built in
    const info = JSON.parse(readFileSync(join(root, 'releases', id, 'release.json'), 'utf8'));
    expect(info).toMatchObject({ id, revision: revs.good1, afldbEnv: 'production', createdBy: 'build' });
    expect(info.build.peakBuildRssMb).toBeGreaterThan(0);
    expect(readdirSync(join(root, 'releases', id, '.next', 'standalone')).some((n) => n.startsWith('.env'))).toBe(false);

    const promoted = await tool('promote', id);
    expect(promoted.code, promoted.out).toBe(0);
    await startServer();
    await assertIntact(id, null);
  }, 120_000);

  it('a failing build leaves the serving release, its assets and the links untouched', async () => {
    const failures = await whileServing(async () => {
      const run = await build(revs.fail).done;
      expect(run.code).toBe(1);
      expect(run.out).toMatch(/BUILD FAILED; nothing was promoted/);
    });
    expect(failures).toEqual([]);
    await assertIntact(ids[0], null);
  }, 120_000);

  it('a type error fails the build; off-host type-checking needs recorded evidence; nothing changes', async () => {
    const failures = await whileServing(async () => {
      const run = await build(revs.typefail).done;
      expect(run.code).toBe(1);
      expect(run.out).toMatch(/build: exit 1/);
      const unproven = await build(revs.typefail, '--typecheck', 'off-host').done;
      expect(unproven.code).toBe(1);
      expect(unproven.out).toMatch(/needs --typecheck-evidence/);
    });
    expect(failures).toEqual([]);
    await assertIntact(ids[0], null);
  }, 120_000);

  for (const signal of ['SIGTERM', 'SIGHUP'] as const) {
    it(`a build interrupted by ${signal} is stopped with its whole process group; nothing changes`, async () => {
      clearBuildPids();
      const failures = await whileServing(async () => {
        const run = build(revs.hang);
        await waitFor(() => buildPid() !== null, 60_000, 'the hanging build to start');
        const pid = buildPid()!;
        run.child.kill(signal);
        const result = await run.done;
        expect(result.code).toBe(130);
        expect(result.out).toMatch(new RegExp(`${signal} received`));
        await waitFor(() => !alive(pid), 10_000, 'the build process to be killed');
      });
      expect(failures).toEqual([]);
      expect(existsSync(join(root, 'build.lock'))).toBe(false);
      await assertIntact(ids[0], null);
    }, 120_000);
  }

  it('a SIGKILLed tool leaves an orphan only in its workspace; the next build reaps it', async () => {
    clearBuildPids();
    const failures = await whileServing(async () => {
      const run = build(revs.hang);
      await waitFor(() => buildPid() !== null, 60_000, 'the hanging build to start');
      run.child.kill('SIGKILL');
      await run.done;
    });
    expect(failures).toEqual([]);
    const pid = buildPid()!;
    expect(alive(pid)).toBe(true);
    // Should the kernel have to choose, the orphan dies before PostgreSQL or the service.
    expect(readFileSync(`/proc/${pid}/oom_score_adj`, 'utf8').trim()).toBe('1000');
    expect(existsSync(join(root, 'build.lock'))).toBe(true);
    // The stale build lock does not block the links: the serving state still verifies and reports.
    await assertIntact(ids[0], null);
    // The next build breaks the stale lock and kills the orphaned group first.
    const next = await build(revs.fail).done;
    expect(next.code).toBe(1);
    expect(next.out).toMatch(/killing the orphaned process group/);
    expect(next.out).toMatch(/breaking stale build/);
    await waitFor(() => !alive(pid), 10_000, 'the orphaned build to be reaped');
    await assertIntact(ids[0], null);
  }, 120_000);

  it('the memory guard kills a build that drives MemAvailable below the floor; nothing changes', async () => {
    clearBuildPids();
    const available = parseMeminfo(readFileSync('/proc/meminfo', 'utf8')).memAvailableMb as number;
    const floor = available - 400;
    const failures = await whileServing(async () => {
      const run = await build(revs.hog, '--min-available-mb', String(floor), '--require-available-mb', '1').done;
      expect(run.code).toBe(1);
      expect(run.out).toMatch(/memory guard: MemAvailable \d+ MB < \d+ MB/);
    });
    expect(failures).toEqual([]);
    const pid = buildPid()!;
    await waitFor(() => !alive(pid), 10_000, 'the hog to be killed');
    await assertIntact(ids[0], null);
  }, 120_000);

  it('promotes a second release, then rolls back to the retained one without building, even mid-build', async () => {
    const run = await build(revs.good2).done;
    expect(run.code, run.out).toBe(0);
    const id2 = /RELEASE READY (\S+)/.exec(run.out)![1];
    ids.push(id2);
    expect((await tool('promote', id2, ...live())).code).toBe(0);
    // Switching `current` does not touch the running server: it is pinned to the release it started in.
    const stale = await tool('status', '--expect', id2, ...live());
    expect(stale.code).toBe(1);
    expect(stale.out).toMatch(/restart pending/);
    // A second promotion before that restart would make `previous` a release that never served.
    const early = await tool('promote', ids[0], ...live());
    expect(early.code).toBe(1);
    expect(early.out).toMatch(/is not running current/);
    await stopServer();
    await startServer();
    await assertIntact(id2, ids[0]);
    expect(await fetchStatus('/_next/static/css/app.css')).toBe(200);

    // Rollback needs no build and is not blocked by one in flight.
    clearBuildPids();
    const inFlight = build(revs.hang);
    await waitFor(() => buildPid() !== null, 60_000, 'a build to be in flight');
    const buildsBefore = readdirSync(join(root, 'builds')).length;
    const back = await tool('rollback');
    expect(back.code, back.out).toBe(0);
    expect(back.out).toMatch(/ROLLED BACK to \S+ \(no rebuild\)/);
    expect(back.out).toMatch(/migrations are forward-only/);
    expect(readdirSync(join(root, 'builds')).length).toBe(buildsBefore);
    inFlight.child.kill('SIGTERM');
    expect((await inFlight.done).code).toBe(130);
    await stopServer();
    await startServer();
    await assertIntact(ids[0], id2);
    const events = readFileSync(join(root, 'events.log'), 'utf8').trim().split('\n').map((l) => JSON.parse(l).op);
    expect(events).toContain('rollback-start');
    expect(events.filter((op) => op === 'status-pass').length).toBeGreaterThan(0);

    // An explicit target: forward again to id2 by name.
    const forward = await tool('rollback', '--to', id2);
    expect(forward.code, forward.out).toBe(0);
    expect(readReleaseLink(root, 'current')).toBe(id2);
    await stopServer();
    await startServer();
    await assertIntact(id2, ids[0]);
    expect((await tool('rollback')).code).toBe(0);
    await stopServer();
    await startServer();
    await assertIntact(ids[0], id2);
  }, 180_000);

  it('verify fails a tampered release and tolerates the server\'s ISR output', async () => {
    const isr = join(root, 'releases', ids[0], '.next', 'standalone', '.next', 'server', 'app', 'matches');
    mkdirSync(isr, { recursive: true });
    writeFileSync(join(isr, '1.html'), '<html></html>');
    const ok = await tool('verify', ids[0]);
    expect(ok.code, ok.out).toBe(0);
    expect(ok.out).toMatch(/server-output file\(s\) differ/);

    appendFileSync(join(root, 'releases', ids[1], '.next', 'standalone', 'server.js'), '\n// tampered\n');
    const bad = await tool('verify', ids[1]);
    expect(bad.code).toBe(1);
    expect(bad.out).toMatch(/changed 1 \[\.next\/standalone\/server\.js\]/);
    // A tampered rollback target is refused before any link moves.
    const rollback = await tool('rollback');
    expect(rollback.code).toBe(1);
    expect(readReleaseLink(root, 'current')).toBe(ids[0]);
  }, 60_000);

  it('adopt --from-manifest takes a settled regenerated ISR page live and refuses a changed code file', async () => {
    const { revision } = JSON.parse(readFileSync(join(root, 'releases', ids[0], 'release.json'), 'utf8'));
    const inPlace = join(checkout, '.next', 'standalone');
    cpSync(join(root, 'releases', ids[0], '.next', 'standalone'), inPlace, { recursive: true });
    const page = join(inPlace, '.next', 'server', 'app', 'matches', '2.html');
    writeFileSync(page, '<html>built</html>');
    const manifestFile = join(base, 'inplace.sha256');
    writeFileSync(manifestFile, formatManifest(hashTree(inPlace)).replace(/^([0-9a-f]{64}) {2}/gm, '$1  ./'));
    // The running server regenerates the page after the manifest was recorded.
    writeFileSync(page, '<html>regenerated</html>');
    const old = new Date(Date.now() - 60_000);
    utimesSync(page, old, old);
    const adopt = (adoptRoot: string) => new Promise<ToolRun>((res) => {
      const child = spawn(process.execPath, [RELEASE, 'adopt', '--checkout', checkout, '--revision', revision,
        '--afldb-env', 'production', '--from-manifest', manifestFile, '--root', adoptRoot], { stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      child.stdout!.on('data', (d) => { out += d; });
      child.stderr!.on('data', (d) => { out += d; });
      child.on('exit', (code, signal) => res({ code, signal, out }));
    });
    try {
      const good = await adopt(join(base, 'adopt-ok'));
      expect(good.code, good.out).toBe(0);
      expect(good.out).toMatch(/1 regenerated ISR file/);
      const adopted = readReleaseLink(join(base, 'adopt-ok'), 'current')!;
      const info = JSON.parse(readFileSync(join(base, 'adopt-ok', 'releases', adopted, 'release.json'), 'utf8'));
      expect(info.adoptedServerOutput).toEqual(['.next/server/app/matches/2.html']);
      expect(readFileSync(join(base, 'adopt-ok', 'releases', adopted, '.next', 'standalone', '.next', 'server', 'app', 'matches', '2.html'), 'utf8'))
        .toBe('<html>regenerated</html>');

      appendFileSync(join(inPlace, 'server.js'), '\n// changed after the manifest\n');
      const bad = await adopt(join(base, 'adopt-bad'));
      expect(bad.code).toBe(1);
      expect(bad.out).toMatch(/server\.js differs from the recorded manifest/);
      expect(existsSync(join(base, 'adopt-bad', 'current'))).toBe(false);
    } finally {
      rmSync(join(checkout, '.next'), { recursive: true, force: true });
    }
  }, 60_000);

  it('finds a symlink that leaves the release, and accepts one that stays inside', () => {
    const dir = mkdtempSync(join(tmpdir(), 'afldb-329-sym-'));
    try {
      mkdirSync(join(dir, 'a', 'b'), { recursive: true });
      writeFileSync(join(dir, 'a', 'f'), 'x');
      symlinkSync('../f', join(dir, 'a', 'b', 'inside'));
      expect(linksOutside(dir)).toEqual([]);
      symlinkSync('/etc/hostname', join(dir, 'a', 'out'));
      symlinkSync('../../..', join(dir, 'a', 'b', 'up'));
      expect(linksOutside(dir).sort()).toEqual(['a/b/up -> ../../..', 'a/out -> /etc/hostname']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('switches a link by rename and refuses a link that points outside releases/', () => {
    const dir = mkdtempSync(join(tmpdir(), 'afldb-329-link-'));
    try {
      switchLink(dir, 'current', 'releases/aaaaaaaaaaaa-B1');
      switchLink(dir, 'current', 'releases/aaaaaaaaaaaa-B2');
      expect(readReleaseLink(dir, 'current')).toBe('aaaaaaaaaaaa-B2');
      expect(readdirSync(dir)).toEqual(['current']);
      switchLink(dir, 'previous', '/etc');
      expect(() => readReleaseLink(dir, 'previous')).toThrow(/not releases/);
      expect(readReleaseLink(dir, 'absent')).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

/**
 * AFLDB-ISSUE-330 maintenance — the maintained post-install checker (deploy/post-install-check.sh).
 *
 * At ISSUE-329 B2 the frozen package's checker failed on the public previous-BUILD_ID 404 because
 * Cloudflare answered that immutable asset from cache (HIT) while the origin answered 404. The
 * maintained checker proves the previous build absent at the origin (loopback and a cache-busted
 * public request), reports an old public cache HIT separately, and still fails on genuine origin,
 * identity and asset errors. Each case runs the real script against stub curl, systemctl,
 * journalctl and node.
 */
const checkerBash = (() => {
  const r = spawnSync('bash', ['-c', 'command -v awk sha256sum >/dev/null && stat -c %s /dev/null >/dev/null'], { encoding: 'utf8' });
  return r.status === 0;
})();

describe.runIf(checkerBash)('AFLDB-ISSUE-330 — post-install check: origin absence, cache HIT, genuine failures', () => {
  const fwd = (p: string) => p.replace(/\\/g, '/');
  const ID = 'bbbbbbbbbbbb-NEWBUILD';
  const LOCAL = 'http://local.test';
  const PUBLIC = 'https://public.test';
  const OLD = '/_next/static/OLDBUILD/_buildManifest.js';
  let dir: string;
  let stubs: string;
  let rel: string;

  beforeAll(() => {
    dir = fwd(mkdtempSync(join(tmpdir(), 'afldb-pic-')));
    stubs = `${dir}/bin`;
    mkdirSync(stubs);
    const stub = (name: string, body: string) => writeFileSync(`${stubs}/${name}`, `#!/bin/bash\n${body}\n`, { mode: 0o755 });
    // Answers from $STUB_ROUTES lines "<METHOD> <url> <code> <content-type> <cf-cache-status|-> <body|->".
    stub('curl', [
      'out=; fmt=; hdr=; method=GET; url=',
      'while [ $# -gt 0 ]; do',
      '  case $1 in -o) out=$2; shift;; -w) fmt=$2; shift;; -D) hdr=$2; shift;; -X) method=$2; shift;; -m) shift;; -*) ;; *) url=$1;; esac; shift',
      'done',
      'key=$(sed -E "s/afldb-origin-check=[0-9]+/afldb-origin-check=N/" <<< "$url")',
      'line=$(awk -v m="$method" -v u="$key" \'$1 == m && $2 == u { print; exit }\' "$STUB_ROUTES")',
      'read -r _ _ code type cf body <<< "${line:-x x 404 text/html - -}"',
      'if [ -n "$hdr" ]; then { printf "HTTP/1.1 %s\\r\\ncontent-type: %s\\r\\n" "$code" "$type"; [ "$cf" = - ] || printf "cf-cache-status: %s\\r\\n" "$cf"; printf "\\r\\n"; } > "$hdr"; fi',
      'if [ -n "$out" ]; then if [ "$body" = - ]; then : > "$out"; else cat "$body" > "$out"; fi',
      'elif [ "$body" != - ]; then cat "$body"; fi',
      'w=${fmt//"%{http_code}"/$code}; w=${w//"%{content_type}"/$type}; printf "%s" "${w//"%{url_effective}"/$url}"',
    ].join('\n'));
    stub('systemctl', 'case $4 in ActiveState) echo active;; Result) echo success;; ActiveEnterTimestamp) echo "Sat 2026-10-31 18:02:55 AEDT";; MemoryCurrent) echo 154140672;; NRestarts) echo 0;; esac');
    stub('journalctl', 'cat "$STUB_JOURNAL"');
    stub('node', 'echo "release: STATUS stub"; exit "${STUB_STATUS_EXIT:-0}"');

    rel = `${dir}/root/releases/${ID}/.next/standalone/.next`;
    mkdirSync(`${rel}/static/chunks`, { recursive: true });
    mkdirSync(`${rel}/static/css`, { recursive: true });
    mkdirSync(`${dir}/root/previous/.next/standalone/.next`, { recursive: true });
    writeFileSync(`${rel}/BUILD_ID`, 'NEWBUILD');
    writeFileSync(`${dir}/root/previous/.next/standalone/.next/BUILD_ID`, 'OLDBUILD');
    writeFileSync(`${rel}/static/chunks/app.js`, `/* app */${'a'.repeat(200)}`);
    writeFileSync(`${rel}/static/css/site.css`, `/* css */${'c'.repeat(200)}`);
    writeFileSync(`${dir}/wrong.js`, `/* old */${'b'.repeat(200)}`);
    writeFileSync(`${dir}/health.json`, '{"status":"ok","database":"ok","latencyMs":1}');
    writeFileSync(`${dir}/health-bad.json`, '{"status":"degraded","database":"error"}');
    writeFileSync(`${dir}/manifest.js`, 'self.__BUILD_MANIFEST={}');
    writeFileSync(`${dir}/page.html`, '<link href="/_next/static/css/site.css"><script src="/_next/static/chunks/app.js"></script>');
    writeFileSync(`${dir}/journal`, `[afldb] primary 1 started\n[afldb] serving build NEWBUILD release ${ID} revision ${'b'.repeat(40)}\n`);
  });

  afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

  const baseRoutes = (): Record<string, string> => ({
    [`GET ${LOCAL}/api/health`]: `200 application/json - ${dir}/health.json`,
    [`GET ${PUBLIC}/api/health`]: `200 application/json DYNAMIC ${dir}/health.json`,
    [`GET ${LOCAL}/_next/static/NEWBUILD/_buildManifest.js`]: `200 application/javascript - ${dir}/manifest.js`,
    [`GET ${PUBLIC}/_next/static/NEWBUILD/_buildManifest.js`]: `200 application/javascript HIT ${dir}/manifest.js`,
    [`GET ${LOCAL}${OLD}`]: '404 text/html - -',
    [`GET ${PUBLIC}${OLD}?afldb-origin-check=N`]: '404 text/html BYPASS -',
    [`GET ${PUBLIC}${OLD}`]: '404 text/html MISS -',
    [`GET ${PUBLIC}/`]: `200 text/html DYNAMIC ${dir}/page.html`,
    [`GET ${PUBLIC}/players`]: `200 text/html DYNAMIC ${dir}/page.html`,
    [`GET ${PUBLIC}/_next/static/chunks/app.js`]: `200 application/javascript HIT ${rel}/static/chunks/app.js`,
    [`GET ${PUBLIC}/_next/static/css/site.css`]: `200 text/css HIT ${rel}/static/css/site.css`,
    [`POST ${PUBLIC}/api/admin/email-intake`]: '410 application/json DYNAMIC -',
  });

  const check = (over: Record<string, string> = {}, env: Record<string, string> = {}) => {
    const routes = { ...baseRoutes(), ...over };
    const file = `${dir}/routes-${Math.random().toString(36).slice(2)}`;
    writeFileSync(file, Object.entries(routes).map(([k, v]) => `${k} ${v}\n`).join(''));
    const r = spawnSync('bash', [fwd(join(REPO, 'deploy', 'post-install-check.sh')), ID], {
      encoding: 'utf8',
      env: {
        ...process.env, PATH: `${stubs}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH}`,
        STUB_ROUTES: file, STUB_JOURNAL: `${dir}/journal`, CHECKOUT: dir, ROOT: `${dir}/root`,
        NODE: `${stubs}/node`, LOCAL, PUBLIC, PAGES: '/ /players', ...env,
      },
    });
    return { status: r.status, out: r.stdout + r.stderr };
  };

  it('passes when the previous build is 404 everywhere, deriving it from the retained previous release', () => {
    const { status, out } = check();
    expect(out).toContain('previous OLDBUILD');
    expect(out).toContain('ok    origin (loopback) previous OLDBUILD 404');
    expect(out).toContain('ok    origin (public, cache-busted) previous OLDBUILD 404, cf-cache-status BYPASS');
    expect(out).toContain('ok    public previous OLDBUILD 404');
    expect(out).not.toMatch(/FAIL|CACHE/);
    expect(out).toContain(`POST-INSTALL CHECK PASS ${ID}\n`);
    expect(status).toBe(0);
  });

  it('reports an old Cloudflare cache HIT of the previous build separately and still passes', () => {
    const { status, out } = check({ [`GET ${PUBLIC}${OLD}`]: `200 application/javascript HIT ${dir}/manifest.js` });
    expect(out).toContain('CACHE public previous OLDBUILD 200 from an old Cloudflare cache HIT');
    expect(out).not.toContain('FAIL');
    expect(out).toContain(`POST-INSTALL CHECK PASS ${ID} (1 old Cloudflare cache HIT(s) reported above, origin 404)`);
    expect(status).toBe(0);
  });

  it('fails when the origin still serves the previous build on loopback', () => {
    const { status, out } = check({ [`GET ${LOCAL}${OLD}`]: `200 application/javascript - ${dir}/manifest.js` });
    expect(out).toContain('FAIL  origin (loopback) serves previous OLDBUILD: 200');
    expect(out).toContain('POST-INSTALL CHECK FAIL (1)');
    expect(status).toBe(1);
  });

  it('fails when the cache-busted public request reaches an origin serving the previous build, even beside a cache HIT', () => {
    const { status, out } = check({
      [`GET ${PUBLIC}${OLD}?afldb-origin-check=N`]: `200 application/javascript MISS ${dir}/manifest.js`,
      [`GET ${PUBLIC}${OLD}`]: `200 application/javascript HIT ${dir}/manifest.js`,
    });
    expect(out).toContain('FAIL  origin (public, cache-busted) serves previous OLDBUILD: 200, cf-cache-status MISS');
    expect(out).toContain('CACHE public previous OLDBUILD');
    expect(out).toContain('POST-INSTALL CHECK FAIL (1)');
    expect(status).toBe(1);
  });

  it('fails a public 200 for the previous build that is not a cache HIT', () => {
    const { status, out } = check({ [`GET ${PUBLIC}${OLD}`]: `200 application/javascript MISS ${dir}/manifest.js` });
    expect(out).toContain('FAIL  public previous OLDBUILD answered 200, cf-cache-status MISS (not a cache HIT)');
    expect(out).not.toContain('CACHE');
    expect(status).toBe(1);
  });

  it('fails when status --expect fails (identity)', () => {
    const { status, out } = check({}, { STUB_STATUS_EXIT: '1' });
    expect(out).toContain(`FAIL  status --expect ${ID}`);
    expect(status).toBe(1);
  });

  it('fails when the public health check reports a database error', () => {
    const { status, out } = check({ [`GET ${PUBLIC}/api/health`]: `200 application/json DYNAMIC ${dir}/health-bad.json` });
    expect(out).toContain(`FAIL  ${PUBLIC}/api/health`);
    expect(status).toBe(1);
  });

  it('fails a public asset whose bytes are not the release\'s, and one that is missing', () => {
    const wrong = check({ [`GET ${PUBLIC}/_next/static/chunks/app.js`]: `200 application/javascript HIT ${dir}/wrong.js` });
    expect(wrong.out).toContain(`FAIL  only 1 of 2 served assets match ${ID}'s files`);
    expect(wrong.status).toBe(1);
    const missing = check({ [`GET ${PUBLIC}/_next/static/css/site.css`]: '404 text/html - -' });
    expect(missing.out).toContain('FAIL  2 assets, 1 bad');
    expect(missing.status).toBe(1);
  });
});
