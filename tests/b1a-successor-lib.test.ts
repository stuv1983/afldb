// tests | AFLDB-ISSUE-366 B1a successor: capture format, baseline binding, recovery decisions, and the P9/P10/R1/R2 blocks on stubs
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  CAPTURE_FORMAT, bindBaseline, classifyState, decideRecovery, parseAttempt, parseAttemptRecord, parseCapture, repairedImage, sha256Hex,
  type AttemptRecord, type DbLiveness, type ProcessCheck, type StateClass,
} from '../tools/v2/b1a-successor/lib';

const STAMP = '20261201T010203Z';
const IDS = 'e5ead8dbf3baf9a7b647b0f55b04c496';
const h = (c: string) => c.repeat(32);
const BASE = [
  `format|${CAPTURE_FORMAT}`, `sitting|${STAMP}`, 'identity|afldb_prod|66668|7674454702926115004', 'schema|public',
  'pss2026|not_applicable|669|0', `ids2026|669|${IDS}`,
  'cov2026|brownlow_match_votes|pending|f|-|-', 'cov2026|brownlow_round_votes|pending|f|-|-', 'cov2026|brownlow_season_total|pending|f|-|-',
  'inputs2026|complete/0/9522/final:207/0', `fp_pss_other(H1)|${h('1')}`, `fp_pss2026_nonstatus(H2)|${h('2')}`,
  `fp_stat_availability(H3)|3456|${h('3')}`, 'na_cov|0|12', 'na_pss|1340|900',
  `fp_season2026|1|${h('4')}`, 'fp_medal2026|0|-', `fp_authority2026|1|${h('5')}`, `fp_entry2026|207|${h('6')}`, `fp_round2026|9522|${h('7')}`,
];
const text = (lines: string[]) => `${lines.join('\n')}\n`;
const want = (over: Partial<Parameters<typeof bindBaseline>[1]> = {}) => ({
  sha256: sha256Hex(text(BASE)), sitting: STAMP, db: 'afldb_prod', oid: '66668', sysid: '7674454702926115004', idsMd5: IDS, ...over,
});

describe('ISSUE-366 — the v2 capture and its binding', () => {
  it('parses a complete v2 capture and binds it to one sitting, database, id set and starting state', () => {
    expect(parseCapture(text(BASE)).problems).toEqual([]);
    const b = bindBaseline(Buffer.from(text(BASE)), want());
    expect(b.problems).toEqual([]);
    expect(b.baseline).toMatchObject({ sitting: STAMP, schema: 'public', ids: { n: 669, md5: IDS } });
  });

  it('refuses a packet 6R capture by name, and any capture missing the row-content evidence', () => {
    const historical = BASE.filter((l) => !/^(format|sitting|schema|fp_(season|medal|authority|entry|round)2026)\|/.test(l));
    expect(parseCapture(text(historical)).problems.join('; ')).toMatch(/packet 6R capture cannot qualify a successor tool/);
    const noRound = BASE.filter((l) => !l.startsWith('fp_round2026|'));
    expect(parseCapture(text(noRound)).problems).toContain('fp_round2026 missing: the capture lacks the ISSUE-366 row-content evidence');
  });

  it('refuses malformed, duplicated, NULL and unknown lines', () => {
    const p = (lines: string[]) => parseCapture(text(lines)).problems.join('; ');
    expect(p([...BASE, `fp_pss_other(H1)|${h('9')}`])).toMatch(/fp_pss_other\(H1\): expected exactly one line, found 2/);
    expect(p(BASE.map((l) => (l.startsWith('fp_pss_other') ? 'fp_pss_other(H1)|-' : l)))).toMatch(/fp_pss_other\(H1\): hash malformed or NULL/);
    expect(p(BASE.map((l) => (l.startsWith('fp_entry2026') ? 'fp_entry2026|x|y' : l)))).toMatch(/fp_entry2026: expected <count>\|<md5 or ->/);
    expect(p([...BASE, 'extra|1'])).toMatch(/unknown line label "extra"/);
    expect(p(BASE.filter((l) => !l.startsWith('cov2026|brownlow_round')))).toMatch(/cov2026: expected 3 lines/);
  });

  it('binding refuses a changed byte, another sitting, another database, another id set and a non-original starting state', () => {
    const bind = (lines: string[], over = {}) => bindBaseline(Buffer.from(text(lines)), { ...want(), sha256: sha256Hex(text(lines)), ...over }).problems.join('; ');
    expect(bindBaseline(Buffer.from(text(BASE).replace('9522', '9523')), want()).problems.join()).toMatch(/baseline sha256 .* differs from the verified/);
    expect(bind(BASE, { sitting: '20261202T000000Z' })).toMatch(/baseline is for sitting 20261201T010203Z, not 20261202T000000Z/);
    expect(bind(BASE, { oid: '1' })).toMatch(/baseline identity afldb_prod\/66668\/7674454702926115004 differs/);
    expect(bind(BASE, { idsMd5: h('a') })).toMatch(/baseline ids2026 669\/.* differs/);
    expect(bind(repairedImage(BASE))).toMatch(/baseline starting status is \[pss2026\|pending\|669\|0\]/);
    expect(bind(BASE, { sha256: 'abc' })).toMatch(/must be 64 lowercase hex/);
  });

  it('classifies exactly original, exactly repaired, and everything else', () => {
    expect(repairedImage(BASE).filter((l, i) => l !== BASE[i])).toEqual(['pss2026|pending|669|0', 'na_pss|671|900']);
    expect(classifyState(BASE, BASE)).toEqual({ kind: 'original' });
    expect(classifyState(BASE, repairedImage(BASE))).toEqual({ kind: 'repaired' });
    const other = repairedImage(BASE).map((l) => (l.startsWith('fp_round2026') ? `fp_round2026|9522|${h('8')}` : l));
    expect(classifyState(BASE, other)).toMatchObject({ kind: 'other', detail: expect.stringMatching(/fp_round2026\|9522\|8{32}/) });
    const mixed = BASE.map((l) => (l.startsWith('pss2026') ? 'pss2026|not_applicable|668|0' : l)).concat('pss2026|pending|1|0');
    expect(classifyState(BASE, mixed).kind).toBe('other');
  });

  it('attempt identity names the sitting and the mode', () => {
    expect(parseAttempt(`${STAMP}-commit-1`)).toEqual({ id: `${STAMP}-commit-1`, sitting: STAMP, mode: 'commit', n: 1 });
    expect(parseAttempt(`${STAMP}-dry-1`)?.mode).toBe('dry');
    for (const bad of [STAMP, `${STAMP}-commit-0`, `${STAMP}-commit-1 --x`, '2026-12-01-commit-1', undefined]) expect(parseAttempt(bad)).toBeNull();
  });
});

describe('ISSUE-366 §1 — the recovery decision (the packet 6R R1 cases, made safe against a live attempt)', () => {
  const ATT = `${STAMP}-commit-1`;
  const none: ProcessCheck = { kind: 'none' };
  const clear: DbLiveness = { ok: true, sameAttempt: 0, otherAttempts: [], lockFree: true };
  const original: StateClass = { kind: 'original' };
  const repaired: StateClass = { kind: 'repaired' };
  const rec = (runner: string | null, block = `ATTEMPT-START ${ATT} wrapper_pid=4242 wrapper_start=99 2026-12-01T01:02:03Z\nRUNNER-PID 4243\n`): AttemptRecord =>
    parseAttemptRecord(block, runner);
  const launched = `LAUNCH {"attempt":"${ATT}","mode":"commit","pid":4243}\nLOCKED {}\n`;
  const decide = (o: { record?: AttemptRecord; pb?: ProcessCheck; pa?: ProcessCheck | null; db?: DbLiveness; da?: DbLiveness | null; state?: StateClass; probeOk?: boolean }) =>
    decideRecovery({ attempt: ATT, record: o.record ?? rec(launched), processBefore: o.pb ?? none, processAfter: o.pa === undefined ? none : o.pa,
      dbBefore: o.db ?? clear, dbAfter: o.da === undefined ? clear : o.da, probe: o.probeOk === false ? { ok: false, error: 'psql: connection refused' } : { ok: true, state: o.state ?? original } });

  it('reads the block and runner records', () => {
    const r = rec(`${launched}OUTCOME COMMIT-UNKNOWN Connection terminated unexpectedly\n`, `ATTEMPT-START ${ATT} wrapper_pid=4242 wrapper_start=99 x\nRUNNER-PID 4243\nRUNNER-EXIT 4\n`);
    expect(r).toMatchObject({ started: true, startedAttempt: ATT, wrapper: { pid: 4242, start: '99' }, runnerPid: 4243, exitCode: 4, launchAttempt: ATT,
      outcomes: ['OUTCOME COMMIT-UNKNOWN Connection terminated unexpectedly'] });
    expect(parseAttemptRecord(null, null)).toMatchObject({ started: false, wrapper: null, exitCode: null, launchAttempt: null, outcomes: [] });
  });

  it('a live attempt STOPs even when the snapshot would show the original rows (the 18 Nov race)', () => {
    expect(decide({ pb: { kind: 'live', detail: 'runner process(es) 4243 carry --attempt' }, state: original })).toEqual({ verdict: 'STOP', reason: expect.stringMatching(/is not terminal \(before the snapshot\)/) });
    expect(decide({ db: { ...clear, sameAttempt: 1 } }).reason).toMatch(/still has 1 database backend\(s\) \(before the snapshot\)/);
    expect(decide({ db: { ...clear, lockFree: false } }).reason).toMatch(/repair advisory lock is held/);
    expect(decide({ da: { ...clear, sameAttempt: 1 } }).reason).toMatch(/after the snapshot/);
    expect(decide({ pa: { kind: 'live', detail: 'block' } }).reason).toMatch(/after the snapshot/);
    expect(decide({ pa: null }).reason).toMatch(/process check after the snapshot did not run/);
    // recover.mts stops before the after-checks when the database check before the snapshot fails: the reason is that failure.
    expect(decide({ db: { ...clear, sameAttempt: 1 }, pa: null, da: null }).reason).toMatch(/still has 1 database backend\(s\) \(before the snapshot\)/);
    expect(decide({ db: { ...clear, ok: false, error: 'ECONNREFUSED' }, pa: null, da: null }).reason).toMatch(/liveness check before the snapshot failed: ECONNREFUSED/);
  });

  it('uncertain lifecycle, a failed probe and a wrong identity STOP', () => {
    expect(decide({ pb: { kind: 'error', detail: 'pgrep exit 3' } }).reason).toMatch(/process lifecycle uncertain/);
    expect(decide({ db: { ...clear, ok: false, error: 'connection refused' } }).reason).toMatch(/liveness check before the snapshot failed/);
    expect(decide({ probeOk: false }).reason).toMatch(/acceptance probe failed: psql: connection refused/);
    expect(decide({ db: { ...clear, otherAttempts: ['afldb-b1a 20261201T010203Z-commit-2'] } }).reason).toMatch(/wrong or unknown attempt identity/);
    expect(decide({ record: rec(`LAUNCH {"attempt":"${STAMP}-commit-2"}\n`) }).reason).toMatch(/runner record names attempt .*-commit-2/);
    expect(decide({ record: rec(launched, `ATTEMPT-START ${STAMP}-commit-2 wrapper_pid=1 wrapper_start=1 x\n`) }).reason).toMatch(/block record names attempt/);
  });

  it('terminal records reconcile with the pinned original or the exact repaired state', () => {
    expect(decide({ record: rec(`${launched}OUTCOME COMMITTED\n`), state: repaired })).toEqual({ verdict: 'COMMITTED', reason: 'OUTCOME COMMITTED and the exact repaired state' });
    expect(decide({ record: rec(`${launched}OUTCOME REFUSED x\n`), state: original }).verdict).toBe('NOT-COMMITTED');
    expect(decide({ record: rec(`${launched}OUTCOME ERROR canceling statement due to lock timeout\n`), state: original }).verdict).toBe('NOT-COMMITTED');
    // Historical R1 cases: COMMIT-UNKNOWN and a lost session with no OUTCOME line are decided by the (terminal) state.
    expect(decide({ record: rec(`${launched}OUTCOME COMMIT-UNKNOWN Connection terminated\n`), state: repaired }).verdict).toBe('COMMITTED');
    expect(decide({ record: rec(`${launched}OUTCOME COMMIT-UNKNOWN Connection terminated\n`), state: original }).verdict).toBe('NOT-COMMITTED');
    expect(decide({ record: rec(launched), state: repaired })).toEqual({ verdict: 'COMMITTED', reason: 'no OUTCOME line (runner exit unrecorded); terminal; the exact repaired state' });
    expect(decide({ record: rec(launched), state: original }).verdict).toBe('NOT-COMMITTED');
    expect(decide({ record: parseAttemptRecord(null, null), state: original }).verdict).toBe('NOT-COMMITTED');
  });

  it('contradictions, ALREADY-APPLIED and a mixed state STOP', () => {
    expect(decide({ record: rec(`${launched}OUTCOME COMMITTED\n`), state: original }).reason).toMatch(/contradictory: OUTCOME COMMITTED but the pinned original/);
    expect(decide({ record: rec(`${launched}OUTCOME REFUSED x\n`), state: repaired }).reason).toMatch(/contradictory: OUTCOME REFUSED but the exact repaired/);
    expect(decide({ record: rec(`${launched}OUTCOME COMMITTED\n`, `ATTEMPT-START ${ATT} wrapper_pid=1 wrapper_start=1 x\nRUNNER-EXIT 2\n`), state: repaired }).reason)
      .toMatch(/OUTCOME COMMITTED with runner exit 2/);
    expect(decide({ record: rec(`${launched}OUTCOME ALREADY-APPLIED (nothing written)\n`), state: repaired }).reason).toMatch(/already repaired before this attempt/);
    expect(decide({ record: rec(`${launched}OUTCOME DRY-RUN-PASS (rolled back)\n`) }).reason).toMatch(/dry-run outcome in the commit record/);
    expect(decide({ record: rec(`${launched}OUTCOME COMMITTED\nOUTCOME COMMITTED\n`), state: repaired }).reason).toMatch(/2 OUTCOME lines/);
    expect(decide({ record: rec(`${launched}OUTCOME SOMETHING\n`) }).reason).toMatch(/unrecognised outcome/);
    expect(decide({ state: { kind: 'other', detail: 'x' } }).reason).toMatch(/mixed or unexpected state/);
    expect(decide({ record: parseAttemptRecord(null, null), state: repaired }).reason).toMatch(/no record of a commit attempt, yet the rows are repaired/);
  });
});

/* ------------------------------------------------------------------ the successor blocks, on stubs ------------------------------------------------------------------ */

const blocksBash = spawnSync('bash', ['-c', 'command -v awk mktemp seq >/dev/null'], { encoding: 'utf8' }).status === 0;

describe.runIf(blocksBash)('ISSUE-366 — the successor sitting blocks (stub programs; no network, no database)', () => {
  const fwd = (p: string) => p.replace(/\\/g, '/');
  let dir: string; let bin: string; let chk: string; let home: string; let calls: string;
  const NEW = 'a2e6ea9995a4-TESTid_01';
  const INV = '0123456789abcdef0123456789abcdef';

  beforeAll(() => {
    dir = fwd(mkdtempSync(join(tmpdir(), 'afldb-b1a366-blocks-')));
    bin = `${dir}/bin`; chk = `${dir}/chk`; home = `${dir}/home`; calls = `${dir}/calls.log`;
    for (const d of [bin, `${chk}/deploy`, home, `${dir}/rel`]) mkdirSync(d, { recursive: true });
    const stub = (path: string, body: string) => writeFileSync(path, `#!/bin/bash\n${body}\n`, { mode: 0o755 });
    stub(`${bin}/node`, [
      'echo "node $*" >> "$CALLS"',
      'if [ "$1" = -e ]; then printf "afldb_beta=STUB-COOKIE.sig"; exit 0; fi',
      'if [ "$1" = deploy/release.mjs ]; then echo "release: stub $*"; [ "$2" = status ] && exit "${STUB_STATUS_RC:-0}"; exit 0; fi',
      'if [ "$1" = --import ] && [[ $3 == *recover.mts ]]; then printf "%b" "${STUB_RECOVER_OUT:-}"; exit "${STUB_RECOVER_RC:-0}"; fi',
      'echo "stub node: unexpected $*" >&2; exit 98',
    ].join('\n'));
    stub(`${bin}/systemctl`, 'echo "ActiveState=active"; echo "InvocationID=stub"');
    stub(`${bin}/git`, '[ "$1" = rev-parse ] && echo a2e6ea9995a44b6d5b7de7e820d17bb2e14986b5; exit 0');
    stub(`${bin}/pgrep`, 'exit 1');
    stub(`${bin}/psql`, 'cat > /dev/null; cat "$STUB_P10_ROWS"');
    stub(`${bin}/curl`, [
      'echo "curl $*" >> "$CALLS"',
      'out=; fmt=; url=; cookie=0',
      'while [ $# -gt 0 ]; do case $1 in -o) out=$2; shift 2;; -w) fmt=$2; shift 2;; -H) [[ $2 == Cookie:* ]] && cookie=1; shift 2;; -m) shift 2;; -s) shift;; *) url=$1; shift;; esac; done',
      'code=404; loc=; body=',
      'case $url in',
      '  */players/*) if [ $cookie = 1 ]; then n=$(( $(cat "$STUB_N" 2>/dev/null || echo 0) + 1 )); echo $n > "$STUB_N"',
      '      code=${STUB_PLAYER_CODE:-200}; body=$(cat "$STUB_PAGE_BODY"); [ "$n" = "${STUB_BAD_AT:-0}" ] && code=500',
      '    else slug=${url##*/}; code=${STUB_ANON_CODE:-307}; loc=${STUB_ANON_LOCATION-http://127.0.0.1:3000/beta?from=%2Fplayers%2F$slug}; fi;;',
      '  */seasons/2026) code=${STUB_SEASON_CODE:-200}; body=${STUB_SEASON_BODY-"<p>No votes recorded for 2026</p>"};;',
      '  */brownlow/2026) code=${STUB_BROWNLOW_CODE:-404};;',
      'esac',
      '[ -n "$out" ] && printf "%s" "$body" > "$out"',
      'w=${fmt//"%{http_code}"/$code}; printf "%s" "${w//"%{redirect_url}"/$loc}"',
    ].join('\n'));
    stub(`${chk}/deploy/post-install-check.sh`, 'echo "post-install-check $*" >> "$CALLS"; echo "post-install-check stub"; exit "${STUB_PIC_RC:-0}"');
    writeFileSync(`${chk}/.env`, ['AFLDB_BACKUP_DATABASE_URL=postgres://afldb_backup:p%40ss@127.0.0.1:5432/afldb_prod', 'AFLDB_SESSION_SECRET=x',
      'AFLDB_BETA_EPOCH=1', 'PORT=3000', ''].join('\n'));
    // The historical tests-p10p11.sh fixtures: four eligible players (Pendlebury first, one debutant), and the two page texts.
    writeFileSync(`${dir}/rows4.txt`, ['cand|scott-pendlebury-11724|pending|0', 'cand|a-b-9235|pending|0', 'cand|c-d-9910|pending|0', 'cand|e-f-10130|pending|0', 'debut|g-h-13001|pending|0', ''].join('\n'));
    writeFileSync(`${dir}/rows-few.txt`, ['cand|scott-pendlebury-11724|pending|0', 'cand|a-b-9235|pending|3', 'cand|c-d-9910|pending|1', 'debut|g-h-13001|pending|0', ''].join('\n'));
    writeFileSync(`${dir}/page-new.html`, '<td>Not yet awarded</td><span>The season is still in progress; the Brownlow Medal has not been awarded</span>');
    writeFileSync(`${dir}/page-old.html`, '<td>No medal</td><span>No Brownlow Medal was awarded for this season</span>');
  });
  afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

  const block = (name: string, args: string[], env: Record<string, string> = {}) => {
    writeFileSync(calls, '');
    writeFileSync(`${dir}/n`, '0');
    const src = readFileSync(join(process.cwd(), 'tools', 'v2', 'b1a-successor', 'sitting', name), 'utf8').replace(/\r/g, '');
    const r = spawnSync('bash', ['-s', '--', ...args], {
      input: src, encoding: 'utf8',
      env: { ...process.env, PATH: `${bin}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH}`, CALLS: calls, STUB_N: `${dir}/n`,
        B1A_NODE_BIN: bin, B1A_CHECKOUT: chk, B1A_HOME: home, B1A_ROOT: `${dir}/rel`, ...env },
    });
    return { code: r.status, out: `${r.stdout}${r.stderr}`, calls: readFileSync(calls, 'utf8') };
  };

  describe('P10: every control is part of the verdict', () => {
    const p10 = (env: Record<string, string>, mode = 'after') => block('p10-pages.sh', [mode], { STUB_P10_ROWS: `${dir}/rows4.txt`, STUB_PAGE_BODY: `${dir}/page-new.html`, ...env });
    const verdict = (out: string) => JSON.parse(/^P10 VERDICT (\{.*\})$/m.exec(out)![1]);

    it('all 64 samples and all three controls good: PASS, exit 0, the cookie never printed', () => {
      const r = p10({});
      expect(r.out).toContain('selected: scott-pendlebury-11724 a-b-9235 c-d-9910 g-h-13001');
      expect(r.out).toContain('P10 RESULT after PASS (64 samples, 3 controls)');
      expect(r.out).toContain('P10 CHECK anon        PASS code=307 location=http://127.0.0.1:3000/beta?from=%2Fplayers%2Fscott-pendlebury-11724');
      expect(r.out).toContain('P10 CHECK manual-browser NOT-RECORDED');
      expect(verdict(r.out)).toMatchObject({ mode: 'after', players: { result: 'PASS', samples: 64, bad: 0 },
        anon: { result: 'PASS', code: '307' }, season2026: { result: 'PASS', code: '200', novotes: 1 }, brownlow2026: { result: 'PASS', code: '404' }, manualBrowser: 'not-recorded', pass: true });
      expect(r.out).not.toContain('STUB-COOKIE');
      expect(r.code).toBe(0);
    });

    for (const [name, env, check] of [
      ['anonymous request not redirected (200)', { STUB_ANON_CODE: '200', STUB_ANON_LOCATION: '' }, 'anon'],
      ['anonymous redirect with another status (302)', { STUB_ANON_CODE: '302' }, 'anon'],
      ['anonymous 307 to the wrong return path', { STUB_ANON_LOCATION: 'http://127.0.0.1:3000/beta?from=%2Fplayers%2Fsomeone-else-1' }, 'anon'],
      ['anonymous 307 without a Location', { STUB_ANON_LOCATION: '' }, 'anon'],
      ['anonymous 307 to a page other than the gate', { STUB_ANON_LOCATION: 'http://127.0.0.1:3000/players/scott-pendlebury-11724' }, 'anon'],
      ['season page HTTP 500', { STUB_SEASON_CODE: '500' }, 'season2026'],
      ['season page without the no-votes text', { STUB_SEASON_BODY: '<p>2026</p>' }, 'season2026'],
      ['Brownlow page 200', { STUB_BROWNLOW_CODE: '200' }, 'brownlow2026'],
    ] as const) {
      it(`${name}, with all 64 player samples good: FAIL, exit 1`, () => {
        const r = p10(env);
        const v = verdict(r.out);
        expect(v.players.result).toBe('PASS');
        expect(v[check].result).toBe('FAIL');
        expect(v.pass).toBe(false);
        expect(r.out).toMatch(/^P10 RESULT after FAIL: /m);
        expect(r.out).not.toContain('after PASS');
        expect(r.code).toBe(1);
      });
    }

    it('one bad player sample with good controls: FAIL, exit 1', () => {
      const r = p10({ STUB_BAD_AT: '60' }); // requests 1-48 are the warm-up pass
      expect(r.out).toContain('P10 CHECK players     FAIL samples=64 bad=1');
      expect(verdict(r.out)).toMatchObject({ anon: { result: 'PASS' }, season2026: { result: 'PASS' }, brownlow2026: { result: 'PASS' }, pass: false });
      expect(r.code).toBe(1);
    });

    it('the historical scenarios: stale text after, HTTP 500, baseline with the old text, too few eligible players', () => {
      const stale = p10({ STUB_PAGE_BODY: `${dir}/page-old.html` });
      expect(stale.out).toContain('P10 CHECK players     FAIL samples=64 bad=64');
      expect(stale.code).toBe(1);
      const http500 = p10({ STUB_PLAYER_CODE: '500' });
      expect(http500.out).toContain('bad=64');
      expect(http500.code).toBe(1);
      const baseline = p10({ STUB_PAGE_BODY: `${dir}/page-old.html` }, 'baseline');
      expect(baseline.out).toContain('P10 RESULT baseline PASS (64 samples, 3 controls)');
      expect(baseline.code).toBe(0);
      const few = p10({ STUB_P10_ROWS: `${dir}/rows-few.txt` });
      expect(few.out).toMatch(/STOP line/);
      expect(few.out).not.toContain('P10 RESULT');
      expect(few.calls).not.toContain('curl');
      expect(few.code).not.toBe(0);
    });
  });

  describe('P9 and R2 verify: an owner-attested restart reaches S7 and S8 alike', () => {
    it('without an InvocationID neither check is told anything (the ordinary path)', () => {
      const r = block('p9-s7s8-checks.sh', [NEW]);
      expect(r.calls).toMatch(new RegExp(`^node deploy/release.mjs status --expect ${NEW}$`, 'm'));
      expect(r.calls).toMatch(new RegExp(`^post-install-check ${NEW}$`, 'm'));
      expect(r.calls).not.toContain('confirm');
      expect(r.out).toContain('P9 RESULT S7+S8 PASS');
      expect(r.code).toBe(0);
    });
    it('with the attested InvocationID, S7 and the nested S8 call both receive it', () => {
      const r = block('p9-s7s8-checks.sh', [NEW, INV]);
      expect(r.calls).toMatch(new RegExp(`^node deploy/release.mjs status --expect ${NEW} --confirm-restart-invocation ${INV}$`, 'm'));
      expect(r.calls).toMatch(new RegExp(`^post-install-check --confirm-restart-invocation ${INV} ${NEW}$`, 'm'));
      expect(r.out).toContain(`P9 RESULT S7+S8 PASS (restart ${INV} owner-attested)`);
      expect(r.code).toBe(0);
    });
    it('a failing S7 or S8 propagates, and malformed arguments stop before any check', () => {
      const s7 = block('p9-s7s8-checks.sh', [NEW, INV], { STUB_STATUS_RC: '1' });
      expect(s7.out).toMatch(/STOP line/); expect(s7.calls).not.toContain('post-install-check'); expect(s7.code).not.toBe(0);
      const s8 = block('p9-s7s8-checks.sh', [NEW, INV], { STUB_PIC_RC: '1' });
      expect(s8.out).not.toContain('P9 RESULT'); expect(s8.code).not.toBe(0);
      for (const args of [[NEW, 'x;id'], ['not-a-release', INV]]) {
        const r = block('p9-s7s8-checks.sh', args);
        expect(r.calls).not.toContain('release.mjs'); expect(r.code).not.toBe(0);
      }
    });
    it('R2 verify carries the same attestation; links mode refuses one', () => {
      const old = 'c1c4b22ee150-bTVyci1eHVcKvSKDVZl_x';
      const v = block('r2-rollback.sh', ['verify', old, INV]);
      expect(v.calls).toMatch(new RegExp(`status --expect ${old} --confirm-restart-invocation ${INV}$`, 'm'));
      expect(v.calls).toMatch(new RegExp(`^post-install-check --confirm-restart-invocation ${INV} ${old}$`, 'm'));
      expect(v.code).toBe(0);
      const links = block('r2-rollback.sh', ['links', old, INV]);
      expect(links.calls).not.toContain('rollback'); expect(links.code).not.toBe(0);
    });
  });

  describe('R1: the probe verdict is the block\'s exit status', () => {
    const r1 = (env: Record<string, string>, probe = true) => block('r1-state.sh', probe ? [STAMP, 'probe'] : [STAMP], env);
    it('COMMITTED exits 0, NOT-COMMITTED exits 10, STOP exits 3', () => {
      const c = r1({ STUB_RECOVER_OUT: 'R1 DECISION COMMITTED: x\\n', STUB_RECOVER_RC: '0' });
      expect(c.out).toContain('R1 RESULT COMMITTED'); expect(c.code).toBe(0);
      expect(c.calls).toMatch(new RegExp(`--recover-attempt ${STAMP}-commit-1 --record-dir ${home}/b1a-r6r-${STAMP} --baseline ${home}/backups/afldb-b1a-${STAMP}/baseline-v2.txt --baseline-sha256 missing`));
      const n = r1({ STUB_RECOVER_OUT: 'R1 DECISION NOT-COMMITTED: x\\n', STUB_RECOVER_RC: '10' });
      expect(n.out).toContain('R1 RESULT NOT-COMMITTED'); expect(n.code).toBe(10);
      const s = r1({ STUB_RECOVER_OUT: 'R1 DECISION STOP: attempt is not terminal\\n', STUB_RECOVER_RC: '3' });
      expect(s.out).toContain('R1 RESULT STOP (exit 3)'); expect(s.code).toBe(3);
    });
    it('a probe that prints no decision is a STOP even with exit 0; without "probe" nothing is decided', () => {
      const silent = r1({ STUB_RECOVER_OUT: 'psql: something\\n', STUB_RECOVER_RC: '0' });
      expect(silent.out).toContain('R1 RESULT STOP: recovery printed no decision (exit 0)'); expect(silent.code).toBe(3);
      const state = r1({}, false);
      expect(state.out).toContain('R1 RESULT state printed (no probe)'); expect(state.calls).not.toContain('recover.mts'); expect(state.code).toBe(0);
    });
    it('passes the P3c baseline hash on record', () => {
      const d = `${home}/backups/afldb-b1a-${STAMP}`;
      mkdirSync(d, { recursive: true });
      writeFileSync(`${d}/baseline-check.txt`, `BEFORE-CHECK PASS\nBASELINE-SHA256 ${'ab'.repeat(32)}\n`);
      const r = r1({ STUB_RECOVER_OUT: 'R1 DECISION STOP: x\\n', STUB_RECOVER_RC: '3' });
      expect(r.calls).toContain(`--baseline-sha256 ${'ab'.repeat(32)}`);
      rmSync(d, { recursive: true, force: true });
    });
  });
});
