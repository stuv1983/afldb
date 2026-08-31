import { spawnSync, type SpawnSyncReturns } from 'node:child_process';

import postgres from 'postgres';

export const IMPORT_ROLE_PARITY_SKIP_MESSAGE =
  'AFLDB_TEST_IMPORT_DATABASE_URL is not set; restricted importer-role validation was not run.';

type ImportRoleIdentity = {
  database: string;
  role: string;
};

type ImportRoleValidation = {
  owner: ImportRoleIdentity;
  restricted: ImportRoleIdentity;
  denial: { table: 'auth_users'; operation: 'DELETE'; sqlstate: '42501' };
};

type RestrictedSpawnOptions = {
  cwd?: string;
  env?: Partial<NodeJS.ProcessEnv>;
  shell?: boolean;
};

type ParsedDsn = {
  database: string;
  endpoint: string;
};

function parseDsn(name: string, dsn: string): ParsedDsn {
  let url: URL;
  try {
    url = new URL(dsn);
  } catch {
    throw new Error(`${name} is not a valid connection URL.`);
  }

  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!database) throw new Error(`${name} does not name a database.`);

  return {
    database,
    endpoint: `${url.hostname.toLowerCase()}:${url.port || '5432'}`,
  };
}

export function validateImportRoleParityDsnTargets(
  ownerDsn: string,
  restrictedDsn: string,
): { ownerDatabase: string; restrictedDatabase: string } {
  const owner = parseDsn('AFLDB_TEST_DATABASE_URL', ownerDsn);
  const restricted = parseDsn('AFLDB_TEST_IMPORT_DATABASE_URL', restrictedDsn);

  if (!/_test$/.test(restricted.database)) {
    throw new Error(
      `AFLDB_TEST_IMPORT_DATABASE_URL points at '${restricted.database}', which is not a _test `
      + 'database. Restricted importer-role validation was refused.',
    );
  }
  if (owner.database !== restricted.database || owner.endpoint !== restricted.endpoint) {
    throw new Error(
      'AFLDB_TEST_IMPORT_DATABASE_URL must target the same PostgreSQL test database as '
      + `AFLDB_TEST_DATABASE_URL. Owner target: ${owner.endpoint}/${owner.database}; `
      + `restricted target: ${restricted.endpoint}/${restricted.database}.`,
    );
  }

  return { ownerDatabase: owner.database, restrictedDatabase: restricted.database };
}

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}

export function createImportRoleParityHarness(
  ownerDsn: string | undefined,
  restrictedDsn: string | undefined,
) {
  const isConfigured = Boolean(restrictedDsn);
  let validated = false;
  let validation: ImportRoleValidation | undefined;

  function requireConfigured(): string {
    if (!restrictedDsn) throw new Error(IMPORT_ROLE_PARITY_SKIP_MESSAGE);
    return restrictedDsn;
  }

  function requireValidated(): string {
    const dsn = requireConfigured();
    if (!validated || !validation) {
      throw new Error(
        'Restricted importer execution refused: AFLDB_TEST_IMPORT_DATABASE_URL has not '
        + 'passed the shared role-parity safety validation.',
      );
    }
    return dsn;
  }

  async function validate(): Promise<ImportRoleValidation> {
    const configuredRestrictedDsn = requireConfigured();
    if (!ownerDsn) {
      throw new Error('AFLDB_TEST_DATABASE_URL must be set before restricted importer-role validation.');
    }
    validateImportRoleParityDsnTargets(ownerDsn, configuredRestrictedDsn);

    const ownerSql = postgres(ownerDsn, { max: 1, onnotice: () => {} });
    const restrictedSql = postgres(configuredRestrictedDsn, { max: 1, onnotice: () => {} });
    try {
      const [[owner], [restricted]] = await Promise.all([
        ownerSql<ImportRoleIdentity[]>`
          SELECT current_database() AS database, current_user AS role
        `,
        restrictedSql<ImportRoleIdentity[]>`
          SELECT current_database() AS database, current_user AS role
        `,
      ]);

      if (!owner || !restricted) {
        throw new Error('Role-parity identity query returned no row.');
      }

      if (owner.database !== restricted.database) {
        throw new Error(
          'AFLDB_TEST_IMPORT_DATABASE_URL authenticated to a different database from '
          + `AFLDB_TEST_DATABASE_URL (${restricted.database} versus ${owner.database}).`,
        );
      }
      if (!/_test$/.test(restricted.database)) {
        throw new Error(
          `AFLDB_TEST_IMPORT_DATABASE_URL authenticated to '${restricted.database}', which is not a _test database.`,
        );
      }
      if (owner.role !== 'afldb_owner') {
        throw new Error(
          `AFLDB_TEST_DATABASE_URL must authenticate as afldb_owner; current_user is '${owner.role}'.`,
        );
      }
      if (restricted.role !== 'afldb_import') {
        throw new Error(
          'AFLDB_TEST_IMPORT_DATABASE_URL must authenticate as afldb_import; '
          + `current_user is '${restricted.role}'.`,
        );
      }

      try {
        await restrictedSql.begin(async (tx) => {
          await tx`DELETE FROM auth_users WHERE false`;
          throw new Error(
            'Restricted-role denial probe unexpectedly succeeded: afldb_import could DELETE from auth_users.',
          );
        });
      } catch (error) {
        if (errorCode(error) !== '42501') throw error;
      }

      validation = {
        owner,
        restricted,
        denial: { table: 'auth_users', operation: 'DELETE', sqlstate: '42501' },
      };
      validated = true;
      return validation;
    } finally {
      await Promise.all([
        ownerSql.end({ timeout: 5 }),
        restrictedSql.end({ timeout: 5 }),
      ]);
    }
  }

  function spawn(
    command: string,
    args: readonly string[],
    options: RestrictedSpawnOptions = {},
  ): SpawnSyncReturns<string> {
    const validatedDsn = requireValidated();
    return spawnSync(command, [...args], {
      cwd: options.cwd,
      encoding: 'utf8',
      shell: options.shell,
      env: {
        ...process.env,
        ...options.env,
        AFLDB_IMPORT_DATABASE_URL: validatedDsn,
      },
    });
  }

  function connect() {
    const validatedDsn = requireValidated();
    return postgres(validatedDsn, { max: 1, onnotice: () => {} });
  }

  function diagnostics(run: SpawnSyncReturns<string>): string {
    const details = [
      `status: ${String(run.status)}`,
      run.signal ? `signal: ${run.signal}` : '',
      run.error ? `spawn error: ${run.error.message}` : '',
      `stdout:\n${run.stdout || '(empty)'}`,
      `stderr:\n${run.stderr || '(empty)'}`,
    ].filter(Boolean);
    return details.join('\n');
  }

  async function withImportDsn<T>(operation: () => Promise<T>): Promise<T> {
    const validatedDsn = requireValidated();
    const previous = process.env.AFLDB_IMPORT_DATABASE_URL;
    process.env.AFLDB_IMPORT_DATABASE_URL = validatedDsn;
    try {
      return await operation();
    } finally {
      if (previous === undefined) delete process.env.AFLDB_IMPORT_DATABASE_URL;
      else process.env.AFLDB_IMPORT_DATABASE_URL = previous;
    }
  }

  return {
    isConfigured,
    skipMessage: IMPORT_ROLE_PARITY_SKIP_MESSAGE,
    validate,
    spawn,
    diagnostics,
    connect,
    withImportDsn,
    get validation() {
      return validation;
    },
  };
}
