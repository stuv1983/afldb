import './guard';

import { beforeAll, describe, expect, it } from 'vitest';

import { createImportRoleParityHarness } from './import-role-parity';

const ownerDsn = process.env.AFLDB_TEST_DATABASE_URL as string;
const importRole = createImportRoleParityHarness(
  ownerDsn,
  process.env.AFLDB_TEST_IMPORT_DATABASE_URL,
);
const roleParitySuffix = importRole.isConfigured ? '' : ` — ${importRole.skipMessage}`;

describe.skipIf(!importRole.isConfigured)(
  `restricted importer credential safety (AFLDB-ISSUE-083)${roleParitySuffix}`,
  () => {
    beforeAll(() => importRole.validate());

    it('keeps the owner fixture role separate from confined afldb_import', () => {
      expect(importRole.validation).toMatchObject({
        owner: { role: 'afldb_owner' },
        restricted: { role: 'afldb_import' },
        denial: { table: 'auth_users', operation: 'DELETE', sqlstate: '42501' },
      });
      expect(importRole.validation?.owner.database).toBe(importRole.validation?.restricted.database);
    });

    it('rejects an owner credential supplied as AFLDB_TEST_IMPORT_DATABASE_URL', async () => {
      const ownerAsRestricted = createImportRoleParityHarness(ownerDsn, ownerDsn);
      await expect(ownerAsRestricted.validate()).rejects.toThrow(
        /AFLDB_TEST_IMPORT_DATABASE_URL must authenticate as afldb_import; current_user is 'afldb_owner'/,
      );
    });
  },
);
