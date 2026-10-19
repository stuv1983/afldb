import type { Metadata } from 'next';

import { requireCapability } from '@/lib/auth/session';

import {
  AcquisitionRunsSection,
  CuratedDerivedSection,
  DataHealthSection,
  InspectionToolsSection,
  MaintenanceSection,
  OperationsHeader,
  SealedSeasonsSection,
} from './_components/OverviewSections';
import { loadOperationsOverview } from './page-data';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Operations centre',
  robots: { index: false, follow: false },
};

/**
 * `/admin/operations` — the AFLDB V2 operations centre (Stage 5, plan D9, ADR 0009).
 *
 * READ-ONLY. Data health (the coverage registry), sealed seasons, acquisition-run status, the way
 * in to curated awards and derived results, the inspection tools and one sentence on maintenance.
 * It starts nothing and carries no form: each mutation lives on its own page behind its own
 * capability and shows its consequences before submit.
 *
 * The guard is the first await. Every read in `loadOperationsOverview` is isolated, so a failing
 * registry or an unreachable settle unit shows an inline notice in its own section only.
 */
export default async function OperationsCentrePage() {
  const admin = await requireCapability('operations.centre.read');
  const overview = await loadOperationsOverview(admin);

  return (
    <>
      <OperationsHeader email={admin.email} role={admin.role} />
      <DataHealthSection health={overview.coverage} />
      <SealedSeasonsSection seasons={overview.seasons} />
      <AcquisitionRunsSection aflApi={overview.aflApiRuns} aflTables={overview.aflTablesRun} />
      <CuratedDerivedSection links={overview.curatedLinks} pending={overview.pending} />
      <InspectionToolsSection links={overview.inspectionLinks} />
      <MaintenanceSection />
    </>
  );
}
