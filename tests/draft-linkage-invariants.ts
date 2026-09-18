/*
 * AFLDB-ISSUE-222 — the bridge-link invariants, as a pure function over rows.
 *
 * Shared by tests/integration/draft-linkage.test.ts (real rows from afldb_test, read-only)
 * and tests/draft-linkage-invariants.test.ts (synthetic rows, no database). No database
 * import here, so the unit test can load it without a connection.
 *
 * Why this exists: the first version of the integration assertion joined
 * draft_persons.player_id to EVERY afltables external identity of that player and compared
 * each to the child's href. A canonical player legitimately carries two AFL Tables profile
 * paths when a tracked AFLDB-ISSUE-136 profile_url_continuity rule folded a renumbered
 * profile into the continuing player (four players in full-history-20260902: Charlie
 * Cameron, Jack Graham, Jack Ross, Jack Williams). That fan-out produced four false
 * mismatches against correct stored links. The invariant is asserted per admitted child
 * bridge in the identity -> player direction, and multi-identity players are reported
 * separately and must be explained by a tracked rule.
 */

export const BRIDGE_METHOD = 'draftguru_person_page_afltables_bridge';
export const LEDGER_METHOD = 'draftguru_explicit_admin_decision';

export type Registration = { external_id: string; player_id: number };
export type PersonLink = {
  player_url: string; player_id: number | null; link_status: string; match_method: string | null;
};
export type ContinuityRule = { id: string; continuing_url: string; renumbered_url: string };
export type Finding = { url: string; detail: string };
export type MultiIdentity = {
  player_id: number; paths: string[]; urls: string[]; target: string | null;
  explained: boolean; rule_ids: string[];
};
export type InvariantReport = {
  /** child targets with no afltables_profile_url registration */
  missing: string[];
  /** child targets registered more than once (the importer would have HALTed) */
  ambiguous: string[];
  /** the person's stored player_id is not the one the child target registers */
  wrongPlayer: Finding[];
  /** the person's link_status / match_method is not the bridge state (or the agreeing human state) */
  wrongState: Finding[];
  /** every linked player carrying more than one afltables path, with the rule that explains it */
  multiIdentity: MultiIdentity[];
  /** the subset of multiIdentity no tracked continuity rule explains, or whose child target is off the pair */
  unexplained: MultiIdentity[];
  /** decided (human-authority) persons inside bridges[] — ledger or live — that the bridge agreed with */
  decided: string[];
};

export function checkBridgeInvariants(input: {
  bridges: Map<string, string>;
  ledgerUrls: Set<string>;
  registrations: Registration[];
  persons: PersonLink[];
  playerIdentities: Registration[];
  rules: ContinuityRule[];
}): InvariantReport {
  const byTarget = new Map<string, number[]>();
  for (const r of input.registrations) {
    byTarget.set(r.external_id, [...(byTarget.get(r.external_id) ?? []), r.player_id]);
  }
  const person = new Map(input.persons.map((p) => [p.player_url, p]));
  const report: InvariantReport = {
    missing: [], ambiguous: [], wrongPlayer: [], wrongState: [], multiIdentity: [], unexplained: [], decided: [],
  };
  const playerOfBridge = new Map<string, number>();

  for (const [url, target] of [...input.bridges].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const ids = byTarget.get(target) ?? [];
    if (ids.length === 0) { report.missing.push(target); continue; }
    if (ids.length > 1) { report.ambiguous.push(target); continue; }
    const pid = ids[0];
    const p = person.get(url);
    if (!p) { report.wrongPlayer.push({ url, detail: 'no draft_persons row' }); continue; }
    if (p.player_id !== pid) {
      report.wrongPlayer.push({ url, detail: `stored player ${p.player_id}, target ${target} registers player ${pid}` });
      continue;
    }
    playerOfBridge.set(url, pid);
    const decided = input.ledgerUrls.has(url) || p.match_method === LEDGER_METHOD;
    if (decided) {
      report.decided.push(url);
      if (p.link_status !== 'resolved' || p.match_method !== LEDGER_METHOD) {
        report.wrongState.push({ url, detail: `decided person stores ${p.link_status}/${p.match_method}` });
      }
    } else if (p.link_status !== 'unique' || p.match_method !== BRIDGE_METHOD) {
      report.wrongState.push({ url, detail: `bridge person stores ${p.link_status}/${p.match_method}` });
    }
  }

  const pathsByPlayer = new Map<number, string[]>();
  for (const r of input.playerIdentities) {
    pathsByPlayer.set(r.player_id, [...(pathsByPlayer.get(r.player_id) ?? []), r.external_id]);
  }
  const urlsByPlayer = new Map<number, string[]>();
  for (const [url, pid] of playerOfBridge) urlsByPlayer.set(pid, [...(urlsByPlayer.get(pid) ?? []), url]);

  for (const [pid, rawPaths] of [...pathsByPlayer].sort(([a], [b]) => a - b)) {
    const paths = [...new Set(rawPaths)].sort();
    if (paths.length < 2 || !urlsByPlayer.has(pid)) continue;
    const urls = (urlsByPlayer.get(pid) ?? []).sort();
    const target = urls.length === 1 ? (input.bridges.get(urls[0]) ?? null) : null;
    const rule = input.rules.find((r) => paths.length === 2 && paths.includes(r.continuing_url) && paths.includes(r.renumbered_url));
    const explained = rule !== undefined && urls.length === 1 && target !== null && paths.includes(target);
    const entry: MultiIdentity = { player_id: pid, paths, urls, target, explained, rule_ids: rule ? [rule.id] : [] };
    report.multiIdentity.push(entry);
    if (!explained) report.unexplained.push(entry);
  }
  return report;
}
