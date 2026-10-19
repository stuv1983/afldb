/**
 * AFLDB V2 Stage 4 -- the registry of retired entry points (plan D10, ADR 0010, R-006).
 *
 * A retired entry point is a `package.json` script that used to run a legacy tool and now only
 * prints a refusal (tools/v2/retired-entry.ts). The tool itself is kept, deliberately, under
 * `legacy/offline/` as diagnostic evidence; nothing schedules, imports or wires it to an admin
 * control. tests/v2-module-boundaries.test.ts proves every `package.json` script that calls the
 * retired-entry CLI names an entry here, and that every entry here is wired to a script.
 *
 * Pure: no I/O, no clock, no database. The governing text lives in docs/v2/legacy-disposition.md
 * and docs/v2/adr/0010-legacy-disposition.md.
 */

export interface RetiredEntry {
  /** The `package.json` script name (`npm run <name>`), also the CLI argument. */
  readonly name: string;
  /** One line: what the entry point did. */
  readonly was: string;
  /** Why it is retired. */
  readonly why: string;
  /** Repository path where the offline tool now lives. */
  readonly offlineLocation: string;
  /** The documents that govern the retirement. */
  readonly governedBy: readonly string[];
  /** How to run the quarantined tool deliberately, from the repository root. */
  readonly deliberateRun: readonly string[];
}

export const RETIRED_ENTRIES: readonly RetiredEntry[] = [
  {
    name: 'current-season:update',
    was: 'the Squiggle / Kali current-season refresh CLI (stages external current-match observations)',
    why: 'Squiggle and Kali are retired sources: AFLDB-ISSUE-122/128 made them staging and diagnostic only, '
      + 'and AFLDB V2 plan D10 removes them from every runtime path. A refresh no longer has a default source (finding F-001).',
    offlineLocation: 'legacy/offline/tools/current-season/update-current-season.ts',
    governedBy: ['docs/v2/legacy-disposition.md', 'docs/v2/adr/0010-legacy-disposition.md'],
    deliberateRun: [
      'npx tsx legacy/offline/tools/current-season/update-current-season.ts --report --year <year>',
      'npx tsx legacy/offline/tools/current-season/update-current-season.ts --source <squiggle|kali|all> --year <year>',
    ],
  },
];

/** The retired entry named `name`, or null when it is not a retired entry point. */
export function findRetiredEntry(name: string): RetiredEntry | null {
  return RETIRED_ENTRIES.find((entry) => entry.name === name) ?? null;
}

/** The refusal printed for a retired entry point: what, why, where it lives now, what governs it. */
export function renderRetiredEntryRefusal(entry: RetiredEntry): string {
  return [
    `RETIRED: "${entry.name}" no longer runs from npm.`,
    `  What it was: ${entry.was}.`,
    `  Why: ${entry.why}`,
    `  The tool is kept offline, for diagnostics only, at: ${entry.offlineLocation}`,
    '  It is never scheduled, imported by the application, or wired to an admin button.',
    `  Governed by: ${entry.governedBy.join(', ')}`,
    '  To run it deliberately, by hand (never from a scheduler):',
    ...entry.deliberateRun.map((command) => `    ${command}`),
  ].join('\n');
}

/** The refusal for a name that is not in the registry (the CLI still exits 1). */
export function renderUnknownRetiredEntry(name: string): string {
  const known = RETIRED_ENTRIES.map((entry) => entry.name).join(', ');
  return `"${name}" is not a registered retired entry point. Registered: ${known || '(none)'}. See docs/v2/legacy-disposition.md.`;
}

// ---------------------------------------------------------------------------------------------
// Stage 5 (plan D9, ADR 0009/0010, V2-GAP-013): the retired ADMIN surfaces.
// ---------------------------------------------------------------------------------------------

/** What kind of admin entry point a retired surface was. */
export type RetiredAdminSurfaceKind = 'server_action' | 'route_handler' | 'page';

/**
 * One retired admin surface: a server action, route handler or page that used to run a legacy
 * ingestion path and now only refuses. The code that implemented the old behaviour is removed
 * from the entry point (the ingestion LIBRARIES stay, for the offline tools); the entry point
 * remains so a stale client or a direct POST receives a typed refusal instead of a 404 that
 * could be mistaken for a transient fault. `tests/v2-module-boundaries.test.ts` proves each
 * listed export still exists and still reaches the refusal helper.
 */
export interface RetiredAdminSurface {
  /** Stable identifier, also the `surface` field of the refusal and of its audit row. */
  readonly id: string;
  readonly kind: RetiredAdminSurfaceKind;
  /** Repository paths that hold the retired exports. */
  readonly paths: readonly string[];
  /** The retired export names (`POST` for a route handler). */
  readonly exports: readonly string[];
  /** One line: what the surface did. */
  readonly was: string;
  /** Why it is retired. */
  readonly why: string;
  /** What replaces it, for the operator. */
  readonly replacedBy: string;
  /** The documents that govern the retirement. */
  readonly governedBy: readonly string[];
}

const ADMIN_GOVERNED_BY = [
  'docs/v2/legacy-disposition.md',
  'docs/v2/adr/0009-admin-operations-centre.md',
  'docs/v2/adr/0010-legacy-disposition.md',
] as const;

export const RETIRED_ADMIN_SURFACES: readonly RetiredAdminSurface[] = [
  {
    id: 'admin.csv_upload',
    kind: 'route_handler',
    paths: ['src/app/admin/upload/stage/route.ts'],
    exports: ['POST'],
    was: 'staged an uploaded CSV file as a data submission for review',
    why: 'AFLDB V2 does not let a runtime path load statistics from a CSV file; staged submissions fed a '
      + 'promotion that wrote final tables directly.',
    replacedBy: 'curated award proposals in the operations centre (/admin/operations/awards) and the audited data editor',
    governedBy: ADMIN_GOVERNED_BY,
  },
  {
    id: 'admin.submission_review',
    kind: 'server_action',
    paths: ['src/app/admin/submissions/[id]/actions.ts'],
    exports: ['runValidation', 'decideSubmission', 'runPromotion'],
    was: 'validated, approved, rejected and promoted a CSV submission into the final statistical tables',
    why: 'promotion wrote matches, player statistics, players and awards straight from a CSV file, '
      + 'bypassing curated review and the sealed-season rules.',
    replacedBy: 'curated award proposals (/admin/operations/awards) and the audited data editor; submissions stay readable as history',
    governedBy: ADMIN_GOVERNED_BY,
  },
  {
    id: 'admin.email_intake',
    kind: 'route_handler',
    paths: ['src/app/api/admin/email-intake/route.ts'],
    exports: ['POST'],
    was: 'accepted CSV attachments forwarded by the mailbox poller and staged them for review',
    why: 'it fed the retired CSV review and promotion path; corrections now go through the audited editors.',
    replacedBy: 'nothing: the mailbox poller is stopped by the Stage 6 cutover (the timer is a deployment act)',
    governedBy: ADMIN_GOVERNED_BY,
  },
  {
    id: 'admin.squiggle_kali_refresh',
    kind: 'server_action',
    paths: ['src/app/admin/current-season/actions.ts'],
    exports: ['runCurrentSeasonAdminAction'],
    was: 'refreshed and reported on staged Squiggle and Kali current-season observations',
    why: 'Squiggle and Kali are retired sources (AFLDB-ISSUE-122/128, plan D10); no runtime path fetches them.',
    replacedBy: 'the AFL API pipeline and its ingestion controls on /admin/current-season',
    governedBy: ADMIN_GOVERNED_BY,
  },
  {
    id: 'admin.afltables_settle_trigger',
    kind: 'server_action',
    paths: ['src/app/admin/current-season/actions.ts'],
    exports: ['startSettleRunAction'],
    was: 'started the AFL Tables settle systemd unit on demand',
    why: 'the AFL Tables settle is retired from the admin surface; the nightly timer on the host stays behind '
      + 'AFLDB-ISSUE-316 until the owner decision D-316-2, which V2 neither starts nor stops.',
    replacedBy: 'the AFL API settle units, shown read-only on /admin/current-season',
    governedBy: ADMIN_GOVERNED_BY,
  },
];

/** The retired admin surface with identifier `id`, or null. */
export function findRetiredAdminSurface(id: string): RetiredAdminSurface | null {
  return RETIRED_ADMIN_SURFACES.find((entry) => entry.id === id) ?? null;
}

/** The operator-facing refusal text: what, why, what replaces it. No secrets, no paths. */
export function renderRetiredAdminRefusal(entry: RetiredAdminSurface): string {
  return `This control has been retired: it ${entry.was}. Why: ${entry.why} Use instead: ${entry.replacedBy}.`;
}

/** The code every legacy-retirement refusal carries. */
export const LEGACY_RETIRED_CODE = 'legacy_retired' as const;

/** The typed refusal a retired admin action returns and a retired route answers with (HTTP 410). */
export interface RetiredAdminRefusal {
  readonly refused: true;
  readonly code: typeof LEGACY_RETIRED_CODE;
  readonly surface: string;
  /** Also the `error` field every admin form state already renders. */
  readonly error: string;
}

export function retiredAdminRefusal(entry: RetiredAdminSurface): RetiredAdminRefusal {
  return {
    refused: true,
    code: LEGACY_RETIRED_CODE,
    surface: entry.id,
    error: renderRetiredAdminRefusal(entry),
  };
}
