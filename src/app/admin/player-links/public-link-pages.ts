import { revalidatePath } from 'next/cache';

/**
 * The public pages that show a linked player's name (AFLDB-ISSUE-308).
 *
 * One list, two callers: the link actions that revalidate in-action
 * (`linkPlayer`, `confirmUnlinked`, `createAndLinkPlayer`) and the
 * capability-gated `/admin/player-links/revalidate` route that the browser
 * posts to after a suggestion approval has settled. The approval actions
 * themselves must not call this: revalidating the submitting route inside a
 * Server Action hangs the Next 15.5 client when the form unmounts on success
 * (ISSUE-087 follow-up), and whether that still holds on Next 16 is not
 * proven.
 */
export function revalidatePublicLinkPages(): void {
  revalidatePath('/awards/[slug]', 'page');
  revalidatePath('/awards/[slug]/[season]', 'page');
  revalidatePath('/clubs/[slug]', 'page');
  revalidatePath('/honour-teams/[slug]', 'page');
  revalidatePath('/seasons/[year]', 'page');
  revalidatePath('/hall-of-fame');
  revalidatePath('/draft');
  revalidatePath('/records/first-kick-goal');
}
