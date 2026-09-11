import type { LeadershipRole, LeadershipStatus } from '@/db/queries/admin-club-leadership';

/**
 * Shared display strings for the club leadership admin surface
 * (AFLDB-ISSUE-163 Stage 2). Pure and presentation-only — the backend never
 * renders a label, only the enum/status values §6/§7 define.
 */

export const LEADERSHIP_ROLE_LABELS: Record<LeadershipRole, string> = {
  captain: 'Captain',
  vice_captain: 'Vice-captain',
};

export const LEADERSHIP_STATUS_LABELS: Record<LeadershipStatus, string> = {
  active: 'Active',
  ended: 'Ended',
  void: 'Void',
};
