/**
 * AFLDB-ISSUE-228 follow-up — the super-admin AFL API ingestion switches.
 * DB-free: only the fail-closed paths that need no live connection, and the
 * pure two-key composition. The switches' actual read-through-site_settings
 * behaviour is exercised end to end by the acquire/settle CLI's own gate
 * tests (`tests/afl-api-match.test.ts`, `tests/afl-api-brownlow-acquire.test.ts`)
 * via the `ingestionControls` test override, and by
 * `parseSiteSettings`/`parseBooleanSetting` coverage in the site-settings
 * suite for the underlying jsonb decode.
 */
import { describe, expect, it } from 'vitest';

import {
  combineAflApiBrownlowGates,
  DISABLED_AFL_API_INGESTION_CONTROLS,
  readAflApiIngestionControls,
} from '@/lib/acquisition/afl-api-ingestion-control';

describe('readAflApiIngestionControls — fail closed (hard requirement B)', () => {
  it('returns disabled for both switches when DATABASE_URL is unset', async () => {
    const controls = await readAflApiIngestionControls({});
    expect(controls).toEqual(DISABLED_AFL_API_INGESTION_CONTROLS);
  });

  it('returns disabled for both switches when the connection is unreachable', async () => {
    const controls = await readAflApiIngestionControls({
      DATABASE_URL: 'postgresql://afldb_app:wrong@127.0.0.1:1/afldb_does_not_exist',
    });
    expect(controls).toEqual(DISABLED_AFL_API_INGESTION_CONTROLS);
  }, 15_000);
});

describe('combineAflApiBrownlowGates — the §D two-key composition', () => {
  it('is enabled only when BOTH gates are true', () => {
    expect(combineAflApiBrownlowGates(true, true).effectiveEnabled).toBe(true);
  });

  it('is disabled when the deployment gate is off, even if the admin control is on', () => {
    const result = combineAflApiBrownlowGates(false, true);
    expect(result.effectiveEnabled).toBe(false);
    expect(result.deploymentGateEnabled).toBe(false);
    expect(result.adminEnabled).toBe(true);
  });

  it('is disabled when the admin control is off, even if the deployment gate is on', () => {
    const result = combineAflApiBrownlowGates(true, false);
    expect(result.effectiveEnabled).toBe(false);
    expect(result.deploymentGateEnabled).toBe(true);
    expect(result.adminEnabled).toBe(false);
  });

  it('is disabled when both are off', () => {
    expect(combineAflApiBrownlowGates(false, false).effectiveEnabled).toBe(false);
  });
});
