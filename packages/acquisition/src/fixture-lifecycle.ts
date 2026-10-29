/**
 * AFLDB V2 Launch F — the AFL API fixture LIFECYCLE and the feed STAGING step (AFLDB-ISSUE-229,
 * V2-GAP-008). PURE: no database, no IO, no network.
 *
 * Builds on `fixture-contract.ts` and never loosens it. `classifyAflApiFixtureStatus` and
 * `evaluateAflApiFixtureProjection` are unchanged: with no acknowledgement this module's outcome
 * for every status is exactly theirs.
 *
 * THE LIFECYCLE (owner instruction 2026-10-19: scheduled, rescheduled, postponed, cancelled,
 * abandoned and completed):
 *   - scheduled   `SCHEDULED` / `UNCONFIRMED_TEAMS` (observed, D-229-1 revised): a projection.
 *   - rescheduled not a provider status: the SAME provider id observed again with a different
 *                 round, date, time or venue. The writer's reconciliation derives it.
 *   - completed   `CONCLUDED` (observed): the match path owns it; the fixture is never mutated.
 *   - postponed / cancelled / abandoned: `POSTPONED`, `CANCELLED`, `ABANDONED`. NONE OF THESE
 *                 STRINGS HAS BEEN OBSERVED from the provider (runbook D-229-3: "Provider
 *                 postponement and cancellation statuses stay unsupported until observed." /
 *                 "No provider status maps automatically to `cancelled` or `void`."). So the
 *                 mapping exists but is NEVER automatic: a status applies only when the operator
 *                 names it in `acknowledgedUnobservedStatuses` for that run. Unacknowledged, it
 *                 refuses `status_unsupported` exactly as the contract does.
 *
 * A transition (postponed / cancelled / abandoned) never CREATES a fixture: it may only act on the
 * provider-owned row of the same provider id (the writer refuses `lifecycle_target_missing`), so an
 * unobserved status can never mint a fixture from a payload shape nobody has seen. It needs only the
 * record's identity (provider id, season, both clubs) to cross-check that row; it does not read the
 * start time, because a postponed or cancelled match's start time is exactly what is no longer true.
 *
 * Mapping onto the AFLDB lifecycle (`scheduled | cancelled | void`, migration 097; never extended):
 *   postponed -> status `scheduled`, match_date / match_time NULL (097 D-5: NULL is TBC)
 *   cancelled -> status `cancelled`, status_reason naming the provider status and id
 *   abandoned -> status `cancelled`, status_reason `abandoned: ...` (the scheduled event did not
 *                happen as a completed match; any partial result belongs to the match path)
 * Nothing maps to `void`: void records an AFLDB data-entry error, never a provider event.
 */
import {
  classifyAflApiFixtureStatus,
  detectAflApiFixtureCollisions,
  evaluateAflApiFixtureProjection,
  type AflApiFixtureCollision,
  type AflApiFixtureContractContext,
  type AflApiFixtureProjection,
  type AflApiFixtureRefusal,
} from './fixture-contract';

/** The unobserved provider statuses this lifecycle can map, each only when acknowledged. */
export const AFL_API_FIXTURE_UNOBSERVED_TRANSITIONS = {
  POSTPONED: 'postponed',
  CANCELLED: 'cancelled',
  ABANDONED: 'abandoned',
} as const;

export type AflApiFixtureTransitionKind =
  (typeof AFL_API_FIXTURE_UNOBSERVED_TRANSITIONS)[keyof typeof AFL_API_FIXTURE_UNOBSERVED_TRANSITIONS];

/** Validates an operator's acknowledgement list: exact provider spellings only, no duplicates. */
export function parseAcknowledgedUnobservedStatuses(values: readonly string[]): ReadonlySet<string> {
  const known = Object.keys(AFL_API_FIXTURE_UNOBSERVED_TRANSITIONS);
  const out = new Set<string>();
  for (const value of values) {
    if (!known.includes(value)) {
      throw new Error(`'${value}' is not an acknowledgeable status; expected one of ${known.join(', ')} (exact spelling).`);
    }
    if (out.has(value)) throw new Error(`'${value}' is acknowledged twice.`);
    out.add(value);
  }
  return out;
}

export type AflApiFixtureLifecycleRefusalCode =
  | AflApiFixtureRefusal['code']
  | 'competition_season_mismatch'
  | 'feed_collision';

export type AflApiFixtureLifecycleRefusal = { code: AflApiFixtureLifecycleRefusalCode; detail: string };

export type AflApiFixtureTransition = {
  kind: AflApiFixtureTransitionKind;
  providerId: string;
  providerStatus: string;
  season: number;
  homeClubHist: string;
  awayClubHist: string;
};

export type AflApiFixtureLifecycleEvaluation =
  | { ok: true; kind: 'scheduled'; projection: AflApiFixtureProjection }
  | { ok: true; kind: 'transition'; transition: AflApiFixtureTransition }
  | { ok: true; kind: 'completed'; providerId: string | null; providerStatus: string }
  | { ok: true; kind: 'deferred'; providerId: string | null; providerStatus: string }
  | { ok: false; providerId: string | null; providerStatus: string | null; refusals: readonly AflApiFixtureLifecycleRefusal[] };

function asObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** The identity a transition needs, each part resolved through the declared identities only. */
function transitionIdentity(
  row: Record<string, unknown>, ctx: AflApiFixtureContractContext,
): { providerId: string; season: number; homeClubHist: string; awayClubHist: string } | AflApiFixtureLifecycleRefusal[] {
  const refusals: AflApiFixtureLifecycleRefusal[] = [];
  const providerId = nonEmptyString(row.providerId);
  if (providerId === null) refusals.push({ code: 'provider_id_missing', detail: 'providerId is missing; there is no durable identity (D-229-7).' });
  const compSeasonId = nonEmptyString(asObject(row.compSeason)?.providerId);
  let season: number | null = null;
  for (const [year, identity] of ctx.identities.seasons) if (identity.providerId === compSeasonId) season = year;
  if (season === null) refusals.push({ code: 'season_unresolved', detail: 'compSeason.providerId is not declared in afl-api-identities.json seasons.' });
  const hist = (side: 'home' | 'away'): string | null => {
    const id = nonEmptyString(asObject(asObject(row[side])?.team)?.providerId);
    const identity = id === null ? undefined : ctx.identities.teams.get(id);
    if (identity === undefined) {
      refusals.push({ code: 'team_unmapped', detail: `${side === 'home' ? 'Home' : 'Away'} team provider id '${id ?? ''}' is not in afl-api-identities.json teams.` });
      return null;
    }
    return identity.hist;
  };
  const homeClubHist = hist('home');
  const awayClubHist = hist('away');
  if (homeClubHist !== null && homeClubHist === awayClubHist) {
    refusals.push({ code: 'clubs_identical', detail: `Home and away both resolve to club '${homeClubHist}'.` });
  }
  if (refusals.length > 0 || providerId === null || season === null || homeClubHist === null || awayClubHist === null) return refusals;
  return { providerId, season, homeClubHist, awayClubHist };
}

/**
 * Evaluates one RAW season-feed record against the lifecycle. Never throws on a malformed record.
 * `acknowledged` is the operator's per-run list (see `parseAcknowledgedUnobservedStatuses`).
 */
export function evaluateAflApiFixtureLifecycle(
  record: unknown, ctx: AflApiFixtureContractContext, acknowledged: ReadonlySet<string> = new Set(),
): AflApiFixtureLifecycleEvaluation {
  const row = asObject(record);
  const providerId = nonEmptyString(row?.providerId);
  const status = typeof row?.status === 'string' ? row.status : null;
  if (row === null || status === null) {
    const result = evaluateAflApiFixtureProjection(record, ctx);
    return { ok: false, providerId, providerStatus: status, refusals: result.ok ? [] : result.refusals };
  }

  const transitionKind = Object.prototype.hasOwnProperty.call(AFL_API_FIXTURE_UNOBSERVED_TRANSITIONS, status)
    ? AFL_API_FIXTURE_UNOBSERVED_TRANSITIONS[status as keyof typeof AFL_API_FIXTURE_UNOBSERVED_TRANSITIONS]
    : null;
  if (transitionKind !== null && acknowledged.has(status)) {
    const identity = transitionIdentity(row, ctx);
    if (Array.isArray(identity)) return { ok: false, providerId, providerStatus: status, refusals: identity };
    return { ok: true, kind: 'transition', transition: { kind: transitionKind, providerStatus: status, ...identity } };
  }

  const statusClass = classifyAflApiFixtureStatus(status);
  if (statusClass.kind === 'concluded') return { ok: true, kind: 'completed', providerId, providerStatus: status };
  if (statusClass.kind === 'defer') return { ok: true, kind: 'deferred', providerId, providerStatus: status };

  const result = evaluateAflApiFixtureProjection(record, ctx);
  if (result.ok) return { ok: true, kind: 'scheduled', projection: result.projection };
  return { ok: false, providerId, providerStatus: status, refusals: result.refusals };
}

// ---------------------------------------------------------------------------
// Staging: a whole retained season feed -> the validated, identity-bearing set the writer reconciles
// ---------------------------------------------------------------------------

export type AflApiFixtureStageRefusal = {
  providerId: string | null;
  providerStatus: string | null;
  refusals: readonly AflApiFixtureLifecycleRefusal[];
};

export type AflApiFixtureStage = {
  season: number;
  compSeasonProviderId: string;
  scheduled: readonly AflApiFixtureProjection[];
  transitions: readonly AflApiFixtureTransition[];
  completed: readonly string[];
  deferred: readonly { providerId: string | null; providerStatus: string }[];
  refused: readonly AflApiFixtureStageRefusal[];
  collisions: readonly AflApiFixtureCollision[];
  /** Every observed status string with its count, verbatim (the evidence surface, B2). */
  statusCounts: Readonly<Record<string, number>>;
};

/**
 * Stages a whole season feed. Fail-closed rules beyond the per-record contract:
 *   - every record must name the expected AFL premiership compSeason (competition AND season);
 *   - a feed-level identity collision (duplicate provider id, two ids for one fixture, swapped
 *     orientation) refuses every record it names.
 * The stage is deterministic: outputs are sorted by provider id.
 */
export function stageAflApiFixtureFeed(
  records: readonly unknown[], ctx: AflApiFixtureContractContext,
  options: { season: number; acknowledgedUnobservedStatuses?: ReadonlySet<string> },
): AflApiFixtureStage {
  const seasonIdentity = ctx.identities.seasons.get(options.season);
  if (seasonIdentity === undefined) {
    throw new Error(`Season ${options.season} is not declared in afl-api-identities.json; there is no compSeason to validate the feed against.`);
  }
  const acknowledged = options.acknowledgedUnobservedStatuses ?? new Set<string>();
  const statusCounts: Record<string, number> = {};
  const scheduled: AflApiFixtureProjection[] = [];
  const transitions: AflApiFixtureTransition[] = [];
  const completed: string[] = [];
  const deferred: { providerId: string | null; providerStatus: string }[] = [];
  const refused: AflApiFixtureStageRefusal[] = [];

  const collisions = detectAflApiFixtureCollisions(records, ctx);
  const collided = new Map<string, AflApiFixtureCollision[]>();
  for (const collision of collisions) {
    for (const id of collision.providerIds) collided.set(id, [...(collided.get(id) ?? []), collision]);
  }

  for (const record of records) {
    const row = asObject(record);
    const status = typeof row?.status === 'string' ? row.status : '(missing)';
    statusCounts[status] = (statusCounts[status] ?? 0) + 1;
    const providerId = nonEmptyString(row?.providerId);
    const compSeasonId = nonEmptyString(asObject(row?.compSeason)?.providerId);

    if (compSeasonId !== seasonIdentity.providerId) {
      refused.push({
        providerId, providerStatus: typeof row?.status === 'string' ? row.status : null,
        refusals: [{
          code: 'competition_season_mismatch',
          detail: `compSeason '${compSeasonId ?? ''}' is not ${seasonIdentity.providerId} (AFL premiership ${options.season}).`,
        }],
      });
      continue;
    }
    const evaluation = evaluateAflApiFixtureLifecycle(record, ctx, acknowledged);
    if (!evaluation.ok) {
      refused.push({ providerId: evaluation.providerId, providerStatus: evaluation.providerStatus, refusals: evaluation.refusals });
      continue;
    }
    if (evaluation.kind === 'completed') { if (evaluation.providerId !== null) completed.push(evaluation.providerId); continue; }
    if (evaluation.kind === 'deferred') { deferred.push({ providerId: evaluation.providerId, providerStatus: evaluation.providerStatus }); continue; }

    const id = evaluation.kind === 'scheduled' ? evaluation.projection.identity.sourceRecordId : evaluation.transition.providerId;
    const hits = collided.get(id);
    if (hits !== undefined) {
      refused.push({
        providerId: id, providerStatus: status,
        refusals: hits.map((hit) => ({ code: 'feed_collision' as const, detail: `${hit.code}: ${hit.detail}` })),
      });
      continue;
    }
    if (evaluation.kind === 'scheduled') scheduled.push(evaluation.projection);
    else transitions.push(evaluation.transition);
  }

  const byId = <T>(idOf: (item: T) => string | null) => (a: T, b: T) => (idOf(a) ?? '').localeCompare(idOf(b) ?? '');
  return {
    season: options.season,
    compSeasonProviderId: seasonIdentity.providerId,
    scheduled: scheduled.sort(byId((p) => p.identity.sourceRecordId)),
    transitions: transitions.sort(byId((t) => t.providerId)),
    completed: completed.sort(),
    deferred: deferred.sort(byId((d) => d.providerId)),
    refused: refused.sort(byId((r) => r.providerId)),
    collisions,
    statusCounts,
  };
}
