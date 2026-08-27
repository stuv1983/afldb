import { describe, expect, it } from 'vitest';

import {
  createImportRoleParityHarness,
  IMPORT_ROLE_PARITY_SKIP_MESSAGE,
  validateImportRoleParityDsnTargets,
} from './integration/import-role-parity';

const owner = 'postgresql://afldb_owner:owner-secret@localhost:5432/afldb_test';

describe('restricted importer role-parity harness', () => {
  it('has an explicit skip reason and never falls back to the owner DSN', () => {
    const harness = createImportRoleParityHarness(owner, undefined);
    expect(harness.isConfigured).toBe(false);
    expect(harness.skipMessage).toBe(
      'AFLDB_TEST_IMPORT_DATABASE_URL is not set; restricted importer-role validation was not run.',
    );
    expect(() => harness.spawn('unused', [])).toThrow(IMPORT_ROLE_PARITY_SKIP_MESSAGE);
  });

  it('refuses a restricted DSN whose database is not a _test database', () => {
    expect(() => validateImportRoleParityDsnTargets(
      owner,
      'postgresql://afldb_import:restricted-secret@localhost:5432/afldb_dev',
    )).toThrow(/AFLDB_TEST_IMPORT_DATABASE_URL.*not a _test database/);
  });

  it('refuses a restricted DSN targeting a different database or server', () => {
    expect(() => validateImportRoleParityDsnTargets(
      owner,
      'postgresql://afldb_import:restricted-secret@localhost:5432/other_test',
    )).toThrow(/same PostgreSQL test database/);
    expect(() => validateImportRoleParityDsnTargets(
      owner,
      'postgresql://afldb_import:restricted-secret@db.example.test:5432/afldb_test',
    )).toThrow(/same PostgreSQL test database/);
  });

  it('refuses process execution until live role validation has completed', () => {
    const harness = createImportRoleParityHarness(
      owner,
      'postgresql://afldb_import:restricted-secret@localhost:5432/afldb_test',
    );
    expect(() => harness.spawn('unused', [])).toThrow(/has not passed.*safety validation/);
  });
});
