import './guard';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { sql } from '@/db/client';
import { compileAxis, solveCellSummary } from '@/db/queries/grid-solver';
import { type GridAxisState } from '@/search/grid-solver-spec';
import {
  checkBridgeInvariants, type ContinuityRule, type PersonLink, type Registration,
} from '../draft-linkage-invariants';

/*
 * AFLDB-ISSUE-222 — the DraftGuru person-page bridge on the REAL linked population.
 *
 * READ-ONLY by construction: every statement is a SELECT, no fixture is seeded and nothing
 * is cleaned up. It therefore differs from tests/integration/grid-solver.test.ts (which seeds
 * and deletes a wildcard season and a draft fixture) and from
 * tests/integration/draftguru-import.test.ts (which runs the importer). Run it against
 * afldb_test after the bridge import has been verified by bridge_import_gate.py verify; it
 * proves the runbook's §6.1 person/pick reconciliation, the remaining §6.4 negative controls,
 * the §6.2 top-10 coverage statement (printed) and — through the production compiler and
 * solveCellSummary — that the six draft criteria answer on the real population instead of
 * rendering the ISSUE-221 "No data" gap.
 *
 * Every expectation is DERIVED from the tracked datasets (the deployment child, the six-decision
 * ledger, the Stage A manifest), never hard-coded, so a later child version (AFLDB-ISSUE-224)
 * only needs AFLDB_DRAFTGURU_BRIDGE pointed at it.
 */

const root = process.cwd();
const childPath = process.env.AFLDB_DRAFTGURU_BRIDGE
  ?? join(root, 'data', 'reference', 'draftguru-person-bridge-20260918-v2.afldb_test.json');
const ledgerPath = join(root, 'data', 'reference', 'draftguru-link-decisions.json');
const manifestPath = join(root, 'docs', 'rebuild-manifests', 'draftguru', 'annual-html-20260826.json');
// The tracked AFLDB-ISSUE-136 renumbered-profile rules: the only legitimate reason one
// canonical player carries two AFL Tables profile paths.
const fitzroyContractPath = join(root, 'tools', 'rebuild', 'fitzroy', 'fitzroy-contract.json');

const BRIDGE_METHOD = 'draftguru_person_page_afltables_bridge';
const LEDGER_METHOD = 'draftguru_explicit_admin_decision';
const REJECTED = ['players/C/Craig_Somerville.html', 'players/D/David_Sullivan.html'];

type Child = { bridges: { player_url: string; afltables_external_id: string }[]; withheld: { player_url: string; reason: string }[] };
type Ledger = { decisions: { player_url: string; decision: 'linked' | 'confirmed_unlinked' }[] };

const child = JSON.parse(readFileSync(childPath, 'utf8')) as Child;
const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8')) as Ledger;
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { total_rows: number; distinct_player_url_count: number };
const continuityRules = ((JSON.parse(readFileSync(fitzroyContractPath, 'utf8')) as {
  profile_url_continuity?: { rules?: ContinuityRule[] };
}).profile_url_continuity?.rules ?? []).map((r) => ({ id: r.id, continuing_url: r.continuing_url, renumbered_url: r.renumbered_url }));

const ledgerUrls = new Set(ledger.decisions.map((d) => d.player_url));
const bridgeMap = new Map(child.bridges.map((b) => [b.player_url, b.afltables_external_id]));
const expectedBridged = child.bridges.filter((b) => !ledgerUrls.has(b.player_url)).map((b) => b.player_url);
const expectedLedgerLinked = ledger.decisions.filter((d) => d.decision === 'linked').length;
const expectedLedgerUnlinked = ledger.decisions.filter((d) => d.decision === 'confirmed_unlinked').length;
const expectedPlainUnmatched = manifest.distinct_player_url_count - expectedBridged.length - expectedLedgerLinked - expectedLedgerUnlinked;

const printed: string[] = [];
const note = (line: string) => { printed.push(line); console.log(`[draft-linkage] ${line}`); };

describe('DraftGuru bridge on afldb_test — §6.1 reconciliation (read-only)', () => {
  it('persons partition exactly as the child + ledger predict', async () => {
    const rows = await sql<{ status: string; method: string | null; n: number }[]>`
      SELECT dp.link_status::text AS status, dp.match_method AS method, count(*)::int AS n
        FROM draft_persons dp JOIN sources s ON s.id = dp.source_id
       WHERE s.key = 'draftguru'
       GROUP BY 1, 2 ORDER BY 1, 2`;
    const by = new Map(rows.map((r) => [`${r.status}|${r.method ?? ''}`, r.n]));
    note(`persons by status|method: ${JSON.stringify([...by])}`);
    expect(rows.reduce((a, r) => a + r.n, 0)).toBe(manifest.distinct_player_url_count);
    expect(by.get(`unique|${BRIDGE_METHOD}`) ?? 0).toBe(expectedBridged.length);
    expect(by.get(`resolved|${LEDGER_METHOD}`) ?? 0).toBe(expectedLedgerLinked);
    expect(by.get(`unmatched|${LEDGER_METHOD}`) ?? 0).toBe(expectedLedgerUnlinked);
    expect(by.get('unmatched|') ?? 0).toBe(expectedPlainUnmatched);
    expect([...by.keys()].sort()).toEqual([
      `resolved|${LEDGER_METHOD}`, `unique|${BRIDGE_METHOD}`, 'unmatched|', `unmatched|${LEDGER_METHOD}`,
    ].sort());
  });

  it('every pick inherits its person and the pick population is the manifest\'s', async () => {
    const [r] = await sql<{ picks: number; mismatched: number; linked: number; unique: number; resolved: number }[]>`
      SELECT count(*)::int AS picks,
             count(*) FILTER (WHERE k.player_id IS DISTINCT FROM p.player_id
                                 OR k.link_status_value::text IS DISTINCT FROM p.link_status::text)::int AS mismatched,
             count(*) FILTER (WHERE k.link_status_value IN ('unique', 'resolved'))::int AS linked,
             count(*) FILTER (WHERE k.link_status_value = 'unique')::int AS unique,
             count(*) FILTER (WHERE k.link_status_value = 'resolved')::int AS resolved
        FROM draft_picks k JOIN sources s ON s.id = k.source_id
        JOIN draft_persons p ON p.id = k.draft_person_id
       WHERE s.key = 'draftguru'`;
    note(`picks ${r.picks}, linked ${r.linked} (bridge ${r.unique}, human ${r.resolved}), capability ${(100 * r.linked / r.picks).toFixed(2)}%`);
    expect(r.picks).toBe(manifest.total_rows);
    expect(r.mismatched).toBe(0);
    expect(r.linked).toBeGreaterThan(r.picks / 2);           // the §6.7 probe, stated not assumed
  });

  it('§6.1 pick level: bridge/human/unlinked per (year, kind) sums to the cell and is printed', async () => {
    const rows = await sql<{ year: number; kind: string; picks: number; human: number; bridge: number; unlinked: number }[]>`
      SELECT k.draft_year::int AS year, k.draft_kind AS kind, count(*)::int AS picks,
             count(*) FILTER (WHERE k.link_status_value = 'resolved')::int AS human,
             count(*) FILTER (WHERE k.link_status_value = 'unique')::int AS bridge,
             count(*) FILTER (WHERE k.link_status_value NOT IN ('unique', 'resolved'))::int AS unlinked
        FROM draft_picks k JOIN sources s ON s.id = k.source_id
       WHERE s.key = 'draftguru'
       GROUP BY 1, 2 ORDER BY 1, 2`;
    for (const r of rows) expect(r.human + r.bridge + r.unlinked).toBe(r.picks);
    note(`cells: ${rows.length}; ${rows.map((r) => `${r.year}/${r.kind} ${r.bridge + r.human}/${r.picks}`).join(', ')}`);
  });
});

describe('DraftGuru bridge on afldb_test — §6.4 negative controls (read-only)', () => {
  it('every admitted child bridge: the exact target is registered once, resolves to the stored player, '
    + 'and the person stores the bridge state (or the agreeing human state)', async () => {
    // Direction matters: child target -> registration -> player, then compare with the person.
    // The first version joined draft_persons.player_id to EVERY afltables identity of the
    // player and fanned out onto the continuing path of the four ISSUE-136 renumbered players
    // (tests/draft-linkage-invariants.test.ts pins that shape DB-free).
    const targets = [...bridgeMap.values()];
    const registrations = await sql<Registration[]>`
      SELECT e.external_id, e.player_id
        FROM external_identities e JOIN sources se ON se.id = e.source_id AND se.key = 'afltables'
       WHERE e.match_method = 'afltables_profile_url' AND e.status IN ('unique', 'resolved')
         AND e.player_id IS NOT NULL AND e.external_id = ANY(${targets})`;
    const persons = await sql<PersonLink[]>`
      SELECT dp.player_url, dp.player_id, dp.link_status::text AS link_status, dp.match_method
        FROM draft_persons dp JOIN sources s ON s.id = dp.source_id
       WHERE s.key = 'draftguru' AND dp.player_url = ANY(${[...bridgeMap.keys()]})`;
    const linkedIds = [...new Set(persons.map((p) => p.player_id).filter((id): id is number => id !== null))];
    const playerIdentities = await sql<Registration[]>`
      SELECT e.external_id, e.player_id
        FROM external_identities e JOIN sources se ON se.id = e.source_id AND se.key = 'afltables'
       WHERE e.match_method = 'afltables_profile_url' AND e.status IN ('unique', 'resolved')
         AND e.player_id = ANY(${linkedIds})`;
    const report = checkBridgeInvariants({ bridges: bridgeMap, ledgerUrls, registrations, persons, playerIdentities, rules: continuityRules });

    note(`decided persons inside bridges[]: ${report.decided.length} (ledger ${[...ledgerUrls].filter((u) => bridgeMap.has(u)).length}); `
      + `players with more than one AFL Tables path: ${JSON.stringify(report.multiIdentity)}`);
    expect(report.missing).toEqual([]);
    expect(report.ambiguous).toEqual([]);
    expect(report.wrongPlayer).toEqual([]);
    expect(report.wrongState).toEqual([]);
    expect(report.unexplained).toEqual([]);
    expect(report.decided.length).toBe(bridgeMap.size - expectedBridged.length);
    expect(persons.length).toBe(bridgeMap.size);
    expect(linkedIds.length).toBe(bridgeMap.size);            // no canonical player claimed twice
  });

  it('withheld persons stay unlinked by the bridge; the rejected identities are reached by nobody', async () => {
    const withheld = child.withheld.map((w) => w.player_url);
    const linkedWithheld = await sql<{ url: string }[]>`
      SELECT dp.player_url AS url FROM draft_persons dp JOIN sources s ON s.id = dp.source_id
       WHERE s.key = 'draftguru' AND dp.match_method = ${BRIDGE_METHOD} AND dp.player_url = ANY(${withheld})`;
    expect(linkedWithheld).toEqual([]);
    const reached = await sql<{ url: string; path: string }[]>`
      SELECT dp.player_url AS url, e.external_id AS path
        FROM external_identities e JOIN sources se ON se.id = e.source_id AND se.key = 'afltables'
        JOIN draft_persons dp ON dp.player_id = e.player_id
        JOIN sources s ON s.id = dp.source_id AND s.key = 'draftguru'
       WHERE e.external_id = ANY(${REJECTED})`;
    expect(reached).toEqual([]);
  });

  it('no two DraftGuru persons share a player; the confirmed-unlinked person stays unmatched', async () => {
    const shared = await sql<{ player_id: number; n: number }[]>`
      SELECT dp.player_id, count(*)::int AS n FROM draft_persons dp JOIN sources s ON s.id = dp.source_id
       WHERE s.key = 'draftguru' AND dp.player_id IS NOT NULL GROUP BY 1 HAVING count(*) > 1`;
    expect(shared).toEqual([]);
    const unlinkedUrls = ledger.decisions.filter((d) => d.decision === 'confirmed_unlinked').map((d) => d.player_url);
    const rows = await sql<{ url: string; status: string; player_id: number | null }[]>`
      SELECT dp.player_url AS url, dp.link_status::text AS status, dp.player_id
        FROM draft_persons dp JOIN sources s ON s.id = dp.source_id
       WHERE s.key = 'draftguru' AND dp.player_url = ANY(${unlinkedUrls})`;
    expect(rows.map((r) => [r.status, r.player_id])).toEqual(unlinkedUrls.map(() => ['unmatched', null]));
  });

  it('trade and free-agency rows carry no pick number; Sam Chapman\'s outcome is printed, never asserted', async () => {
    const [t] = await sql<{ violations: number; moves: number }[]>`
      SELECT count(*) FILTER (WHERE pick_number IS NOT NULL)::int AS violations, count(*)::int AS moves
        FROM draft_picks k JOIN sources s ON s.id = k.source_id
       WHERE s.key = 'draftguru' AND k.draft_kind IN ('trade', 'free_agency')`;
    expect(t.violations).toBe(0);
    const chapman = await sql<{ url: string; status: string; method: string | null; player_id: number | null }[]>`
      SELECT dp.player_url AS url, dp.link_status::text AS status, dp.match_method AS method, dp.player_id
        FROM draft_persons dp JOIN sources s ON s.id = dp.source_id
       WHERE s.key = 'draftguru' AND dp.player_url LIKE '%/sam_chapman/%'`;
    note(`Sam Chapman (U5/§3.6): ${JSON.stringify(chapman)}`);
  });

  it('§6.2: National Draft picks 1–10 coverage by year is stated for every draft', async () => {
    const rows = await sql<{ year: number; picks: number; linked: number }[]>`
      SELECT k.draft_year::int AS year, count(*)::int AS picks,
             count(*) FILTER (WHERE k.link_status_value IN ('unique', 'resolved'))::int AS linked
        FROM draft_picks k JOIN sources s ON s.id = k.source_id
       WHERE s.key = 'draftguru' AND k.draft_kind = 'national' AND k.pick_number BETWEEN 1 AND 10
       GROUP BY 1 ORDER BY 1`;
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.picks).toBeLessThanOrEqual(10);
    note(`top-10 national coverage: ${rows.map((r) => `${r.year} ${r.linked}/${r.picks}`).join(', ')}`);
  });
});

describe('Grid Solver draft criteria on the real linked population (read-only, production compiler)', () => {
  const count = async (axis: GridAxisState): Promise<number> => {
    const [r] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM players p JOIN player_career_stats c ON c.player_id = p.id
       WHERE ${compileAxis(axis)}`;
    return r.n;
  };

  it('the six draft builders each answer a non-empty set with sane bounds', async () => {
    const top10 = await count({ builder: 'national_draft_pick_between', params: { from: '1', to: '10' } });
    const pick1 = await count({ builder: 'national_draft_pick_between', params: { from: '1', to: '1' } });
    const anyTop10 = await count({ builder: 'draft_pick_between', params: { from: '1', to: '10' } });
    const rookie = await count({ builder: 'draft_type_is', params: { draftType: 'rookie' } });
    const traded = await count({ builder: 'traded_min_times', params: { times: '1' } });
    const fatherSon = await count({ builder: 'recruited_via', params: { signingKind: 'Father-Son' } });
    const y2001 = await count({ builder: 'draft_year_between', params: { from: '2001', to: '2001' } });
    note(`national top-10 ${top10}, pick 1 ${pick1}, any-kind top-10 ${anyTop10}, rookie ${rookie}, traded>=1 ${traded}, father-son ${fatherSon}, drafted 2001 ${y2001}`);
    expect(pick1).toBeGreaterThan(0);
    expect(pick1).toBeLessThanOrEqual(42);                     // 42 national drafts in the source
    expect(top10).toBeGreaterThanOrEqual(pick1);
    expect(top10).toBeLessThanOrEqual(420);
    expect(anyTop10).toBeGreaterThanOrEqual(top10);
    expect(rookie).toBeGreaterThan(0);
    expect(traded).toBeGreaterThan(0);
    expect(fatherSon).toBeGreaterThan(0);
    expect(y2001).toBeGreaterThan(0);
  });

  it('drafted_by_club answers for the club with the most linked national picks', async () => {
    const [club] = await sql<{ organization_id: number; slug: string; n: number }[]>`
      SELECT c.organization_id, c.slug, count(*)::int AS n
        FROM draft_picks k JOIN sources s ON s.id = k.source_id JOIN clubs c ON c.id = k.club_id
       WHERE s.key = 'draftguru' AND k.draft_kind = 'national' AND k.link_status_value IN ('unique', 'resolved')
       GROUP BY 1, 2 ORDER BY 3 DESC, 2 LIMIT 1`;
    expect(club).toBeDefined();
    const drafted = await count({ builder: 'drafted_by_club', params: { club: String(club.organization_id) } });
    const neverPlayed = await count({ builder: 'drafted_by_club_never_played', params: { club: String(club.organization_id) } });
    note(`drafted_by_club(${club.slug}) ${drafted}; never played there ${neverPlayed}`);
    expect(drafted).toBeGreaterThan(0);
    expect(neverPlayed).toBeLessThanOrEqual(drafted);
  });

  it('the ISSUE-221 "No data" square is gone: national top-10 × any career is a populated cell', async () => {
    const top10: GridAxisState = { builder: 'national_draft_pick_between', params: { from: '1', to: '10' } };
    const anyone: GridAxisState = { builder: 'career_games_min', params: { games: '0' } };
    const cell = await solveCellSummary(top10, anyone, 'games_asc');
    note(`cell national top-10 x career>=0: eligible ${cell.eligible}, emptyAxis ${cell.emptyAxis}, top ${JSON.stringify(cell.top)}`);
    expect(cell.emptyAxis).toBeNull();
    expect(cell.eligible).toBeGreaterThan(0);
    expect(cell.top).not.toBeNull();
    const both = await solveCellSummary(top10, { builder: 'draft_type_is', params: { draftType: 'national' } }, 'games_asc');
    expect(both.emptyAxis).toBeNull();
    expect(both.eligible).toBe(cell.eligible);                 // every national top-10 pick is a national pick
  }, 120_000);
});
