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
    // AFLDB-ISSUE-160 §8.2 put a fail-closed pre-check and the manual-row branch ahead
    // of this patch, so the UPDATE is no longer the first statement of the branch. What
    // must not change is the KEY it joins on: migration 069's reload key, unchanged
    // (R-7), because rewriting it would orphan every override already written.
    expect(pyCommon).toMatch(/elif table == "draft_picks":/);
    expect(pyCommon).toMatch(/UPDATE draft_picks d\s+SET.*?entity_key = d\.source_id::text \|\| '\|' \|\| d\.player_url \|\| '\|' \|\| d\.draft_year::text \|\| '\|' \|\| d\.draft_kind/s);
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

describe('AFLDB-ISSUE-160 source contract', () => {
  const root = process.cwd();
  // Line endings are normalised on read. The worktree is an autocrlf=true checkout, so
  // every tracked file is CRLF here and LF on the Linux host; an assertion that pins a
  // literal newline would otherwise pass on one and fail on the other.
  const readSource = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf-8')
    .replace(/\r\n/g, '\n');
  const pyCommon = readSource('tools/migration/common.py');
  const pyFitzroy = readSource('tools/migration/import_fitzroy_core.py');
  const pyDraftGuru = readSource('tools/rebuild/draftguru/import_draftguru.py');
  const pyExport = readSource('tools/rebuild/draftguru/export_link_decisions.py');

  test('exactly one INSERT INTO draft_picks in src/ — and it is admin-draft.ts (D-5)', () => {
    // W-10. Two admin write paths with different semantics is the thing ISSUE-160
    // exists to end; a grep is the only check that stays true as the tree grows.
    const found: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { walk(full); continue; }
        if (!/\.tsx?$/.test(entry.name)) continue;
        // Strip comments first: a doc comment that NAMES the rule is not a second
        // writer, and a test that cannot tell the difference would forbid explaining it.
        const code = fs.readFileSync(full, 'utf-8').replace(/\r\n/g, '\n')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
        if (/INSERT\s+INTO\s+draft_picks/i.test(code)) {
          found.push(path.relative(root, full).split(path.sep).join('/'));
        }
      }
    };
    walk(path.join(root, 'src'));
    expect(found).toEqual(['src/db/queries/admin-draft.ts']);
  });

  test('the manual selection identity namespace cannot collide with the source one', () => {
    const adminDraft = readSource('src/db/queries/admin-draft.ts');
    // 'manual:<uuid>' is not a URL, so the DraftGuru canonical_player_url regex — the
    // contract the importer keys on — can never match it.
    expect(adminDraft).toContain("return `manual:${token}`;");
    const contract = JSON.parse(fs.readFileSync(
      path.join(root, 'tools/rebuild/draftguru/draftguru-contract.json'), 'utf-8'));
    const urlRe = new RegExp(contract.canonical_player_url.regex);
    expect(urlRe.test('manual:0f1c2d3e-4a5b-6c7d-8e9f-001122334455')).toBe(false);
    // And the token is minted, never derived from anything a human typed.
    expect(adminDraft).toContain("import { randomUUID } from 'node:crypto';");
    expect(adminDraft).not.toMatch(/manual:\$\{[^}]*[Nn]ame/);
  });

  test('the frozen draft-kind enumeration in the replay equals the tracked contract', () => {
    // common.py cannot read a repository file at import time and still fail closed, so
    // it carries a copy. This is the assertion that stops the two drifting.
    const kinds = JSON.parse(fs.readFileSync(
      path.join(root, 'data/reference/draftguru-event-kinds.json'), 'utf-8'));
    const expected = [...new Set([
      ...kinds.events.map((e: { draft_kind: string }) => e.draft_kind),
      kinds.absent_column.draft_kind,
    ])].sort();
    const block = pyCommon.slice(pyCommon.indexOf('MANUAL_DRAFT_KINDS = ('));
    const declared = [...block.slice(0, block.indexOf(')')).matchAll(/"([a-z_]+)"/g)]
      .map((m) => m[1]).sort();
    expect(declared).toEqual(expected);
  });

  test('the players replay re-creates a manual player and fails closed first (§8.1)', () => {
    expect(pyCommon).toContain('replay_admin_overrides(players): refusing to commit');
    // Guarded by NOT EXISTS on the identity, not ON CONFLICT: players has no natural
    // unique key a conflict target could name.
    expect(pyCommon).toMatch(/NOT EXISTS \(\s+SELECT 1 FROM external_identities e/);
    expect(pyCommon).toContain("s.key = 'manual_admin_edit'");
    // The bind branch: a manual player who has since debuted resolves onto the
    // candidate's path-player instead of being created twice.
    expect(pyCommon).toContain('bound_player_id');
    expect(pyCommon).toContain('INSERT INTO player_career_stats');
  });

  test('the draft_picks replay re-creates a manual selection and fails closed first (§8.2)', () => {
    expect(pyCommon).toContain('replay_admin_overrides(draft_picks): refusing to commit');
    expect(pyCommon).toContain('player_identity does not resolve to exactly one player');
    expect(pyCommon).toContain('club_slug does not resolve to exactly one club');
    expect(pyCommon).toContain('draft_kind is not one of the frozen draft event kinds');
    // The manual row is re-created only when it is absent, and then whole-row UPDATEd
    // from its payload, so a corrected year or club replays too.
    expect(pyCommon).toMatch(/INSERT INTO draft_picks[\s\S]{0,2000}?d\.player_url = 'manual:' \|\| m\.token/);
    // The source-owned patch keeps its 069 key and gains selection_facts.
    expect(pyCommon).toMatch(
      /entity_key = d\.source_id::text \|\| '\|' \|\| d\.player_url \|\| '\|' \|\| d\.draft_year::text \|\| '\|' \|\| d\.draft_kind/);
    expect(pyCommon).toMatch(/pick_number = CASE WHEN jsonb_exists\(o\.override_values, 'pick_number'\)/);
    expect(pyCommon).toMatch(/club_id = CASE\s+WHEN jsonb_exists\(o\.override_values, 'club_slug'\)/);
  });

  test('D-2: the fitzRoy guard refuses, and can never link', () => {
    // The whole point of the guard: a name and a date of birth may REFUSE an unsafe
    // insert; they may never attach an identity or set a player_id.
    const guard = pyFitzroy.slice(
      pyFitzroy.indexOf('MANUAL_CANDIDATES_SQL'), pyFitzroy.indexOf('def import_players('));
    expect(guard).toContain('def manual_insert_verdict(');
    expect(guard).toContain('def refuse_unsafe_manual_insert(');
    // It reads player_id (that is how it finds candidates) and writes nothing at all:
    // no INSERT, no UPDATE, no DELETE anywhere in the guard.
    expect(guard).not.toMatch(/\bINSERT\s+INTO\b/i);
    expect(guard).not.toMatch(/\bUPDATE\s+\w/i);
    expect(guard).not.toMatch(/\bDELETE\s+FROM\b/i);
    // Both sides normalised by the SAME SQL function -- a Python-side normalisation is
    // how two spellings of one rule drift apart.
    expect(guard).toContain('afldb_normalise_name(n)');
    expect(pyFitzroy).toContain('refuse_unsafe_manual_insert(');
    // It runs ONLY in the new-player INSERT branch.
    const insertBranch = pyFitzroy.indexOf("INSERT INTO players\n                             (display_name, sort_name, search_name, slug,");
    const callSite = pyFitzroy.indexOf('refuse_unsafe_manual_insert(\n');
    expect(callSite).toBeGreaterThan(0);
    expect(callSite).toBeLessThan(insertBranch);
    expect(pyFitzroy.slice(callSite, insertBranch)).not.toContain('UPDATE players');
  });

  test('§8.3: a manual player is named by token in the ledger, never seeded twice', () => {
    expect(pyExport).toContain('"source": "manual_admin_edit", "external_id": manual_id');
    expect(pyDraftGuru).toContain('def resolve_manual_players(');
    const branch = pyDraftGuru.slice(pyDraftGuru.indexOf('elif target["source"] == MANUAL_SOURCE_KEY:'));
    const nextBranch = branch.indexOf('        else:');
    expect(branch.slice(0, nextBranch)).not.toContain('seed_player');
    expect(pyDraftGuru).toContain('two ledger decisions claim one manual identity');
  });
});
