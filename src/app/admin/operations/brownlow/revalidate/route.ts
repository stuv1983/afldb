import { revalidatePath } from 'next/cache';
import { requireCapability } from '@/lib/auth/session';

/** Follow-up request after the decision commits, following the awards-admin precedent. */
export async function POST(): Promise<Response> {
  await requireCapability('data.brownlow.finalise');
  revalidatePath('/brownlow');
  for (const path of ['/brownlow/[year]', '/players/[slug]', '/clubs/[slug]', '/seasons/[year]', '/records/[category]']) {
    revalidatePath(path, 'page');
  }
  return Response.json({ ok: true });
}
