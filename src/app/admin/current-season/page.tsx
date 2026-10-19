import type { Metadata } from 'next';

import {
  readSettleUnitTableStatus,
  type SettleUnitStatus,
} from '@/lib/acquisition/settle-status';
import type { SettleUnitKey } from '@/lib/acquisition/settle-trigger';
import { requireCapability } from '@/lib/auth/session';

import { readAflApiIngestionAdminView } from './actions';
import { AflApiIngestionControls } from './AflApiIngestionControls';
import { AflApiSettleUnitsPanel } from './AflApiSettleUnitsPanel';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Current season ingestion',
  robots: { index: false, follow: false },
};

export default async function CurrentSeasonPage() {
  await requireCapability('acquisition.currentSeason');

  // AFLDB-ISSUE-232. Never allowed to take the page down: each unit row already
  // reports its own read failures, and anything that still throws is shown, never
  // fatal.
  let aflApiUnits: Record<SettleUnitKey, SettleUnitStatus> | null = null;
  let aflApiUnitsError: string | null = null;
  try {
    aflApiUnits = await readSettleUnitTableStatus();
  } catch (error) {
    aflApiUnitsError = error instanceof Error ? error.message : String(error);
  }

  // AFLDB-ISSUE-228 follow-up. Never allowed to take the page down, matching
  // the unit read above: a database that has not run the relevant migration, or
  // a transient read failure, must still render the rest of the page — the
  // CLI/timer's own fail-closed check does not depend on this read succeeding.
  let ingestionView = null;
  let ingestionViewError: string | null = null;
  try {
    ingestionView = await readAflApiIngestionAdminView();
  } catch (error) {
    ingestionViewError = error instanceof Error ? error.message : String(error);
  }

  return (
    <>
      <div className="page-header">
        <h1>Current season</h1>
        <p className="subtitle">
          The AFL API is the current-season source: its ingestion switches and the state of its
          settle units are below. The AFL Tables nightly settle still runs on the host behind
          AFLDB-ISSUE-316 until the owner&rsquo;s decision D-316-2; AFLDB V2 neither starts nor
          stops it. Its on-demand admin trigger and the Squiggle and Kali controls are retired
          (AFLDB V2 Stage 5, docs/v2/legacy-disposition.md).
        </p>
      </div>

      {ingestionViewError ? (
        <p className="notice" role="alert">{ingestionViewError}</p>
      ) : (
        ingestionView && <AflApiIngestionControls initialView={ingestionView} />
      )}

      <AflApiSettleUnitsPanel units={aflApiUnits} error={aflApiUnitsError} />
    </>
  );
}
