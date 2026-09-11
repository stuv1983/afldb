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

  test('AFLDB-ISSUE-159: coaches replay keeps absent-vs-explicit-null semantics', () => {
    // display_name is NOT NULL on coaches (087:40), so an explicit JSON null is
    // forbidden and COALESCE is the correct -- and only safe -- shape.
    expect(pyCommon).toMatch(/display_name\s*=\s*COALESCE\(o\.override_values->>'display_name',\s*c\.display_name\)/);

    // given_name, surname, dob and notes are nullable, so an ABSENT key must
    // leave the column alone and an EXPLICIT null must clear it. jsonb_exists is
    // the only thing that distinguishes the two; ->> collapses them.
    for (const [field, cast] of [
      ['given_name', ''], ['surname', ''], ['notes', ''], ['dob', '::date'],
    ] as const) {
      const value = cast
        ? `\\(o\\.override_values->>'${field}'\\)${cast}`
        : `o\\.override_values->>'${field}'`;
      expect(pyCommon, field).toMatch(
        new RegExp(`${field}\\s*=\\s*CASE WHEN jsonb_exists\\(o\\.override_values,\\s*'${field}'\\)\\s*THEN\\s*${value}\\s*ELSE\\s*c\\.${field}\\s*END`),
      );
    }

    // Linkage moves as one fact, and absent-vs-explicit-null decides all three
    // columns together -- coaches_link_ck and coaches_profile_link_ck admit no
    // half state. Every arm branches on jsonb_exists first.
    for (const column of ['player_id', 'link_status_value', 'afltables_profile_path']) {
      expect(pyCommon, column).toMatch(
        new RegExp(`${column} = CASE\\s+WHEN NOT jsonb_exists\\(o\\.override_values, 'player_id_identity'\\) THEN c\\.${column}`),
      );
    }

    // The durable linkage decision is a PROFILE PATH, never a player id: ids are
    // rebuilt on promotion, paths are not.
    expect(pyCommon).toMatch(/e\.external_id = o\.override_values->>'player_id_identity'/);
    expect(pyCommon).not.toMatch(/override_values->>'player_id'\b/);

    // Identity is never carried in the payload: afltables_coach_path and name_key
    // are what BIND an override to a row, so an override must not be able to move one.
    const coachesBranch = pyCommon.slice(
      pyCommon.indexOf('elif table == "coaches":'),
      pyCommon.indexOf('elif table == "match_coaches":'),
    );
    expect(coachesBranch.length).toBeGreaterThan(0);
    expect(coachesBranch).not.toMatch(/SET[\s\S]*?afltables_coach_path\s*=/);
    expect(coachesBranch).not.toMatch(/SET[\s\S]*?\bname_key\s*=/);
    // A manual coach is re-created from 'manual:' || <token from the entity_key>,
    // in both identity columns, under the manual_admin_edit source.
    expect(coachesBranch).toMatch(/'manual:' \|\| substring\(o\.entity_key from position\(':' in o\.entity_key\) \+ 1\)/);
    expect(coachesBranch).toMatch(/SELECT id FROM sources WHERE key = 'manual_admin_edit'/);
  });

  test('AFLDB-ISSUE-159: match_coaches replay keeps absent-vs-explicit-null semantics', () => {
    const branch = pyCommon.slice(pyCommon.indexOf('elif table == "match_coaches":'));
    expect(branch.length).toBeGreaterThan(0);

    // Every column of match_coaches is a key or provenance; the single mutable
    // fact is WHICH coach. There is therefore no nullable field to distinguish,
    // and an absent or explicitly null coach_identity is not "leave it alone" --
    // it is an override that cannot be honoured, and it REFUSES.
    expect(branch).toMatch(/NOT jsonb_exists\(d\.override_values, 'coach_identity'\)\s*\n\s*OR d\.override_values->>'coach_identity' IS NULL\s*\n\s*THEN 'override carries no coach_identity'/);
    expect(branch).not.toMatch(/COALESCE\(/);

    // The coach is resolved by PATH, never by id or name.
    expect(branch).toMatch(/c\.afltables_coach_path = d\.override_values->>'coach_identity'/);
    expect(branch).not.toMatch(/name_key|display_name/);

    // Written under manual_admin_edit, which is also what keeps the importer's
    // stale-delete (scoped to the afltables source) from removing it.
    expect(branch).toMatch(/SELECT id FROM sources WHERE key = 'manual_admin_edit'/);
  });

  test('AFLDB-ISSUE-159: the match_coaches composite key decodes on the LAST delimiter', () => {
    // The defect this pins (found at G3, 2026-09-12): entity_key is
    // '<match_key>|<club slug>', but matches.match_key is ITSELF pipe-delimited,
    // so the key carries five delimiters and not one. Decoding with
    // split_part(entity_key, '|', 1) / (..., 2) reads the season and the round
    // out of it, resolves to nothing, and refuses a valid human decision.

    // (a) The repository fact the decoder has to respect, pinned at both ends.
    const migration003 = fs.readdirSync(path.join(root, 'src/db/migrations'))
      .filter((f) => f.startsWith('003_') && f.endsWith('.sql'))
      .map((f) => fs.readFileSync(path.join(root, 'src/db/migrations', f), 'utf-8'))
      .join('\n');
    expect(migration003).toContain('Stable natural key: season|round|date|home|away');
    const pyFitzroyCore = fs.readFileSync(
      path.join(root, 'tools/migration/import_fitzroy_core.py'), 'utf-8',
    );
    expect(pyFitzroyCore).toMatch(
      /def match_key_of\([\s\S]{0,200}?return "\|"\.join\(\[[\s\S]{0,200}?match\.match_date\.isoformat\(\)/,
    );

    const branch = pyCommon.slice(pyCommon.indexOf('elif table == "match_coaches":'));
    expect(branch.length).toBeGreaterThan(0);

    // (b) The broken decoder must not come back, in either statement. Asserted
    //     against the CODE with the Python commentary stripped: the branch
    //     explains at length what it must not do, naming the broken call, and
    //     that explanation must not fail its own test.
    const branchCode = branch.split('\n')
      .filter((line) => !line.trim().startsWith('#')).join('\n');
    expect(branchCode).not.toMatch(/split_part\([^)]*entity_key/);

    // (c) The decode is last-delimiter, and single-sourced: ONE CTE feeds both the
    // refusal query and the write, so they cannot drift apart again.
    expect(branch).toContain("strpos(reverse(o.entity_key), '|')");
    expect(branch).toMatch(/decoded AS \(/);
    expect((branch.match(/decoded AS \(/g) ?? [])).toHaveLength(1);
    expect((branch.match(/WITH " \+ decoded_overrides/g) ?? []).length).toBe(2);
    expect(branch).toMatch(/JOIN matches m ON m\.match_key = d\.match_key/);
    expect(branch).toMatch(/JOIN clubs cl ON cl\.slug = d\.club_slug/);

    // (d) A malformed key still refuses, and refuses BEFORE it is used.
    expect(branch).toMatch(/WHEN d\.tail = 0\s*\n\s*THEN 'entity_key is not <match_key>\|<club slug>'/);
    expect(branch).toMatch(/WHEN d\.club_slug = ''/);

    // (e) The round trip, DB-free, on the exact key that exposed the defect.
    //     This is the same arithmetic the SQL performs: PostgreSQL's
    //     strpos(reverse(k), '|') is the 1-based offset of the last delimiter
    //     counted from the end, so left(k, len - tail) / right(k, tail - 1).
    const matchKey = '1902|1|1902-05-03|Carlton|Geelong';
    const clubSlug = 'carlton';
    const entityKey = `${matchKey}|${clubSlug}`;
    const tail = [...entityKey].reverse().indexOf('|') + 1;
    expect(entityKey.slice(0, entityKey.length - tail)).toBe(matchKey);
    expect(entityKey.slice(entityKey.length - (tail - 1))).toBe(clubSlug);
    // And the decoder that caused the defect does NOT round trip.
    expect(entityKey.split('|')[0]).not.toBe(matchKey);
    expect(entityKey.split('|')[1]).not.toBe(clubSlug);
    // The invariant the last-delimiter rule rests on: a club slug has no delimiter.
    expect(clubSlug).not.toContain('|');
  });

  test('AFLDB-ISSUE-159: both new replay branches fail closed, never skipping', () => {
    for (const [entity, next] of [
      ['coaches', 'elif table == "match_coaches":'],
      ['match_coaches', ''],
    ] as const) {
      const start = pyCommon.indexOf(`elif table == "${entity}":`);
      const branch = next ? pyCommon.slice(start, pyCommon.indexOf(next)) : pyCommon.slice(start);
      // The refusal is computed over the WHOLE active set and raised BEFORE any
      // write, so a reload either honours every human decision or does none of it.
      expect(branch, entity).toMatch(
        new RegExp(`raise RuntimeError\\(\\s*\\n?\\s*"replay_admin_overrides\\(${entity}\\): refusing to commit`),
      );
      expect(branch, entity).toContain('unresolvable = [(key, problem)');
      expect(branch.indexOf('raise RuntimeError'), entity)
        .toBeLessThan(branch.indexOf('INSERT INTO'));
      // No silent skip: nothing quietly filters the unresolvable rows away.
      expect(branch, entity).not.toMatch(/continue\b|pass\b/);
    }
  });

  test('AFLDB-ISSUE-159: the importer calls both replays, in the binding order', () => {
    const pyCoaches = fs.readFileSync(
      path.join(root, 'tools/migration/import_match_coaches.py'), 'utf-8',
    );
    expect(pyCoaches).toMatch(/from common import [^\n]*replay_admin_overrides/);

    // §6.2. coaches replay: after the coaches upsert, before ANY match_coaches
    // work, so a manual coach row exists for the assignment join.
    const coachesReplay = pyCoaches.indexOf('replay_admin_overrides(pg, "coaches")');
    const upsertCount = pyCoaches.indexOf('coaches_written = cur.rowcount');
    const tmpAssignments = pyCoaches.indexOf('CREATE TEMP TABLE tmp_match_coaches');
    expect(upsertCount).toBeLessThan(coachesReplay);
    expect(coachesReplay).toBeLessThan(tmpAssignments);

    // match_coaches replay: after the assignment upsert, before the integrity
    // checks -- the (match_id, club_id) PK carries no source, so the snapshot has
    // already overwritten any manual assignment and this is what restores it.
    const assignmentsReplay = pyCoaches.indexOf('replay_admin_overrides(pg, "match_coaches")');
    const assignmentsCount = pyCoaches.indexOf('assignments_written = cur.rowcount');
    const guard = pyCoaches.indexOf('if coaches_written != len(coach_rows)');
    expect(assignmentsCount).toBeLessThan(assignmentsReplay);
    expect(assignmentsReplay).toBeLessThan(guard);

    // Both counts are captured before either replay runs, so the guard counts the
    // INSERT over tmp_coaches alone and a manual row cannot perturb it.
    expect(upsertCount).toBeLessThan(guard);
    expect(assignmentsCount).toBeLessThan(guard);
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
