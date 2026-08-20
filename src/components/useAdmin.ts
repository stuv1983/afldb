'use client';

import { isSuperAdminAction } from '@/app/player-link-suggestion-action';

let adminPromise: Promise<boolean> | null = null;

export function checkSuperAdminClient(): Promise<boolean> {
  if (!adminPromise) {
    adminPromise = isSuperAdminAction();
  }
  return adminPromise;
}
