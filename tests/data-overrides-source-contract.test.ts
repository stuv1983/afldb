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
  });
});
