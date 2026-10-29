// Owner-authorised proposal-copy repair; never writes accepted source or structural artefacts.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../../..');
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const read = p => fs.readFileSync(p, 'utf8').replaceAll('\r\n', '\n');
const evidence = path.join(__dirname, 'validation/restatement-repair');
const resuming = fs.existsSync(evidence);
fs.mkdirSync(evidence, { recursive: true });
const protectedFiles = {};
function inventory(dir) {
  for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const p = path.posix.join(dir, e.name);
    if (e.isDirectory()) inventory(p);
    else if (e.isFile()) protectedFiles[p] = sha(fs.readFileSync(path.join(root, p)));
  }
}
for (const p of ['src', 'packages', 'tools', 'tests', 'data/reference', 'deploy']) inventory(p);
for (const p of ['PIN-TABLE.json', 'transition-change-set.json', 'successor-tuple.json', 'activate-authority.PROPOSED.json', 'deactivate-authority.PROPOSED.json', 'migration-binding.json', 'pins/rebuild-test.inactive.ts.txt', 'pins/rebuild-test.projected-active.ts.txt']) {
  protectedFiles[path.posix.join(path.relative(root, __dirname).replaceAll('\\', '/'), p)] = sha(fs.readFileSync(path.join(__dirname, p)));
}
if (!resuming) fs.writeFileSync(path.join(evidence, 'protected-before.json'), JSON.stringify(protectedFiles, null, 2) + '\n');
const plan = JSON.parse(read(path.join(__dirname, 'RESTATEMENT-PLAN.json')));
for (const state of ['B', 'C']) for (const p of plan.files) {
  const rel = `state-${state}/${p}${/\.tsx?$/.test(p) ? '.txt' : ''}`;
  const dest = path.join(evidence, 'original', rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (!resuming) fs.copyFileSync(path.join(__dirname, 'restatements', rel), dest);
}
const p = 'tests/db-test-rebuild.test.ts';
const current = read(path.join(root, p));
const bpath = path.join(__dirname, 'restatements/state-B', p + '.txt');
let b = read(path.join(evidence, 'original/state-B', p + '.txt'));
const tailMarker = "  it.each([undefined, null, [], {}, 'c2-2026-successor'])";
if (!b.includes(tailMarker)) throw Error('Missing successor merge boundary');
// Restore the P inactive-table group INCLUDING its helper declarations and execution refusal case.
let inactive = current.slice(current.indexOf('  // AFLDB-ISSUE-323 at the PREDECESSOR state.'), current.indexOf("  it.each([undefined, null, [], {}, 'predecessor-1897-2025'])"));
inactive = inactive.replace("guard, predecessor state", "guard, state B inactive")
  .replace('ladder: resolveLadderRebuildExpectation(source(), t)', 'ladder: resolveLadderRebuildExpectation(source(), t, rawPredecessorDocuments())');
const predecessorPositive = inactive.indexOf("    it('keeps the ordinary predecessor rebuild unchanged:");
inactive = inactive.slice(0, predecessorPositive) + '  });\n';
inactive = inactive.replace(/  \/\/ AFLDB-ISSUE-323 at the PREDECESSOR state\.[\s\S]*?  describe\(/, '// State B: installed successor is inactive; explicit P fabrication fixtures prove refusal.\n  describe(');
b = b.slice(0, b.indexOf("  it('resolves and plans the actual contract, the adopted")) + `  it('state B: installed successor refuses resolution and planning until separate activation', () => {
    expect(SUCCESSOR_LADDER_TUPLES).toEqual({});
    expect(activeDocuments().contract.datasets.ladder.rebuild_expectation.profile).toBe('c2-2026-successor');
    expect(() => resolveLadderRebuildExpectation(successorSource(), ordinary())).toThrow(/Unsupported ladder expectation/);
    expect(() => realPlanStages(ordinary(), successorSource(), { draftguruLabel: DEFAULT_DRAFTGURU_LABEL, planOnly: true }))
      .toThrow(/Unsupported ladder expectation/);
  });
` + inactive + b.slice(b.indexOf(tailMarker));
b = b.replace('// The CURRENT tracked documents: since the 2026 rollover (D-316-1) they carry the adopted successor.', '// State B tracked documents contain the installed successor; the closed activation table is empty.');
const finalStart = b.indexOf("  it('takes its expected values from the tracked register, not from this file'");
const finalEnd = b.indexOf("  it('gates the seasons the accepted baseline claims", finalStart);
if (finalStart < 0 || finalEnd < finalStart) throw Error('Missing final-check boundary');
const invariant = `  it('invariant: takes predecessor final-check values from its explicit register fixture', () => {
    const tracked = predecessorJson('data/reference/fitzroy-accepted-baselines.json');
    const accepted = tracked.baselines.find((b: Record<string, unknown>) => b.acceptance_status === 'accepted');
    const checks = finalValidationChecks(tracked);
    for (const [key, value] of Object.entries(accepted.measured)) {
      if (key.startsWith('$')) continue;
      const check = checks.find((c) => c.key === key);
      if (check) expect(check.expected).toBe(value);
    }
    for (const key of ['matches', 'player_match_rows', 'brownlow_round_vote_rows']) {
      expect(checks.map((c) => c.key)).toContain(key);
    }
  });

`;
b = b.slice(0, finalStart) + invariant + b.slice(finalEnd);
const predecessorGuard = `  it('invariant: explicit predecessor plan reaches its first stage with predecessor documents', () => {
    const s = source(), t = target(), d = rawPredecessorDocuments();
    const binding = Object.freeze({ source: s, target: t, ladder: resolveLadderRebuildExpectation(s, t, d) });
    expect(binding.ladder.pair.profile).toBe('predecessor-1897-2025');
    const check: typeof checkRebuildBinding = (b, checkpoint) => checkRebuildBinding(b, checkpoint, d);
    const stages = realPlanStages(t, s, OPTS, predecessorHeightContract, binding, d, check);
    let preflight: unknown;
    try { realRunPreflight({ ...fakeDeps().deps, checkBinding: check }, OPTS, s, predecessorHeightContract, binding); } catch (error) { preflight = error; }
    expect(String(preflight ?? '')).not.toMatch(/provenance/);
    expect(() => executeRebuild(stages, t, { ...fakeDeps().deps, checkBinding: check,
      runCommand: () => { throw new Error('stub stop'); } }, { binding })).toThrow('stub stop');
  });
`;
b = b.replace(tailMarker, predecessorGuard + tailMarker);
if (b.split('\n').length < 7000) throw Error('Unexpected test loss');
fs.writeFileSync(bpath, b);
// C is prepared only after B passes by the separate finish-C script.
fs.writeFileSync(path.join(evidence, 'invariant-fragments.json'), JSON.stringify({ invariant, predecessorGuard }, null, 2) + '\n');
console.log(JSON.stringify({ repaired: bpath, protected_files: Object.keys(protectedFiles).length }));
