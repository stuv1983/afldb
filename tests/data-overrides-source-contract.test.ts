import { expect, test, describe } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('AFLDB-ISSUE-086 Source Contract', () => {
  const root = process.cwd();
  const tsContent = fs.readFileSync(path.join(root, 'src/db/queries/data-edits.ts'), 'utf-8');
  const pyCommon = fs.readFileSync(path.join(root, 'tools/migration/common.py'), 'utf-8');
  const pyFitzroy = fs.readFileSync(path.join(root, 'tools/migration/import_fitzroy_core.py'), 'utf-8');
  const pyDraftGuru = fs.readFileSync(path.join(root, 'tools/rebuild/draftguru/import_draftguru.py'), 'utf-8');
  const sqlOverrides = fs.readFileSync(path.join(root, 'src/db/migrations/073_data_overrides.sql'), 'utf-8');
  const privileges = fs.readFileSync(path.join(root, 'tools/maintenance/privileges.sql'), 'utf-8');

  test('Player identity is never surrogate-ID based', () => {
    expect(tsContent).toMatch(/SELECT e\.external_id\s+FROM external_identities e\s+JOIN sources s ON s\.id = e\.source_id\s+WHERE e\.player_id = \S+\s+AND s\.key = 'afltables'\s+AND e\.status IN \('unique', 'resolved'\)/);
    expect(tsContent).toMatch(/return `afltables:\$\{row\.external_id\}`/);
    expect(tsContent).toMatch(/if \(!row\) return null; \/\/ Not source-owned or lacks stable identity/);
  });

  test('JSON absent vs explicit NULL semantics', () => {
    // One nullable text field (given_name)
    expect(pyCommon).toMatch(/given_name\s*=\s*CASE WHEN jsonb_exists\(o\.override_values,\s*'given_name'\)\s*THEN\s*o\.override_values->>'given_name'\s*ELSE\s*p\.given_name\s*END/);

    // One nullable numeric/date field (dob)
    expect(pyCommon).toMatch(/dob\s*=\s*CASE WHEN jsonb_exists\(o\.override_values,\s*'dob'\)\s*THEN\s*\(o\.override_values->>'dob'\)::date\s*ELSE\s*p\.dob\s*END/);

    // One NOT NULL field (display_name)
    expect(pyCommon).toMatch(/display_name\s*=\s*COALESCE\(o\.override_values->>'display_name',\s*p\.display_name\)/);
  });

  test('Delta-only override payload behaviour', () => {
    expect(tsContent).toMatch(/const overrides: Record<string, any> = existing \? \{ \.\.\.existing\.override_values \} : \{\};/);
    expect(tsContent).toMatch(/for \(const field of group\.fields\) \{\s+if \(values\[field\] !== before\[field\]\) \{\s+overrides\[field\] = values\[field\];\s+\}\s+\}/);
  });

  test('Transaction placement before commit', () => {
    expect(pyFitzroy).toMatch(/import_players\(pg, rep, players, args, refs\)\s+from common import replay_admin_overrides\s+replay_admin_overrides\(pg, "players"\)/);
    expect(pyFitzroy).toMatch(/import_matches\(pg, rep, matches, clubs, refs\)\s+replay_admin_overrides\(pg, "matches"\)/);
  });

  test('DraftGuru replay hook contract', () => {
    expect(pyCommon).toMatch(/elif table == "draft_picks":\s+cur\.execute\("""\s+UPDATE draft_picks d\s+SET.*?entity_key = d\.source_id::text \|\| '\|' \|\| d\.player_url \|\| '\|' \|\| d\.draft_year::text \|\| '\|' \|\| d\.draft_kind/s);
    expect(pyDraftGuru).toMatch(/from common import \([^)]*replay_admin_overrides/s);
    expect(pyDraftGuru).toMatch(/reconcile_draftguru_identities\([\s\S]*?\)\s+replay_admin_overrides\(pg, "draft_picks"\)\s+report_reload\(rep, "draft_persons"/);
  });

  test('Migration/schema contract', () => {
    expect(sqlOverrides).toMatch(/entity_type\s+text\s+NOT NULL/);
    expect(sqlOverrides).toMatch(/entity_key\s+text\s+NOT NULL/);
    expect(sqlOverrides).toMatch(/override_values\s+jsonb\s+NOT NULL/);
    expect(sqlOverrides).toMatch(/is_active\s+boolean\s+NOT NULL DEFAULT true/);
    expect(sqlOverrides).toMatch(/UNIQUE \(entity_type, entity_key, field_group\)/);

    // AFLDB-ISSUE-086 (reopened 2026-08-28): 073 declares
    // admin_user_id NOT NULL REFERENCES auth_users(id) but indexes only
    // (entity_type, entity_key), so fk-indexes.test.ts reports
    // data_overrides(admin_user_id) -> auth_users as uncovered.
    // Migration 075 is the forward repair; 073 is not edited.
    const fkIndexPath = path.join(root, 'src/db/migrations/075_data_overrides_fk_index.sql');
    expect(fs.existsSync(fkIndexPath)).toBe(true);

    const statement = fs.readFileSync(fkIndexPath, 'utf-8')
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n')
      .match(/CREATE[\s\S]*?;/);
    expect(statement).not.toBeNull();
    const createIndex = statement![0];

    // Name, target table and admin_user_id as the leading/only key column,
    // created IF NOT EXISTS.
    expect(createIndex).toMatch(
      /^CREATE INDEX IF NOT EXISTS ix_data_overrides_admin_user_id\s+ON data_overrides \(admin_user_id\);$/,
    );
    // Not unique, not partial, and not CONCURRENTLY (the migration runner
    // wraps each migration in a transaction).
    expect(createIndex).not.toMatch(/UNIQUE/i);
    expect(createIndex).not.toMatch(/\bWHERE\b/i);
    expect(createIndex).not.toMatch(/CONCURRENTLY/i);
  });

  test('AFLDB-ISSUE-109 grants only the Data Editor upsert capability', () => {
    const writerGrantPath = path.join(
      root,
      'src/db/migrations/078_data_overrides_admin_write.sql',
    );
    expect(fs.existsSync(writerGrantPath)).toBe(true);

    const writerGrant = fs.readFileSync(writerGrantPath, 'utf-8')
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n');
    const reconcilerGrant = privileges
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n');

    const insertGrant = /GRANT INSERT \(\s*entity_type, entity_key, field_group, override_values,\s*admin_user_id, is_active, updated_at\s*\) ON data_overrides TO afldb_import;/;
    const updateGrant = /GRANT UPDATE \(\s*override_values, admin_user_id, is_active, updated_at\s*\) ON data_overrides TO afldb_import;/;

    expect(writerGrant).toMatch(insertGrant);
    expect(writerGrant).toMatch(updateGrant);
    expect(writerGrant).toContain(
      'GRANT USAGE ON SEQUENCE data_overrides_id_seq TO afldb_import;',
    );
    expect(writerGrant).not.toMatch(/grant_import_write\s*\(/i);
    expect(writerGrant).not.toMatch(
      /GRANT\s+(?:ALL|INSERT|UPDATE|DELETE|TRUNCATE)\s+ON\s+data_overrides/i,
    );
    expect(writerGrant).not.toMatch(
      /GRANT\s+(?:SELECT|UPDATE)\s+ON\s+SEQUENCE\s+data_overrides_id_seq/i,
    );

    // The subtractive reconciler revokes this unregistered table first,
    // then must restore the same narrow exception rather than a wider one.
    expect(reconcilerGrant).toMatch(insertGrant);
    expect(reconcilerGrant).toMatch(updateGrant);
    expect(reconcilerGrant).toContain(
      'GRANT USAGE ON SEQUENCE data_overrides_id_seq TO afldb_import;',
    );
    expect(reconcilerGrant).not.toMatch(
      /GRANT\s+(?:ALL|INSERT|UPDATE|DELETE|TRUNCATE)\s+ON\s+data_overrides/i,
    );
    expect(reconcilerGrant).not.toMatch(
      /GRANT\s+(?:SELECT|UPDATE)\s+ON\s+SEQUENCE\s+data_overrides_id_seq/i,
    );
    expect(reconcilerGrant).not.toMatch(/grant_import_write\(['"]data_overrides['"]\)/i);
  });
});
