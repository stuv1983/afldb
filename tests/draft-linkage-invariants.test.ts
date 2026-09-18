import { describe, expect, it } from 'vitest';

import {
  BRIDGE_METHOD, checkBridgeInvariants, LEDGER_METHOD, type ContinuityRule, type PersonLink,
  type Registration,
} from './draft-linkage-invariants';

/*
 * AFLDB-ISSUE-222 — DB-free regression for the bridge-link invariants.
 *
 * Reproduces, with synthetic rows, the exact shape that made the first integration assertion
 * fail falsely on afldb_test (2026-09-19): a canonical player registered under TWO AFL Tables
 * profile paths by an AFLDB-ISSUE-136 continuity rule, with the child bridge naming the
 * renumbered path. The corrected invariant must accept that shape, report the player as a
 * multi-identity player explained by the rule, and still refuse every genuine defect.
 */

const DG = 'https://www.draftguru.com.au/players/';
const rules: ContinuityRule[] = [
  { id: '2025-jack-graham-renumbered-profile', continuing_url: 'players/J/Jack_Graham.html', renumbered_url: 'players/J/Jack_Graham2.html' },
];

function world() {
  const bridges = new Map<string, string>([
    [DG + 'jack_graham/3', 'players/J/Jack_Graham2.html'],       // renumbered path, folded player
    [DG + 'alpha_one/1', 'players/A/Alpha_One.html'],
    [DG + 'nathan_fyfe/1', 'players/N/Nat_Fyfe.html'],            // agreeing ledger person
  ]);
  const ledgerUrls = new Set([DG + 'nathan_fyfe/1']);
  const registrations: Registration[] = [
    { external_id: 'players/J/Jack_Graham2.html', player_id: 12576 },
    { external_id: 'players/A/Alpha_One.html', player_id: 1001 },
    { external_id: 'players/N/Nat_Fyfe.html', player_id: 500 },
  ];
  const persons: PersonLink[] = [
    { player_url: DG + 'jack_graham/3', player_id: 12576, link_status: 'unique', match_method: BRIDGE_METHOD },
    { player_url: DG + 'alpha_one/1', player_id: 1001, link_status: 'unique', match_method: BRIDGE_METHOD },
    { player_url: DG + 'nathan_fyfe/1', player_id: 500, link_status: 'resolved', match_method: LEDGER_METHOD },
  ];
  // EVERY afltables path of the linked players: Jack Graham has two (the fan-out).
  const playerIdentities: Registration[] = [
    { external_id: 'players/J/Jack_Graham.html', player_id: 12576 },
    { external_id: 'players/J/Jack_Graham2.html', player_id: 12576 },
    { external_id: 'players/A/Alpha_One.html', player_id: 1001 },
    { external_id: 'players/N/Nat_Fyfe.html', player_id: 500 },
  ];
  return { bridges, ledgerUrls, registrations, persons, playerIdentities, rules };
}

describe('bridge-link invariants (DB-free)', () => {
  it('accepts the player-with-two-identities shape and explains it by the tracked rule', () => {
    const r = checkBridgeInvariants(world());
    expect(r.missing).toEqual([]);
    expect(r.ambiguous).toEqual([]);
    expect(r.wrongPlayer).toEqual([]);
    expect(r.wrongState).toEqual([]);
    expect(r.decided).toEqual([DG + 'nathan_fyfe/1']);
    expect(r.multiIdentity).toEqual([{
      player_id: 12576,
      paths: ['players/J/Jack_Graham.html', 'players/J/Jack_Graham2.html'],
      urls: [DG + 'jack_graham/3'],
      target: 'players/J/Jack_Graham2.html',
      explained: true,
      rule_ids: ['2025-jack-graham-renumbered-profile'],
    }]);
    expect(r.unexplained).toEqual([]);
  });

  it('the old join shape would have flagged the continuing path; the invariant does not compare it', () => {
    const w = world();
    // What the first assertion did: every identity of the player against the child's href.
    const naive = w.playerIdentities
      .filter((i) => i.player_id === 12576)
      .filter((i) => w.bridges.get(DG + 'jack_graham/3') !== i.external_id);
    expect(naive.map((i) => i.external_id)).toEqual(['players/J/Jack_Graham.html']);   // the false mismatch
    expect(checkBridgeInvariants(w).wrongPlayer).toEqual([]);                          // the correct verdict
  });

  it('a stored link to a different player than the child target registers is wrongPlayer', () => {
    const w = world();
    w.persons[1].player_id = 1099;
    const r = checkBridgeInvariants(w);
    expect(r.wrongPlayer).toEqual([{ url: DG + 'alpha_one/1', detail: 'stored player 1099, target players/A/Alpha_One.html registers player 1001' }]);
  });

  it('a child target with no registration is missing; one registered twice is ambiguous', () => {
    const w = world();
    w.registrations = w.registrations.filter((x) => x.external_id !== 'players/A/Alpha_One.html');
    w.registrations.push({ external_id: 'players/J/Jack_Graham2.html', player_id: 12577 });
    const r = checkBridgeInvariants(w);
    expect(r.missing).toEqual(['players/A/Alpha_One.html']);
    expect(r.ambiguous).toEqual(['players/J/Jack_Graham2.html']);
  });

  it('a bridge person stored as resolved, or a decided person stored as unique, is wrongState', () => {
    const w = world();
    w.persons[1].link_status = 'resolved';
    w.persons[2].link_status = 'unique';
    w.persons[2].match_method = BRIDGE_METHOD;
    const r = checkBridgeInvariants(w);
    expect(r.wrongState.map((f) => f.url)).toEqual([DG + 'alpha_one/1', DG + 'nathan_fyfe/1']);
  });

  it('a second identity no tracked rule explains is reported as unexplained, not silently accepted', () => {
    const w = world();
    w.playerIdentities.push({ external_id: 'players/A/Alpha_One0.html', player_id: 1001 });
    const r = checkBridgeInvariants(w);
    expect(r.unexplained.map((m) => [m.player_id, m.paths, m.explained])).toEqual([
      [1001, ['players/A/Alpha_One.html', 'players/A/Alpha_One0.html'], false],
    ]);
    expect(r.wrongPlayer).toEqual([]);          // the link itself is still correct
  });

  it('a child target that is off the rule pair (a third path) is unexplained even with a rule', () => {
    const w = world();
    w.playerIdentities.push({ external_id: 'players/J/Jack_Graham3.html', player_id: 12576 });
    const r = checkBridgeInvariants(w);
    expect(r.unexplained.map((m) => m.player_id)).toEqual([12576]);
  });

  it('a person absent from draft_persons is wrongPlayer', () => {
    const w = world();
    w.persons = w.persons.filter((p) => p.player_url !== DG + 'alpha_one/1');
    expect(checkBridgeInvariants(w).wrongPlayer).toEqual([{ url: DG + 'alpha_one/1', detail: 'no draft_persons row' }]);
  });
});
