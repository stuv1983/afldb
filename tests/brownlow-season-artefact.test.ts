/**
 * The tracked season-grain Brownlow artefact (AFLDB-ISSUE-113 §8.6 / §8.12).
 *
 * DB-free. Proves, from the tracked bytes alone, the facts the loader relies on:
 * the artefact, its manifest and the identity adjudication file agree; no row has
 * an empty profile path; every adjudicated bootstrap id carries exactly its
 * adjudicated path (Peter Brown 1978 → Peter_Brown3.html, the operator decision of
 * 2026-09-04); the five explicit recovery-path overrides of §8.14.5 are applied to
 * exactly the named legacy players and nowhere else; NULL is preserved as empty,
 * never coerced to 0; and the measured contract (16,120 / 79,113 / 112 / 98) plus the
 * career witnesses reproduce from the artefact itself. The loader's own validator is
 * exercised through its CLI, exactly as the rebuild preflight runs it, and the
 * builder's override rule is exercised through its CLI on a synthetic export so
 * that an unadjudicated mismatched recovery path is proven to pass through
 * unchanged and be rejected by the resolver.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = process.cwd();
const loader = resolve(root, 'tools/migration/import_brownlow_season.py');
const builder = resolve(root, 'tools/migration/build_brownlow_season_artefact.py');
const artefactCsv = resolve(root, 'data/brownlow/season-votes.csv');
const manifestJson = resolve(root, 'data/brownlow/season-votes.manifest.json');
const identityCsv = resolve(root, 'data/brownlow/player-identity.csv');
const python = process.env.PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3');

type Row = Record<string, string>;

/** Minimal RFC-4180 reader: the artefact quotes only names carrying a comma or quote. */
function parseCsv(text: string): Row[] {
  const lines = text.split('\n').filter((line) => line.length > 0);
  const split = (line: string): string[] => {
    const cells: string[] = [];
    let cell = '';
    let quoted = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      if (quoted) {
        if (ch === '"' && line[i + 1] === '"') { cell += '"'; i += 1; }
        else if (ch === '"') quoted = false;
        else cell += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === ',') { cells.push(cell); cell = ''; }
      else cell += ch;
    }
    cells.push(cell);
    return cells;
  };
  const header = split(lines[0]);
  return lines.slice(1).map((line) => {
    const cells = split(line);
    expect(cells).toHaveLength(header.length);
    return Object.fromEntries(header.map((key, i) => [key, cells[i]]));
  });
}

const artefactText = readFileSync(artefactCsv, 'utf8');
const rows = parseCsv(artefactText);
const identities = parseCsv(readFileSync(identityCsv, 'utf8'));
const manifest = JSON.parse(readFileSync(manifestJson, 'utf8')) as {
  provenance_source_key: string;
  source: { database: string; read_only: boolean; dump_sha256: string };
  export_sql: string;
  artefact: Record<string, unknown> & { null_counts: Record<string, number> };
  export: { rows_without_profile_path: number; rows_with_overridden_profile_path: number };
  identity: {
    players: number; rows: number;
    gap_players: number; gap_rows: number; override_players: number; override_rows: number;
    overrides: Array<{
      bootstrap_player_id: number; display_name: string; recovery_profile_url: string;
      afltables_profile_url: string; evidence: string; rows: number; seasons: number[];
      votes: number;
    }>;
  };
};

/**
 * The five §8.14.5 adjudications, exactly as the operator stated them on 2026-09-04:
 * legacy player → the recovery-bridge path AFL Tables does not use → the canonical
 * profile path → the canonical player it resolves to (from the prod bridge witness).
 */
type Override = {
  id: string; name: string; from: string; to: string; canonical: number;
  seasons: readonly string[]; votes: number;
};
const OVERRIDES: readonly Override[] = [
  { id: '3597', name: 'Archie Roberts', from: 'players/A/Archie_Roberts0.html',
    to: 'players/A/Archie_Roberts.html', canonical: 733, seasons: ['1934'], votes: 2 },
  { id: '2425', name: 'Glen Scanlon', from: 'players/G/Glenn_Scanlon.html',
    to: 'players/G/Glen_Scanlon.html', canonical: 5164, seasons: ['1977'], votes: 1 },
  { id: '2060', name: 'Jack Patterson', from: 'players/J/Jack_Patterson.html',
    to: 'players/J/Jack_Paterson.html', canonical: 6489,
    seasons: ['1931', '1932', '1935'], votes: 12 },
  { id: '2459', name: 'Lyall Anderson', from: 'players/L/Lyle_Anderson.html',
    to: 'players/L/Lyall_Anderson.html', canonical: 8970, seasons: ['1958'], votes: 2 },
  { id: '1830', name: 'Stephen Icke', from: 'players/S/Steven_Icke.html',
    to: 'players/S/Stephen_Icke.html', canonical: 12010,
    seasons: ['1976', '1977', '1979', '1980', '1981', '1982', '1983', '1984'], votes: 60 },
];

const votesByPath = new Map<string, number>();
for (const row of rows) {
  votesByPath.set(row.afltables_profile_url,
                  (votesByPath.get(row.afltables_profile_url) ?? 0) + Number(row.votes));
}

describe('brownlow season artefact: bytes and shape', () => {
  it('is LF-terminated with the §8.6 header', () => {
    expect(artefactText.includes('\r')).toBe(false);
    expect(artefactText.split('\n')[0]).toBe(
      'season,afltables_profile_url,votes,vote_rank,eligible_rank,is_ineligible,is_winner,'
      + 'games,three_vote_games,two_vote_games,one_vote_games,polling_games,'
      + 'link_status_value,bootstrap_player_id,display_name,legacy_source_record_id');
  });

  it('reproduces the measured recovery-source contract', () => {
    expect(rows).toHaveLength(16_120);
    expect(rows.reduce((sum, r) => sum + Number(r.votes), 0)).toBe(79_113);
    expect(rows.filter((r) => r.is_winner === 't')).toHaveLength(112);
    const seasons = [...new Set(rows.map((r) => Number(r.season)))].sort((a, b) => a - b);
    expect(seasons).toHaveLength(98);
    expect(seasons[0]).toBe(1924);
    expect(seasons[seasons.length - 1]).toBe(2025);
    // 1942-1945 were not decided; 2026 is pending and must never carry a row.
    for (const war of [1942, 1943, 1944, 1945]) expect(seasons).not.toContain(war);
    expect(seasons).not.toContain(2026);
    expect(new Set(rows.map((r) => r.afltables_profile_url)).size).toBe(4_275);
  });

  it('has no empty profile path and no target player id', () => {
    expect(rows.filter((r) => r.afltables_profile_url === '')).toHaveLength(0);
    expect(rows.every((r) => /^players\/[A-Z]\/[^/]+\.html$/.test(r.afltables_profile_url)))
      .toBe(true);
    expect(Object.keys(rows[0])).not.toContain('player_id');
  });

  it('preserves NULL as empty, never as zero', () => {
    // The 3 NULL eligible_rank rows are exactly the 3 ineligible rows (§8.11).
    const nullEligible = rows.filter((r) => r.eligible_rank === '');
    expect(nullEligible).toHaveLength(3);
    expect(nullEligible.every((r) => r.is_ineligible === 't')).toBe(true);
    expect(rows.filter((r) => r.polling_games === '')).toHaveLength(4_928);
    expect(manifest.artefact.null_counts).toEqual({
      vote_rank: 0, eligible_rank: 3, games: 0,
      three_vote_games: 10_589, two_vote_games: 10_568, one_vote_games: 9_003,
      polling_games: 4_928,
    });
  });

  it('is unique and deterministically ordered on (season, profile path)', () => {
    let previous = '';
    for (const row of rows) {
      const key = `${row.season.padStart(4, '0')} ${row.afltables_profile_url}`;
      expect(key > previous, `${key} after ${previous}`).toBe(true);
      previous = key;
    }
  });

  it('carries every season with at least one winner', () => {
    const winners = new Set(rows.filter((r) => r.is_winner === 't').map((r) => r.season));
    expect(winners.size).toBe(98);
  });
});

describe('brownlow season artefact: identity adjudication (§8.12)', () => {
  it('adjudicates the 174 path-less legacy players plus the 5 explicit overrides, by evidence', () => {
    expect(identities).toHaveLength(179);
    expect(identities.filter((i) => i.recovery_profile_url === '')).toHaveLength(174);
    expect(identities.filter((i) => i.recovery_profile_url !== '')).toHaveLength(5);
    expect(manifest.identity.players).toBe(179);
    expect(manifest.identity.rows).toBe(539);
    expect(manifest.identity.gap_players).toBe(174);
    expect(manifest.identity.gap_rows).toBe(525);
    expect(manifest.identity.override_players).toBe(5);
    expect(manifest.identity.override_rows).toBe(14);
    expect(manifest.export.rows_without_profile_path).toBe(525);
    expect(manifest.export.rows_with_overridden_profile_path).toBe(14);
    const evidence = new Map<string, number>();
    for (const i of identities) evidence.set(i.evidence, (evidence.get(i.evidence) ?? 0) + 1);
    expect(Object.fromEntries(evidence)).toEqual({
      round_vote_witness: 20, unique_name_span: 153, operator: 6,
    });
  });

  it('maps Peter Brown 1978 to Peter_Brown3.html by operator decision', () => {
    const brown = identities.find((i) => i.bootstrap_player_id === '10924');
    expect(brown).toEqual({
      bootstrap_player_id: '10924', display_name: 'Peter Brown',
      afltables_profile_url: 'players/P/Peter_Brown3.html', evidence: 'operator',
      recovery_profile_url: '',
    });
    const row = rows.find((r) => r.bootstrap_player_id === '10924');
    expect(row?.season).toBe('1978');
    expect(row?.afltables_profile_url).toBe('players/P/Peter_Brown3.html');
  });

  it('settles Michael Kennedy 1989 by the round-vote witness, not by name', () => {
    expect(identities.find((i) => i.bootstrap_player_id === '1367')).toEqual({
      bootstrap_player_id: '1367', display_name: 'Michael Kennedy',
      afltables_profile_url: 'players/M/Michael_Kennedy0.html',
      evidence: 'round_vote_witness', recovery_profile_url: '',
    });
  });

  it('writes exactly the adjudicated path into every adjudicated row', () => {
    const byId = new Map(identities.map((i) => [i.bootstrap_player_id, i.afltables_profile_url]));
    let adjudicatedRows = 0;
    for (const row of rows) {
      const expected = byId.get(row.bootstrap_player_id);
      if (expected === undefined) continue;
      adjudicatedRows += 1;
      expect(row.afltables_profile_url).toBe(expected);
    }
    expect(adjudicatedRows).toBe(539);
    // No adjudicated path collides with a bridged one.
    const bridged = new Set(rows
      .filter((r) => !byId.has(r.bootstrap_player_id))
      .map((r) => r.afltables_profile_url));
    for (const url of byId.values()) expect(bridged.has(url)).toBe(false);
  });

  it('gives each bootstrap player exactly one profile path', () => {
    const paths = new Map<string, string>();
    for (const row of rows) {
      const seen = paths.get(row.bootstrap_player_id);
      if (seen !== undefined) expect(row.afltables_profile_url).toBe(seen);
      paths.set(row.bootstrap_player_id, row.afltables_profile_url);
    }
  });
});

describe('brownlow season artefact: witnesses (§8.7 V7)', () => {
  it('reproduces the operator witnesses by profile path', () => {
    // Harley Reid / Matt Rowell / Tom Green (1984+, round sums are exact) and the two
    // pre-1984 representatives the release gates resolve from data.
    expect(votesByPath.get('players/H/Harley_Reid.html')).toBe(10);
    expect(votesByPath.get('players/M/Matt_Rowell.html')).toBe(89);
    expect(votesByPath.get('players/T/Tom_Green1.html')).toBe(73);
    expect(votesByPath.get('players/D/Dick_Reynolds.html')).toBe(154);
    expect(votesByPath.get('players/B/Bob_Skilton.html')).toBe(180);
    expect(rows.filter((r) => r.afltables_profile_url === 'players/B/Bob_Skilton.html'
                              && r.is_winner === 't')).toHaveLength(3);
  });
});

describe('brownlow season artefact: manifest and loader validation', () => {
  it('records the provenance the design requires', () => {
    expect(manifest.provenance_source_key).toBe('afltables');
    expect(manifest.source.database).toBe('afldb_prod_auth_recovery');
    expect(manifest.source.read_only).toBe(true);
    expect(manifest.source.dump_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest.export_sql).toContain('FROM brownlow_season_votes b');
    expect(manifest.export_sql).not.toMatch(/insert|update|delete|truncate/i);
    expect(manifest.artefact.csv_sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('passes the loader\'s own offline validation through its CLI', () => {
    const result = spawnSync(python, [loader, '--validate-only'],
                             { cwd: root, encoding: 'utf8' });
    if (result.error) throw result.error;
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    const payload = JSON.parse(result.stdout.trim()) as Record<string, unknown>;
    expect(payload.ok).toBe(true);
    expect(payload.rows).toBe(16_120);
    expect(payload.votes_total).toBe(79_113);
    expect(payload.winners).toBe(112);
    expect(payload.seasons).toBe(98);
    expect(payload.csv_sha256).toBe(manifest.artefact.csv_sha256);
    expect(payload.identity_players).toBe(179);
    expect(payload.identity_gap_players).toBe(174);
    expect(payload.identity_override_players).toBe(5);
    expect(payload.identity_override_rows).toBe(14);
    expect(payload.source_key).toBe('afltables');
  });

  it('refuses a tampered artefact (hash mismatch) through the same CLI', () => {
    const tmp = resolve(root, 'data', 'brownlow', 'season-votes.tampered.tmp.csv');
    writeFileSync(tmp, artefactText.replace(/,f,t,/, ',f,f,'), 'utf8');
    try {
      const result = spawnSync(python, [loader, '--validate-only', '--artefact', tmp],
                               { cwd: root, encoding: 'utf8' });
      expect(result.status).toBe(1);
      const payload = JSON.parse(result.stdout.trim()) as Record<string, unknown>;
      expect(payload.ok).toBe(false);
      expect(String(payload.error)).toMatch(/csv_sha256|winner|does not match/);
    } finally {
      rmSync(tmp, { force: true });
    }
  });
});

describe('brownlow season artefact: explicit recovery-path overrides (§8.14.5)', () => {
  const byId = new Map(identities.map((i) => [i.bootstrap_player_id, i]));

  it.each(OVERRIDES)('adjudicates $name ($id): $from → $to', (o) => {
    // The adjudication row: explicit, operator evidence, naming the exact path it replaces.
    expect(byId.get(o.id)).toEqual({
      bootstrap_player_id: o.id, display_name: o.name, afltables_profile_url: o.to,
      evidence: 'operator', recovery_profile_url: o.from,
    });
    // The artefact: exactly that legacy player's rows carry the canonical path, and
    // the recovery-bridge spelling survives nowhere.
    const mine = rows.filter((r) => r.bootstrap_player_id === o.id);
    expect(mine.map((r) => r.season)).toEqual([...o.seasons]);
    expect(mine.every((r) => r.afltables_profile_url === o.to)).toBe(true);
    expect(mine.reduce((sum, r) => sum + Number(r.votes), 0)).toBe(o.votes);
    expect(rows.filter((r) => r.afltables_profile_url === o.to)).toHaveLength(mine.length);
    expect(rows.filter((r) => r.afltables_profile_url === o.from)).toHaveLength(0);
    // The manifest preserves the original recovery path as provenance.
    expect(manifest.identity.overrides.find((e) => e.bootstrap_player_id === Number(o.id)))
      .toEqual({
        bootstrap_player_id: Number(o.id), display_name: o.name,
        recovery_profile_url: o.from, afltables_profile_url: o.to, evidence: 'operator',
        rows: o.seasons.length, seasons: o.seasons.map(Number), votes: o.votes,
      });
  });

  it('lists exactly the five overrides, 14 rows, 77 votes, and no winner rows', () => {
    expect(manifest.identity.overrides.map((e) => e.bootstrap_player_id))
      .toEqual([1830, 2060, 2425, 2459, 3597]);
    expect(manifest.identity.overrides.reduce((sum, e) => sum + e.rows, 0)).toBe(14);
    expect(manifest.identity.overrides.reduce((sum, e) => sum + e.votes, 0)).toBe(77);
    const ids = new Set(OVERRIDES.map((o) => o.id));
    expect(rows.filter((r) => ids.has(r.bootstrap_player_id) && r.is_winner === 't'))
      .toHaveLength(0);
  });
});

/**
 * Builder-level regression: drive tools/migration/build_brownlow_season_artefact.py on
 * a synthetic export reconstructed from the tracked artefact (the affected rows with
 * their recovery-bridge paths restored, plus each season's winner so the built
 * artefact passes its own validation). No database, no name matching.
 */
describe('brownlow season builder: override rule (§8.14.5)', () => {
  const overrideIds = new Set<string>(OVERRIDES.map((o) => o.id));
  const seasons = new Set<string>(OVERRIDES.flatMap((o) => [...o.seasons]));
  const header = artefactText.split('\n')[0];

  const csvLine = (r: Row): string => header.split(',').map((key) => {
    const v = r[key];
    return /[",]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  }).join(',');

  /** The synthetic export: winners of the affected seasons plus the five players' rows. */
  function syntheticExport(recoveryPathFor: (id: string, canonical: string) => string): string {
    const picked = rows
      .filter((r) => seasons.has(r.season) && (r.is_winner === 't' || overrideIds.has(r.bootstrap_player_id)))
      .map((r) => ({ ...r, afltables_profile_url: overrideIds.has(r.bootstrap_player_id)
        ? recoveryPathFor(r.bootstrap_player_id, r.afltables_profile_url)
        : r.afltables_profile_url }));
    return `${header}\n${picked.map(csvLine).join('\n')}\n`;
  }

  const identityHeader = 'bootstrap_player_id,display_name,afltables_profile_url,evidence,recovery_profile_url';
  const identityLine = (o: typeof OVERRIDES[number], from = o.from): string =>
    `${o.id},${o.name},${o.to},operator,${from}`;
  // The adjudication file is strictly ascending on bootstrap id (the parser enforces it).
  const identityFile = (lines: string[]): string => `${identityHeader}\n${[...lines]
    .sort((a, b) => Number(a.split(',')[0]) - Number(b.split(',')[0])).join('\n')}\n`;

  function runBuilder(exportText: string, identityText: string) {
    const dir = mkdtempSync(join(tmpdir(), 'afldb-brownlow-builder-'));
    const exportPath = join(dir, 'export.csv');
    const identityPath = join(dir, 'identity.csv');
    const artefactPath = join(dir, 'season-votes.csv');
    const manifestPath = join(dir, 'season-votes.manifest.json');
    writeFileSync(exportPath, exportText, 'utf8');
    writeFileSync(identityPath, identityText, 'utf8');
    const sha = createHash('sha256').update(exportText, 'utf8').digest('hex');
    const result = spawnSync(python, [
      builder, '--export', exportPath, '--export-sha256', sha,
      '--identity', identityPath, '--artefact', artefactPath, '--manifest', manifestPath,
      '--source-host', 'test', '--source-database', 'synthetic', '--source-role', 'test',
      '--postgres-version', 'n/a', '--extracted-at-utc', '2026-09-04T00:00:00Z',
      '--dump-file', 'n/a', '--dump-sha256', 'n/a',
    ], { cwd: root, encoding: 'utf8' });
    if (result.error) throw result.error;
    const built = result.status === 0 ? parseCsv(readFileSync(artefactPath, 'utf8')) : [];
    const builtManifest = result.status === 0
      ? JSON.parse(readFileSync(manifestPath, 'utf8')) as typeof manifest
      : null;
    rmSync(dir, { recursive: true, force: true });
    return { status: result.status, stderr: result.stderr, built, manifest: builtManifest };
  }

  it('applies all five adjudications when the row names the exact recovery path', () => {
    const run = runBuilder(syntheticExport((id) => OVERRIDES.find((o) => o.id === id)!.from),
                           identityFile(OVERRIDES.map((o) => identityLine(o))));
    expect(run.stderr).toBe('');
    expect(run.status).toBe(0);
    for (const o of OVERRIDES) {
      const mine = run.built.filter((r) => r.bootstrap_player_id === o.id);
      expect(mine.map((r) => r.season)).toEqual([...o.seasons]);
      expect(mine.every((r) => r.afltables_profile_url === o.to)).toBe(true);
      expect(run.built.some((r) => r.afltables_profile_url === o.from)).toBe(false);
    }
    expect(run.manifest?.export.rows_with_overridden_profile_path).toBe(14);
    expect(run.manifest?.identity.overrides.map((e) => e.recovery_profile_url).sort())
      .toEqual(OVERRIDES.map((o) => o.from).sort());
    // Everything not overridden is carried byte-for-byte.
    const winners = run.built.filter((r) => r.is_winner === 't');
    expect(winners).toEqual(rows.filter((r) => seasons.has(r.season) && r.is_winner === 't'));
  });

  it('carries an unadjudicated mismatched recovery path through unchanged (no correction)', () => {
    // Drop the Archie Roberts row: with no adjudication the recovery bridge stays
    // authoritative, so Archie_Roberts0.html reaches the loader verbatim.
    const without = OVERRIDES.filter((o) => o.id !== '3597');
    const run = runBuilder(syntheticExport((id) => OVERRIDES.find((o) => o.id === id)!.from),
                           identityFile(without.map((o) => identityLine(o))));
    expect(run.stderr).toBe('');
    expect(run.status).toBe(0);
    const roberts = run.built.filter((r) => r.bootstrap_player_id === '3597');
    expect(roberts.map((r) => r.afltables_profile_url)).toEqual(['players/A/Archie_Roberts0.html']);
    expect(run.built.some((r) => r.afltables_profile_url === 'players/A/Archie_Roberts.html'))
      .toBe(false);
    expect(run.manifest?.export.rows_with_overridden_profile_path).toBe(13);
  });

  it('fails hard when an override names a recovery path the export does not carry', () => {
    // The adjudication is for bootstrap 3597 but claims a different original path:
    // it does not describe this export, so nothing is overridden and the build stops.
    const roberts = OVERRIDES.find((o) => o.id === '3597')!;
    const lines = OVERRIDES.map((o) => o.id === '3597'
      ? identityLine(o, 'players/A/Archie_Roberts9.html')
      : identityLine(o));
    const run = runBuilder(syntheticExport((id) => OVERRIDES.find((o) => o.id === id)!.from),
                           identityFile(lines));
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('override for bootstrap_player_id 3597');
    expect(run.stderr).toContain(roberts.from);
    expect(run.stderr).toContain('refusing to override');
  });

  it('fails hard when an override names a legacy player the export lacks', () => {
    const lines = [...OVERRIDES.map((o) => identityLine(o)),
                   '999999,Nobody,players/N/Nobody.html,operator,players/N/Nobody0.html'];
    const run = runBuilder(syntheticExport((id) => OVERRIDES.find((o) => o.id === id)!.from),
                           identityFile(lines));
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('override for bootstrap_player_id 999999');
    expect(run.stderr).toContain('no rows for this legacy player');
  });

  it('refuses a gap-fill row (no recovery path) for a player the export already bridges', () => {
    // An adjudication without an explicit recovery path never overrides a bridged path.
    const lines = OVERRIDES.map((o) => o.id === '3597' ? identityLine(o, '') : identityLine(o));
    const run = runBuilder(syntheticExport((id) => OVERRIDES.find((o) => o.id === id)!.from),
                           identityFile(lines));
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('does not cover exactly the export');
    expect(run.stderr).toContain('surplus [3597]');
  });
});

/**
 * Loader-level negative: the resolver the load phase uses is fail-closed on a
 * profile path no canonical player carries. Built here from an in-memory bridge
 * (the five canonical players of §8.14.5) so the rule is proven without a database:
 * every original recovery path is rejected, every adjudicated path resolves to
 * exactly the intended canonical player.
 */
describe('brownlow season loader: unadjudicated recovery paths are rejected', () => {
  it('rejects each original recovery path and resolves each adjudicated path', () => {
    const script = [
      'import json, sys',
      `sys.path.insert(0, ${JSON.stringify(resolve(root, 'tools/migration'))})`,
      'from import_brownlow_season import ProfileResolver',
      'bridge = json.loads(sys.argv[1]); probes = json.loads(sys.argv[2])',
      'r = ProfileResolver.from_pairs([(u, i) for u, i in bridge])',
      'print(json.dumps({u: list(r.resolve(u)) for u in probes}))',
    ].join('\n');
    const bridge = OVERRIDES.map((o) => [o.to, o.canonical]);
    const probes = OVERRIDES.flatMap((o) => [o.from, o.to]);
    const result = spawnSync(python, ['-c', script, JSON.stringify(bridge), JSON.stringify(probes)],
                             { cwd: root, encoding: 'utf8' });
    if (result.error) throw result.error;
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    const resolved = JSON.parse(result.stdout.trim()) as Record<string, [number | null, string | null]>;
    for (const o of OVERRIDES) {
      expect(resolved[o.from]).toEqual([null, 'no canonical player carries this AFL Tables profile path']);
      expect(resolved[o.to]).toEqual([o.canonical, null]);
    }
  });
});
