import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { ColemanContractError } from '@afldb/derived';

import { loadColemanContract } from '@/db/queries/coleman-inputs';
import { loadSeasonRegistry } from '@/lib/seasons/sealed-seasons';

import {
  findEnvFiles,
  findEnvFilesRecursive,
  removeEnvFiles,
} from '../tools/build/env-in-standalone.mjs';
import {
  STANDALONE_RUNTIME_FILES,
  checkRuntimeFiles,
  copyRuntimeFiles,
} from '../tools/build/standalone-runtime-files.mjs';

/**
 * AFLDB-ISSUE-220 — the web unit's credential boundary.
 *
 * `deploy/afldb.service` is the only thing standing between the
 * internet-facing process and every DSN `.env` carries: `EnvironmentFile=`
 * loads the whole file, and `UnsetEnvironment=` is a hand-typed deny list
 * that silently misses any `*_DATABASE_URL` added to `.env.example` after
 * it was last edited — AFLDB-ISSUE-146 did exactly this to the two
 * code-test DSNs, and they reached the running DEV process unnoticed
 * (AFLDB-ISSUE-220 E4/E5). This suite derives the full DSN name set from
 * `.env.example` — the tracked, complete template — on every run, rather
 * than hand-typing a second copy of the same list, so a future DSN addition
 * fails this test instead of shipping live.
 */
describe('AFLDB-ISSUE-220 — web unit credential boundary', () => {
  const unit = readFileSync('deploy/afldb.service', 'utf8');
  const envExample = readFileSync('.env.example', 'utf8');

  const KEPT = ['DATABASE_URL', 'AFLDB_AUTH_DATABASE_URL', 'AFLDB_IMPORT_DATABASE_URL'];

  const allDsnNames = Array.from(
    new Set(Array.from(envExample.matchAll(/^#?\s*([A-Z_]*DATABASE_URL)=/gm), (m) => m[1])),
  );

  it('.env.example defines DSNs beyond the three the web process keeps', () => {
    // Guards the derivation itself: if this ever shrank to 3, the
    // per-name loop below would pass vacuously and stop proving anything.
    expect(allDsnNames.length).toBeGreaterThan(KEPT.length);
    expect(allDsnNames).toEqual(expect.arrayContaining(KEPT));
  });

  it('loads .env, then keeps exactly app, auth and import', () => {
    expect(unit).toContain('EnvironmentFile=/home/arm/projects/afldb/.env');
    for (const name of KEPT) {
      expect(unit).not.toMatch(new RegExp(`^UnsetEnvironment=.*\\b${name}\\b`, 'm'));
    }
  });

  const denied = allDsnNames.filter((name) => !KEPT.includes(name));

  it('has at least one DSN left to deny', () => {
    expect(denied.length).toBeGreaterThan(0);
  });

  it.each(denied)('unsets %s', (name) => {
    expect(unit).toMatch(new RegExp(`^UnsetEnvironment=.*\\b${name}\\b`, 'm'));
  });
});

describe('AFLDB-ISSUE-220 — standalone build ships no credential file', () => {
  it('removes .env files copied into the standalone tree and leaves everything else', async () => {
    const scratch = await mkdtemp(join(tmpdir(), 'afldb-issue-220-standalone-'));
    try {
      await writeFile(join(scratch, '.env'), 'DATABASE_URL=postgresql://example\n');
      await writeFile(join(scratch, '.env.production'), 'DATABASE_URL=postgresql://example\n');
      await mkdir(join(scratch, 'static'));
      await writeFile(join(scratch, 'server.js'), '// not a credential file\n');

      const remaining = await removeEnvFiles(scratch);

      expect(remaining).toEqual([]);
      expect(await findEnvFiles(scratch)).toEqual([]);
      const untouched = await readdir(scratch);
      expect(untouched.sort()).toEqual(['server.js', 'static']);
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });

  it('prepare-standalone.mjs refuses to ship if a .env file survives removal', () => {
    const wrapper = readFileSync('tools/build/prepare-standalone.mjs', 'utf8');
    expect(wrapper).toContain('removeEnvFiles(standalone)');
    expect(wrapper).toMatch(/remainingEnvFiles\.length > 0[\s\S]*?process\.exit\(1\)/);
  });

  it('detects a nested credential file that top-level cleanup leaves, and deletes nothing nested', async () => {
    const scratch = await mkdtemp(join(tmpdir(), 'afldb-issue-220-nested-'));
    try {
      await writeFile(join(scratch, '.env'), 'DATABASE_URL=postgresql://example\n');
      await mkdir(join(scratch, 'nested', 'app'), { recursive: true });
      await writeFile(join(scratch, 'nested', 'app', '.env.production'), 'X=1\n');
      await writeFile(join(scratch, 'nested', 'app', 'server.js'), '// ordinary\n');
      await mkdir(join(scratch, 'node_modules', 'pkg'), { recursive: true });
      await writeFile(join(scratch, 'node_modules', 'pkg', 'index.js'), '// ordinary\n');
      await writeFile(join(scratch, 'node_modules', 'pkg', '.envrc-not-env'), 'ordinary\n');

      expect(await removeEnvFiles(scratch)).toEqual([]);
      expect(await findEnvFilesRecursive(scratch)).toEqual(['nested/app/.env.production']);

      // Reported, never removed; ordinary nested files are untouched.
      expect(await readFile(join(scratch, 'nested', 'app', '.env.production'), 'utf8')).toBe('X=1\n');
      expect(await readFile(join(scratch, 'nested', 'app', 'server.js'), 'utf8')).toBe('// ordinary\n');
      expect((await readdir(join(scratch, 'node_modules', 'pkg'))).sort()).toEqual([
        '.envrc-not-env',
        'index.js',
      ]);
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });

  it('reports sorted relative POSIX paths, deterministically', async () => {
    const scratch = await mkdtemp(join(tmpdir(), 'afldb-issue-220-sorted-'));
    try {
      await mkdir(join(scratch, 'z'), { recursive: true });
      await mkdir(join(scratch, 'a', 'b'), { recursive: true });
      await writeFile(join(scratch, 'z', '.env'), '');
      await writeFile(join(scratch, 'a', 'b', '.env.local'), '');
      await writeFile(join(scratch, '.env.production'), '');

      const expected = ['.env.production', 'a/b/.env.local', 'z/.env'];
      expect(await findEnvFilesRecursive(scratch)).toEqual(expected);
      expect(await findEnvFilesRecursive(scratch)).toEqual(expected);
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });

  it('never follows a symlinked directory', async () => {
    const scratch = await mkdtemp(join(tmpdir(), 'afldb-issue-220-link-'));
    const outside = await mkdtemp(join(tmpdir(), 'afldb-issue-220-outside-'));
    try {
      await writeFile(join(outside, '.env'), 'DATABASE_URL=postgresql://example\n');
      // 'junction' needs no elevation on Windows; elsewhere it is an ordinary directory symlink.
      await symlink(outside, join(scratch, 'linked'), 'junction');

      expect(await readdir(join(scratch, 'linked'))).toEqual(['.env']);
      expect(await findEnvFilesRecursive(scratch)).toEqual([]);
    } finally {
      await rm(scratch, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  it('works from names only: the helper never opens a file', () => {
    const helper = readFileSync('tools/build/env-in-standalone.mjs', 'utf8');
    expect(helper).toMatch(/import \{ readdir, rm \} from 'node:fs\/promises';/);
    expect(helper).not.toMatch(/readFile|createReadStream|\bopen\(/);
  });

  it('prepare-standalone.mjs refuses to ship if a .env-named file survives anywhere in the tree', () => {
    const wrapper = readFileSync('tools/build/prepare-standalone.mjs', 'utf8');
    expect(wrapper).toMatch(
      /const nestedEnvFiles = await findEnvFilesRecursive\(standalone\);\s*if \(nestedEnvFiles\.length > 0\) \{[\s\S]*?process\.exit\(1\);/,
    );
    // The scan runs after every copy into the tree, so nothing copied later escapes it.
    const scanAt = wrapper.indexOf('findEnvFilesRecursive(standalone)');
    for (const lastCopy of ["join(standalone, 'public')", "join(standalone, 'deploy', 'coming-soon')"]) {
      expect(wrapper.indexOf(lastCopy)).toBeGreaterThan(-1);
      expect(scanAt).toBeGreaterThan(wrapper.indexOf(lastCopy));
    }
  });
});

/**
 * V2-GAP-036 — the standalone bundle must hold every repository file the server reads at runtime
 * through a `process.cwd()` path. The production build omitted the Coleman derivation contract, so
 * every Coleman compare and publish was refused there while the repository-root suites passed.
 */
describe('V2-GAP-036 — standalone bundle ships the runtime reference files', () => {
  /**
   * How src/ names a repository file: a `'data'|'tools', …, '<name>.json'` segment list (every server
   * loader today) or one `'data/…/<name>.json'` string, in either quote style.
   */
  const PATHS = /(['"])(?:data|tools)\1(?:\s*,\s*(['"])[^'"\n]+\2)*\s*,\s*(['"])[^'"\n]+\.json\3|(['"])(?:data|tools)\/[^'"\n]+\.json\4/g;
  /** CLI-only code the server never imports (asserted below), whose paths resolve at the repository root. */
  const CLI_ONLY = 'src/lib/rollover/';

  function sourceFiles(dir = 'src'): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) return sourceFiles(path);
      return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
    });
  }

  function runtimeReadsInSrc(): Map<string, string[]> {
    const reads = new Map<string, string[]>();
    for (const path of sourceFiles().filter((p) => !p.startsWith(CLI_ONLY))) {
      for (const match of readFileSync(path, 'utf8').matchAll(PATHS)) {
        const file = Array.from(match[0].matchAll(/['"]([^'"]+)['"]/g), (m) => m[1]).join('/');
        reads.set(file, [...(reads.get(file) ?? []), path]);
      }
    }
    return reads;
  }

  it(`${CLI_ONLY} is imported by no other src/ module, so its repository paths never run in the server`, () => {
    const importers = sourceFiles().filter((p) => !p.startsWith(CLI_ONLY) && /lib\/rollover/.test(readFileSync(p, 'utf8')));
    expect(importers).toEqual([]);
  });

  it('lists every data/ and tools/ JSON file a src/ loader reads, and the Coleman contract among them', () => {
    const reads = runtimeReadsInSrc();
    // Guards the scan itself: it must keep finding the loaders this gap was about.
    expect(reads.get('data/reference/coleman-derivation.json')).toEqual(['src/db/queries/coleman-inputs.ts']);
    expect(reads.get('data/reference/seasons.json')).toEqual(['src/lib/seasons/sealed-seasons.ts']);
    for (const [file, readers] of reads) {
      expect(STANDALONE_RUNTIME_FILES, `${file} is read by ${readers.join(', ')}`).toContain(file);
    }
  });

  it('every listed file exists in the repository', () => {
    for (const file of STANDALONE_RUNTIME_FILES) expect(existsSync(file), file).toBe(true);
  });

  it('copies the files into a standalone-shaped tree, where the Coleman and season loaders read them', async () => {
    const scratch = await mkdtemp(join(tmpdir(), 'afldb-gap-036-standalone-'));
    try {
      expect((await checkRuntimeFiles(process.cwd(), scratch)).map((p) => p.file))
        .toEqual(['server.js', ...STANDALONE_RUNTIME_FILES]);
      expect((await checkRuntimeFiles(process.cwd(), scratch)).slice(1).map((p) => p.problem))
        .toEqual(STANDALONE_RUNTIME_FILES.map(() => 'missing from the bundle'));
      expect(() => loadColemanContract(scratch)).toThrow(ColemanContractError);

      await writeFile(join(scratch, 'server.js'), '// standalone entry point\n');
      await copyRuntimeFiles(process.cwd(), scratch);

      expect(await checkRuntimeFiles(process.cwd(), scratch)).toEqual([]);
      expect(loadColemanContract(scratch)).toEqual(loadColemanContract(process.cwd()));
      expect(loadSeasonRegistry(scratch)).toEqual(loadSeasonRegistry(process.cwd()));
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });

  it('reports a bundle file that differs from the repository copy', async () => {
    const scratch = await mkdtemp(join(tmpdir(), 'afldb-gap-036-differs-'));
    try {
      await writeFile(join(scratch, 'server.js'), '// standalone entry point\n');
      await copyRuntimeFiles(process.cwd(), scratch);
      await writeFile(join(scratch, 'data', 'reference', 'coleman-derivation.json'), '{}\n');
      expect(await checkRuntimeFiles(process.cwd(), scratch)).toEqual([
        { file: 'data/reference/coleman-derivation.json', problem: 'differs from the repository file' },
      ]);
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });

  it('names a file missing from the repository instead of failing the copy', async () => {
    const scratch = await mkdtemp(join(tmpdir(), 'afldb-gap-036-absent-'));
    try {
      await writeFile(join(scratch, 'server.js'), '// standalone entry point\n');
      const files = ['data/reference/seasons.json', 'data/reference/no-such-runtime-file.json'];
      await copyRuntimeFiles(process.cwd(), scratch, files);
      expect(await checkRuntimeFiles(process.cwd(), scratch, files)).toEqual([
        { file: 'data/reference/no-such-runtime-file.json', problem: 'missing from the repository' },
      ]);
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });

  it('prepare-standalone.mjs copies, then refuses to ship unless every file checks out', () => {
    const wrapper = readFileSync('tools/build/prepare-standalone.mjs', 'utf8');
    expect(wrapper).toMatch(
      /await copyRuntimeFiles\(root, standalone\);\s*const runtimeFileProblems = await checkRuntimeFiles\(root, standalone\);\s*if \(runtimeFileProblems\.length > 0\) \{[\s\S]*?process\.exit\(1\);/,
    );
    // The credential scan runs after this copy too.
    expect(wrapper.indexOf('findEnvFilesRecursive(standalone)')).toBeGreaterThan(wrapper.indexOf('copyRuntimeFiles(root, standalone)'));
  });
});

describe('AFLDB-ISSUE-220 — docs/deployment.md agrees with the unit', () => {
  const doc = readFileSync('docs/deployment.md', 'utf8');

  it('documents the current three-DSN web process boundary, not the pre-066 one', () => {
    expect(doc).not.toMatch(/holds only `DATABASE_URL`, which cannot write/);
    expect(doc).toMatch(/DATABASE_URL.*AFLDB_AUTH_DATABASE_URL.*AFLDB_IMPORT_DATABASE_URL|AFLDB_IMPORT_DATABASE_URL.*afldb_import/s);
  });

  it('lists every DSN name .env.example defines', () => {
    const envExample = readFileSync('.env.example', 'utf8');
    const allDsnNames = Array.from(
      new Set(Array.from(envExample.matchAll(/^#?\s*([A-Z_]*DATABASE_URL)=/gm), (m) => m[1])),
    );
    for (const name of allDsnNames) {
      expect(doc).toContain(name);
    }
  });
});

/**
 * AFLDB-ISSUE-352 — a scheduled backup, a weekly restore verification, an off-host copy and a monitor probe.
 *
 * `tools/maintenance/scheduled-backup.sh` WRAPS backup.sh and restore-test.sh (whose text is pinned by
 * tests/restore-test.test.sh and tests/db-promotion-check.test.ts) and is exercised here against stub tools in a sandbox:
 * no database is touched and nothing is written outside the sandbox. The real wrapper over a real cluster was rehearsed
 * separately (docs/v2/evidence/remediation-20261114/hostops/README.md).
 */
describe.runIf(process.platform === 'linux')('AFLDB-ISSUE-352 — scheduled backup wrapper and units', () => {
  const WRAPPER = join(process.cwd(), 'tools', 'maintenance', 'scheduled-backup.sh');
  const root = mkdtempSync(join(tmpdir(), 'afldb-352-'));
  const tools = join(root, 'tools');
  const bin = join(root, 'bin');
  mkdirSync(tools);
  mkdirSync(bin);
  writeFileSync(join(tools, 'backup.sh'), [
    '#!/usr/bin/env bash',
    "dir=''; while [ $# -gt 0 ]; do case $1 in --dir) dir=$2; shift 2;; *) shift;; esac; done",
    '[ "${FAKE_BACKUP_RC:-0}" != 0 ] && { echo "pg_dump failed" >&2; exit "$FAKE_BACKUP_RC"; }',
    'stamp=$(date +%Y%m%d-%H%M%S)$RANDOM; target="$dir/afldb_prod-$stamp.dump"',
    'echo "==> Backing up afldb_prod to $target"; printf "dump %s" "$stamp" > "$target"; echo "==> Done."',
  ].join('\n'));
  // restore-test.sh stub: the Nth call exits with the Nth number of FAKE_RESTORE_SEQ (comma separated; the last repeats).
  writeFileSync(join(tools, 'restore-test.sh'), [
    '#!/usr/bin/env bash',
    'n=$(cat "$FAKE_RESTORE_COUNT" 2>/dev/null || echo 0); n=$((n + 1)); echo "$n" > "$FAKE_RESTORE_COUNT"',
    'echo "restore-test stub got $1" >> "$FAKE_RESTORE_COUNT.args"',
    'IFS=, read -r -a seq <<< "${FAKE_RESTORE_SEQ:-0}"; i=$((n - 1)); [ "$i" -ge "${#seq[@]}" ] && i=$((${#seq[@]} - 1))',
    'exit "${seq[$i]}"',
  ].join('\n'));
  writeFileSync(join(bin, 'pg_restore'), '#!/usr/bin/env bash\nexit 0\n');
  for (const f of [join(tools, 'backup.sh'), join(tools, 'restore-test.sh'), join(bin, 'pg_restore')]) chmodSync(f, 0o755);

  let n = 0;
  const baseEnv = (dir: string, extra: Record<string, string | undefined> = {}) => {
    const full: Record<string, string | undefined> = {
      PATH: `${bin}:${process.env.PATH}`, HOME: root, AFLDB_BACKUP_TOOLS_DIR: tools, AFLDB_BACKUP_DIR: dir,
      AFLDB_VERIFY_RETRY_SECONDS: '0', FAKE_RESTORE_COUNT: join(root, `count${n}`), ...extra,
    };
    for (const key of Object.keys(full)) if (full[key] === undefined) delete full[key];
    return full as NodeJS.ProcessEnv;
  };
  const run = (mode: string, env: Record<string, string | undefined> = {}) => {
    n += 1;
    const dir = join(root, `case${n}`);
    const r = spawnSync('bash', [WRAPPER, mode], { encoding: 'utf8', env: baseEnv(dir, env) });
    return {
      ...r, dir, out: `${r.stdout}${r.stderr}`,
      state: (f: string) => (existsSync(join(dir, '.state', f)) ? readFileSync(join(dir, '.state', f), 'utf8') : null),
    };
  };
  const status = (dir: string) => spawnSync('bash', [WRAPPER, 'status'], { encoding: 'utf8', env: baseEnv(dir) });

  it('refuses to guess its target: no AFLDB_BACKUP_DIR, or a relative one, is a configuration error and writes nothing', () => {
    const none = run('backup', { AFLDB_BACKUP_DIR: undefined });
    expect(none.status).toBe(2);
    expect(none.out).toMatch(/AFLDB_BACKUP_DIR must be set to an absolute path \(no default/);
    expect(run('backup', { AFLDB_BACKUP_DIR: 'backups' }).status).toBe(2);
    expect(run('nonsense').status).toBe(2);
    expect(existsSync(join(root, 'backups'))).toBe(false);
  });

  it('backup: writes a verifiable sha256 sidecar and state, logs the resolved target first, drops orphaned sidecars', () => {
    const dir = join(root, `case${n + 1}`);
    mkdirSync(join(dir, '.state'), { recursive: true });
    writeFileSync(join(dir, 'afldb_prod-gone.dump.sha256'), 'x  afldb_prod-gone.dump\n'); // its dump was pruned
    const ok = run('backup');
    expect(ok.status, ok.out).toBe(0);
    expect(ok.out.split('\n')[0]).toContain(`scheduled-backup: target: mode=backup dir=${dir} keep=14 offhost=none`);
    const dump = readdirSync(dir).find((f) => f.endsWith('.dump'))!;
    expect(readdirSync(dir)).not.toContain('afldb_prod-gone.dump.sha256');
    expect(spawnSync('sha256sum', ['-c', `${dump}.sha256`], { cwd: dir }).status).toBe(0);
    expect(JSON.parse(ok.state('last-backup.json')!)).toMatchObject({ file: dump, offhost: 'skipped' });
    expect(ok.state('FAILED')).toBeNull();
  });

  it('a failing backup exits 1 and leaves a FAILED marker naming the step; the next success clears it', () => {
    const bad = run('backup', { FAKE_BACKUP_RC: '3' });
    expect(bad.status).toBe(1);
    expect(bad.out).toMatch(/AFLDB_BACKUP_FAILURE mode=backup step=backup exit=3/);
    expect(JSON.parse(bad.state('FAILED')!)).toMatchObject({ mode: 'backup', step: 'backup', exit: 3 });
    expect(status(bad.dir).status).toBe(1);
    const again = spawnSync('bash', [WRAPPER, 'backup'], { encoding: 'utf8', env: baseEnv(bad.dir) });
    expect(again.status, again.stderr).toBe(0);
    expect(existsSync(join(bad.dir, '.state', 'FAILED'))).toBe(false);
  });

  it('verify: restores the FRESH dump itself, retries a failed parity check once, and fails loudly after the second', () => {
    const pass = run('verify', { FAKE_RESTORE_SEQ: '1,0' });
    expect(pass.status, pass.out).toBe(0);
    expect(pass.out).toMatch(/restore verification failed; one retry/);
    const dump = readdirSync(pass.dir).find((f) => f.endsWith('.dump'))!;
    const arg = `restore-test stub got ${join(pass.dir, dump)}`;
    expect(readFileSync(`${join(root, `count${n}`)}.args`, 'utf8').trim().split('\n')).toEqual([arg, arg]);
    expect(JSON.parse(pass.state('last-verify.json')!)).toMatchObject({ file: dump, attempts: 2 });
    const fail = run('verify', { FAKE_RESTORE_SEQ: '1' });
    expect(fail.status).toBe(1);
    expect(JSON.parse(fail.state('FAILED')!)).toMatchObject({ mode: 'verify', step: 'restore-test' });
    expect(existsSync(join(fail.dir, '.state', 'last-verify.json'))).toBe(false); // never "verified"
  });

  it('off-host: copies, re-hashes and prunes at the destination; a missing destination keeps the local dump and fails the run', () => {
    const dest = join(root, 'offhost');
    mkdirSync(dest);
    for (const stamp of ['20250101-000000', '20250102-000000']) {
      writeFileSync(join(dest, `afldb_prod-${stamp}.dump`), 'old');
      writeFileSync(join(dest, `afldb_prod-${stamp}.dump.sha256`), 'x');
    }
    const ok = run('backup', { AFLDB_OFFHOST_DEST: dest, AFLDB_OFFHOST_KEEP: '2' });
    expect(ok.status, ok.out).toBe(0);
    const held = readdirSync(dest).filter((f) => f.endsWith('.dump'));
    expect(held).toHaveLength(2); // retention at the destination: the newest two by name
    const newest = readdirSync(ok.dir).find((f) => f.endsWith('.dump'))!;
    expect(held).toContain(newest);
    expect(spawnSync('sha256sum', ['-c', `${newest}.sha256`], { cwd: dest }).status).toBe(0);
    expect(readdirSync(dest).some((f) => f.endsWith('.partial'))).toBe(false);
    expect(JSON.parse(ok.state('last-backup.json')!).offhost).toBe('ok');

    const missing = run('backup', { AFLDB_OFFHOST_DEST: join(root, 'unmounted') });
    expect(missing.status).toBe(1);
    expect(missing.out).toMatch(/is not a directory \(a missing mount must fail, not be created\)/);
    expect(existsSync(join(root, 'unmounted'))).toBe(false);
    expect(readdirSync(missing.dir).filter((f) => f.endsWith('.dump'))).toHaveLength(1);
    expect(JSON.parse(missing.state('last-backup.json')!).offhost).toBe('failed');
    expect(JSON.parse(missing.state('FAILED')!)).toMatchObject({ step: 'offhost' });
  });

  it('status is the monitor probe: ok after a recent backup and verification, failing on staleness or a never-verified restore', () => {
    const ver = run('verify');
    expect(ver.status, ver.out).toBe(0);
    const first = status(ver.dir);
    expect(first.status, first.stdout).toBe(0);
    // A backup older than the limit fails.
    const stale = readFileSync(join(ver.dir, '.state', 'last-backup.json'), 'utf8').replace(/"epoch":\d+/, '"epoch":1000');
    writeFileSync(join(ver.dir, '.state', 'last-backup.json'), stale);
    const old = status(ver.dir);
    expect(old.stdout).toMatch(/STATUS FAIL backup: last success \d+h ago \(limit 30h\)/);
    expect(old.status).toBe(1);
    // A directory that has only ever taken backups has never proven a restore.
    const only = run('backup');
    const onlyProbe = status(only.dir);
    expect(onlyProbe.status).toBe(1);
    expect(onlyProbe.stdout).toMatch(/STATUS FAIL restore verification: never recorded/);
  });

  it('the prepared units sit outside the settle and apt windows, carry no credentials, and use a dedicated directory', () => {
    const read = (f: string) => readFileSync(join('deploy', f), 'utf8');
    const calendar = (f: string) => /^OnCalendar=(.+)$/m.exec(read(f))![1];
    const hhmm = (text: string) => { const m = /(\d{2}):(\d{2})$/.exec(text)!; return Number(m[1]) * 60 + Number(m[2]); };
    for (const timer of ['afldb-backup.timer', 'afldb-backup-verify.timer']) {
      const start = hhmm(calendar(timer));
      const random = Number(/^RandomizedDelaySec=(\d+)min$/m.exec(read(timer))![1]);
      // The whole run (start + jitter + 30 min) ends before the 05:00 settle window, after the 00:00 housekeeping jobs.
      expect(start).toBeGreaterThan(60);
      expect(start + random + 30).toBeLessThan(5 * 60);
      expect(read(timer)).toMatch(/^Persistent=true$/m);
    }
    expect(calendar('afldb-backup-verify.timer')).toMatch(/^Wed /); // not Sunday: e2scrub_all.timer 03:10
    for (const unit of ['afldb-backup.service', 'afldb-backup-verify.service']) {
      const text = read(unit);
      expect(text).not.toMatch(/^EnvironmentFile=/m); // backup.sh and restore-test.sh read .env themselves; no DSN in the unit
      expect(text).toMatch(/^Environment=AFLDB_BACKUP_DIR=\/home\/arm\/backups\/afldb-scheduled$/m);
      expect(text).not.toMatch(/AFLDB_BACKUP_DIR=\/home\/arm\/backups\/afldb$/m); // never the per-operation dump directory
      expect(text).toMatch(/^OnFailure=afldb-backup-failed\.service$/m);
      expect(text).toMatch(/^ExecStart=\/bin\/bash \/home\/arm\/projects\/afldb\/tools\/maintenance\/scheduled-backup\.sh (backup|verify)$/m);
      expect(text).toMatch(/^ReadWritePaths=\/home\/arm\/backups\/afldb-scheduled$/m);
    }
    // The wrapper wraps; it does not edit what other suites pin.
    expect(readFileSync('tools/maintenance/scheduled-backup.sh', 'utf8')).toContain('never edits or reimplements them');
  });
});
