import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/*
 * AFLDB-ISSUE-093 Stage B2-4/5 — the supported DraftGuru importer.
 *
 * Static contract pins of tools/rebuild/draftguru/import_draftguru.py plus spawn
 * tests of its --validate-only path, which performs the whole of Phase A and needs
 * no database driver. No network, no database, no legacy SQLite.
 *
 * Separate from tests/draftguru-acquisition.test.ts for the same reason
 * tests/fitzroy-core-import.test.ts is separate from tests/fitzroy-acquisition.test.ts:
 * acquisition and import are different subsystems with different contracts.
 */

const root = process.cwd();
const importerPath = join(root, "tools", "rebuild", "draftguru", "import_draftguru.py");
// Normalised to LF once, so every slice/index/regex pin below sees one representation
// regardless of the checkout's autocrlf setting (Windows worktrees read back CRLF).
const importerSource = readFileSync(importerPath, "utf8").replace(/\r\n/g, "\n");

/*
 * The module docstring documents the boundaries this importer respects, so it
 * necessarily NAMES the things the importer must not do ("zero AFLDB_LEGACY_SQLITE
 * dependency", "never opens a network socket"). Absence assertions therefore run
 * against the source with that docstring removed: the contract is that the CODE
 * does not do these things, not that the documentation never mentions them.
 */
const importerCode = importerSource.slice(
  importerSource.indexOf('"""', importerSource.indexOf('"""') + 3) + 3,
);

const venvPython = process.platform === "win32"
  ? join(root, ".venv", "Scripts", "python.exe")
  : join(root, ".venv", "bin", "python");
const python = process.env.AFLDB_PYTHON
  ?? (existsSync(venvPython) ? venvPython : (process.platform === "win32" ? "python" : "python3"));

function hasPython(): boolean {
  return spawnSync(python, ["--version"], { encoding: "utf8" }).status === 0;
}

/** The accepted Stage A snapshot is gitignored, so snapshot-dependent runs skip without it. */
function hasSnapshot(): boolean {
  return existsSync(join(root, "data", "sources", "draftguru", "annual-html-20260826",
    "raw", "years"));
}

const itPy = hasPython() && hasSnapshot() ? it : it.skip;

/** The scripted-connection contracts import tools/migration/common.py, which imports psycopg. */
function hasPsycopg(): boolean {
  return spawnSync(python, ["-c", "import psycopg"], { encoding: "utf8" }).status === 0;
}

const itPyDriver = hasPython() && hasPsycopg() ? it : it.skip;

function runImporter(args: string[]) {
  return spawnSync(python, [importerPath, ...args], { encoding: "utf8", cwd: root });
}

function withTempBridge(doc: unknown, body: (path: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "afldb-bridge-"));
  try {
    const path = join(dir, "bridge.json");
    writeFileSync(path, JSON.stringify(doc), "utf8");
    body(path);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("DraftGuru importer — legacy independence", () => {
  it("has zero AFLDB_LEGACY_SQLITE dependency", () => {
    expect(importerCode).not.toMatch(/AFLDB_LEGACY_SQLITE/);
    expect(importerCode).not.toMatch(/connect_legacy/);
    expect(importerCode).not.toMatch(/\bimport\s+sqlite3\b/);
    expect(importerCode).not.toMatch(/\bsqlite3\./);
  });

  it("never reads the frozen browser-export CSV parity oracle", () => {
    expect(importerCode).not.toMatch(/full-history/);
    expect(importerCode).not.toMatch(/\.csv\b/);
    expect(importerCode).not.toMatch(/load_parity_csv|run_parity/);
  });

  it("never consumes Stage B1 profiling output as a bridge source", () => {
    expect(importerCode).not.toMatch(/person_profile/);
    expect(importerCode).not.toMatch(/person-html/);
    expect(importerCode).not.toMatch(/afltables_link_profile/);
    // and the boundary is stated in the code, so a later refactor cannot lose it silently
    expect(importerCode).toContain("Stage B1's profiling snapshot is");
    expect(importerCode).toContain("NOT this file and is never read by this module");
  });

  it("opens no network socket", () => {
    for (const forbidden of [/\brequests\b/, /\burllib\.request\b/, /\bhttpx\b/,
                             /\bsocket\b/, /\burlopen\b/]) {
      expect(importerCode).not.toMatch(forbidden);
    }
  });
});

/*
 * AFLDB-ISSUE-093 Stage B2-7 — retirement of tools/migration/import_draft.py.
 *
 * The narrow claim these pin is: the SUPPORTED DraftGuru rebuild no longer depends on
 * the legacy importer or on AFLDB_LEGACY_SQLITE. They deliberately do NOT assert that
 * the repository is free of AFLDB_LEGACY_SQLITE — import_legacy_afl.py, import_awards.py,
 * enrich_birth_dates.py and validate_migration.py still use it legitimately.
 */
describe("legacy draft importer retirement", () => {
  const legacyPath = join(root, "tools", "migration", "import_draft.py");
  const legacySource = readFileSync(legacyPath, "utf8");
  // As for the importer above: the tombstone's docstring must NAME what it no longer
  // does, so absence assertions run against the source with that docstring removed.
  const legacyCode = legacySource.slice(
    legacySource.indexOf('"""', legacySource.indexOf('"""') + 3) + 3,
  );

  it("is a tombstone that cannot import anything", () => {
    expect(legacySource).toContain("RETIRED");
    // The message may NAME AFLDB_LEGACY_SQLITE to say it is not used, so — as
    // tests/reference-data.test.ts:191-195 already does — the assertion is on the USE
    // forms, not the mention.
    expect(legacyCode).not.toMatch(/connect_legacy/);
    expect(legacyCode).not.toMatch(/require_env\s*\(\s*["']AFLDB_LEGACY_SQLITE["']/);
    expect(legacyCode).not.toMatch(/(environ|getenv)\s*[[(][^)\]]*AFLDB_LEGACY_SQLITE/);
    expect(legacyCode).not.toMatch(/\bimport\s+sqlite3\b|\bsqlite3\./);
    expect(legacyCode).not.toMatch(/connect_pg|reload_keyed|import_batch|psycopg/);
    expect(legacyCode).not.toMatch(/subprocess|exec\(|runpy/);
    expect(legacySource).toContain("Nothing was read and nothing was written");
  });

  it("exits non-zero and names the supported replacement", () => {
    expect(legacySource).toMatch(/return 2\b/);
    expect(legacySource).toContain("tools/rebuild/draftguru/import_draftguru.py");
    // it must not silently stand in for the replacement: the contracts differ
    expect(legacySource).toContain("it will not run the replacement for you");
  });

  it("keeps the legacy implementation out of the tombstone", () => {
    // the whole point of a tombstone is that the old behaviour is gone, not hidden
    expect(legacyCode).not.toMatch(/DRAFT_QUERY|PICK_COLUMNS|replay_decisions/);
    expect(legacySource.length).toBeLessThan(6000);
  });

  itPy("actually fails when invoked", () => {
    const run = spawnSync(python, [legacyPath], { encoding: "utf8", cwd: root });
    expect(run.status).not.toBe(0);
    expect(run.stdout + run.stderr).toContain("RETIRED");
    expect(run.stdout + run.stderr).toContain("import_draftguru.py");
  });

  it("is not named as a runnable step by supported operator documentation", () => {
    for (const doc of ["deployment.md", "production-cutover.md"]) {
      const text = readFileSync(join(root, "docs", doc), "utf8");
      expect(text, `${doc} still runs the retired importer`)
        .not.toMatch(/python\s+tools\/migration\/import_draft\.py/);
      expect(text).toContain("tools/rebuild/draftguru/import_draftguru.py");
    }
  });

  it("leaves the canonical supported importer in place", () => {
    expect(existsSync(join(root, "tools", "rebuild", "draftguru", "import_draftguru.py")))
      .toBe(true);
  });

  it("has no active DraftGuru test spawning the legacy importer", () => {
    for (const suite of ["tests/draftguru-import.test.ts",
                         "tests/draftguru-acquisition.test.ts",
                         "tests/integration/draftguru-import.test.ts"]) {
      const text = readFileSync(join(root, suite), "utf8");
      expect(text, `${suite} spawns the retired importer`)
        .not.toMatch(/['"]tools\/migration\/import_draft\.py['"]/);
    }
    // and the legacy-only suite it replaced is gone
    expect(existsSync(join(root, "tests", "integration", "draft-reload-links.test.ts")))
      .toBe(false);
  });
});

describe("DraftGuru importer — privileges and transaction", () => {
  it("connects as afldb_import, never as owner", () => {
    expect(importerSource).toContain("AFLDB_IMPORT_DATABASE_URL");
    expect(importerSource).not.toMatch(/AFLDB_OWNER_DATABASE_URL/);
  });

  it("runs inside one tracked import batch and reuses the shared reload helper", () => {
    expect(importerSource).toContain("import_batch(pg, SOURCE_KEY");
    expect(importerSource).toContain("reload_keyed(");
    expect(importerSource).toContain("check_population_drop");
  });

  it("keeps migration 069's reload keys", () => {
    expect(importerSource).toContain('PERSON_KEY = ("source_id", "player_url")');
    expect(importerSource).toContain(
      'PICK_KEY = ("source_id", "player_url", "draft_year", "draft_kind")');
    // dg_person_id is a per-load rank, so its unique constraint must be deferred
    expect(importerSource).toContain("SET CONSTRAINTS draft_persons_source_id_dg_person_id_key");
  });

  it("scopes every reload to DraftGuru ownership", () => {
    const scoped = importerSource.match(/scope_column="source_id", scope_values=\[source_id\]/g);
    expect(scoped?.length).toBe(2);              // draft_persons and draft_picks
    // persons are upserted only; childless ones are removed after their picks (NO ACTION FK)
    expect(importerSource).toContain("delete_missing=False");
    expect(importerSource).toMatch(/DELETE FROM draft_persons p[\s\S]{0,200}NOT EXISTS/);
  });

  it("does not present the out-of-scope-key check as active protection", () => {
    // It is retained for a future key change but cannot fire while source_id is part of
    // the reload key. Asserting only its presence would lock in a false sense of safety,
    // so the code must carry the reason and name where the real guarantee is proven.
    expect(importerSource).toContain("refuse_out_of_scope_key=True");
    expect(importerSource).toContain("UNREACHABLE under migration 069's key");
    expect(importerSource).toContain("PARTIAL on");
    expect(importerSource).toContain("'ownership boundary'");
  });

  it("commits the data and the completed batch status together: ANALYZE runs after the batch block", () => {
    // AFLDB-ISSUE-222 pre-import review: analyze() commits whatever transaction is open before
    // it toggles autocommit, so calling it INSIDE the import_batch block split the data commit
    // from batch.finish("completed"). The call must sit after the block, at function level.
    const block = importerSource.slice(
      importerSource.indexOf("with import_batch(pg, SOURCE_KEY"),
      importerSource.indexOf("    analyze(pg, \"draft_persons\""));
    expect(block).not.toContain("analyze(pg");
    expect(importerSource).toMatch(/\n    analyze\(pg, "draft_persons", "draft_picks", "external_identities"\)\n\n    return 0/);
    expect(importerSource).toContain("Deliberately OUTSIDE the batch block");
  });

  it("describes --dry-run exactly: data rolled back, failed audit row retained", () => {
    expect(importerSource).toContain("DRY_RUN_MESSAGE = (");
    expect(importerSource).toContain('print("\\n" + DRY_RUN_MESSAGE)');
    expect(importerCode).not.toContain("nothing was written");
    expect(importerSource).toContain("is retained with status 'failed' and error 'DryRunComplete: '");
  });

  // AFLDB-ISSUE-222 -- the transaction order proven against a scripted connection
  // (tests/python/draftguru_import_atomicity_contract.py): one commit before the first data
  // statement, none between it and the 'completed' batch row, rollback-then-failed-row on an
  // injected error and on --dry-run, refusal before any write on a bridge/human contradiction,
  // and DraftGuru-scoped writes only. No snapshot, no database, no network.
  itPyDriver("rolls back on failure and commits data + status once (scripted connection)", () => {
    const result = spawnSync(python,
      ["tests/python/draftguru_import_atomicity_contract.py"],
      { cwd: root, encoding: "utf8" });
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("All DraftGuru importer atomicity checks hold.");
    expect(result.stdout).not.toContain("FAIL ");
  });
});

/*
 * AFLDB-ISSUE-222 Phase 4b — --link-only.
 *
 * Applies the reviewed trusted linkage to an already-loaded DraftGuru population and rewrites
 * no source-owned Stage A fact, for a target (afldb_dev) whose accepted snapshot
 * `annual-html-20260902` no longer exists in raw form anywhere and cannot be re-acquired.
 *
 * tests/python/draftguru_link_only_contract.py is the behavioural proof, against the real
 * modules and the scripted connection. The pins below are the static half: they fail if the
 * write set widens, if a Stage A entry point reappears on the link-only path, or if the full
 * reload acquires a link-only branch.
 */
describe("DraftGuru importer — --link-only", () => {
  itPyDriver("write set, no-Stage-A, child partition, preconditions, authority, CLI, atomicity "
    + "and the gate's link-only plan/verify all hold on the real tools", () => {
    const result = spawnSync(python,
      ["tests/python/draftguru_link_only_contract.py"],
      { cwd: root, encoding: "utf8" });
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("All DraftGuru link-only checks hold.");
    expect(result.stdout).not.toContain("FAIL ");
  });

  it("declares a write set of exactly the link columns, per table", () => {
    expect(importerSource).toContain(
      'PERSON_LINK_COLUMNS = ("player_id", "link_status", "match_method", "confidence_notes",\n'
      + '                       "is_matching_backlog")');
    expect(importerSource).toContain(
      'PICK_LINK_COLUMNS = ("player_id", "link_status_value", "match_method", "confidence_notes")');
    expect(importerSource).toContain(
      'IDENTITY_LINK_COLUMNS = ("player_id", "status", "match_method")');
  });

  it("never names a source-owned column in a link-only SET clause", () => {
    const statements = ["PERSON_LINK_UPDATE_SQL", "PICK_LINK_UPDATE_SQL", "IDENTITY_LINK_UPDATE_SQL"]
      .map((name) => {
        const marker = `${name} = """`;
        const start = importerSource.indexOf(marker);
        expect(start, name).toBeGreaterThan(-1);
        const open = start + marker.length;                 // just past the opening quotes
        return importerSource.slice(open, importerSource.indexOf('"""', open));
      });
    for (const sql of statements) {
      const setClause = sql.slice(sql.indexOf("\n   SET "), sql.indexOf("\n  FROM "));
      for (const column of ["dg_person_id", "display_name_raw", "name_key", "reported_games",
        "reported_goals", "import_batch_id", "source_record_id", "detail", "notes",
        "external_name", "external_url", "candidate_count"]) {
        // anchored on a word boundary: `confidence_notes = …` is a permitted link column and
        // must not be read as an assignment to `notes`
        expect(setClause, `${column} must not be assignable`)
          .not.toMatch(new RegExp(`(^|[\\s,])${column}\\s*=`, "m"));
      }
      // scoped, keyed, and a no-op when the link state already agrees
      expect(sql).toContain("t.source_id = %s");
      expect(sql).toContain("IS DISTINCT FROM");
      expect(sql.trimStart().startsWith("UPDATE ")).toBe(true);
    }
  });

  it("reads no Stage A snapshot on the link-only path", () => {
    const start = importerSource.indexOf("def validate_link_only(");
    const end = importerSource.indexOf("STORED_PERSON_SQL = ");
    expect(start).toBeGreaterThan(-1);
    // The docstring deliberately NAMES the functions it does not call, exactly as the module
    // docstring names the boundaries the importer respects, so the absence assertion is about
    // CALLS — `name(` — not about the prose. The AST proof in
    // tests/python/draftguru_link_only_contract.py §2 is the rigorous form of this.
    const body = importerSource.slice(start, end);
    for (const fn of ["verify_stage_a_manifest", "verify_raw_bytes", "resolve_snapshot_dir",
      "parse_snapshot", "validate_identity", "build_persons", "build_picks"]) {
      expect(body, `${fn}() must not be called in link-only`).not.toContain(`${fn}(`);
    }
    expect(importerSource).toContain("--link-only refuses --snapshot-root");
  });

  it("is fail-closed on the CLI and keeps the full reload's defaults", () => {
    expect(importerSource).toContain("--link-only requires --bridge");
    expect(importerSource).toContain("--link-only requires --no-seed");
    expect(importerSource).toContain("--link-only requires an explicit --label");
    expect(importerSource).toContain("--link-only refuses --acknowledge-population-drop");
    // the effective default label is unchanged; only its explicitness is now observable
    expect(importerSource).toContain('STAGE_A_LABEL = "annual-html-20260826"');
    expect(importerSource).toContain("args.label_explicit = args.label is not None");
    expect(importerSource).toContain("        args.label = STAGE_A_LABEL");
  });

  it("writes an audit row that names the mode and the asserted label", () => {
    expect(importerSource).toContain('f"mode={LINK_ONLY_MODE} {IDENTITY_NOTES_PREFIX}{label} "');
    expect(importerSource).toContain('notes=batch_notes(prepared, args.label)');
  });

  it("keeps the full reload free of any link-only branch", () => {
    // run_import() is the last function before main(); link-only lives in its own
    // run_link_only_import() above the entry point, so the full reload cannot drift.
    const start = importerSource.indexOf("def run_import(");
    const end = importerSource.indexOf("def main(");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(importerSource.slice(start, end)).not.toContain("link_only");
    expect(importerSource).toContain("def run_link_only_import(");
    // main() dispatches to a separate entry point rather than threading a flag through
    expect(importerSource).toContain("    if args.link_only:\n        return main_link_only(args)");
  });
});

describe("DraftGuru importer — frozen derivations", () => {
  it("uses the frozen B2-1 name_key rule, not afldb_normalise_name", () => {
    expect(importerSource).toContain("def draftguru_name_key");
    // the frozen rule: fold NBSP, collapse, trim, lowercase — and nothing else
    expect(importerSource).toContain('re.sub(r"\\s+", " ", folded).strip().lower()');
    // name_key is derived in Python and is NEVER assigned from the SQL normaliser, which
    // rewrites apostrophes, hyphens and accents and reproduced only 4,926 of 5,057 values
    expect(importerSource).toContain('"name_key": draftguru_name_key(display)');
    expect(importerCode).not.toMatch(/name_key[^\n]*afldb_normalise_name/);
    // afldb_normalise_name is confined to a seeded player's search_name/slug
    expect(importerSource).toContain("search_name = afldb_normalise_name(display_name)");
  });

  it("applies the frozen signing rule and never imports signing_detail", () => {
    expect(importerSource).toMatch(/re\.sub\(r"\\s\*\\\(\.\*\$", "", signing_raw\)/);
    expect(importerSource).toContain("signing_detail — class D, not imported");
    // absence is never coerced into a kind
    expect(importerSource).toMatch(/if signing_raw is None:\s*\n\s*return None/);
  });

  it("never promotes weight_kg or parity-only grade", () => {
    expect(importerSource).toContain("weight_kg — no source, not imported");
    expect(importerSource).toContain("grade — parity-only, not promoted");
  });

  it("derives competition from the tracked league eras", () => {
    expect(importerSource).toContain("def build_competition_resolver");
    expect(importerSource).toContain("league_eras");
    expect(importerSource).toContain("seasons.json");
  });
});

describe("DraftGuru importer — fail-closed vocabulary", () => {
  it("halts on an unknown event label rather than inventing a category", () => {
    expect(importerSource).toMatch(/unknown event_type_raw/);
    expect(importerSource).toContain("fails closed rather than inventing");
    expect(importerSource).toContain('on_unknown_event_type_raw"] != "HALT"');
  });

  it("halts on an unknown club slug and never resolves one by alias or year", () => {
    expect(importerSource).toContain("is neither an ");
    expect(importerSource).toContain("exact clubs.slug nor a reviewed exception");
    expect(importerSource).toContain("alias, name, similarity or year");
    expect(importerSource).toContain('on_unknown_club_slug"] != "HALT"');
  });

  it("halts on a signing head outside the closed vocabulary", () => {
    expect(importerSource).toContain("the closed vocabulary");
    expect(importerSource).toContain("if kind is not None and kind not in signing_vocab:");
  });

  it("uses no name, game count or ordinal collapse as identity", () => {
    // identity is resolved through external_identities and the ledger only
    expect(importerSource).not.toMatch(/search_name\s*=\s*afldb_normalise_name\(%s\)/);
    expect(importerSource).not.toMatch(/WHERE\s+p\.display_name/i);
    expect(importerSource).toContain("never identity evidence");
    expect(importerSource).toContain("Names, game counts, birth years, fuzzy matching");
  });
});

describe("DraftGuru importer — explicit decisions and seeding", () => {
  it("enforces the ledger's frozen vocabulary", () => {
    expect(importerSource).toContain('unknown ledger decision');
    expect(importerSource).toContain('unknown ledger target source');
    expect(importerSource).toContain("a draftguru target's external_id differs from its decision key");
    expect(importerSource).toContain("two ledger decisions claim one AFL Tables identity");
  });

  it("halts when an afltables target does not resolve uniquely", () => {
    expect(importerSource).toMatch(/resolves to \{len\(candidates\)\}\s*"\s*\n\s*"canonical players/);
    expect(importerSource).toContain("Refusing to create a replacement player from DraftGuru data");
  });

  it("represents confirmed_unlinked with no canonical player", () => {
    expect(importerSource).toMatch(/if entry\["decision"\] == "confirmed_unlinked":[\s\S]{0,220}player_id"\] = None/);
    expect(importerSource).toContain('UNLINKED_DEFAULT = "unmatched"');
  });

  it("seeds only the approved minimal shell", () => {
    expect(importerSource).toContain("def seed_player");
    // nothing private or derived is seeded
    for (const forbidden of ["dob", "birth_year", "weight_kg", "notes", "height_cm",
                             "player_career_stats"]) {
      expect(importerSource).not.toMatch(
        new RegExp(`INSERT INTO players[\\s\\S]{0,400}${forbidden}`));
    }
    expect(importerSource).toContain("NOT a universal name parser");
    // a rerun reuses the registered DraftGuru identity instead of minting again
    expect(importerSource).toMatch(/existing = dg_identities\.get\(url\)[\s\S]{0,140}player_id = existing/);
  });
});

describe("DraftGuru importer — bridge interface", () => {
  it("treats the bridge as optional and separately supplied", () => {
    expect(importerSource).toContain("--bridge");
    expect(importerSource).toMatch(/if path is None:\s*\n\s*return \{\}/);
  });

  it("cannot let automatic bridge evidence override a human decision", () => {
    expect(importerSource).toContain(
      "an admissible bridge contradicts an explicit human decision");
    expect(importerSource).toContain("never overrides human authority");
    // the audit trail is the failed import_batches row, not a data_issues row that the
    // rollback would take with it
    expect(importerSource).toContain("The audit trail is the failed import_batches row");
    expect(importerSource).not.toContain("INSERT INTO data_issues");
    // a bridged link is 'unique'; 'resolved' stays reserved for human decisions
    expect(importerSource).toContain(`"unique"              # 'resolved' stays reserved`);
  });

  it("refuses ambiguous or double-claimed bridges", () => {
    expect(importerSource).toContain("binds one DraftGuru person to multiple AFL Tables");
    expect(importerSource).toContain("binds one AFL Tables identity to multiple DraftGuru");
    expect(importerSource).toContain("a finding, never an instruction to merge");
  });
});

describe("DraftGuru importer — Phase A against the accepted snapshot", () => {
  itPy("validates the whole input set without a database", () => {
    const run = runImporter(["--validate-only"]);
    expect(run.status).toBe(0);
    expect(run.stdout).toContain("42 year pages, sha256 verified");
    expect(run.stdout).toContain("persons    : 5057");
    expect(run.stdout).toContain("picks      : 6810");
    expect(run.stdout).toContain("ledger     : 6 explicit decisions");
    expect(run.stdout).toContain("No database was contacted");
  });

  itPy("accepts a well-formed synthetic bridge dataset", () => {
    withTempBridge({
      schema_version: 1,
      bridges: [{
        player_url: "https://www.draftguru.com.au/players/nathan_fyfe/1",
        afltables_external_id: "players/N/Nat_Fyfe.html",
      }],
    }, (path) => {
      const run = runImporter(["--validate-only", "--bridge", path]);
      expect(run.status).toBe(0);
      expect(run.stdout).toContain("bridge     : 1 entries");
    });
  });

  itPy("refuses a bridge that binds one AFL Tables identity to two persons", () => {
    withTempBridge({
      schema_version: 1,
      bridges: [
        { player_url: "https://www.draftguru.com.au/players/nathan_fyfe/1",
          afltables_external_id: "players/N/Nat_Fyfe.html" },
        { player_url: "https://www.draftguru.com.au/players/brad_miller/1",
          afltables_external_id: "players/N/Nat_Fyfe.html" },
      ],
    }, (path) => {
      const run = runImporter(["--validate-only", "--bridge", path]);
      expect(run.status).toBe(1);
      expect(run.stdout).toContain("never an instruction to merge");
    });
  });

  itPy("refuses a bridge whose identity is not the canonical profile form", () => {
    withTempBridge({
      schema_version: 1,
      bridges: [{
        player_url: "https://www.draftguru.com.au/players/nathan_fyfe/1",
        afltables_external_id: "http://afltables.com/afl/stats/players/N/Nat_Fyfe.html",
      }],
    }, (path) => {
      const run = runImporter(["--validate-only", "--bridge", path]);
      expect(run.status).toBe(1);
      expect(run.stdout).toContain("non-canonical AFL Tables identity");
    });
  });

  itPy("refuses a bridge keyed on a non-canonical player_url", () => {
    withTempBridge({
      schema_version: 1,
      bridges: [{
        player_url: "https://www.draftguru.com.au/players/nathan_fyfe/1/",
        afltables_external_id: "players/N/Nat_Fyfe.html",
      }],
    }, (path) => {
      const run = runImporter(["--validate-only", "--bridge", path]);
      expect(run.status).toBe(1);
      expect(run.stdout).toContain("canonical player_url");
    });
  });
});
