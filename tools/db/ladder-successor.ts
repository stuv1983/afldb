/**
 * AFLDB-ISSUE-316 C2 — the successor ladder tuple rules, re-exported for the rebuild.
 *
 * The rules are pure and live with the rollover planner (src/lib/rollover/ladder-successor.ts), which
 * reads and edits the same table. The rebuild imports them from here so its own source keeps no
 * parent-directory import paths.
 */
export * from '../../src/lib/rollover/ladder-successor';
