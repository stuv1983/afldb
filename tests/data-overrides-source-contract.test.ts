import { expect, test, describe } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * ONE `replay_admin_overrides()` branch out of `tools/migration/common.py`,
 * isolated from its siblings: from its own `elif table == "<name>":` down to the
 * NEXT branch at the same indentation, or to the end of the function when it is
 * the last one.
 *
 * Slicing to the end of the file — which is what these assertions used to do —
 * is only correct for whichever branch happens to be last, so every branch added
 * afterwards silently widened the ones before it: an ISSUE-159 assertion that
 * `match_coaches` contains no COALESCE and no `split_part(entity_key ...)` began
 * failing on ISSUE-161's and ISSUE-162's code, which are not its subject. The
 * guarantee is unchanged and still exact; only the extraction is repaired.
 */
function replayBranch(source: string, table: string): string {
  const start = source.indexOf(`elif table == "${table}":`);
  if (start < 0) throw new Error(`replay_admin_overrides has no "${table}" branch`);
  const body = source.slice(start);
  // Eight spaces is the branch indentation inside replay_admin_overrides; the
  // offset of one skips this branch's own header.
  const next = /\n {8}elif table == "/.exec(body.slice(1));
  return next ? body.slice(0, next.index + 1) : body;
}

/**
 * Python source with its `#` commentary removed, for "the CODE never does X"
 * claims. A branch that explains at length what it must not do — naming the
 * broken call, or naming `match_id` to say the column does not exist — must not
 * fail its own test for saying so.
 */
function executablePython(source: string): string {
  return source.split('\n').filter((line) => !line.trim().startsWith('#')).join('\n');
}

/** TypeScript source with its comments removed, for the same reason. */
function executableTypeScript(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

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
    const coachesBranch = replayBranch(pyCommon, 'coaches');
    expect(coachesBranch.length).toBeGreaterThan(0);
    expect(coachesBranch).not.toMatch(/SET[\s\S]*?afltables_coach_path\s*=/);
    expect(coachesBranch).not.toMatch(/SET[\s\S]*?\bname_key\s*=/);
    // A manual coach is re-created from 'manual:' || <token from the entity_key>,
    // in both identity columns, under the manual_admin_edit source.
    expect(coachesBranch).toMatch(/'manual:' \|\| substring\(o\.entity_key from position\(':' in o\.entity_key\) \+ 1\)/);
    expect(coachesBranch).toMatch(/SELECT id FROM sources WHERE key = 'manual_admin_edit'/);
  });

  test('AFLDB-ISSUE-159: match_coaches replay keeps absent-vs-explicit-null semantics', () => {
    const branch = replayBranch(pyCommon, 'match_coaches');
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

    const branch = replayBranch(pyCommon, 'match_coaches');
    expect(branch.length).toBeGreaterThan(0);

    // (b) The broken decoder must not come back, in either statement. Asserted
    //     against THIS branch's code with the Python commentary stripped: the
    //     branch explains at length what it must not do, naming the broken call,
    //     and that explanation must not fail its own test. Sibling branches are
    //     out of scope — the fixtures replay legitimately decodes its own
    //     'manual_admin_edit:<token>' key with split_part on ':'.
    const branchCode = executablePython(branch);
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
    for (const entity of ['coaches', 'match_coaches'] as const) {
      const branch = replayBranch(pyCommon, entity);
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

  test('AFLDB-ISSUE-161: exactly one INSERT INTO season_list_members in src/', () => {
    // I-7. A playing list is administrative intent, and one writer is what makes
    // "importers may not overwrite manual truth" checkable at all. A grep is the
    // only check that stays true as the tree grows.
    const found: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { walk(full); continue; }
        if (!/\.tsx?$/.test(entry.name)) continue;
        const code = fs.readFileSync(full, 'utf-8').replace(/\r\n/g, '\n')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
        if (/INSERT\s+INTO\s+season_list_members/i.test(code)) {
          found.push(path.relative(root, full).split(path.sep).join('/'));
        }
      }
    };
    walk(path.join(root, 'src'));
    expect(found).toEqual(['src/db/queries/admin-season-lists.ts']);
  });

  test('AFLDB-ISSUE-161: appearances are never written as membership (D-2)', () => {
    const source = readSource('src/db/queries/admin-season-lists.ts');
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    // The appearances projection is a SELECT and only a SELECT: no statement in
    // this module may read player_club_season_stats and write a membership in
    // the same breath. The frozen origin enumeration carries no appearance-
    // derived value, so there is no origin such a row could even be given.
    expect(code).not.toMatch(/INSERT\s+INTO\s+season_list_members[\s\S]{0,400}player_club_season_stats/i);
    expect(code).not.toContain('seeded_appearances');
    expect(code).toContain("export const FIRST_LIST_SEASON = 2027;");
    const origins = /SEASON_LIST_ORIGINS = \[([^\]]*)\]/.exec(code)![1];
    expect([...origins.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]))
      .toEqual(['added', 'copied_list', 'transferred', 'imported']);
  });

  test('AFLDB-ISSUE-161: the replay fails closed, honours tombstones, and never ON CONFLICTs', () => {
    expect(pyCommon).toContain('replay_admin_overrides(season_list_members): refusing to commit');
    expect(pyCommon).toContain('player_identity does not resolve to exactly one player');
    expect(pyCommon).toContain('club_slug does not resolve to exactly one club');
    expect(pyCommon).toContain('no club identity of that organisation is eligible in that season');
    expect(pyCommon).toContain('membership override carries no valid origin');

    const branch = replayBranch(pyCommon, 'season_list_members');
    // The pre-check reads EVERY override for the entity type, active and inactive:
    // an unresolvable TOMBSTONE is as serious as an unresolvable membership,
    // because failing to apply it resurrects a deliberately removed player.
    expect(branch).toContain("WHERE o.entity_type = 'season_list_members'");
    expect(branch).not.toMatch(/entity_type = 'season_list_members' AND o\.is_active/);
    // Tombstones delete, and they delete FIRST.
    const deleteAt = branch.indexOf('DELETE FROM season_list_members');
    const insertAt = branch.indexOf('INSERT INTO season_list_members');
    expect(deleteAt).toBeGreaterThan(0);
    expect(insertAt).toBeGreaterThan(deleteAt);
    // Guarded by NOT EXISTS, never ON CONFLICT: the UNIQUE is on (season,
    // player), so the same player at a different club is a contradiction between
    // two durable records and must surface, not be swallowed.
    expect(branch).toMatch(/NOT EXISTS \(\s*SELECT 1 FROM season_list_members m/);
    expect(branch.slice(0, branch.length)).not.toMatch(
      /INSERT INTO season_list_members[\s\S]{0,1200}ON CONFLICT/);
  });

  test('AFLDB-ISSUE-161: a membership is never derived, so no rebuild may touch it', () => {
    // The whole point of a separate canonical table (§3): "listed" is not
    // "played", and every table that means "played" is TRUNCATEd and rebuilt
    // from player_match_stats by this job — which the nightly settle runs. If
    // season_list_members ever appeared here, an administered list would be
    // silently erased every night. This is the assertion that stops it, and it
    // is exact rather than a spot check.
    const rebuild = readSource('tools/migration/rebuild_derived.py');
    expect(rebuild).toContain('TRUNCATE player_club_season_stats;');
    expect(rebuild).not.toContain('season_list_members');

    const inventory = readSource('tools/db/promotion-inventory.ts');
    const derived = /DERIVED_FOOTBALL_TABLES: readonly string\[\] = \[([\s\S]*?)\]/.exec(inventory)![1];
    expect([...derived.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]))
      .toEqual(['player_clubs', 'player_club_season_stats', 'player_season_stats',
        'player_career_stats', 'club_seasons']);

    // Nor is it a settle target: the settle writes matches, player_match_stats
    // and scores and then runs the rebuild above. Neither reaches this table.
    const settle = readSource('src/lib/acquisition/settle-afltables.ts');
    expect(settle).not.toContain('season_list_members');
  });

  test('AFLDB-ISSUE-161: the frozen origin enumeration in the replay equals the migration', () => {
    // common.py cannot read the database schema and still fail closed, so it
    // carries a copy. This is the assertion that stops the two drifting.
    const migration = readSource('src/db/migrations/096_season_list_members.sql');
    const check = /origin\s+text\s+NOT NULL CHECK \(origin IN \(([\s\S]*?)\)\)/.exec(migration)![1];
    const expected = [...check.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
    const block = pyCommon.slice(pyCommon.indexOf('SEASON_LIST_ORIGINS = ('));
    const declared = [...block.slice(0, block.indexOf(')')).matchAll(/"([a-z_]+)"/g)]
      .map((m) => m[1]).sort();
    expect(declared).toEqual(expected);
    expect(declared).not.toContain('seeded_appearances');
  });

  test('AFLDB-ISSUE-162: exactly one INSERT INTO fixtures in src/', () => {
    // I-1. A fixture is administrative intent about a match that has not been
    // played, and ONE writer is what makes "nothing else may create one"
    // checkable at all. A grep is the only check that stays true as the tree
    // grows.
    const found: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { walk(full); continue; }
        if (!/\.tsx?$/.test(entry.name)) continue;
        const code = fs.readFileSync(full, 'utf-8').replace(/\r\n/g, '\n')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
        if (/INSERT\s+INTO\s+fixtures/i.test(code)) {
          found.push(path.relative(root, full).split(path.sep).join('/'));
        }
      }
    };
    walk(path.join(root, 'src'));
    expect(found).toEqual(['src/db/queries/admin-fixtures.ts']);
  });

  test('AFLDB-ISSUE-162: a fixture is never a played match, and never becomes one', () => {
    // §3, §21, S-1. The whole point of a separate canonical table: `matches`
    // means PLAYED, and every derived figure in AFLDB reads it. If a fixture
    // could reach any of these, a scheduled game would count as a 0-0 draw.
    // Asserted against the EXECUTABLE code. The contract is about what the
    // module does, not about which concepts its commentary is allowed to name —
    // and it names them deliberately: the file explains that it creates no venue
    // by writing out the `INSERT INTO venues` it will never contain, and states
    // that a fixture stores no `match_id` and compares no `match_key`. Asserting
    // over the raw text would make the module's own explanation of a rule a
    // violation of it.
    const code = executableTypeScript(readSource('src/db/queries/admin-fixtures.ts'));
    for (const table of [
      'matches', 'match_period_scores', 'player_match_stats', 'brownlow_round_votes',
      'club_seasons', 'seasons', 'clubs', 'venues', 'venue_aliases',
    ]) {
      expect(code, table).not.toMatch(new RegExp(
        `INSERT\\s+INTO\\s+${table}\\b|UPDATE\\s+${table}\\b|DELETE\\s+FROM\\s+${table}\\b`, 'i',
      ));
    }

    // D-6, and the operator constraint of 2026-09-11: the played association is
    // resolved at READ TIME and is never persisted or compared as an identity.
    // No column, payload key or SQL fragment in the module names either one.
    expect(code).not.toContain('match_key');
    expect(code).not.toContain('match_id');

    // And the mirror: nothing that derives a played-match fact may read
    // `fixtures`. These are the consumers AFLDB-ISSUE-162 §21 audited.
    for (const consumer of [
      'tools/migration/rebuild_derived.py',
      'src/lib/acquisition/settle-afltables.ts',
      'src/lib/acquisition/canonical-apply.ts',
      'src/db/queries/rounds.ts',
      'src/db/queries/venues.ts',
      'src/db/queries/clubs.ts',
      'src/db/queries/grid-solver.ts',
    ]) {
      expect(readSource(consumer), consumer).not.toMatch(/\bFROM\s+fixtures\b|\bJOIN\s+fixtures\b/i);
    }

    // The settle never writes fixtures either, so no twin can arise: the two
    // tables never hold the same fact (§19).
    expect(readSource('src/lib/acquisition/settle-afltables.ts'))
      .not.toMatch(/INSERT\s+INTO\s+fixtures|UPDATE\s+fixtures/i);
  });

  test('AFLDB-ISSUE-162: the fixtures replay fails closed and never deletes', () => {
    expect(pyCommon).toContain('replay_admin_overrides(fixtures): refusing to commit');
    expect(pyCommon).toContain('home_club_slug does not resolve to exactly one club');
    expect(pyCommon).toContain('no home club identity is eligible in that season');
    expect(pyCommon).toContain('payload carries no valid status');
    expect(pyCommon).toContain('payload fixture_key does not match the entity_key token');

    const branch = replayBranch(pyCommon, 'fixtures');
    expect(branch.length).toBeGreaterThan(0);
    // The branch's own SQL and Python, with its commentary removed: the comments
    // state the D-6 rule by naming `match_key` and `match_id`, and must not fail
    // the assertion that the CODE never touches either.
    const branchCode = executablePython(branch);
    // The refusal is computed over EVERY override and raised BEFORE any write,
    // so a reload either honours every human decision or does none of it.
    expect(branch.indexOf('raise RuntimeError')).toBeLessThan(branch.indexOf('INSERT INTO'));
    expect(branch).toContain('unresolvable = [(key, problem)');

    // NEVER deletes. A fixture row persists through `cancelled` and `void`
    // precisely so its data_edits rows stay resolvable at the lineage remap, so
    // a replay that dropped one would break the promotion contract (§16, §20).
    expect(branchCode).not.toMatch(/DELETE\s+FROM\s+fixtures/i);
    // Guarded by NOT EXISTS, never ON CONFLICT: a contradiction between two
    // durable records must surface through the uniqueness constraint.
    expect(branch).toMatch(/NOT EXISTS \(\s*SELECT 1 FROM fixtures x/);
    expect(branch).not.toMatch(/INSERT INTO fixtures[\s\S]{0,1500}ON CONFLICT/);
    // The identity is the one thing a replay may not move: fixture_key is never
    // in a SET list, and the UPDATE that carries every other fact is still there.
    expect(branchCode).not.toMatch(/SET[\s\S]{0,600}fixture_key\s*=/);
    expect(branchCode).toMatch(/UPDATE fixtures x\s*\n\s*SET season =/);
    // It writes no result fact, because there is no column it could write one to.
    expect(branchCode).not.toMatch(/home_score|away_score|margin|attendance|winner/);
    // And it never renders, stores or compares a match_key or a match_id (D-6).
    // The commentary names both to say so; the executable branch touches neither.
    expect(branchCode).not.toContain('match_key');
    expect(branchCode).not.toContain('match_id');

    // The VENUE contract (§11, operator clarification 2026-09-11). A venue slug
    // this database cannot resolve must not silently become TBC and must not be
    // fuzzy-matched to a replacement: the fixture keeps the canonical NAME the
    // payload carries, venue_id stays NULL, and the degradation is REPORTED.
    // Both statements carry the identical expression, so the INSERT and the
    // idempotent re-UPDATE cannot disagree about what happened to the venue.
    expect((branchCode.match(
      /CASE WHEN f\.venue_id IS NOT NULL THEN f\.venue_canonical_name\s*\n?\s*ELSE f\.v->>'venue_raw' END/g,
    ) ?? [])).toHaveLength(2);
    expect(branch).toContain('kept as an unmapped venue name (venue_id NULL)');
    expect(branchCode).toMatch(/WHERE f\.v->>'venue_slug' IS NOT NULL AND f\.venue_id IS NULL/);
    // No fuzzy fallback: an unresolved venue is never guessed at by name.
    expect(branchCode).not.toMatch(/ILIKE|similarity\(|soundex|levenshtein/i);
    // An unresolvable venue is a WARNING, never a refusal: a promotion is not
    // stopped by a venue rename, and the fixture is still re-created.
    const problemCase = branchCode.slice(
      branchCode.indexOf('SELECT f.entity_key,'), branchCode.indexOf('END AS problem'),
    );
    expect(problemCase.length).toBeGreaterThan(0);
    expect(problemCase).not.toContain('venue');
  });

  test('AFLDB-ISSUE-162: the importer calls the fixtures replay', () => {
    expect(pyFitzroy).toMatch(
      /replay_admin_overrides\(pg, "matches"\)[\s\S]{0,800}replay_admin_overrides\(pg, "fixtures"\)/,
    );
    // And the promotion runbook's replay loop names it, or a promoted database
    // would hold no administered schedule at all.
    const promotion = readSource('docs/production-promotion.md');
    expect(promotion).toMatch(/for table in \([^)]*'fixtures'\)/);
  });

  test('AFLDB-ISSUE-162: the frozen fixture enumerations in the replay equal the migration', () => {
    // common.py cannot read the database schema and still fail closed, so it
    // carries copies. These are the assertions that stop them drifting.
    const migration = readSource('src/db/migrations/097_fixtures.sql');
    const statusCheck = /CHECK \(status IN \(([^)]*)\)\)/.exec(migration)![1];
    const expectedStatuses = [...statusCheck.matchAll(/'([a-z]+)'/g)].map((m) => m[1]).sort();
    const statusBlock = pyCommon.slice(pyCommon.indexOf('FIXTURE_STATUSES = ('));
    expect([...statusBlock.slice(0, statusBlock.indexOf(')')).matchAll(/"([a-z_]+)"/g)]
      .map((m) => m[1]).sort()).toEqual(expectedStatuses);

    const enumBody = /CREATE TYPE round_type AS ENUM \(([\s\S]*?)\)/
      .exec(readSource('src/db/migrations/003_matches.sql'))![1];
    const added = [...readSource('src/db/migrations/084_round_type_wildcard_final.sql')
      .matchAll(/ALTER TYPE round_type ADD VALUE IF NOT EXISTS '([a-z_]+)'/g)].map((m) => m[1]);
    const expectedTypes = [...enumBody.matchAll(/'([a-z_]+)'/g)].map((m) => m[1])
      .concat(added).sort();
    const typeBlock = pyCommon.slice(pyCommon.indexOf('FIXTURE_ROUND_TYPES = ('));
    expect([...typeBlock.slice(0, typeBlock.indexOf(')')).matchAll(/"([a-z_]+)"/g)]
      .map((m) => m[1]).sort()).toEqual(expectedTypes);
  });

  test('AFLDB-ISSUE-163: exactly one INSERT INTO club_leadership in src/', () => {
    // ONE writer is what makes "nothing else may appoint a captain" checkable
    // at all, and a grep is the only check that stays true as the tree grows.
    const found: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { walk(full); continue; }
        if (!/\.tsx?$/.test(entry.name)) continue;
        const code = fs.readFileSync(full, 'utf-8').replace(/\r\n/g, '\n')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
        if (/INSERT\s+INTO\s+club_leadership/i.test(code)) {
          found.push(path.relative(root, full).split(path.sep).join('/'));
        }
      }
    };
    walk(path.join(root, 'src'));
    expect(found).toEqual(['src/db/queries/admin-club-leadership.ts']);
  });

  test('AFLDB-ISSUE-163: leadership never mutates a list, a player or a match', () => {
    // §12, the operator constraint of 2026-09-12. Appointing a leader is a
    // statement about an office. It must not quietly write a season-list
    // membership around its own precondition, mutate a player identity, or
    // touch a match or a statistic.
    const code = executableTypeScript(readSource('src/db/queries/admin-club-leadership.ts'));
    for (const table of [
      'season_list_members', 'players', 'external_identities', 'captaincies',
      'matches', 'player_match_stats', 'club_seasons', 'seasons', 'clubs',
    ]) {
      expect(code, table).not.toMatch(new RegExp(
        `INSERT\\s+INTO\\s+${table}\\b|UPDATE\\s+${table}\\b|DELETE\\s+FROM\\s+${table}\\b`, 'i',
      ));
    }
    // There is NO hard-delete path anywhere: 'ended' and 'void' keep the row so
    // its data_edits rows stay resolvable at a promotion lineage remap.
    expect(code).not.toMatch(/DELETE\s+FROM\s+club_leadership/i);
    // The durable identity is the one thing no statement may move. Asserted as
    // "appointment_key is never an assignment target", not as a distance from
    // the word SET: `WHERE appointment_key = ...` is legitimate and common, and
    // a distance rule would either catch it or miss a real SET list.
    expect(code).not.toMatch(/SET\s+appointment_key\s*=/i);
    expect(code).not.toMatch(/\n\s*appointment_key\s*=[^=]/);
    // The membership precondition is LOCKED, not merely read (§9, L-8): the
    // lock is what stops a concurrent AFLDB-ISSUE-161 removal committing
    // between the check and the appointment.
    expect(code).toContain('FOR KEY SHARE');
  });

  test('AFLDB-ISSUE-163: one season boundary, and no public read reaches admin code', () => {
    // §20.3 and operator clarification 2 of 2026-09-12. The boundary is ONE
    // constant, derived from the season-list floor so leadership can never
    // precede the lists, and it is declared exactly once.
    const publicReads = readSource('src/db/queries/club-leadership.ts');
    expect(publicReads).toContain('export const FIRST_LEADERSHIP_SEASON = FIRST_LIST_SEASON;');
    expect(readSource('src/db/queries/admin-season-lists.ts'))
      .toContain('export const FIRST_LIST_SEASON = 2027;');
    // The writer re-exports it; it does not declare a second one.
    const writer = readSource('src/db/queries/admin-club-leadership.ts');
    expect(writer).not.toMatch(/const FIRST_LEADERSHIP_SEASON\s*=/);
    expect(writer).toContain('export { FIRST_LEADERSHIP_SEASON };');

    // The public module reads the public client only, and imports no admin
    // mutation, override or audit code (§20.4).
    const publicCode = executableTypeScript(publicReads);
    expect(publicCode).not.toContain('data_overrides');
    expect(publicCode).not.toContain('admin-club-leadership');
    expect(publicCode).not.toContain('AFLDB_IMPORT_DATABASE_URL');

    // The two public captain-history projections, ISOLATED.
    //
    // Scoping matters here and a whole-file search would be wrong: `awards.ts`
    // legitimately carries `award_winners.is_vice_captain` (awards.ts:111), a
    // REPRESENTATIVE-TEAM flag for All-Australian and 22 Under 22 selections —
    // not club leadership at all (AFLDB-ISSUE-163 §2.1). Searching the file for
    // the token `vice_captain` says nothing about either projection and fails on
    // unrelated award functionality that must not change.
    const awardsCode = executableTypeScript(readSource('src/db/queries/awards.ts'));

    // §20.4: the public reads reach the public leadership module and never the
    // admin writer.
    expect(awardsCode).toContain("from '@/db/queries/club-leadership'");
    expect(awardsCode).not.toContain('admin-club-leadership');

    // Exactly two canonical reads exist, so a third projection cannot be added
    // without a boundary and land outside this contract.
    expect((awardsCode.match(/FROM club_leadership\b/g) ?? []).length).toBe(2);

    const block = (from: string, to: string) => {
      const start = awardsCode.indexOf(from);
      const end = awardsCode.indexOf(to);
      expect(start, from).toBeGreaterThan(-1);
      expect(end, to).toBeGreaterThan(start);
      return awardsCode.slice(start, end);
    };
    const projections: Record<string, string> = {
      'getPlayerHonours captaincies':
        block('WITH captaincy_rows AS (', 'SELECT * FROM captaincy_rows'),
      getClubCaptains:
        block('WITH lineage AS (', 'SELECT * FROM captain_rows'),
    };

    for (const [name, projection] of Object.entries(projections)) {
      // One authority per season, enforced on BOTH arms of the union — the
      // boundary is in the query, never a de-duplication by name afterwards.
      expect(projection, name).toContain('cp.season < ${FIRST_LEADERSHIP_SEASON}::smallint');
      expect(projection, name).toContain('l.season >= ${FIRST_LEADERSHIP_SEASON}::smallint');

      // The canonical arm's own filter, from its FROM clause onwards. Asserted
      // POSITIVELY: the only `l.role` predicate deciding which rows enter is the
      // equality to 'captain', and the only `l.status` predicate excludes rows
      // entered in error. A vice-captaincy therefore cannot reach a captain
      // history however the rest of the file grows, and the proof does not
      // depend on a token being absent from unrelated code.
      const arm = projection.slice(projection.indexOf('FROM club_leadership'));
      const predicates = (pattern: RegExp) =>
        (arm.match(pattern) ?? []).map((line) => line.trim());
      expect(predicates(/l\.role\b[^\n]*/g), name).toEqual(["l.role = 'captain'"]);
      expect(predicates(/l\.status\b[^\n]*/g), name).toEqual(["l.status <> 'void'"]);
      expect(arm, name).not.toMatch(/vice_captain/);
    }
  });

  test('AFLDB-ISSUE-163: captaincies stays frozen below the canonical boundary', () => {
    // §3, §23, R-14. The legacy Wikipedia manifest must never start answering a
    // season club_leadership owns, or one season would have two authorities and
    // the union would contradict itself. This is the pin.
    const captaincies = readSource('tools/migration/captaincies.py');
    const maxSeason = Number(/^MAX_SEASON = (\d{4})$/m.exec(captaincies)![1]);
    const firstLeadership = Number(
      /export const FIRST_LIST_SEASON = (\d{4});/
        .exec(readSource('src/db/queries/admin-season-lists.ts'))![1],
    );
    expect(maxSeason).toBeLessThan(firstLeadership);
    // And the legacy role vocabulary is untouched by this issue: widening it is
    // a deliberate change to an honours import, not a side effect of leadership
    // administration.
    expect(captaincies).toContain('ROLES = {"Captain"}');
    expect(captaincies).toContain('EXPECTED_TOTAL = 1774');
    // Migration 098 does not touch the legacy table at all.
    const migration = readSource('src/db/migrations/098_club_leadership.sql');
    const sqlOnly = migration.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
    expect(sqlOnly).not.toMatch(/ALTER\s+TABLE\s+captaincies|INSERT\s+INTO\s+captaincies/i);
    expect(sqlOnly).not.toMatch(/ALTER\s+TABLE\s+season_list_members/i);
  });

  test('AFLDB-ISSUE-163: the leadership replay fails closed, never deletes, never re-checks lists', () => {
    expect(pyCommon).toContain('replay_admin_overrides(club_leadership): refusing to commit');
    expect(pyCommon).toContain('player_identity does not resolve to exactly one player');
    expect(pyCommon).toContain('club_slug does not resolve to exactly one club');
    expect(pyCommon).toContain('payload appointment_key does not match the entity_key token');
    expect(pyCommon).toContain('payload carries no valid role');
    expect(pyCommon).toContain('payload carries no valid status');
    expect(pyCommon).toContain('an active appointment cannot carry an end date');
    expect(pyCommon).toContain('the appointment ends before it starts');

    const branch = replayBranch(pyCommon, 'club_leadership');
    expect(branch.length).toBeGreaterThan(0);
    const branchCode = executablePython(branch);

    // The refusal is computed over EVERY override and raised BEFORE any write,
    // so a reload either honours every human decision or does none of it.
    expect(branch.indexOf('raise RuntimeError')).toBeLessThan(branch.indexOf('INSERT INTO'));
    expect(branch).toContain('unresolvable = [(key, problem)');

    // NEVER deletes. An appointment persists through 'ended' and 'void'
    // precisely so its data_edits rows stay resolvable at the lineage remap.
    expect(branchCode).not.toMatch(/DELETE\s+FROM\s+club_leadership/i);
    // Ended and void rows are RE-CREATED, not suppressed. Every leadership
    // override is active, so the branch reads none of them by is_active, and
    // neither write filters by status — the ONLY guard on the insert is the
    // NOT EXISTS on the key.
    expect(branchCode).not.toMatch(/o\.is_active/);
    expect(branchCode).not.toMatch(/WHERE[^\n]*v->>'status'\s*=/);
    // Guarded by NOT EXISTS, never ON CONFLICT: two active payloads naming one
    // player-season are a contradiction between durable records and must
    // surface through the partial unique index as the error they are.
    expect(branch).toMatch(/NOT EXISTS \(\s*SELECT 1 FROM club_leadership x/);
    expect(branch).not.toMatch(/INSERT INTO club_leadership[\s\S]{0,1500}ON CONFLICT/);
    // The identity is the one thing a replay may not move — asserted as
    // "appointment_key is never an assignment target". `WHERE
    // x.appointment_key = a.token` is how the UPDATE finds its row and must
    // stay, so a distance-from-SET rule would refuse the correct code.
    expect(branchCode).not.toMatch(/SET\s+appointment_key\s*=/);
    expect(branchCode).not.toMatch(/\n\s*appointment_key\s*=/);
    expect(branchCode).toMatch(/UPDATE club_leadership x\s*\n\s*SET season =/);

    // §9, D-5. Membership is a precondition of MAKING an appointment, never a
    // property of a recorded one: a replay that re-checked it would erase valid
    // leadership history wherever a list was corrected afterwards, and would
    // make AFLDB-ISSUE-161's removal destructive. The branch never reads it.
    expect(branchCode).not.toContain('season_list_members');
    // And no fuzzy fallback anywhere: an identity is resolved or refused.
    expect(branchCode).not.toMatch(/ILIKE|similarity\(|soundex|levenshtein|display_name/i);
  });

  test('AFLDB-ISSUE-163: leadership is never derived, and the importer calls its replay', () => {
    // Nothing recomputes an appointment, so no rebuild and no settle may touch
    // the table — if either did, an administered captain would be erased
    // nightly.
    expect(readSource('tools/migration/rebuild_derived.py')).not.toContain('club_leadership');
    expect(readSource('src/lib/acquisition/settle-afltables.ts')).not.toContain('club_leadership');
    const inventory = readSource('tools/db/promotion-inventory.ts');
    const derived = /DERIVED_FOOTBALL_TABLES: readonly string\[\] = \[([\s\S]*?)\]/.exec(inventory)![1];
    expect([...derived.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]))
      .not.toContain('club_leadership');

    // ORDERING IS BINDING after players, because an appointment names its
    // player by identity.
    expect(pyFitzroy).toMatch(
      /replay_admin_overrides\(pg, "players"\)[\s\S]{0,1600}replay_admin_overrides\(pg, "club_leadership"\)/,
    );
    // And the promotion runbook's replay loop names it, or a promoted database
    // would hold no administered leadership at all.
    expect(readSource('docs/production-promotion.md'))
      .toMatch(/for table in \([^)]*'club_leadership'/);
  });

  test('AFLDB-ISSUE-163: the frozen leadership enumerations in the replay equal the migration', () => {
    // common.py cannot read the database schema and still fail closed, so it
    // carries copies. These are the assertions that stop them drifting.
    const migration = readSource('src/db/migrations/098_club_leadership.sql');

    const roleCheck = /CHECK \(role IN \(([^)]*)\)\)/.exec(migration)![1];
    const expectedRoles = [...roleCheck.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
    const roleBlock = pyCommon.slice(pyCommon.indexOf('LEADERSHIP_ROLES = ('));
    expect([...roleBlock.slice(0, roleBlock.indexOf(')')).matchAll(/"([a-z_]+)"/g)]
      .map((m) => m[1]).sort()).toEqual(expectedRoles);
    expect(expectedRoles).not.toContain('co_captain');

    const statusCheck = /CHECK \(status IN \(([^)]*)\)\)/.exec(migration)![1];
    const expectedStatuses = [...statusCheck.matchAll(/'([a-z]+)'/g)].map((m) => m[1]).sort();
    const statusBlock = pyCommon.slice(pyCommon.indexOf('LEADERSHIP_STATUSES = ('));
    expect([...statusBlock.slice(0, statusBlock.indexOf(')')).matchAll(/"([a-z_]+)"/g)]
      .map((m) => m[1]).sort()).toEqual(expectedStatuses);

    // The TypeScript writer carries the same two vocabularies.
    const writer = readSource('src/db/queries/admin-club-leadership.ts');
    const tsRoles = /LEADERSHIP_ROLES = \[([^\]]*)\]/.exec(writer)![1];
    expect([...tsRoles.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort()).toEqual(expectedRoles);
    const tsStatuses = /LEADERSHIP_STATUSES = \[([^\]]*)\]/.exec(writer)![1];
    expect([...tsStatuses.matchAll(/'([a-z]+)'/g)].map((m) => m[1]).sort())
      .toEqual(expectedStatuses);
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

/*
 * AFLDB-ISSUE-165 — the awards & honours lifecycle source contract.
 *
 * Everything here is DB-FREE: it reads migration 101, `common.py` and
 * `admin-awards.ts` as text and pins the three against each other. The claims
 * that need a real PostgreSQL — that the replay actually restores a correction
 * after a rebuild, that a missing target fails closed, that the audit row rolls
 * back with its mutation — live in `tests/integration/admin-awards.test.ts`.
 */
describe('AFLDB-ISSUE-165 source contract', () => {
  const root = process.cwd();
  const readSource = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf-8')
    .replace(/\r\n/g, '\n');
  const pyCommon = readSource('tools/migration/common.py');
  const pyAwards = readSource('tools/migration/import_awards.py');
  const migration = readSource('src/db/migrations/101_awards_honours_lifecycle.sql');
  /** The migration's STATEMENTS, for "the schema never does X" claims. */
  const migrationSql = migration.split('\n')
    .filter((line) => !line.trim().startsWith('--')).join('\n');
  const writer = readSource('src/db/queries/admin-awards.ts');
  const TABLES = ['award_winners', 'hall_of_fame', 'honour_team_members'] as const;

  /**
   * One function's source, from its declaration to the next top-level one.
   *
   * Slicing to the first `\n}` — the obvious shortcut — is wrong for any
   * function whose signature carries a multi-line inline parameter type, whose
   * closing `}` sits at column 0 and therefore ends the "body" after the
   * signature. `insertHallOfFame` is exactly that shape.
   */
  const functionBody = (source: string, name: string): string => {
    const start = source.indexOf(`async function ${name}`);
    expect(start, `no function ${name}`).toBeGreaterThan(-1);
    const rest = source.slice(start + 1);
    const ends = ['\nasync function ', '\nexport ', '\nfunction ', '\n// ===']
      .map((token) => rest.indexOf(token))
      .filter((at) => at >= 0);
    return ends.length ? rest.slice(0, Math.min(...ends)) : rest;
  };

  test('the frozen lifecycle enumeration equals the migration and the writer', () => {
    // common.py cannot read the database schema and still fail closed, so it
    // carries a copy. This is the assertion that stops the three drifting.
    const checks = [...migration.matchAll(/CHECK \(status IN \(([^)]*)\)\)/g)]
      .map((m) => [...m[1].matchAll(/'([a-z]+)'/g)].map((s) => s[1]).sort());
    // One per table, and all three identical: the lifecycle is one vocabulary.
    expect(checks).toHaveLength(TABLES.length);
    for (const check of checks) expect(check).toEqual(['active', 'void']);

    const pyBlock = pyCommon.slice(pyCommon.indexOf('HONOUR_LIFECYCLE_STATUSES = ('));
    expect([...pyBlock.slice(0, pyBlock.indexOf(')')).matchAll(/"([a-z_]+)"/g)]
      .map((m) => m[1]).sort()).toEqual(['active', 'void']);

    const tsStatuses = /HONOUR_STATUSES = \[([^\]]*)\]/.exec(writer)![1];
    expect([...tsStatuses.matchAll(/'([a-z]+)'/g)].map((m) => m[1]).sort())
      .toEqual(['active', 'void']);

    // There is deliberately NO 'ended' here: an award result, an induction or a
    // team selection does not cease the way a club_leadership appointment does.
    // Asserted on the VOCABULARIES, not on the prose: all three explain at
    // length why 'ended' is absent, and a test that could not tell an
    // explanation from a declaration would forbid writing one.
    for (const vocabulary of [
      ...checks.map((c) => c.join(',')),
      pyBlock.slice(0, pyBlock.indexOf(')')),
      tsStatuses,
    ]) {
      expect(vocabulary).not.toContain('ended');
    }
  });

  test('the three field groups agree across the migration, the replay and the writer', () => {
    const pyBlock = pyCommon.slice(pyCommon.indexOf('HONOUR_FIELD_GROUPS = ('));
    const pyGroups = [...pyBlock.slice(0, pyBlock.indexOf(')')).matchAll(/"([a-z]+)"/g)]
      .map((m) => m[1]).sort();
    expect(pyGroups).toEqual(['correction', 'lifecycle', 'record']);
    const tsGroups = /HONOUR_FIELD_GROUPS = \[([^\]]*)\]/.exec(writer)![1];
    expect([...tsGroups.matchAll(/'([a-z]+)'/g)].map((m) => m[1]).sort()).toEqual(pyGroups);
    for (const group of pyGroups) expect(migration).toContain(`'${group}'`);
  });

  test('migration 101 widens data_overrides forward and admits no settle target', () => {
    expect(migration).toMatch(
      /ADD CONSTRAINT data_overrides_entity_type_check CHECK \(entity_type IN \(\s*'players',\s*'matches',\s*'draft_picks',\s*'coaches',\s*'match_coaches',\s*'season_list_members',\s*'fixtures',\s*'club_leadership',\s*'award_winners',\s*'hall_of_fame',\s*'honour_team_members'\s*\)\)/,
    );
    const widening = migration.slice(
      migration.indexOf('ADD CONSTRAINT data_overrides_entity_type_check'),
    );
    for (const settleTarget of [
      'match_period_scores', 'player_match_stats', 'brownlow_round_votes',
    ]) {
      expect(widening.slice(0, widening.indexOf('));'))).not.toContain(settleTarget);
    }
    // 058 already admits all three data_edits names; re-stating them would be a
    // second allowlist that could disagree with the first.
    expect(migrationSql).not.toContain('data_edits_table_name_check');
  });

  test('migration 101 makes the identity keys ACTIVE-ROW-ONLY, and only those', () => {
    // Without this a replacement collides with the record of its predecessor,
    // and "void + re-enter" — the whole correction model — is unexpressible.
    expect(migration).toContain('DROP CONSTRAINT hall_of_fame_name_uq');
    expect(migration).toMatch(
      /CREATE UNIQUE INDEX hall_of_fame_active_name_uq\s*\n\s*ON hall_of_fame \(name, inducted_year\) NULLS NOT DISTINCT\s*\n\s*WHERE status <> 'void';/,
    );
    expect(migration).toMatch(
      /CREATE UNIQUE INDEX honour_team_linked_player_uq[\s\S]*?WHERE player_id IS NOT NULL AND status <> 'void';/,
    );
    expect(migration).toMatch(
      /CREATE UNIQUE INDEX honour_team_unlinked_name_uq[\s\S]*?WHERE player_id IS NULL AND status <> 'void';/,
    );
    // award_winners' key is the SOURCE RECORD, not a fact about the person, so
    // it is deliberately untouched — and (award_id, season, player_id) must
    // never become one: migration 042 proved the 1984 All-Australian carries two
    // legitimate rows per player. Asserted on the STATEMENTS, because the
    // migration explains both decisions in its commentary.
    expect(migrationSql).not.toContain('award_winners_source_uq');
    expect(migrationSql).not.toMatch(/UNIQUE[\s\S]{0,80}\(award_id, season, player_id\)/);
    // D-8: no speculative index.
    expect(migrationSql).not.toMatch(/CREATE INDEX/);
  });

  test('every replay branch fails closed, and only lifecycle warns (D-9)', () => {
    for (const table of TABLES) {
      const branch = replayBranch(pyCommon, table);
      const code = executablePython(branch);

      // Fail closed FIRST, over the whole active set, before anything is written.
      expect(branch).toContain(`replay_admin_overrides(${table}): refusing to commit`);
      expect(code.indexOf('raise RuntimeError'))
        .toBeLessThan(code.indexOf('INSERT INTO'));

      // A correction or a record override whose target is absent REFUSES.
      expect(branch).toContain("'correction' AND");
      expect(branch).toContain('correction target row does not exist');

      // A lifecycle override whose target is absent WARNS and is RETAINED.
      expect(code).toContain(`_warn_retained_lifecycle("${table}"`);
      expect(code).toMatch(/field_group = 'lifecycle' AND [a-z_.]+ IS NULL/);

      // The delta semantics are jsonb_exists, never COALESCE: an absent key
      // leaves the source value and an explicit JSON null clears it, and
      // COALESCE cannot tell those two apart (the migration-086 discipline).
      expect(code).toContain('jsonb_exists');

      // No fuzzy identity resolution anywhere, in any branch.
      expect(code).not.toMatch(/ILIKE|similarity\(|soundex|levenshtein|display_name/i);

      // The durable key is never a row id.
      expect(code).not.toMatch(/override_values->>'(row_id|id|player_id|club_id|award_id)'/);
    }
  });

  test('a correction never moves an identity-bearing column', () => {
    // R-1, asserted as "this column is never an assignment target in the
    // correction UPDATE". A correction that could rewrite who won an award is
    // the single most damaging thing this issue could ship.
    const forbidden: Record<string, string[]> = {
      award_winners: ['award_id', 'season', 'player_id', 'player_name_raw',
        'source_id', 'source_record_id'],
      hall_of_fame: ['name', 'inducted_year', 'source_id'],
      honour_team_members: ['team_name', 'player_id', 'source_id'],
    };
    for (const table of TABLES) {
      const code = executablePython(replayBranch(pyCommon, table));
      const correction = code.slice(code.indexOf("WHERE w.field_group = 'correction'") >= 0
        ? code.indexOf('UPDATE ' + table + ' x\n                   SET votes')
        : code.indexOf('UPDATE ' + table + ' x'));
      void correction;
      const updates = [...code.matchAll(
        new RegExp(`UPDATE ${table} x\\n\\s+SET [\\s\\S]*?field_group = '(\\w+)'`, 'g'),
      )];
      const correctionUpdate = updates.find((m) => m[1] === 'correction');
      expect(correctionUpdate, `${table} has no correction UPDATE`).toBeTruthy();
      for (const column of forbidden[table]) {
        expect(correctionUpdate![0]).not.toMatch(new RegExp(`\\n\\s+${column} = `));
      }
    }
  });

  test('import_awards.py replays IMMEDIATELY after every reload it owns (R-2)', () => {
    // Batched at the end of the run, the replay would target rows a later group
    // is about to overwrite. Seven award_winners groups, one Hall of Fame
    // reload, one honour-team reload — every one of them, or a corrected row
    // silently reverts on the next import.
    expect(pyAwards).toContain('replay_admin_overrides,');
    const calls = [...pyAwards.matchAll(/replay_admin_overrides\(pg, "(\w+)"\)/g)]
      .map((m) => m[1]);
    expect(calls.filter((t) => t === 'award_winners')).toHaveLength(7);
    expect(calls.filter((t) => t === 'hall_of_fame')).toHaveLength(1);
    expect(calls.filter((t) => t === 'honour_team_members')).toHaveLength(1);

    // Each call sits between its own reload and that reload's commit, so the
    // two land as one transaction — and before the next reload starts, which is
    // R-2 exactly: batched at the end, the replay would target rows a later
    // group is about to overwrite.
    const code = executablePython(pyAwards);
    for (const match of code.matchAll(/replay_admin_overrides\(pg, "\w+"\)/g)) {
      const after = code.slice(match.index! + match[0].length);
      const commit = after.indexOf('pg.commit()');
      const nextReload = after.indexOf('reload_keyed(');
      expect(commit, 'a replay call with no following commit').toBeGreaterThanOrEqual(0);
      if (nextReload >= 0) expect(commit).toBeLessThan(nextReload);
    }

    // And no broad handler swallows the refusal: main() catches exactly the two
    // named reload exceptions, neither of which the replay raises.
    expect(code).toContain('except (LinkDecisionLoss, ReloadOwnershipCollision) as loss:');
    expect(code).not.toMatch(/except Exception[\s\S]{0,200}replay_admin_overrides/);
  });

  test('D-11: every award span the importer derives counts ACTIVE rows only', () => {
    const spans = [...pyAwards.matchAll(/(?:min|max)\(season\) FROM award_winners/g)];
    expect(spans.length).toBeGreaterThan(0);
    for (const span of spans) {
      // The predicate follows within the same statement, which the source wraps
      // across two adjacent string literals.
      expect(pyAwards.slice(span.index!, span.index! + 160)).toContain("status = 'active'");
    }
    // The writer recomputes the same two values from the same predicate inside
    // its own transaction, so the two can never disagree.
    expect(functionBody(writer, 'recomputeAwardSpan')).toContain("status = 'active'");
  });

  test('D-12: the legacy ingest writer refuses to overwrite an active override', () => {
    const datasets = readSource('src/lib/ingest/datasets.ts');
    const promote = datasets.slice(
      datasets.indexOf('const allAustralian: DatasetSpec'),
      datasets.indexOf('// --- Dataset: Match results ---'),
    );
    expect(promote).toContain("o.entity_type = 'award_winners'");
    expect(promote).toContain("o.field_group IN ('lifecycle', 'correction')");
    expect(promote).toContain("o.entity_key = s.key || ':' || ${recordId}");
    // The refusal comes BEFORE the upsert, or it refuses nothing.
    expect(promote.indexOf('if (held)'))
      .toBeLessThan(promote.indexOf('INSERT INTO award_winners'));
    // And it is NOT a second replay: this writer learns no override semantics.
    // Asserted on the CODE, because the refusal's own comment explains at
    // length why a replay here would be the wrong answer.
    const promoteCode = executableTypeScript(promote);
    expect(promoteCode).not.toContain('jsonb_exists');
    expect(promoteCode).not.toContain('replay');
  });

  test('D-10: a voided row leaves the admin player-link and candidate queues', () => {
    for (const rel of [
      'src/db/queries/player-links.ts', 'src/db/queries/player-match-candidates.ts',
    ]) {
      const source = readSource(rel);
      for (const alias of ['w', 'h', 'm']) {
        expect(source, `${rel} does not exclude voided ${alias} rows`)
          .toContain(`${alias}.status <> 'void'`);
      }
    }
  });

  test('the durable keys the writer mints are the ones the replay decodes', () => {
    // entity_key shapes, asserted on BOTH sides so a change to one fails here
    // rather than silently orphaning every existing durable record.
    expect(writer).toContain('return `${sourceKey}:${sourceRecordId}`;');
    expect(writer).toContain('return `${sourceKey}:${name}|${inductedYear ?? \'\'}`;');
    expect(writer).toContain('return `${sourceKey}:${teamName}|${playerIdentity}`;');
    expect(writer).toContain("return identity ?? `name:${playerNameRaw}`;");

    const awards = executablePython(replayBranch(pyCommon, 'award_winners'));
    expect(awards).toContain("substring(o.entity_key from position(':' in o.entity_key) + 1)");
    expect(awards).toContain('w.source_record_id = d.record_id');

    // hall_of_fame splits on the LAST '|' (a year never contains one);
    // honour_team_members on the FIRST (a team name never contains one, and the
    // writer refuses one that does).
    const hof = executablePython(replayBranch(pyCommon, 'hall_of_fame'));
    expect(hof).toContain("position('|' in reverse(r.natural_key))");
    const honour = executablePython(replayBranch(pyCommon, 'honour_team_members'));
    expect(honour).toContain("left(r.natural_key, position('|' in r.natural_key) - 1)");
    expect(writer).toContain('function carriesKeySeparator');
  });

  test('a Hall of Fame name is never replaced by a linked player display name', () => {
    // Found by the first DB-backed run. `hall_of_fame.name` is IDENTITY —
    // migration 042 keys the table on (name, inducted_year) and migration 101's
    // durable key is '<source key>:<name>|<inducted_year>' — so deriving it from
    // `players.display_name`, as the legacy `awards-admin.ts` creator does,
    // files the induction under a different key from the one the administrator
    // asked for, and makes a same-name/same-year replacement impossible.
    const body = functionBody(writer, 'insertHallOfFame');
    expect(body).toContain('if (!name) name = p.displayName;');
    expect(body).not.toMatch(/\n\s+name = p\.displayName;/);
    // The name reaching the key and the row is the SUPPLIED one.
    expect(body).toContain('const entityKey = hallOfFameEntityKey(MANUAL_SOURCE_KEY, name,');

    // The other two tables deliberately keep the legacy behaviour, because on
    // them the display name is a fact beside a separate identity rather than
    // the identity itself. Asserted so the asymmetry is a decision on the
    // record and not an oversight.
    for (const fn of ['insertAwardWinner', 'insertHonourTeamMember']) {
      expect(functionBody(writer, fn), fn).toContain('playerName = p.displayName;');
    }
  });

  test('B-1: a row with no durable key is refused, never silently unreplayable', () => {
    // Measured 0 of 3,712 on afldb_test (2026-09-13), so this is defensive — but
    // a row that cannot be NAMED in data_overrides cannot have its correction or
    // void survive a rebuild, and recording one would be a decision AFLDB
    // quietly loses.
    expect(writer).toContain("'no_durable_key'");
    expect(functionBody(writer, 'lockAwardWinner')).toContain(
      'row.sourceId === null || row.sourceKey === null || !row.sourceRecordId',
    );
  });

  test('every mutation writes its audit row in the SAME transaction (ISSUE-027)', () => {
    const code = executableTypeScript(writer);
    // recordDataEdit is reachable from every write path, and never from outside
    // a transaction callback: the only connection this module opens is the
    // import-role one, and every mutation runs inside importSql.begin().
    expect([...code.matchAll(/recordDataEdit\(/g)].length).toBeGreaterThanOrEqual(6);
    expect(code).not.toContain('revalidatePath(');
    // R-7: paths are RETURNED for the caller to POST, never revalidated here.
    expect(code).toContain('revalidatePaths');
  });
});
