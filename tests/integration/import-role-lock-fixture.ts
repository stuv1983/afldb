/**
 * AFLDB-ISSUE-274, D-274-2. The closing sequence of the afldb_import lock test, as a pure function.
 *
 * Pure: no database, no driver. `import-role-match-lock.test.ts` supplies the operations;
 * `tests/import-role-lock-fixture.test.ts` drives the same code with fakes, DB-free. (The integration
 * file cannot be imported without a database: `./guard` throws at import.)
 *
 * The guarantees, in one place:
 *   1. Ownership is proved, not assumed. Every row this run removes carries the run's unique marker
 *      (the match's and the season's `notes`), and the operations given here are the only removers.
 *      A row on the fixture key without the marker belongs to someone else: it is PRESERVED and
 *      reported, never deleted.
 *   2. The season INSERT has four states, not two. Once sent, its outcome is 'unconfirmed' until its
 *      reply arrives. A lost reply therefore leaves 'unconfirmed': possible season residue is
 *      REPORTED, and the season is NOT removed, because nothing proves who created it. (A server
 *      error is treated the same way: "nothing was written" is claimed only for 'not-sent'.)
 *   3. Nothing is removed unless the afldb_import session is confirmed gone.
 *   4. Nothing is discarded. The primary failure and every cleanup or connection-close problem are in
 *      the reported error: the primary failure first, the problems after it, the original as `cause`.
 */

/** The season INSERT: sent but unanswered is its own state. */
export type SeasonInsert = 'not-sent' | 'unconfirmed' | 'created' | 'pre-existing';

export type FixtureState = {
  seasonInsert: SeasonInsert;
  /** Set BEFORE the matches INSERT is sent, so a lost reply still leaves the row accounted for. */
  matchInsertSent: boolean;
  /** Known only from the INSERT's RETURNING. */
  matchId: number | null;
  /** The role connection's backend pid; null if it never ran a statement. */
  rolePid: number | null;
};

export type FixtureLabels = {
  matchKey: string;
  season: number;
  /** The unique per-run value written to `notes` of the fixture rows and required by every DELETE. */
  marker: string;
  /** The application_name of the afldb_import session. */
  roleApplicationName: string;
};

export type Observation = {
  /** `matches` rows on the fixture key that carry this run's marker. */
  ownedMatches: number;
  /** `matches` rows on the fixture key that do NOT. */
  foreignMatches: number;
  /** `seasons` rows for the fixture year that carry this run's marker. */
  ownedSeasons: number;
};

export type FinishOps = {
  closeRole: () => Promise<void>;
  /** True only when the server confirms the role's backend is gone. Throws if it cannot observe. */
  roleSessionGone: (pid: number) => Promise<boolean>;
  /** DELETE requiring the marker (and the id when known). */
  deleteOwnedMatch: (matchId: number | null) => Promise<void>;
  /** DELETE requiring the marker and no matches row in the season. */
  deleteOwnedSeason: () => Promise<void>;
  observe: () => Promise<Observation>;
  closeOwner: () => Promise<void>;
};

export type Outcome = { failed: false } | { failed: true; error: unknown };

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export async function finishImportRoleLockCase(
  state: FixtureState, labels: FixtureLabels, ops: FinishOps, outcome: Outcome,
): Promise<void> {
  const problems: string[] = [];
  /** Runs one step; a throw becomes a recorded problem and `ok: false`. */
  const attempt = async <T>(what: string, work: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false }> => {
    try {
      return { ok: true, value: await work() };
    } catch (error) {
      problems.push(`${what} failed: ${message(error)}`);
      return { ok: false };
    }
  };

  await attempt('closing the afldb_import connection', ops.closeRole);

  const seasonOurs = state.seasonInsert === 'created';
  const removable = state.matchInsertSent || seasonOurs;
  let removalAttempted = false;
  let matchRemovalOk = true;
  if (removable) {
    let gone = state.rolePid === null; // no pid: the role connection never ran a statement
    if (state.rolePid !== null) {
      const pid = state.rolePid;
      const confirmed = await attempt('confirming the afldb_import session gone', () => ops.roleSessionGone(pid));
      gone = confirmed.ok && confirmed.value;
    }
    if (!gone) {
      problems.push(
        `The afldb_import session (backend pid ${state.rolePid}, application_name '${labels.roleApplicationName}') is not confirmed gone, `
        + 'so the fixture was NOT removed. Once it is, remove deliberately only rows carrying the marker '
        + `'${labels.marker}': the matches row on ${labels.matchKey}${seasonOurs ? ` and the seasons row ${labels.season}` : ''}.`,
      );
    } else {
      removalAttempted = true;
      if (state.matchInsertSent) {
        // By id and key and marker when the id is known; by key and marker when the reply was lost.
        // A row on the key without the marker is not ours and is never matched.
        matchRemovalOk = (await attempt('removing the fixture matches row', () => ops.deleteOwnedMatch(state.matchId))).ok;
      }
      if (seasonOurs) {
        if (matchRemovalOk) {
          await attempt(`removing the fixture seasons row ${labels.season}`, ops.deleteOwnedSeason);
        } else {
          problems.push(`the seasons row ${labels.season} created by this run was NOT removed because the matches removal did not complete.`);
        }
      }
    }
  }

  const seasonUnconfirmed = state.seasonInsert === 'unconfirmed';
  if (removalAttempted || seasonUnconfirmed) {
    const seen = await attempt('verifying the fixture state', ops.observe);
    if (seen.ok) {
      const { ownedMatches, foreignMatches, ownedSeasons } = seen.value;
      if (ownedMatches > 0) {
        problems.push(`fixture residue: ${ownedMatches} matches row(s) carrying this run's marker remain on ${labels.matchKey}.`);
      }
      if (foreignMatches > 0) {
        problems.push(
          `${foreignMatches} matches row(s) on ${labels.matchKey} do not carry this run's marker (another session created `
          + 'them, or their ownership cannot be confirmed); they were PRESERVED, not deleted.',
        );
      }
      if (seasonOurs && ownedSeasons > 0) {
        problems.push(`fixture residue: the seasons row ${labels.season} created by this run remains (a matches row may still reference it).`);
      }
      if (seasonUnconfirmed) {
        problems.push(seasonUncertainty(labels, `a seasons row carrying this run's marker ${
          ownedSeasons > 0 ? 'EXISTS' : 'was not found'} at the check`));
      }
    } else if (seasonUnconfirmed) {
      problems.push(seasonUncertainty(labels, 'the state could not be checked'));
    }
  }

  await attempt('closing the owner connection', ops.closeOwner);

  if (!outcome.failed) {
    if (problems.length > 0) throw new Error(problems.join('; '));
    return;
  }
  if (problems.length === 0) throw outcome.error;
  throw Object.assign(
    new Error(`${message(outcome.error)} (also: ${problems.join('; ')})`),
    { cause: outcome.error },
  );
}

function seasonUncertainty(labels: FixtureLabels, observed: string): string {
  return `possible season residue: the seasons INSERT for ${labels.season} was sent but its outcome was never confirmed, `
    + `so this run may have created that row; it was NOT removed because its ownership is not confirmed (${observed}). `
    + `A seasons row ${labels.season} whose notes equal '${labels.marker}' is this run's.`;
}
