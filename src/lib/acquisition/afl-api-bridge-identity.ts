/**
 * AFLDB-ISSUE-241 / AFLDB-ISSUE-240 — the AFL API bridge artefact's stable-identity contract,
 * the bridge loader's pure per-provider planner, and the semantic key of the
 * `afl_api_identity_contradiction` finding it records.
 *
 * WHY (ISSUE-241). A bridge artefact used to name each linked provider's player by a bare,
 * database-local `candidate_player_id`. A rebuild or promotion renumbers `players.id`, so the
 * same integer can later name a different person, and an `--apply` would then link the provider
 * to the wrong player. Only one of the four evidence classes had any provenance gate, and that
 * gate bound a database NAME, not a lineage: an `afldb_test`-built artefact still passed it after
 * `afldb_test` itself had been rebuilt.
 *
 * THE CONTRACT. An artefact is loadable only when it declares
 * `player_identity_contract: "afldb.afl_api_bridge.stable_identity.v1"` and every `linked` row
 * carries `candidate_player_identity`: the accepted stable identity of ISSUE-237 §5 (the
 * unprefixed trusted AFL Tables profile path, otherwise the `manual_admin_edit` token). The
 * loader resolves that identity on the TARGET with the one reverse lookup every AFL API
 * lifecycle already uses (`classifyAflApiReverseIdentity`, continuity rules included), so a
 * renumbered player resolves to its new id and a stale id is never read for identity.
 *
 * `candidate_player_id` is NON-AUTHORITATIVE. It may still appear, as a diagnostic hint written
 * by the emitter, and the ONE documented rule is: it is never used to choose a player. A hint
 * that differs from the resolved player is reported (`hintMismatches`), never trusted and never
 * a reason to link elsewhere. An artefact without the contract — every artefact built before
 * ISSUE-241 — is refused outright, never upgraded: a bare id cannot be proven, after the fact,
 * to name the same person in any database that has since been rebuilt or promoted.
 *
 * WHY (ISSUE-240). The loader opened a new `afl_api_identity_contradiction` row every time it
 * met the same contradiction. The finding now carries `data_issues.issue_key`, a deterministic
 * key over the contradiction's SEMANTIC identity (below), and the insert relies on migration
 * 076's partial unique index `uq_data_issues_open_by_key`: while one open row with that key
 * exists, a replay records nothing new. The first row — its evidence and provenance — is never
 * rewritten. A materially different contradiction has a different key and is recorded.
 *
 * Pure: no database, clock or network access. The adapter is
 * `tools/migration/import_afl_api_player_bridge.ts`.
 */
import { createHash } from 'node:crypto';

import {
  AFL_API_PROVIDER_ID_RE,
  aflApiContinuityContradictionText,
  isAflApiImporterMatchMethod,
  type AflApiForwardIdentityResult,
  type AflApiImporterMatchMethod,
  type AflApiPlayerRemapResult,
} from './afl-api-adjudication';
import { canonicalJson } from './observations';

/* ------------------------------------------------------------------ *
 * 1. The artefact contract (ISSUE-241)
 * ------------------------------------------------------------------ */

/** The one value an identity-bound artefact declares at its top level. */
export const AFL_API_BRIDGE_IDENTITY_CONTRACT = 'afldb.afl_api_bridge.stable_identity.v1';

/** The contract field names, in one place for the emitter, the loader and the consumers. */
export const AFL_API_BRIDGE_CONTRACT_FIELD = 'player_identity_contract';
export const AFL_API_BRIDGE_IDENTITY_FIELD = 'candidate_player_identity';
/** Written by an emitter beside a `null` identity, so the refusal names the reason. */
export const AFL_API_BRIDGE_IDENTITY_REFUSAL_FIELD = 'candidate_player_identity_refusal';

/** One `linked` provider row of an identity-bound artefact, validated. */
export type AflApiBridgeLinkedRow = {
  externalId: string;
  /** The §5 stable identity the loader resolves. The ONLY field that chooses a player. */
  identity: string;
  /** `candidate_player_id`, when present. Diagnostic only (see the header). */
  hintPlayerId: number | null;
  observedName: string | null;
  evidenceSummary: string | null;
  /** The artefact row as written, carried into the import batch's rejection payload. */
  raw: Record<string, unknown>;
};

const PREFIXED_IDENTITY_RE = /^(afltables|manual_admin_edit):/;

const isPositiveSafeInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0;

const optionalText = (value: unknown): string | null => (typeof value === 'string' ? value : null);

/**
 * Validate an artefact against the identity contract and return its `linked` rows, sorted by
 * provider id. Every problem is returned (never just the first), and any problem means the
 * artefact is refused as a whole before a connection is opened: a missing or malformed identity
 * is an artefact defect, not a per-row target condition.
 */
export function aflApiBridgeLinkedRows(
  artefact: Record<string, unknown>,
  evidenceClass: AflApiImporterMatchMethod,
): { rows: AflApiBridgeLinkedRow[]; problems: string[] } {
  if (artefact[AFL_API_BRIDGE_CONTRACT_FIELD] !== AFL_API_BRIDGE_IDENTITY_CONTRACT) {
    return {
      rows: [],
      problems: [
        `the artefact declares ${AFL_API_BRIDGE_CONTRACT_FIELD}=${JSON.stringify(artefact[AFL_API_BRIDGE_CONTRACT_FIELD] ?? null)}, `
        + `not ${JSON.stringify(AFL_API_BRIDGE_IDENTITY_CONTRACT)}. It is lineage-unbound: its candidate_player_id `
        + 'values are database-local surrogates that a rebuild or promotion may have renumbered, so it is refused '
        + 'and never upgraded (AFLDB-ISSUE-241). Re-emit the evidence with an identity-binding emitter.',
      ],
    };
  }
  const providers = artefact.providers;
  if (providers === null || typeof providers !== 'object' || Array.isArray(providers)) {
    return { rows: [], problems: ['the artefact has no providers object'] };
  }

  const rows: AflApiBridgeLinkedRow[] = [];
  const problems: string[] = [];
  const providerByIdentity = new Map<string, string>();
  for (const [externalId, value] of Object.entries(providers as Record<string, unknown>)) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) continue;
    const row = value as Record<string, unknown>;
    if (row.disposition !== 'linked') continue;
    const at = `linked provider ${externalId}`;

    if (!AFL_API_PROVIDER_ID_RE.test(externalId)) problems.push(`${at}: is not a CD_I provider id`);

    const identity = row[AFL_API_BRIDGE_IDENTITY_FIELD];
    if (typeof identity !== 'string' || identity.trim() === '') {
      const refusal = row[AFL_API_BRIDGE_IDENTITY_REFUSAL_FIELD];
      problems.push(`${at}: carries no ${AFL_API_BRIDGE_IDENTITY_FIELD}`
        + (typeof refusal === 'string' ? ` (emitter: ${refusal})` : ''));
      continue;
    }
    if (identity !== identity.trim()) {
      problems.push(`${at}: ${AFL_API_BRIDGE_IDENTITY_FIELD} has surrounding whitespace`);
      continue;
    }
    if (PREFIXED_IDENTITY_RE.test(identity)) {
      problems.push(`${at}: ${AFL_API_BRIDGE_IDENTITY_FIELD} '${identity}' is the prefixed form; the contract `
        + 'carries the unprefixed accepted identity (an AFL Tables profile path or a manual_admin_edit token)');
      continue;
    }

    const hint = row.candidate_player_id;
    if (hint !== undefined && hint !== null && !isPositiveSafeInteger(hint)) {
      problems.push(`${at}: candidate_player_id is present but is not a positive integer`);
    }

    // The manual class names the profile it relied on; it must be the identity it binds.
    const declaredProfile = row.canonical_afltables_profile_url;
    if (evidenceClass === 'afl_api_manual_adjudication' && declaredProfile !== undefined
        && declaredProfile !== identity) {
      problems.push(`${at}: canonical_afltables_profile_url ${JSON.stringify(declaredProfile)} is not its `
        + `${AFL_API_BRIDGE_IDENTITY_FIELD} '${identity}'`);
    }

    const earlier = providerByIdentity.get(identity);
    if (earlier !== undefined) {
      problems.push(`${at}: identity '${identity}' is already claimed by linked provider ${earlier} in the same artefact`);
    } else {
      providerByIdentity.set(identity, externalId);
    }

    rows.push({
      externalId,
      identity,
      hintPlayerId: isPositiveSafeInteger(hint) ? hint : null,
      observedName: optionalText(row.observed_name),
      evidenceSummary: optionalText(row.evidence_summary),
      raw: row,
    });
  }
  rows.sort((a, b) => (a.externalId < b.externalId ? -1 : a.externalId > b.externalId ? 1 : 0));
  return { rows, problems };
}

/* ------------------------------------------------------------------ *
 * 2. The contradiction finding's semantic key (ISSUE-240)
 * ------------------------------------------------------------------ */

export const AFL_API_CONTRADICTION_ISSUE_TYPE = 'afl_api_identity_contradiction';
export const AFL_API_CONTRADICTION_KEY_VERSION = 1;

export type AflApiContradictionKind = 'provider_already_linked' | 'player_already_linked';

/**
 * Everything that makes one contradiction materially different from another, and nothing else.
 * No timestamp, artefact path, batch id or free text. `existingPlayerRef` is the existing row's
 * player by stable identity; only when that player has none is it `player_id:<n>` (or
 * `null_player`), so two unidentified players are never merged into one finding.
 */
export type AflApiContradictionKeyFields = {
  kind: AflApiContradictionKind;
  externalId: string;
  evidenceClass: AflApiImporterMatchMethod;
  proposedPlayerIdentity: string;
  existingExternalId: string;
  existingStatus: string;
  existingMatchMethod: string | null;
  existingPlayerRef: string;
};

/** `afl_api_identity_contradiction:v1:<sha256 of the fields in a fixed order>`. */
export function aflApiContradictionIssueKey(fields: AflApiContradictionKeyFields): string {
  const ordered = [
    fields.kind, fields.externalId, fields.evidenceClass, fields.proposedPlayerIdentity,
    fields.existingExternalId, fields.existingStatus, fields.existingMatchMethod, fields.existingPlayerRef,
  ];
  const digest = createHash('sha256').update(canonicalJson(ordered), 'utf8').digest('hex');
  return `${AFL_API_CONTRADICTION_ISSUE_TYPE}:v${AFL_API_CONTRADICTION_KEY_VERSION}:${digest}`;
}

/** The existing row's player as the key names it (see `AflApiContradictionKeyFields`). */
export function aflApiExistingPlayerRef(
  playerId: number | null, forward: AflApiForwardIdentityResult | undefined,
): string {
  if (playerId === null) return 'null_player';
  if (forward?.ok) return forward.identity;
  return `player_id:${playerId}`;
}

/* ------------------------------------------------------------------ *
 * 3. The loader's pure planner (ISSUE-241; findings keyed per ISSUE-240)
 * ------------------------------------------------------------------ */

/** A live `afl_api` `external_identities` row, as the loader reads it. */
export type AflApiBridgeExistingRow = {
  /** `null` only for a row this same run plans to insert (it has no id until written). */
  id: number | null;
  externalId: string;
  status: string;
  matchMethod: string | null;
  playerId: number | null;
};

export type AflApiBridgeFinding = {
  kind: AflApiContradictionKind;
  externalId: string;
  /**
   * `data_issues.entity_id`: the existing `external_identities.id` the finding is about. `null`
   * when that row is one this same run inserts; the adapter writes the links first and fills it.
   */
  entityId: number | null;
  issueKey: string;
  keyFields: AflApiContradictionKeyFields;
  proposedPlayerId: number;
  hintPlayerId: number | null;
  existing: AflApiBridgeExistingRow & { playerRef: string };
  row: AflApiBridgeLinkedRow;
};

export type AflApiBridgePlan = {
  /** Any entry refuses the whole run; nothing is written. */
  stops: { externalId: string; reason: string }[];
  inserts: { externalId: string; playerId: number; row: AflApiBridgeLinkedRow }[];
  alreadyLinked: string[];
  /** The same no-op, against an ISSUE-235 human `resolved` row. */
  alreadyLinkedHuman: string[];
  contradictions: AflApiBridgeFinding[];
  playerCollisions: AflApiBridgeFinding[];
  /** Reported only: the hint named another player and was ignored. */
  hintMismatches: { externalId: string; hintPlayerId: number; resolvedPlayerId: number }[];
};

function remapStopReason(remap: AflApiPlayerRemapResult | undefined, identity: string): string | null {
  if (!remap) return `its identity '${identity}' was not resolved`;
  if (!remap.ok) {
    if (remap.reason === 'continuity_contradiction') {
      return `its identity '${identity}' ${aflApiContinuityContradictionText(remap)}`;
    }
    return remap.reason === 'ambiguous'
      ? `its identity '${identity}' names more than one player on the target`
      : `its identity '${identity}' names no player on the target`;
  }
  if (remap.remappedIdentity !== identity) {
    return `its identity '${identity}' resolved as '${remap.remappedIdentity}'`;
  }
  return null;
}

/**
 * The whole per-provider decision table, a pure function of the artefact rows, the target's
 * reverse resolution of each row's identity and the target's live `afl_api` rows. Rows are
 * decided in provider order, and a planned insert is visible to every later row, exactly as the
 * sequential write sees it.
 *
 * | Target state                                                  | Outcome                         |
 * |---------------------------------------------------------------|---------------------------------|
 * | identity unresolvable, ambiguous or continuity-contradicted   | STOP (whole run refuses)        |
 * | provider row exists, same resolved player                     | already linked (human if resolved) |
 * | provider row exists, another or no player                     | withheld: provider_already_linked |
 * | provider free, resolved player holds another afl_api row      | withheld: player_already_linked |
 * | provider free, player free                                    | INSERT                          |
 *
 * No existing row is ever updated or deleted, whichever writer (importer or ISSUE-235 human) owns
 * it; a human `resolved` row is only ever a no-op or the subject of a withheld finding.
 */
export function planAflApiBridgeImport(input: {
  evidenceClass: AflApiImporterMatchMethod;
  rows: readonly AflApiBridgeLinkedRow[];
  remapByIdentity: ReadonlyMap<string, AflApiPlayerRemapResult>;
  existingRows: readonly AflApiBridgeExistingRow[];
  /** Forward identity of every player that holds an `afl_api` row on the target. */
  forwardIdentityByPlayerId: ReadonlyMap<number, AflApiForwardIdentityResult>;
}): AflApiBridgePlan {
  if (!isAflApiImporterMatchMethod(input.evidenceClass)) {
    throw new Error(`planAflApiBridgeImport: unsupported evidence class ${String(input.evidenceClass)}`);
  }
  const plan: AflApiBridgePlan = {
    stops: [], inserts: [], alreadyLinked: [], alreadyLinkedHuman: [],
    contradictions: [], playerCollisions: [], hintMismatches: [],
  };
  const byExternalId = new Map<string, AflApiBridgeExistingRow>();
  const byPlayerId = new Map<number, AflApiBridgeExistingRow>();
  for (const row of input.existingRows) {
    byExternalId.set(row.externalId, row);
    if (row.playerId !== null) byPlayerId.set(row.playerId, row);
  }

  const finding = (
    kind: AflApiContradictionKind, row: AflApiBridgeLinkedRow, playerId: number, existing: AflApiBridgeExistingRow,
  ): AflApiBridgeFinding => {
    const playerRef = aflApiExistingPlayerRef(
      existing.playerId, existing.playerId === null ? undefined : input.forwardIdentityByPlayerId.get(existing.playerId));
    const keyFields: AflApiContradictionKeyFields = {
      kind, externalId: row.externalId, evidenceClass: input.evidenceClass,
      proposedPlayerIdentity: row.identity, existingExternalId: existing.externalId,
      existingStatus: existing.status, existingMatchMethod: existing.matchMethod, existingPlayerRef: playerRef,
    };
    return {
      kind, externalId: row.externalId, entityId: existing.id, issueKey: aflApiContradictionIssueKey(keyFields),
      keyFields, proposedPlayerId: playerId, hintPlayerId: row.hintPlayerId,
      existing: { ...existing, playerRef }, row,
    };
  };

  for (const row of [...input.rows].sort((a, b) => (a.externalId < b.externalId ? -1 : a.externalId > b.externalId ? 1 : 0))) {
    const remap = input.remapByIdentity.get(row.identity);
    const stop = remapStopReason(remap, row.identity);
    if (stop !== null || !remap || !remap.ok) {
      plan.stops.push({ externalId: row.externalId, reason: stop ?? 'unresolved' });
      continue;
    }
    const playerId = remap.newPlayerId;
    if (row.hintPlayerId !== null && row.hintPlayerId !== playerId) {
      plan.hintMismatches.push({ externalId: row.externalId, hintPlayerId: row.hintPlayerId, resolvedPlayerId: playerId });
    }

    const existing = byExternalId.get(row.externalId);
    if (existing) {
      if (existing.playerId === playerId) {
        (existing.status === 'resolved' ? plan.alreadyLinkedHuman : plan.alreadyLinked).push(row.externalId);
      } else {
        plan.contradictions.push(finding('provider_already_linked', row, playerId, existing));
      }
      continue;
    }

    const holder = byPlayerId.get(playerId);
    if (holder) {
      plan.playerCollisions.push(finding('player_already_linked', row, playerId, holder));
      continue;
    }

    plan.inserts.push({ externalId: row.externalId, playerId, row });
    // Visible to every later row: the sequential write would see this row too.
    const planned: AflApiBridgeExistingRow = {
      id: null, externalId: row.externalId, status: 'unique', matchMethod: input.evidenceClass, playerId,
    };
    byExternalId.set(row.externalId, planned);
    byPlayerId.set(playerId, planned);
  }
  return plan;
}

/** The `data_issues` description and details of one finding. The details keep every field the
 * pre-ISSUE-240 finding carried, so existing readers (`details->>'external_id'`) are unchanged. */
export function aflApiBridgeFindingRecord(f: AflApiBridgeFinding, provenance: {
  tool: string; artefactSha256: string;
}): { description: string; details: Record<string, unknown> } {
  const description = f.kind === 'provider_already_linked'
    ? `afl_api provider player ${f.externalId} bridge evidence (${f.keyFields.evidenceClass}) resolves `
      + `identity '${f.row.identity}' to player_id=${f.proposedPlayerId}, but external_identities.id=${f.entityId} `
      + 'already links this provider id to a different player. Withheld; the existing link was not modified.'
    : `afl_api provider player ${f.externalId} bridge evidence (${f.keyFields.evidenceClass}) resolves `
      + `identity '${f.row.identity}' to player_id=${f.proposedPlayerId}, but that player already holds afl_api `
      + `provider ${f.existing.externalId} (external_identities.id=${String(f.entityId)}). Withheld; the existing `
      + 'link was not modified.';
  const details: Record<string, unknown> = {
    kind: f.kind,
    source_key: 'afl_api',
    external_id: f.externalId,
    evidence_class: f.keyFields.evidenceClass,
    proposed_player_id: f.proposedPlayerId,
    proposed_player_identity: f.row.identity,
    candidate_player_id_hint: f.hintPlayerId,
    existing_status: f.existing.status,
    existing_match_method: f.existing.matchMethod,
    existing_player_id: f.existing.playerId,
    existing_player_ref: f.existing.playerRef,
    evidence_summary: f.row.evidenceSummary,
    dedup_key: { version: AFL_API_CONTRADICTION_KEY_VERSION, fields: f.keyFields },
    provenance: { tool: provenance.tool, artefact_sha256: provenance.artefactSha256 },
  };
  if (f.kind === 'player_already_linked') details.existing_external_id = f.existing.externalId;
  return { description, details };
}
