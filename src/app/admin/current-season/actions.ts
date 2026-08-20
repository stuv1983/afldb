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
    const insertMissingMatches = mode === 'auto' || formData.get('insertMissingMatches') === 'on';
    const updateMatches = mode !== 'auto' && formData.get('updateMatches') === 'on';

    const result = await runCurrentSeasonRefresh({
      year,
      sources: [...sources],
      apply,
      insertMissingMatches,
      updateMatches,
    });
    const report = await getCurrentSeasonReport(year);

    await audit('current_season.refreshed', {
      year,
      mode,
      sources,
      apply,
      insertMissingMatches,
      updateMatches,
      fetched: result.fetched,
      staged: result.staged,
      inserted: result.inserted,
      resolved: result.resolved,
      updated: result.updated,
      unresolved: result.unresolved,
    }, { userId: admin.id, label: admin.email });

    revalidatePath('/admin/current-season');
    if (result.inserted > 0 || result.updated > 0) {
      revalidatePath('/matches');
      revalidatePath('/matches/[id]', 'page');
      revalidatePath('/seasons');
      revalidatePath('/seasons/[year]', 'page');
      revalidatePath('/clubs/[slug]', 'page');
      revalidatePath('/records/[category]', 'page');
    }

    return {
      message: result.applied
        ? `Updated ${year}: staged ${result.staged}, inserted ${result.inserted}, resolved ${result.resolved}.`
        : `Dry run for ${year}: fetched ${result.fetched}; nothing was written.`,
      result,
      report,
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
