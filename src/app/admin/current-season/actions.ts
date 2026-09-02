'use server';

import { revalidatePath } from 'next/cache';

import {
  getCurrentSeasonReport,
  parseCurrentSeasonSources,
  runCurrentSeasonRefresh,
  validateCurrentSeasonYear,
  type CurrentSeasonReport,
  type CurrentSeasonRunResult,
} from '@/lib/external-afl/current-season-import';
import { audit, requireSuperAdmin } from '@/lib/auth/session';

export type CurrentSeasonAdminState = {
  error?: string;
  message?: string;
  result?: CurrentSeasonRunResult;
  report?: CurrentSeasonReport;
};

function parseYear(formData: FormData): number {
  return validateCurrentSeasonYear(Number(formData.get('year') ?? new Date().getFullYear()));
}

export async function runCurrentSeasonAdminAction(
  _previous: CurrentSeasonAdminState,
  formData: FormData,
): Promise<CurrentSeasonAdminState> {
  const admin = await requireSuperAdmin();
  const mode = String(formData.get('mode') ?? 'auto');

  try {
    const year = parseYear(formData);
    if (mode === 'report') {
      const report = await getCurrentSeasonReport(year);
      await audit('current_season.reported', { year }, { userId: admin.id, label: admin.email });
      return {
        message: `Loaded current-season staging report for ${year}.`,
        report,
      };
    }

    const sources = mode === 'auto'
      ? ['kali'] as const
      : parseCurrentSeasonSources(String(formData.get('source') ?? 'kali'));
    const apply = mode === 'auto' || formData.get('apply') === 'on';
    const insertMissingMatches = false;

    const result = await runCurrentSeasonRefresh({
      year,
      sources: [...sources],
      apply,
      insertMissingMatches,
    });
    const report = await getCurrentSeasonReport(year);

    await audit('current_season.refreshed', {
      year,
      mode,
      sources,
      apply,
      insertMissingMatches,
      observationsFetched: result.observationsFetched,
      sourceCounts: result.sourceCounts,
      independenceGroupCounts: result.independenceGroupCounts,
      completeObservations: result.completeObservations,
      observationsWithScores: result.observationsWithScores,
      observationsStaged: result.observationsStaged,
      observationVersionsInserted: result.observationVersionsInserted,
      observationsMarkedAbsent: result.observationsMarkedAbsent,
      canonicalMatchesResolved: result.canonicalMatchesResolved,
      canonicalRowsInserted: result.canonicalRowsInserted,
      canonicalRowsUpdated: result.canonicalRowsUpdated,
      unresolvedObservations: result.unresolvedObservations,
      incompleteSourceRecords: result.incompleteSourceRecords,
      rejectedOrConflicted: result.rejectedOrConflicted,
      sourceDisagreements: result.sourceDisagreements,
      sameGroupConflicts: result.sameGroupConflicts,
    }, { userId: admin.id, label: admin.email });

    revalidatePath('/admin/current-season');

    return {
      message: result.applied
        ? `Refreshed ${year} fallback evidence: staged ${result.observationsStaged} observations and resolved ${result.canonicalMatchesResolved} local matches for diagnostics. Canonical current-season rows were not changed.`
        : `Dry run for ${year}: fetched ${result.observationsFetched} observations; nothing was written.`,
      result,
      report,
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
