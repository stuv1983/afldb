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
