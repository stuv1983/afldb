import type { Metadata } from 'next';
import Link from 'next/link';

import { NewPickWizard } from '@/app/admin/draft/NewPickWizard';
import { listClubs } from '@/db/queries/clubs';
import { DRAFT_EVENT_PAIRS, MIN_DRAFT_YEAR, NULL_PICK_KINDS } from '@/db/queries/admin-draft';
import { requireCapability } from '@/lib/auth/session';

export const metadata: Metadata = { title: 'Add a draft selection', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

/**
 * `/admin/draft/new` -- the first-class new-selection workflow
 * (AFLDB-ISSUE-160 §18): draft facts, then search-before-create, then an
 * explicit choice between an existing player and a new one. Super Admin
 * only (`data.draft.edit`): every path this page reaches is a mutation.
 */
export default async function NewDraftPickPage() {
  await requireCapability('data.draft.edit');
  const clubs = await listClubs();

  return (
    <>
      <div className="page-header">
        <p className="eyebrow"><Link href="/admin/draft">← Draft administration</Link></p>
        <h1>Add a draft selection</h1>
        <p className="subtitle">
          Search for the player first. Only create a new person when the search genuinely finds
          no one — a likely duplicate with no distinguishing date of birth is refused, never
          guessed.
        </p>
      </div>

      <NewPickWizard
        clubs={clubs.map((c) => ({ slug: c.slug, name: c.name }))}
        eventPairs={DRAFT_EVENT_PAIRS as { draftType: string; draftKind: string }[]}
        nullPickKinds={NULL_PICK_KINDS as string[]}
        minDraftYear={MIN_DRAFT_YEAR}
      />
    </>
  );
}
