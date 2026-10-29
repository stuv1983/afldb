import 'server-only';

import { NextResponse } from 'next/server';

import {
  findRetiredAdminSurface,
  retiredAdminRefusal,
  type RetiredAdminRefusal,
} from '@afldb/domain';

import { audit, type AdminUser } from '@/lib/auth/session';

/**
 * The one place a retired admin control (server action or route handler) is turned into a
 * refusal (AFLDB V2 Stage 5, plan D9/D10, V2-GAP-013, docs/v2/legacy-disposition.md).
 *
 * WHAT THIS IS FOR. A control that used to run a legacy ingestion path keeps its exported
 * name, so a stale client, a bookmarked form or a direct POST gets a typed refusal naming the
 * retirement rather than a 404 that could pass for a transient fault. The entry point calls
 * its existing guard FIRST (so who may reach the refusal is exactly who could reach the old
 * behaviour), then one of the functions below, and never the old library.
 *
 * AUDIT. An authorised, attributed refusal writes ONE best-effort `auth_audit_log` row
 * (`admin.legacy_retired_refused`, detail `{ surface, export }`), the pattern `auditRefusal`
 * in src/app/admin/awards/actions.ts uses: a failed audit write is logged and does not change
 * the refusal. An UNATTRIBUTED caller (the mailbox poller's route, which authenticates by a
 * shared secret that is no longer read) is answered by `goneRetiredAdminRoute`, which writes
 * nothing: auditing anonymous calls would let anyone write audit rows.
 *
 * The refusal text carries no path, secret or stack; it is built from the pure registry
 * (`RETIRED_ADMIN_SURFACES` in packages/domain/src/legacy-retirement.ts).
 */

export const RETIRED_ADMIN_AUDIT_ACTION = 'admin.legacy_retired_refused';

/** HTTP 410 Gone: the resource existed and has been withdrawn on purpose. */
export const RETIRED_ADMIN_ROUTE_STATUS = 410;

type Actor = Pick<AdminUser, 'id' | 'email'>;

function refusalFor(surface: string): RetiredAdminRefusal {
  const entry = findRetiredAdminSurface(surface);
  if (entry === null) throw new Error(`"${surface}" is not a registered retired admin surface.`);
  return retiredAdminRefusal(entry);
}

async function auditRefusal(surface: string, exportName: string, admin: Actor): Promise<void> {
  try {
    await audit(RETIRED_ADMIN_AUDIT_ACTION, { surface, export: exportName },
      { userId: admin.id, label: admin.email });
  } catch (error) {
    console.error('Failed to log administrative audit for a retired admin control refusal', error);
  }
}

/**
 * Refuse a retired server action: one best-effort audit row, then the typed refusal.
 * `exportName` is the retired export that was called (a surface may list several).
 */
export async function refuseRetiredAdminAction(
  surface: string,
  admin: Actor,
  exportName: string,
): Promise<RetiredAdminRefusal> {
  const refusal = refusalFor(surface);
  await auditRefusal(surface, exportName, admin);
  return refusal;
}

/** Refuse a retired, guarded route handler: the audit row, then HTTP 410 with the refusal. */
export async function refuseRetiredAdminRoute(
  surface: string,
  admin: Actor,
  exportName = 'POST',
): Promise<NextResponse> {
  const refusal = refusalFor(surface);
  await auditRefusal(surface, exportName, admin);
  return NextResponse.json(refusal, { status: RETIRED_ADMIN_ROUTE_STATUS });
}

/**
 * Answer a retired route that has no authenticated caller: HTTP 410 with the refusal, no body
 * read, no secret comparison, no database, no audit row.
 */
export function goneRetiredAdminRoute(surface: string): NextResponse {
  return NextResponse.json(refusalFor(surface), { status: RETIRED_ADMIN_ROUTE_STATUS });
}
