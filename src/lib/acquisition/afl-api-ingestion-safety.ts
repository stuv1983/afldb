import postgres from 'postgres';

import { SETTING_KEYS, parseSiteSettings } from '@/lib/site-settings';

import type { AflApiIngestionControls } from './afl-api-ingestion-control';

const CONNECT_TIMEOUT_S = 5;
const END_TIMEOUT_S = 5;

export type AflApiDatabaseIdentity = {
  database: string;
  role: string;
};

export type AflApiIngestionPreflight = {
  controls: AflApiIngestionControls;
  control: AflApiDatabaseIdentity;
  writer: AflApiDatabaseIdentity;
};

/**
 * The names are obtained from live PostgreSQL sessions, never inferred from a
 * DSN, hostname, or environment-variable name. Database roles may differ.
 */
export function requireSameAflApiDatabase(
  control: AflApiDatabaseIdentity,
  writer: AflApiDatabaseIdentity,
): void {
  if (control.database !== writer.database) {
    throw new Error(
      `AFL API ingestion refused: control database '${control.database}' does not match `
      + `writer database '${writer.database}'. No canonical settle was started.`,
    );
  }
}

/**
 * Read the enable switches and prove the connection that read them names the
 * same live database as the canonical writer, before either settle function is
 * invoked. This function deliberately owns and closes only the read-only
 * control client; callers retain ownership of the writer client.
 */
export async function proveAflApiIngestionPreflight(
  writerSql: postgres.Sql,
  env: Partial<Record<string, string | undefined>> = process.env,
): Promise<AflApiIngestionPreflight> {
  const controlDsn = env.DATABASE_URL;
  if (!controlDsn) {
    throw new Error('AFL API ingestion refused: DATABASE_URL is not configured for the control database.');
  }

  let controlSql: postgres.Sql | null = null;
  try {
    // Construct inside the protected boundary too: malformed control DSNs
    // must fail closed with the same secret-safe public error as connection
    // and query failures.
    controlSql = postgres(controlDsn, {
      max: 1,
      connect_timeout: CONNECT_TIMEOUT_S,
      onnotice: () => {},
      transform: { undefined: null },
    });
    const [settingRows, controlRows, writerRows] = await Promise.all([
      controlSql<{ key: string; value: unknown }[]>`
        SELECT key, value FROM site_settings
         WHERE key IN (${SETTING_KEYS.aflApiCurrentSeasonEnabled}, ${SETTING_KEYS.aflApiBrownlowEnabled})
      `,
      controlSql<AflApiDatabaseIdentity[]>`
        SELECT current_database() AS database, current_user AS role
      `,
      writerSql<AflApiDatabaseIdentity[]>`
        SELECT current_database() AS database, current_user AS role
      `,
    ]);
    const control = controlRows[0];
    const writer = writerRows[0];
    if (!control || !writer) {
      throw new Error('AFL API ingestion refused: live database identity query returned no row.');
    }
    requireSameAflApiDatabase(control, writer);
    const settings = parseSiteSettings(settingRows);
    return {
      controls: {
        currentSeasonEnabled: settings.aflApiCurrentSeasonEnabled,
        brownlowAdminEnabled: settings.aflApiBrownlowEnabled,
      },
      control,
      writer,
    };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('AFL API ingestion refused:')) throw error;
    throw new Error('AFL API ingestion refused: unable to read the control database or prove live writer identity.');
  } finally {
    if (controlSql) {
      try {
        await controlSql.end({ timeout: END_TIMEOUT_S });
      } catch {
        // Cleanup must not replace the public fail-closed error with a driver
        // message that could contain connection details.
      }
    }
  }
}
