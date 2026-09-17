import { readFileSync } from 'node:fs';
import { mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { findEnvFiles, removeEnvFiles } from '../tools/build/env-in-standalone.mjs';

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
