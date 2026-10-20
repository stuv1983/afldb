/**
 * Populated-ledger rollback rehearsal, step 1: put representative VALID V2 state into a disposable
 * isolated copy, only through the production services the operations centre uses.
 *
 *   curated awards   createProposal / validateProposal / approveProposal / rejectProposal / reviseProposal /
 *                    reviseApprovedProposal (CORRECT and REPLACE paths) -> award_winners + data_overrides + data_edits
 *   void/reinstate   voidAwardWinner / reinstateAwardWinner (admin-awards)
 *   Brownlow         recordBrownlowEligibilityForAdmin (decision, supersession, open and sealed seasons, publication)
 *   Coleman          loadColemanDerivationInput -> publishColemanResult(..., colemanAwardWinnerProjection)
 *                    including a corrected goal fact (superseding publication, voided and inserted winners)
 *
 * Every identity is SYNTHETIC (marker `rb-pop`, `@example.invalid` users with no credentials, seasons 2085-2095
 * that no real data uses). No real user, credential or historical source fact is touched; the only real row a
 * run changes is the `coleman` / `brownlow-medal` award span, which the production services recompute.
 *
 *   node --import tsx --conditions=react-server tools/v2/rollback-populate.ts <out.json>
 *
 * Run it through tools/v2/isolated-pg.ts `run <afldb_v2_rb_*_test> --`; it refuses any other target.
 */
import { writeFileSync } from 'node:fs';

import postgres from 'postgres';

import {
  approveProposal,
  createProposal,
  rejectProposal,
  reviseApprovedProposal,
  reviseProposal,
  validateProposal,
  type CuratedAwardsViewer,
  type ProposalInput,
} from '@afldb/admin';
import { postgresExecutor, type TransactionalSqlExecutor } from '@afldb/db';
import { publishColemanResult, type ColemanPublicationOutcome } from '@afldb/derived';
import { checkIsolatedTestDsn, sealedSeasonsFrom, type SealedSeasons, type SeasonRegistry } from '@afldb/domain';

import { reinstateAwardWinner, voidAwardWinner } from '@/db/queries/admin-awards';
import { awardWinnerPromotionPort, awardWinnerRevisionPort, withAwardProposalExecutor } from '@/db/queries/award-proposals';
import { colemanAwardWinnerProjection } from '@/db/queries/coleman-award-winners';
import { loadColemanContract, loadColemanDerivationInput } from '@/db/queries/coleman-inputs';
import { recordBrownlowEligibilityDecision } from '@/db/queries/brownlow-eligibility';

const MARKER = 'rb-pop';
const NOW = () => new Date('2026-10-20T12:00:00Z');
const OPTIONS = { now: NOW };
const NOTE = 'SYNTHETIC rehearsal note: checked against the synthetic annual report (page 14).';
const CITATION = 'https://example.invalid/rb-pop/ruling';
const ATTESTATION = 'SYNTHETIC attestation: no second reviewer is available this week.';
const OPEN_SEASON = 2092;
const SEALED_SEASON = 2091;
const CURATED_SEALED: SealedSeasons = { from: 1897, through: SEALED_SEASON, open: [] };
const CURATED_OPEN: SealedSeasons = { from: 1897, through: 1899, open: [] };
const BROWNLOW_SEASONS = { tie: 2086, open: 2088, sealed: 2089 } as const;
const BROWNLOW_REGISTRY: SeasonRegistry = { first_season: 2085, last_season: 2089, in_progress_seasons: [2088] };
const COLEMAN_SEASON = 2095;
const COLEMAN_REGISTRY: SeasonRegistry = { first_season: 1897, last_season: COLEMAN_SEASON, in_progress_seasons: [] };
const DERIVED_AT = '2026-10-20T00:00:00Z';

const ownerUrl = process.env.AFLDB_OWNER_DATABASE_URL ?? '';
const importUrl = process.env.AFLDB_TEST_IMPORT_DATABASE_URL ?? '';
if (process.env.AFLDB_V2_ISOLATED_PG !== '1' || checkIsolatedTestDsn(ownerUrl, Number(process.env.AFLDB_V2_ISOLATED_PORT)).length > 0 || !importUrl) {
  throw new Error('Refused: run through tools/v2/isolated-pg.ts against an isolated afldb_v2_*_test database');
}
const database = new URL(ownerUrl).pathname.slice(1);
if (!/^afldb_v2_rb_[a-z0-9_]+_test$/.test(database)) throw new Error(`Refused: ${database} is not an afldb_v2_rb_*_test rehearsal copy`);
process.env.AFLDB_IMPORT_DATABASE_URL = importUrl; // the curated services connect through this variable

const owner = postgres(ownerUrl, { max: 2, onnotice: () => {} });
const importSql = postgres(importUrl, { max: 2, onnotice: () => {} });
const executor: TransactionalSqlExecutor = postgresExecutor(importSql);

type Id = { id: number };
const players: { id: number; identity: string; slug: string; name: string }[] = [];
const created: Record<string, unknown> = {};

async function newUser(email: string, role: 'admin' | 'super_admin'): Promise<number> {
  // No password hash and no session: a synthetic identity that cannot sign in.
  const [row] = await owner<Id[]>`INSERT INTO auth_users (email, role) VALUES (${`${MARKER}-${email}@example.invalid`}, ${role}) RETURNING id::int AS id`;
  return row.id;
}

async function newPlayer(tag: string): Promise<{ id: number; identity: string; slug: string; name: string }> {
  const [afltables] = await owner<Id[]>`SELECT id::int AS id FROM sources WHERE key = 'afltables'`;
  const name = `Synthetic RB ${tag}`;
  const slug = `${MARKER}-${tag.toLowerCase()}`;
  const path = `players/R/${MARKER}-${tag.toLowerCase()}.html`;
  const [player] = await owner<Id[]>`
    INSERT INTO players (display_name, search_name, sort_name, slug)
    VALUES (${name}, afldb_normalise_name(${name}), ${name}, ${slug}) RETURNING id::int AS id`;
  await owner`
    INSERT INTO external_identities (source_id, external_id, player_id, status, match_method)
    VALUES (${afltables.id}, ${path}, ${player.id}, 'unique', 'afltables_profile_url')`;
  return { id: player.id, identity: `afltables:${path}`, slug, name };
}

async function newClub(slug: string, withOrganisation: boolean): Promise<number> {
  let organisationId: number | null = null;
  if (withOrganisation) {
    const [org] = await owner<Id[]>`INSERT INTO club_organizations (name, slug) VALUES (${`${slug} organisation`}, ${`${slug}-org`}) RETURNING id::int AS id`;
    organisationId = org.id;
  }
  return owner.begin(async (tx) => {
    await tx`SET CONSTRAINTS clubs_current_identity_id_fkey DEFERRED`;
    const [club] = await tx<Id[]>`
      INSERT INTO clubs (slug, name, short_name, abbreviation, current_identity_id, legacy_club_hist, organization_id)
      VALUES (${slug}, ${slug}, ${slug.slice(-8)}, ${slug.slice(-4).toUpperCase()}, -1, ${slug}, ${organisationId})
      RETURNING id::int AS id`;
    await tx`UPDATE clubs SET current_identity_id = ${club.id} WHERE id = ${club.id}`;
    return club.id;
  });
}

async function preflight(): Promise<void> {
  const [ledger] = await owner<{ n: number; last: string }[]>`SELECT count(*)::int AS n, max(name) AS last FROM afldb_meta.schema_migrations`;
  if (ledger.n !== 115) throw new Error(`Refused: expected migration ledger 115, found ${ledger.n}`);
  for (const table of ['award_proposals', 'award_proposal_decisions', 'derived_award_results', 'brownlow_eligibility_decisions', 'derived_award_projections']) {
    const [row] = await owner.unsafe(`SELECT count(*)::int AS n FROM ${table}`);
    if (row.n !== 0) throw new Error(`Refused: ${table} already holds ${row.n} rows; populate only a copy of the migration-only database`);
  }
  const [marked] = await owner<{ n: number }[]>`SELECT count(*)::int AS n FROM auth_users WHERE email LIKE ${`${MARKER}-%`}`;
  if (marked.n !== 0) throw new Error('Refused: rehearsal fixtures already exist in this copy');
  for (const slug of ['coleman', 'brownlow-medal']) {
    const [award] = await owner<Id[]>`SELECT id::int AS id FROM awards WHERE slug = ${slug}`;
    if (!award) throw new Error(`Refused: the ${slug} award definition is missing from this copy`);
  }
  for (const key of ['afltables', 'manual_admin_edit']) {
    const [source] = await owner<Id[]>`SELECT id::int AS id FROM sources WHERE key = ${key}`;
    if (!source) throw new Error(`Refused: source ${key} is missing from this copy`);
  }
}

/* ------------------------------------------------------------------ curated awards */

async function curated(creator: CuratedAwardsViewer, approver: CuratedAwardsViewer, clubSlugs: string[]): Promise<void> {
  const input = (slug: string, over: Partial<ProposalInput> = {}): ProposalInput => ({
    awardSlug: slug, season: OPEN_SEASON, playerIdentity: players[0].identity, playerNameRaw: players[0].name, clubSlug: null,
    votes: '10', position: null, sourceKind: 'manual_entry', citation: 'SYNTHETIC citation for the rehearsal', acquiredOn: '2026-10-01', ...over,
  });
  const award = async (n: number): Promise<string> => {
    const slug = `${MARKER}-award-${n}`;
    await owner`INSERT INTO awards (slug, name, category, competition) VALUES (${slug}, ${`${MARKER} award ${n}`}, 'award', 'AFL')`;
    return slug;
  };
  const approve = (viewer: CuratedAwardsViewer, proposalId: number, extra: { decisionNote?: string; selfApprovalAttestation?: string }, sealed: SealedSeasons) =>
    withAwardProposalExecutor((ex) => approveProposal(viewer, ex, { proposalId, ...extra }, { promotion: awardWinnerPromotionPort, sealed }, OPTIONS));
  const revise = (proposalId: number, changes: Partial<ProposalInput>) => withAwardProposalExecutor((ex) => reviseApprovedProposal(
    creator, ex, { proposalId, changes, decisionNote: NOTE }, { revision: awardWinnerRevisionPort, sealed: CURATED_OPEN }, OPTIONS));
  const proposeAndValidate = (slug: string, by: CuratedAwardsViewer, over: Partial<ProposalInput> = {}) => withAwardProposalExecutor(async (ex) => {
    const proposal = await createProposal(by, ex, input(slug, over), OPTIONS);
    const validated = await validateProposal(by, ex, { proposalId: proposal.id }, OPTIONS);
    if (validated.status !== 'validated') throw new Error(`proposal ${proposal.id} did not validate`);
    return proposal.id;
  });

  // award 1: four-eyes approval, CORRECT revision (votes), REPLACE revision (player changes, old row void).
  const a1 = await award(1);
  const p1 = await proposeAndValidate(a1, creator, { clubSlug: clubSlugs[0] });
  const approved1 = await approve(approver, p1, { decisionNote: NOTE }, CURATED_OPEN);
  const corrected = await revise(p1, { votes: '15', position: 'Centre' });
  const replaced = await revise(corrected.revision.id, { playerIdentity: players[1].identity, playerNameRaw: players[1].name });

  // award 2: a rejection, and a pending proposal revised before approval.
  const a2 = await award(2);
  const rejected = await withAwardProposalExecutor(async (ex) => {
    const proposal = await createProposal(creator, ex, input(a2, { votes: '3' }), OPTIONS);
    await validateProposal(creator, ex, { proposalId: proposal.id }, OPTIONS);
    return rejectProposal(approver, ex, { proposalId: proposal.id, decisionNote: 'SYNTHETIC reason: duplicate of another entry' });
  });
  const pendingRevised = await withAwardProposalExecutor(async (ex) => {
    const proposal = await createProposal(creator, ex, input(a2, { playerIdentity: players[1].identity, playerNameRaw: players[1].name }), OPTIONS);
    return reviseProposal(creator, ex, { proposalId: proposal.id, changes: { votes: '22' }, decisionNote: NOTE }, OPTIONS);
  });
  const p2 = pendingRevised.revision.id;
  await withAwardProposalExecutor((ex) => validateProposal(creator, ex, { proposalId: p2 }, OPTIONS));
  await approve(approver, p2, { decisionNote: NOTE }, CURATED_OPEN);

  // award 3: sealed season (audited correction), then a void and a reinstatement of the canonical winner.
  const a3 = await award(3);
  const p3 = await proposeAndValidate(a3, creator, { season: SEALED_SEASON, votes: '7' });
  await approve(approver, p3, { decisionNote: NOTE }, CURATED_SEALED);
  const winnerAt = async (slug: string) => owner<{ id: number; updatedAt: string }[]>`
    SELECT w.id::int AS id, w.updated_at::text AS "updatedAt" FROM award_winners w JOIN awards a ON a.id = w.award_id
     WHERE a.slug = ${slug} AND w.status = 'active' ORDER BY w.id LIMIT 1`;
  const [w3] = await winnerAt(a3);
  const voided = await voidAwardWinner({ rowId: w3.id, expectedUpdatedAt: w3.updatedAt, adminUserId: approver.userId, reason: 'SYNTHETIC void for the rehearsal', note: NOTE });
  if (!(voided as { ok?: boolean }).ok) throw new Error(`void refused: ${JSON.stringify(voided)}`);
  const [w3v] = await owner<{ id: number; updatedAt: string }[]>`SELECT id::int AS id, updated_at::text AS "updatedAt" FROM award_winners WHERE id = ${w3.id}`;
  const reinstated = await reinstateAwardWinner({ rowId: w3v.id, expectedUpdatedAt: w3v.updatedAt, adminUserId: approver.userId, note: NOTE });
  if (!(reinstated as { ok?: boolean }).ok) throw new Error(`reinstate refused: ${JSON.stringify(reinstated)}`);

  // award 4: self-approval with an attestation (recorded in the ledger).
  const a4 = await award(4);
  const p4 = await proposeAndValidate(a4, creator, { votes: '4' });
  await approve(creator, p4, { decisionNote: NOTE, selfApprovalAttestation: ATTESTATION }, CURATED_OPEN);

  created.curated = {
    awards: [a1, a2, a3, a4],
    approved1: approved1.promotion.entityKey,
    correctedMode: corrected.revised.mode,
    replacedMode: replaced.revised.mode,
    rejectedStatus: rejected.status,
    voidOk: (voided as { ok?: boolean }).ok, reinstateOk: (reinstated as { ok?: boolean }).ok,
  };
}

/* ------------------------------------------------------------------ Brownlow */

async function brownlow(deciderId: number): Promise<void> {
  const tags = ['a1', 'a2', 'a3', 'c1', 'c2', 'c3', 'e1'];
  const ids: Record<string, number> = {};
  for (const tag of tags) ids[tag] = (await newPlayer(`BL-${tag}`)).id;
  const stored: [number, string, number, number | null, boolean, number][] = [
    [BROWNLOW_SEASONS.sealed, 'a1', 30, null, true, 1], [BROWNLOW_SEASONS.sealed, 'a2', 25, 2, false, 2], [BROWNLOW_SEASONS.sealed, 'a3', 20, 3, false, 3],
    [BROWNLOW_SEASONS.tie, 'c1', 30, 1, true, 1], [BROWNLOW_SEASONS.tie, 'c2', 30, 1, true, 1], [BROWNLOW_SEASONS.tie, 'c3', 20, 3, false, 3],
    [BROWNLOW_SEASONS.open, 'e1', 10, 1, true, 1],
  ];
  for (const [season, tag, votes, rank, winner, voteRank] of stored) {
    await owner`INSERT INTO brownlow_season_votes (season, player_id, votes, vote_rank, eligible_rank, is_ineligible, is_winner)
                VALUES (${season}, ${ids[tag]}, ${votes}, ${voteRank}, ${rank}, false, ${winner})`;
  }
  // The query-level service the operations centre calls (its wrapper imports Next request APIs that cannot load
  // outside Next, so the auth_audit_log row it adds is not produced here; the ledger and data_edits rows are).
  const decide = async (season: number, tag: string, verdict: 'eligible' | 'ineligible', expected: number | null, note = NOTE) => {
    const result = await recordBrownlowEligibilityDecision(executor, {
      season, playerId: ids[tag], verdict, citation: CITATION, note, expectedCurrentDecisionId: expected, decidedBy: deciderId,
      viewer: { role: 'super_admin', canManageAdmins: true }, sealed: sealedSeasonsFrom(BROWNLOW_REGISTRY), publicationRegistry: BROWNLOW_REGISTRY });
    if (!result.ok) throw new Error(`Brownlow decision refused: ${season} ${tag} ${result.refusal.code}: ${result.refusal.message}`);
    return result.decision.id;
  };
  const first = await decide(BROWNLOW_SEASONS.sealed, 'a1', 'ineligible', null); // sealed: audited correction, the runner-up wins
  const reversed = await decide(BROWNLOW_SEASONS.sealed, 'a1', 'eligible', first, `${NOTE} Reversed on appeal.`); // supersedes the first
  const tie = await decide(BROWNLOW_SEASONS.tie, 'c2', 'ineligible', null); // the other tied player wins alone
  const open = await decide(BROWNLOW_SEASONS.open, 'e1', 'eligible', null); // open season: basis open_season, no correction
  created.brownlow = { players: ids, decisions: { first, reversed, tie, open } };
}

/* ------------------------------------------------------------------ Coleman */

async function coleman(actorId: number): Promise<void> {
  const letters = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] as const;
  type Letter = (typeof letters)[number];
  const clubOf: Record<Letter, number> = { A: 0, B: 0, C: 1, D: 1, E: 2, F: 2, G: 3, H: 3 };
  const matches = [
    { key: 'm1', home: 0, away: 1, final: false }, { key: 'm2', home: 2, away: 3, final: false }, { key: 'm3', home: 0, away: 2, final: false },
    { key: 'm4', home: 1, away: 3, final: false }, { key: 'f1', home: 0, away: 1, final: true },
  ] as const;
  const goals: Record<string, number> = { 'A:m1': 3, 'A:m3': 2, 'A:f1': 1, 'B:m1': 1, 'B:m3': 1, 'C:m1': 2, 'C:m4': 1, 'C:f1': 2, 'D:m4': 2, 'E:m2': 3, 'F:m3': 1, 'G:m2': 1, 'G:m4': 2 };
  await owner`INSERT INTO seasons (year, league, status) VALUES (${COLEMAN_SEASON}, 'AFL', 'complete'::season_status) ON CONFLICT (year) DO NOTHING`;
  const clubIds: number[] = [];
  for (let i = 0; i < 4; i += 1) clubIds.push(await newClub(`${MARKER}-cl-${i}`, false));
  const playerIds = {} as Record<Letter, number>;
  for (const letter of letters) playerIds[letter] = (await newPlayer(`CM-${letter}`)).id;
  const matchIds: Record<string, number> = {};
  for (const m of matches) {
    const [row] = await owner<Id[]>`
      INSERT INTO matches (match_key, season, round_code, round_number, round_type, is_final, match_date, venue_raw,
                           home_club_id, away_club_id, home_score, away_score, result, winner_club_id, margin, attendance_status)
      VALUES (${`${MARKER}|${m.key}`}, ${COLEMAN_SEASON}, ${m.final ? 'EF' : '1'}, ${m.final ? null : 1},
              ${m.final ? 'elimination_final' : 'home_and_away'}::round_type, ${m.final}, ${`${COLEMAN_SEASON}-04-01`}, ${`${MARKER} Oval`},
              ${clubIds[m.home]}, ${clubIds[m.away]}, 60, 30, 'home_win'::match_result, ${clubIds[m.home]}, 30, 'not_collected'::coverage_status)
      RETURNING id::int AS id`;
    matchIds[m.key] = row.id;
    for (const letter of letters) {
      if (clubOf[letter] !== m.home && clubOf[letter] !== m.away) continue;
      await owner`INSERT INTO player_match_stats (player_id, match_id, club_id, goals)
                  VALUES (${playerIds[letter]}, ${row.id}, ${clubIds[clubOf[letter]]}, ${goals[`${letter}:${m.key}`] ?? 0})`;
    }
  }
  const publish = async (note: string): Promise<ColemanPublicationOutcome> => {
    const derivation = await loadColemanDerivationInput(executor, {
      season: COLEMAN_SEASON, settled: true, derivedAt: DERIVED_AT, registry: COLEMAN_REGISTRY, contract: loadColemanContract() });
    return publishColemanResult(executor, {
      derivation, correction: { workflow: 'derived_award_publication', actorUserId: actorId, note, evidenceRef: `${MARKER}-evidence` },
      publishedBy: actorId, viewer: { role: 'super_admin', canManageAdmins: true } }, { projection: colemanAwardWinnerProjection });
  };
  const outcomes: string[] = [];
  const record = (outcome: ColemanPublicationOutcome) => {
    if (!outcome.ok) throw new Error(`Coleman publication refused: ${outcome.refusal.code}: ${outcome.refusal.message}`);
    outcomes.push(outcome.outcome);
    return outcome;
  };
  const first = record(await publish(NOTE));
  record(await publish(NOTE)); // an idempotent rerun: unchanged
  // An authorised correction of a goal fact (synthetic): the leader falls to a three-way tie, so the next
  // publication supersedes the first, voids A and inserts C, E and G.
  await owner`UPDATE player_match_stats SET goals = 0 WHERE player_id = ${playerIds.A} AND match_id = ${matchIds.m1}`;
  const second = record(await publish(`${NOTE} Corrected goal fact.`));
  created.coleman = { outcomes, firstId: first.id, secondId: second.id, secondSupersedes: second.supersededId };
}

async function main(): Promise<void> {
  const out = process.argv[2];
  if (!out) throw new Error('usage: rollback-populate.ts <out.json>');
  await preflight();
  const creatorId = await newUser('creator', 'super_admin');
  const approverId = await newUser('approver', 'super_admin');
  const creator: CuratedAwardsViewer = { role: 'super_admin', canManageAdmins: true, userId: creatorId };
  const approver: CuratedAwardsViewer = { role: 'super_admin', canManageAdmins: true, userId: approverId };
  for (const season of [SEALED_SEASON, OPEN_SEASON, ...Object.values(BROWNLOW_SEASONS)]) {
    await owner`INSERT INTO seasons (year, league, status) VALUES (${season}, 'AFL', 'complete'::season_status) ON CONFLICT (year) DO NOTHING`;
  }
  players.push(await newPlayer('C1'), await newPlayer('C2'));
  const clubs = [await newClub(`${MARKER}-club-1`, true), await newClub(`${MARKER}-club-2`, true)];
  created.users = { creatorId, approverId };
  created.clubs = clubs;
  await curated(creator, approver, [`${MARKER}-club-1`, `${MARKER}-club-2`]);
  await brownlow(approverId);
  await coleman(creatorId);
  const counts: Record<string, number> = {};
  for (const table of ['award_proposals', 'award_proposal_decisions', 'derived_award_results', 'brownlow_eligibility_decisions', 'derived_award_projections']) {
    const [row] = await owner.unsafe(`SELECT count(*)::int AS n FROM ${table}`);
    counts[table] = row.n;
    if (row.n === 0) throw new Error(`Populate left ${table} empty`);
  }
  writeFileSync(out, `${JSON.stringify({ database, counts, created }, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ database, counts }));
}

main().then(
  async () => { await importSql.end({ timeout: 5 }); await owner.end({ timeout: 5 }); },
  async (error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
    await importSql.end({ timeout: 5 }).catch(() => undefined);
    await owner.end({ timeout: 5 }).catch(() => undefined);
  },
);
