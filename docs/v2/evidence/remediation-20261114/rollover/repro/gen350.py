"""AFLDB-ISSUE-350 rehearsal harness generator (scratch test, never committed to tests/).

Derives a one-off integration test from tests/integration/settle-afl-api-state-b.test.ts (the harness the 2026-11-14 review used for its
ING-1 reproduction), moved to the real season 2027 with NO seasons row and NO keepalive match, so a nightly-shaped settle runs against the
snapshot copy exactly as production's would. Usage:  gen350.py <mode> <out.ts>
  mode A  the state before the opening (no 2027 row)         -> body A: run the nightly-shaped settle, log the outcome
  mode N  the off-season nightly (zero units, complete season feed) after the opening
  mode C  the state after `issue350-season-open` was applied  -> body C: run it again, log the outcome (the row now exists)
The generated file replaces the harness's afterAll (so it does not delete the opened row) and, for mode C, the fail-closed residue
expectation for the season row (the opened row is the point of the run). The database is a disposable isolated copy.
"""
import re
import sys

mode, out = sys.argv[1], sys.argv[2]
src = open('tests/integration/settle-afl-api-state-b.test.ts', encoding='utf-8').read()
head, _, _ = src.partition("describe('AFLDB-ISSUE-257")
old = """  await sql`INSERT INTO seasons (year, league, status) VALUES (${FIXTURE_SEASON}, 'AFL', 'in_progress'::season_status)`;
  const [keepalive] = await sql<{ id: number }[]>`"""
assert old in head
head = head.replace(old, """  const [keepalive] = [{ id: 0 }]; void sql`""", 1)
for a, b in [
    ("const FIXTURE_SEASON = 2071;", "const FIXTURE_SEASON = 2027;"),
    ("const NS = 'CD_M2071ISSUE275SB';", "const NS = 'CD_M2027REM350';"),
    ("const SNAPSHOT_LABEL = 'issue275-stateb-integration';", "const SNAPSHOT_LABEL = 'rem350-nightly-shaped';"),
    ("const NOTE = 'issue-275 state-b afl_api ownership test';", "const NOTE = 'rem350 nightly-shaped settle rehearsal';"),
    ("const SYNTHETIC_PLAYER_LEGACY_ID = -275000001;", "const SYNTHETIC_PLAYER_LEGACY_ID = -275009350;"),
    ("'karl-amon-issue275-state-b-fixture'", "'karl-amon-rem350-fixture'"),
    ("'Amon-Issue275StateB'", "'Amon-Rem350'"),
    ("'players/Z/Issue275-state-b-bridged-test.html'", "'players/Z/Rem350-bridged-test.html'"),
]:
    assert a in head, a
    head = head.replace(a, b)
if mode in ('C', 'N'):
    a = "const NO_RESIDUE = {\n  seasons: 0,"
    assert a in head
    head = head.replace(a, "const NO_RESIDUE = {\n  seasons: 1,", 1)
head, n = re.subn(r"afterAll\(async \(\) => \{\n  try \{.*?\n\}, 300_000\);", "afterAll(async () => { await sql.end({ timeout: 10 }); }, 300_000);", head, count=1, flags=re.S)
assert n == 1, 'afterAll block not replaced'
body = open('docs/v2/evidence/remediation-20261114/rollover/repro/body_%s.frag' % mode, encoding='utf-8').read()
open(out, 'w', encoding='utf-8', newline='\n').write(head + body)
