import 'server-only';

import postgres from 'postgres';

import {
  CuratedAwardError,
  type ApprovedWinnerRevisionPort,
  type ApprovedWinnerRevisionRequest,
  type ApprovedWinnerRevisionResult,
  type AwardPromotionPort,
  type AwardPromotionRequest,
  type AwardPromotionResult,
} from '@afldb/admin';
import {
  assertTestProcessDsn,
  nativeTransactionOf,
  postgresExecutor,
  type SqlExecutor,
  type TransactionalSqlExecutor,
} from '@afldb/db';

import {
  awardWinnerPaths,
  insertAwardWinner,
  readAwardWinnerInTx,
  reviseApprovedAwardWinnerInTx,
} from '@/db/queries/admin-awards';

/**
 * Curated-award approval, wired to production (AFLDB V2 Stage 4, docs/v2/adr/0008-curated-awards.md).
 *
 * `@afldb/admin` owns the proposal workflow as pure services over a SQL port and deliberately does
 * NOT import this module: it is server-only and `admin-awards.ts` reaches `@/db/client`. This file is
 * the one place the two meet.
 *
 * APPROVAL PROMOTES THROUGH THE EXISTING AUDITED PATH. `insertAwardWinner` (unchanged apart from
 * being exported) writes the `award_winners` row, the `data_overrides` row that survives a rebuild,
 * the `data_edits` audit row and recomputes the award span, all on the transaction it is given. The
 * service hands it the SAME transaction that writes the proposal's status and ledger row, so the
 * whole approval commits or rolls back as one. Nothing here copies that function's SQL.
 *
 * The proposal is cross-referenced from the canonical audit row: `auditExtra` adds the proposal id,
 * key, revision and evidence to `data_edits.new_values`.
 *
 * NOT RUN against a database from the V2 workstation (plan D2/R-017). tests/v2-curated-awards.test.ts
 * pins the mapping with the promotion function mocked; the PostgreSQL behaviour of `insertAwardWinner`
 * itself is covered by tests/integration/admin-awards.test.ts, unchanged.
 *
 * REVALIDATION (V2-GAP-024). The port returns the public paths the created row moves, computed
 * server-side with `awardWinnerPaths` from the row it just wrote. The caller posts them to
 * /admin/awards/revalidate after success; nothing here (or in any server action) calls
 * `revalidatePath`, which hangs the client (see CLAUDE.md known traps).
 *
 * APPROVED REVISIONS (V2-GAP-018). `awardWinnerRevisionPort` wires the revision service to the
 * tx-level replace/correct variants extracted from `replaceAwardWinner` / `correctAwardWinner`
 * (`reviseApprovedAwardWinnerInTx`), on the SAME transaction as the proposal rows and ledger.
 */

type RollbackLike = { name?: unknown; reason?: unknown; detail?: unknown };

/** `RollbackRefusal` (admin-awards.ts) is module-private, so it is recognised by name. */
function rollbackRefusalDetail(error: unknown): string | null {
  if (!(error instanceof Error)) return null;
  const candidate = error as Error & RollbackLike;
  return candidate.name === 'RollbackRefusal'
    ? `${String(candidate.reason ?? 'refused')}: ${String(candidate.detail ?? error.message)}`
    : null;
}

/** The production {@link AwardPromotionPort}: `insertAwardWinner` on the service's own transaction. */
export const awardWinnerPromotionPort: AwardPromotionPort = {
  async promote(tx: SqlExecutor, request: AwardPromotionRequest): Promise<AwardPromotionResult> {
    const native = nativeTransactionOf(tx);
    if (!native) {
      // Refuse rather than write outside the approval's transaction.
      throw new CuratedAwardError(
        'promotion_refused',
        'The promotion port needs the postgres.js transaction executor made by withAwardProposalExecutor().',
      );
    }
    try {
      const created = await insertAwardWinner(native, {
        awardId: request.awardId,
        season: request.season,
        playerId: request.playerId,
        playerNameRaw: request.playerNameRaw,
        clubId: request.clubId,
        votes: request.votes,
        position: request.position,
        isCaptain: request.isCaptain,
        isViceCaptain: request.isViceCaptain,
        note: request.note,
        adminUserId: request.adminUserId,
        adminNote: request.adminNote,
        sealWorkflow: 'curated_award_approval',
        confirmDuplicate: request.confirmDuplicate,
        auditExtra: {
          curated_proposal_id: request.proposalId,
          curated_proposal_key: request.proposalKey,
          curated_proposal_revision: request.revision,
          curated_source_kind: request.evidence.sourceKind,
          curated_source_url: request.evidence.sourceUrl,
          curated_citation: request.evidence.citation,
          curated_acquired_on: request.evidence.acquiredOn,
        },
      });
      const row = await readAwardWinnerInTx(native, created.rowId);
      return { entityKey: created.entityKey, revalidatePaths: row ? awardWinnerPaths(row) : [] };
    } catch (error) {
      const detail = rollbackRefusalDetail(error);
      if (detail !== null) throw new CuratedAwardError('promotion_refused', detail);
      throw error;
    }
  },
};

/**
 * A refusal from the approved-revision lookup/lifecycle. `not_found` and `invalid_transition` are
 * exactly "the approved winner is missing or void" (the only places the lifecycle raises them); every
 * other reason is the existing replace/correct rule refusing, surfaced as `promotion_refused`.
 */
function revisionRefusal(error: unknown): CuratedAwardError | null {
  if (!(error instanceof Error)) return null;
  const candidate = error as Error & RollbackLike;
  if (candidate.name !== 'RollbackRefusal') return null;
  const detail = String(candidate.detail ?? error.message);
  return candidate.reason === 'not_found' || candidate.reason === 'invalid_transition'
    ? new CuratedAwardError('approved_winner_not_active', detail)
    : new CuratedAwardError('promotion_refused', `${String(candidate.reason ?? 'refused')}: ${detail}`);
}

/** The production {@link ApprovedWinnerRevisionPort}: the tx-level replace/correct on the service's own transaction. */
export const awardWinnerRevisionPort: ApprovedWinnerRevisionPort = {
  async revise(tx: SqlExecutor, request: ApprovedWinnerRevisionRequest): Promise<ApprovedWinnerRevisionResult> {
    const native = nativeTransactionOf(tx);
    if (!native) {
      throw new CuratedAwardError(
        'promotion_refused',
        'The revision port needs the postgres.js transaction executor made by withAwardProposalExecutor().',
      );
    }
    try {
      const revised = await reviseApprovedAwardWinnerInTx(native, {
        approvedEntityKey: request.previousEntityKey,
        adminUserId: request.adminUserId,
        adminNote: request.adminNote,
        mode: request.mode,
        correction: request.correction,
        replacement: {
          awardId: request.target.awardId,
          season: request.target.season,
          playerId: request.target.playerId,
          playerNameRaw: request.target.playerNameRaw,
          clubId: request.target.clubId,
          votes: request.target.votes,
          position: request.target.position,
          isCaptain: request.target.isCaptain,
          isViceCaptain: request.target.isViceCaptain,
          note: request.target.note,
          confirmDuplicate: request.target.confirmDuplicate,
        },
        auditExtra: {
          curated_proposal_id: request.proposalId,
          curated_proposal_key: request.proposalKey,
          curated_proposal_revision: request.toRevision,
          curated_revises_revision: request.fromRevision,
          curated_revises_entity_key: request.previousEntityKey,
          curated_source_kind: request.evidence.sourceKind,
          curated_source_url: request.evidence.sourceUrl,
          curated_citation: request.evidence.citation,
          curated_acquired_on: request.evidence.acquiredOn,
        },
      });
      return {
        entityKey: revised.entityKey,
        mode: revised.mode,
        voidedEntityKey: revised.voidedEntityKey,
        revalidatePaths: revised.revalidatePaths,
      };
    } catch (error) {
      throw revisionRefusal(error) ?? error;
    }
  },
};

/**
 * Run `work` with an import-role executor (`AFLDB_IMPORT_DATABASE_URL`, one short-lived connection,
 * the same shape as `withImportConnection` in admin-awards.ts). Under a test process the DSN must
 * name a `_test` database (plan D5): the guard is a no-op outside tests.
 */
export async function withAwardProposalExecutor<T>(
  work: (executor: TransactionalSqlExecutor) => Promise<T>,
): Promise<T> {
  const importUrl = process.env.AFLDB_IMPORT_DATABASE_URL;
  if (!importUrl) throw new Error('AFLDB_IMPORT_DATABASE_URL is not configured.');
  assertTestProcessDsn('AFLDB_IMPORT_DATABASE_URL', importUrl);
  const importSql = postgres(importUrl, { max: 1, onnotice: () => {} });
  try {
    return await work(postgresExecutor(importSql));
  } finally {
    await importSql.end({ timeout: 5 });
  }
}
