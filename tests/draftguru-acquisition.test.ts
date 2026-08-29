import { describe, expect, it } from "vitest";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/*
 * AFLDB-ISSUE-093 §13.5 — DraftGuru acquisition/parser contract (runbook §14).
 * Static pins of the contract JSON + adapter/parser source, plus spawn tests of
 * the parser and the adapter's fail-before-network paths against committed
 * fixtures. No network, no database, no live DraftGuru access.
 */

const root = process.cwd();
const contractPath = join(root, "tools", "rebuild", "draftguru", "draftguru-contract.json");
const parserPath = join(root, "tools", "rebuild", "draftguru", "parse_draft_snapshot.py");
const adapterPath = join(root, "tools", "rebuild", "draftguru", "acquire_draft.py");
const fixtureDir = join(root, "tests", "fixtures", "draftguru");

const contract = JSON.parse(readFileSync(contractPath, "utf8"));
const parserSource = readFileSync(parserPath, "utf8");
const adapterSource = readFileSync(adapterPath, "utf8");

const NBSP = " ";
const ZWSP = "​";
const ARROW = "↧";
const SELECTION_HEADER = `# ${ARROW}`;
const BASE = "https://www.draftguru.com.au";

const venvPython = process.platform === "win32"
  ? join(root, ".venv", "Scripts", "python.exe")
  : join(root, ".venv", "bin", "python");
const python = process.env.AFLDB_PYTHON
  ?? (existsSync(venvPython) ? venvPython : (process.platform === "win32" ? "python" : "python3"));

function hasPython(): boolean {
  const probe = spawnSync(python, ["--version"], { encoding: "utf8" });
  return !probe.error && probe.status === 0;
}
const canSpawn = hasPython();
const itPy = canSpawn ? it : it.skip;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function runParser(args: string[]): SpawnSyncReturns<string> {
  return spawnSync(python, [parserPath, ...args], { encoding: "utf8" });
}

function runAdapter(args: string[]): SpawnSyncReturns<string> {
  return spawnSync(python, [adapterPath, ...args], { encoding: "utf8" });
}

/** Build a snapshot directory from fixture HTML (or literal HTML content). */
function makeSnapshot(years: Record<number, { fixture?: string; html?: string }>): {
  root: string; label: string; dir: string;
} {
  const snapRoot = mkdtempSync(join(tmpdir(), "draftguru-snap-"));
  const label = "fixture-snapshot";
  const dir = join(snapRoot, label);
  mkdirSync(join(dir, "raw", "years"), { recursive: true });
  mkdirSync(join(dir, "http", "years"), { recursive: true });
  for (const [yearText, spec] of Object.entries(years)) {
    const year = Number(yearText);
    const html = spec.html ?? readFileSync(join(fixtureDir, spec.fixture as string), "utf8");
    writeFileSync(join(dir, "raw", "years", `year_${year}.html`), html, "utf8");
    writeFileSync(join(dir, "http", "years", `year_${year}.json`), JSON.stringify({
      url: `${BASE}/years/${year}`,
      final_url: `${BASE}/years/${year}`,
      http_status: 200,
      content_type: "text/html; charset=utf-8",
    }), "utf8");
  }
  return { root: snapRoot, label, dir };
}

function readJsonl(file: string): any[] {
  return readFileSync(file, "utf8").trim().split("\n").map((line) => JSON.parse(line));
}

function sha256File(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

/** CSV parity fixture mirroring tests/fixtures/draftguru/year_2001_excerpt.html
 *  in browser-export shape: variant C header (no Trade column), float-formatted
 *  selection numbers, NBSP player names, ZWSP-delimited Original Club. */
const PARITY_CSV_2001 = [
  `Pick,Draft,${SELECTION_HEADER},Club,Signing,Player,Age,Height,Original Club,Grade,Games,Goals,Coaches,Brownlow,Awards`,
  `,National,1.0,Hawthorn,,Luke${NBSP}Hodge,17yr,185cm,Colac/${ZWSP}Geelong Falcons,A+,346,190,45,42,`,
  `,National,40.0,Geelong,Father-Son (Gary Ablett),Gary${NBSP}Ablett,17yr,182cm,Modewarre/${ZWSP}Geelong Falcons,A+,357,445,310,232,`,
  `,National,55.0,Melbourne,,Brad${NBSP}Miller,18yr,194cm,Mount Gravatt,C+,157,132,0,4,`,
  `,Rookie,30.0,Richmond,,Brad${NBSP}Miller,19yr,188cm,Western U18/${ZWSP}Western Jets,D,0,0,0,0,`,
  `,Trade,,Melbourne,,Clint${NBSP}Bizzell,25yr,188cm,Brisbane Boys' College/${ZWSP}Kedron Grange,B,88,7,21,5,`,
].join("\n") + "\n";

function makeParityDir(csvContent: string): string {
  const dir = mkdtempSync(join(tmpdir(), "draftguru-parity-"));
  writeFileSync(join(dir, "2001_AFL_Draft_and_Trade_Period_Table_1.csv"), csvContent, "utf8");
  return dir;
}

// ---------------------------------------------------------------------------
// Contract (tools/rebuild/draftguru/draftguru-contract.json)
// ---------------------------------------------------------------------------

describe("DraftGuru acquisition contract", () => {
  it("pins the canonical player_url form settled by U1 (absolute https, no trailing slash, ordinal preserved)", () => {
    expect(contract.base_url).toBe(BASE);
    expect(contract.canonical_player_url.form)
      .toBe(`${BASE}/players/<slug>/<ordinal>`);
    expect(contract.canonical_player_url.trailing_slash).toBe("forbidden");
    const regex = new RegExp(contract.canonical_player_url.regex);
    expect(regex.test(`${BASE}/players/brad_miller/1`)).toBe(true);
    expect(regex.test(`${BASE}/players/brad_miller/2`)).toBe(true);
    expect(regex.test(`${BASE}/players/brad_miller/1/`)).toBe(false);
    expect(regex.test("/players/brad_miller/1")).toBe(false);
    expect(regex.test(`${BASE}/players/brad_miller`)).toBe(false);
    expect(contract.canonical_player_url.evidence).toContain("U1 RESOLVED 2026-08-26");
  });

  it("constructs annual URLs from the single base constant", () => {
    const url = contract.year_url_pattern
      .replace("{base_url}", contract.base_url)
      .replace("{year}", "1981");
    expect(url).toBe(`${BASE}/years/1981`);
    // The adapter builds URLs through the parser's single helper, never a
    // second URL literal.
    expect(adapterSource).toContain("snapshot_parser.build_year_url");
    expect(adapterSource).not.toContain("https://www.draftguru.com.au");
  });

  it("pins exactly the 42 expected years", () => {
    const expected = [1981, 1982];
    for (let y = 1986; y <= 2025; y += 1) expected.push(y);
    expect(contract.expected_years).toEqual(expected);
    expect(contract.expected_years).toHaveLength(42);
  });

  it("records 1983-1985 as intentional coverage gaps, not failures", () => {
    expect(contract.known_coverage_gaps).toEqual([
      { year: 1983, reason: "no draft held" },
      { year: 1984, reason: "no draft held" },
      { year: 1985, reason: "no draft held" },
    ]);
    for (const gap of contract.known_coverage_gaps) {
      expect(contract.expected_years).not.toContain(gap.year);
    }
  });

  it("pins the three CSV schema variants and the live Trade-column rule", () => {
    expect(contract.csv_schema_variants.A.columns).toHaveLength(14);
    expect(contract.csv_schema_variants.A.years).toEqual([1981, 1982, 1987]);
    expect(contract.csv_schema_variants.A.columns).not.toContain("Draft");
    expect(contract.csv_schema_variants.B.years).toEqual([1986, 1997, 1998]);
    expect(contract.csv_schema_variants.B.columns).toContain("Detail");
    expect(contract.csv_schema_variants.C.columns).toContain("Signing");
    expect(contract.csv_schema_variants.C.years).toContain(2001);
    expect(contract.csv_schema_variants.C.years).toHaveLength(36);
    expect(contract.selection_column_header).toBe(SELECTION_HEADER);
    expect(contract.live_header_rule).toContain("Trade");
    expect(contract.live_header_rule).toContain("fails closed");
  });

  it("declares the frozen CSV artifact as a non-importable parity oracle", () => {
    expect(contract.csv_artifact.path).toBe("data/sources/draftguru/full-history-20260826");
    expect(contract.csv_artifact.immutable).toBe(true);
    expect(contract.csv_artifact.identity_complete).toBe(false);
    expect(contract.csv_artifact.import_capable).toBe(false);
    expect(contract.snapshot.label_pattern).toBe("^annual-html-[0-9]{8}$");
  });

  it("pins the parity baseline and respectful HTTP policy", () => {
    expect(contract.parity_baseline.total_rows).toBe(6810);
    expect(contract.parity_baseline.distinct_persons).toBe(5057);
    expect(contract.parity_baseline.selection_number_blank).toBe(1686);
    expect(contract.selection_blank_event_types)
      .toEqual(["Free Agency", "Post-Draft", "Pre-Draft", "Trade"]);
    const policy = contract.http_policy;
    expect(policy.user_agent).toContain("AFLDB-rebuild");
    expect(policy.timeout_seconds).toBe(20);
    expect(policy.max_retries).toBe(3);
    expect(policy.backoff_seconds).toEqual([2, 4, 8]);
    expect(policy.min_delay_seconds).toBe(1.5);
    expect(policy.concurrency).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Adapter/parser source pins
// ---------------------------------------------------------------------------

describe("acquisition sources (static pins)", () => {
  it("have zero legacy-database and zero application-database dependency", () => {
    for (const source of [adapterSource, parserSource]) {
      const lower = source.toLowerCase();
      for (const forbidden of [
        "afldb_legacy_sqlite", "sqlite", "connect_legacy",
        "psycopg", "database_url", "postgres", "psql",
        "afldb_test_pre_rebuild",
      ]) {
        expect(lower).not.toContain(forbidden);
      }
    }
  });

  it("performs no destructive filesystem or data operation anywhere", () => {
    for (const source of [adapterSource, parserSource]) {
      for (const forbidden of [
        "DELETE", "TRUNCATE", "delete_missing", "rmtree", "os.remove", "unlink(",
      ]) {
        expect(source).not.toContain(forbidden);
      }
    }
  });

  it("implements the §4 respectful-HTTP contract", () => {
    expect(adapterSource).toContain('"User-Agent": self.user_agent');
    expect(adapterSource).toContain("timeout=self.timeout");
    expect(adapterSource).toContain("robots.txt disallows the target paths");
    expect(adapterSource).toContain("cross-host redirect");
    expect(adapterSource).toContain("zero-byte body");
    expect(adapterSource).toMatch(/min_delay/);
  });

  it("writes the manifest LAST, refuses partials, and treats labels as immutable", () => {
    expect(adapterSource).toContain("already exists. Snapshots are immutable");
    expect(adapterSource).toContain("No manifest was written");
    expect(adapterSource).toContain("partial/probe acquisition");
    expect(adapterSource).toContain('"manifest_written": False');
    expect(adapterSource).toContain("^[0-9a-f]{64}$");
  });
});

// ---------------------------------------------------------------------------
// Parser behaviour (spawned against committed fixtures)
// ---------------------------------------------------------------------------

describe("snapshot parser (fixture spawns)", () => {
  itPy("extracts verbatim hrefs and canonicalises to the U1 stored form", () => {
    const snap = makeSnapshot({ 2001: { fixture: "year_2001_excerpt.html" } });
    const run = runParser(["--label", snap.label, "--snapshot-root", snap.root]);
    expect(run.stderr).toBe("");
    expect(run.status).toBe(0);
    const rows = readJsonl(join(snap.dir, "parsed", "rows.jsonl"));
    expect(rows).toHaveLength(5);
    const hodge = rows.find((r) => r.player_slug === "luke_hodge");
    expect(hodge.player_href_raw).toBe("/players/luke_hodge/1");
    expect(hodge.player_url).toBe(`${BASE}/players/luke_hodge/1`);
    expect(hodge.club_href_raw).toBe("/clubs/hawthorn");
    expect(hodge.club_slug).toBe("hawthorn");
    expect(hodge.club_name_raw).toBe("Hawthorn");
  });

  itPy("preserves the ordinal exactly (gary_ablett/2 never collapses to /1 or slug-only)", () => {
    const snap = makeSnapshot({ 2001: { fixture: "year_2001_excerpt.html" } });
    const run = runParser(["--label", snap.label, "--snapshot-root", snap.root]);
    expect(run.status).toBe(0);
    const rows = readJsonl(join(snap.dir, "parsed", "rows.jsonl"));
    const ablett = rows.find((r) => r.player_slug === "gary_ablett");
    expect(ablett.player_ordinal).toBe(2);
    expect(ablett.player_url).toBe(`${BASE}/players/gary_ablett/2`);
  });

  itPy("keeps the two Brad Millers distinct (the canonical identity regression)", () => {
    const snap = makeSnapshot({ 2001: { fixture: "year_2001_excerpt.html" } });
    const run = runParser(["--label", snap.label, "--snapshot-root", snap.root]);
    expect(run.status).toBe(0);
    const rows = readJsonl(join(snap.dir, "parsed", "rows.jsonl"));
    const miller1 = rows.find((r) => r.player_url === `${BASE}/players/brad_miller/1`);
    const miller2 = rows.find((r) => r.player_url === `${BASE}/players/brad_miller/2`);
    expect(miller1).toBeDefined();
    expect(miller2).toBeDefined();
    // Identical rendered names; identity comes from the href alone.
    expect(miller1.player_name_raw).toBe(`Brad${NBSP}Miller`);
    expect(miller2.player_name_raw).toBe(`Brad${NBSP}Miller`);
    expect(miller1.event_type_raw).toBe("National");
    expect(miller1.pick_number).toBe(55);
    expect(miller1.club_name_raw).toBe("Melbourne");
    expect(miller2.event_type_raw).toBe("Rookie");
    expect(miller2.pick_number).toBe(30);
    expect(miller2.club_name_raw).toBe("Richmond");
    const persons = readJsonl(join(snap.dir, "parsed", "persons.jsonl"));
    const millers = persons.filter((p) => p.slug === "brad_miller");
    expect(millers.map((p) => p.player_url).sort()).toEqual([
      `${BASE}/players/brad_miller/1`,
      `${BASE}/players/brad_miller/2`,
    ]);
    expect(persons).toHaveLength(5);
  });

  itPy("canonicalisation is idempotent and rejects trailing slashes and foreign hosts", () => {
    const relative = runParser(["--print-canonical", "/players/brad_miller/1"]);
    expect(relative.status).toBe(0);
    expect(relative.stdout.trim()).toBe(`${BASE}/players/brad_miller/1`);
    const absolute = runParser(["--print-canonical", `${BASE}/players/brad_miller/1`]);
    expect(absolute.status).toBe(0);
    expect(absolute.stdout.trim()).toBe(`${BASE}/players/brad_miller/1`);
    expect(runParser(["--print-canonical", "/players/brad_miller/1/"]).status).toBe(1);
    expect(runParser(["--print-canonical", "/players/brad_miller"]).status).toBe(1);
    expect(runParser(["--print-canonical", "http://example.com/players/x/1"]).status).toBe(1);
  });

  itPy("accepts the 14-column variant A shape (1981: no Draft, no Trade)", () => {
    const snap = makeSnapshot({ 1981: { fixture: "year_1981_excerpt.html" } });
    const run = runParser(["--label", snap.label, "--snapshot-root", snap.root]);
    expect(run.stderr).toBe("");
    expect(run.status).toBe(0);
    const rows = readJsonl(join(snap.dir, "parsed", "rows.jsonl"));
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.event_type_raw).toBeNull();
      expect(row.trade_column_present).toBe(false);
      expect(row.trade_raw).toBeNull();
      expect(row.signing_raw).toBeNull();
    }
    const craig = rows.find((r) => r.player_slug === "neil_craig");
    expect(craig.pick_number).toBe(2);
    expect(craig.detail_raw).toBeNull();
  });

  itPy("fails closed on an unknown header (schema drift)", () => {
    const drifted = readFileSync(join(fixtureDir, "year_2001_excerpt.html"), "utf8")
      .replace("<th>Player</th>", "<th>Footballer</th>");
    const snap = makeSnapshot({ 2001: { html: drifted } });
    const run = runParser(["--label", snap.label, "--snapshot-root", snap.root]);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("no table matches an accepted header");
    expect(existsSync(join(snap.dir, "parsed"))).toBe(false);
  });

  itPy("treats blank as absence: null selection numbers, parity-only career figures, absent Trade", () => {
    const snap = makeSnapshot({ 2001: { fixture: "year_2001_excerpt.html" } });
    const run = runParser(["--label", snap.label, "--snapshot-root", snap.root]);
    expect(run.status).toBe(0);
    const rows = readJsonl(join(snap.dir, "parsed", "rows.jsonl"));
    const trade = rows.find((r) => r.event_type_raw === "Trade");
    expect(trade.pick_number).toBeNull();
    expect(trade.trade_raw).toBeNull();
    for (const row of rows) {
      // Games/Goals/Coaches/Brownlow are captured for parity only — raw
      // strings under parity_only, never top-level facts.
      expect(row.games).toBeUndefined();
      expect(row.goals).toBeUndefined();
      expect(typeof row.parity_only.games).toBe("string");
      expect(row.pick_number === null || row.pick_number > 0).toBe(true);
    }
    const profile = JSON.parse(
      readFileSync(join(snap.dir, "parsed", "trade_column_profile.json"), "utf8"));
    expect(profile.years_with_trade_header).toEqual([2001]);
    expect(profile.populated_by_year).toEqual({ "2001": 0 });
    expect(profile.total_populated).toBe(0);
  });

  itPy("separates text nodes across <br> in Pick and Signing cells (live 2001 structure)", () => {
    // Measured in the real 2001 page: the parenthesised qualifier follows a
    // <br/>, in both the Pick and the Signing column --
    //   <td class="category">Priority<br/>(Fremantle)</td>
    //   <td class="category">Father-Son<br/>(<a href="/players/gary_ablett/1">Gary&nbsp;Ablett</a>)</td>
    // Concatenating those text nodes fused them into 'Priority(Fremantle)' and
    // 'Father-Son(Gary Ablett)', which failed 2001 CSV parity. All five <br>
    // in the live document are this structure.
    const head = `<tr><th>Pick</th><th>Draft</th><th>${SELECTION_HEADER}</th><th>Club</th>`
      + `<th>Signing</th><th>Player</th><th>Age</th><th>Height</th><th>Original Club</th>`
      + `<th>Grade</th><th>Games</th><th>Goals</th><th>Coaches</th><th>Brownlow</th>`
      + `<th>Awards</th></tr>`;
    const html = `<html><head><meta charset="utf-8"></head><body>
<table><thead>${head}</thead><tbody>
  <tr>
    <td class="category">
      Priority<br/>(Fremantle)

    </td>
    <td class="draft">National</td><td class="number">1</td>
    <td class="club"><a href="/clubs/hawthorn">Hawthorn</a></td>
    <td class="category"></td>
    <td class="player"><a href="/players/luke_hodge/1">Luke&#160;Hodge</a></td>
    <td class="stats">17<em>yr</em></td><td class="stats height">185<em>cm</em></td>
    <td class="from-club"><a href="/from/colac_tigers">Colac</a><em>/&#8203;</em><a href="/from/geelong_falcons">Geelong U18</a></td>
    <td class="grade">A+</td><td>346 (305)</td><td>194</td><td>591</td><td>131</td><td></td>
  </tr>
  <tr>
    <td class="category"></td>
    <td class="draft">National</td><td class="number">40</td>
    <td class="club"><a href="/clubs/geelong">Geelong</a></td>
    <td class="category">Father-Son<br/>(<a href="/players/gary_ablett/1">Gary&#160;Ablett</a>)
</td>
    <td class="player"><a href="/players/gary_ablett/2">Gary&#160;Ablett</a></td>
    <td class="stats">17<em>yr</em></td><td class="stats height">182<em>cm</em></td>
    <td class="from-club"><a href="/from/modewarre_warriors">Modewarre</a><em>/&#8203;</em><a href="/from/geelong_falcons">Geelong U18</a></td>
    <td class="grade">A+</td><td>357 (247)</td><td>445</td><td>984</td><td>232</td><td></td>
  </tr>
</tbody></table></body></html>`;
    const snap = makeSnapshot({ 2001: { html } });
    const run = runParser(["--label", snap.label, "--snapshot-root", snap.root]);
    expect(run.status).toBe(0);
    const rows = readJsonl(join(snap.dir, "parsed", "rows.jsonl"));
    expect(rows).toHaveLength(2);
    // A <br> becomes exactly one space — never a fused value, never two spaces.
    expect(rows[0].pick_note_raw).toBe("Priority (Fremantle)");
    expect(rows[1].signing_raw).toBe(`Father-Son (Gary${NBSP}Ablett)`);
    // The fix is scoped to <br>: NBSP inside the qualifier survives, and no
    // space is invented in a cell whose parts are separated by markup alone.
    expect(rows[0].original_club_raw).toBe(`Colac/${ZWSP}Geelong U18`);
    // The Signing cell carries the FATHER's player href; row identity still
    // comes only from the Player column.
    expect(rows[1].player_url).toBe(`${BASE}/players/gary_ablett/2`);
    expect(rows[1].player_ordinal).toBe(2);
  });

  itPy("never modifies raw/ bytes and counts encoding artefacts instead of repairing them", () => {
    const snap = makeSnapshot({ 2001: { fixture: "year_2001_excerpt.html" } });
    const rawFile = join(snap.dir, "raw", "years", "year_2001.html");
    const before = sha256File(rawFile);
    const run = runParser(["--label", snap.label, "--snapshot-root", snap.root]);
    expect(run.status).toBe(0);
    expect(sha256File(rawFile)).toBe(before);
    const schema = JSON.parse(readFileSync(join(snap.dir, "parsed", "schema.json"), "utf8"));
    const info = schema.years["2001"];
    expect(info.column_count).toBe(16);
    expect(info.trade_column_present).toBe(true);
    expect(info.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    // ZWSP is stored literally in the fixture bytes (4 occurrences: every
    // Original Club containing a '/'; Brad Miller /1's "Mount Gravatt" has
    // none). NBSP is stored as &#160; entities — 0 literal U+00A0 bytes — and
    // appears only once the HTML parser expands them into extracted cell text:
    // one per player name, so one per parsed row. The 6th &#160; in the file
    // is inside the leading HTML comment and is correctly not extracted.
    expect(info.encoding_counts_raw_document.zwsp).toBe(4);
    expect(info.encoding_counts_raw_document.nbsp).toBe(0);
    expect(info.encoding_counts_extracted.zwsp).toBe(4);
    expect(info.encoding_counts_extracted.nbsp).toBe(5);
    expect(info.encoding_counts_extracted.nbsp).toBe(info.row_count);
    expect(info.encoding_counts_extracted.downward_arrow).toBeGreaterThanOrEqual(1);
    expect(info.encoding_counts_extracted.mojibake_signature).toBe(0);
  });

  itPy("--validate-only writes nothing", () => {
    const snap = makeSnapshot({ 2001: { fixture: "year_2001_excerpt.html" } });
    const run = runParser(["--label", snap.label, "--snapshot-root", snap.root, "--validate-only"]);
    expect(run.status).toBe(0);
    expect(existsSync(join(snap.dir, "parsed"))).toBe(false);
  });

  itPy("--require-complete refuses a partial snapshot", () => {
    const snap = makeSnapshot({ 2001: { fixture: "year_2001_excerpt.html" } });
    const run = runParser([
      "--label", snap.label, "--snapshot-root", snap.root, "--require-complete"]);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("snapshot is not complete");
  });

  itPy("refuses the frozen browser-export CSV label outright", () => {
    const run = runParser([
      "--label", "full-history-20260826",
      "--snapshot-root", join(root, "data", "sources", "draftguru")]);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("frozen browser-export CSV artifact");
  });
});

// ---------------------------------------------------------------------------
// CSV parity (fixture-scale harness, runbook §7)
// ---------------------------------------------------------------------------

describe("CSV parity reconciliation (fixture scale)", () => {
  itPy("reconciles the 2001 fixture against its browser-export shape", () => {
    const snap = makeSnapshot({ 2001: { fixture: "year_2001_excerpt.html" } });
    const parityDir = makeParityDir(PARITY_CSV_2001);
    const run = runParser([
      "--label", snap.label, "--snapshot-root", snap.root,
      "--parity", "--parity-dir", parityDir]);
    expect(run.stderr).toBe("");
    expect(run.status).toBe(0);
    const summary = JSON.parse(run.stdout.trim().split("\n").pop() as string);
    expect(summary.parity).toBe("PASS");
    expect(summary.total_rows).toBe(5);
    expect(summary.distinct_person_count).toBe(5);
  });

  itPy("fails on an unexplained population difference", () => {
    const snap = makeSnapshot({ 2001: { fixture: "year_2001_excerpt.html" } });
    const parityDir = makeParityDir(
      PARITY_CSV_2001.replace(`Brad${NBSP}Miller,18yr`, `Brett${NBSP}Miller,18yr`));
    const run = runParser([
      "--label", snap.label, "--snapshot-root", snap.root,
      "--parity", "--parity-dir", parityDir]);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("parity failed");
    expect(run.stderr).toContain("player display names");
  });
});

// ---------------------------------------------------------------------------
// Browser-export mojibake — the enumerated parity-only exception (runbook §7)
//
// The frozen CSV corpus contains the double-encoding signature exactly SIX
// times, in exactly five files: 2003, 2011, 2013 (x2), 2016, 2018. The live
// HTML carries the correct Unicode everywhere (mojibake_signature = 0 on all
// 42 pages), so the damage is export-side only and is repaired ON THE CSV SIDE
// DURING COMPARISON ONLY — never in the parsed values, never in player_url,
// never in the frozen corpus.
// ---------------------------------------------------------------------------

/** The four damaged names, in their correct live-source Unicode form.
 *  Codepoints are pinned numerically in the assertions below rather than by
 *  eye, so a transport that mangles a character fails the test loudly. */
const codes = (s: string): number[] => Array.from(s, (c) => c.codePointAt(0) as number);
const SETANTA = `Setanta${NBSP}Ó hAilpín`;  // Setanta O-acute hAilp-i-acute-n
const CIARAN_SHEEHAN = `Ciarán${NBSP}Sheehan`;   // Ciar-a-acute-n Sheehan
const CIARAN_BYRNE = `Ciarán${NBSP}Byrne`;       // Ciar-a-acute-n Byrne
const RED_OG_MURPHY = `Red Óg${NBSP}Murphy`;     // Red O-acute-g Murphy

/** Re-read each UTF-8 byte of a segment as one Latin-1 character — exactly the
 *  damage the browser export applied. Verified against the real corpus bytes:
 *  2003 holds `Setanta` + NBSP + C3 83 C2 93 + ` hAilp` + C3 83 C2 AD + `n`,
 *  i.e. the NBSP itself is NOT damaged (it is stored as a proper C2 A0), so
 *  the damage is applied per NBSP-delimited segment. */
function damageSegment(text: string): string {
  return Array.from(Buffer.from(text, "utf8"), (b) => String.fromCharCode(b)).join("");
}
function damage(name: string): string {
  return name.split(NBSP).map(damageSegment).join(NBSP);
}

const MOJIBAKE_PEOPLE = [
  { name: SETANTA, href: "/players/setanta_%C3%B3%20hailp%C3%ADn/1", club: "Carlton", pick: 3 },
  { name: CIARAN_SHEEHAN, href: "/players/ciar%C3%A1n_sheehan/1", club: "Carlton", pick: 4 },
  { name: CIARAN_BYRNE, href: "/players/ciar%C3%A1n_byrne/1", club: "Carlton", pick: 5 },
  { name: RED_OG_MURPHY, href: "/players/red%20%C3%B3g_murphy/1", club: "Sydney", pick: 6 },
];

function mojibakeSnapshotHtml(): string {
  const head = `<tr><th>Pick</th><th>Draft</th><th>${SELECTION_HEADER}</th><th>Club</th>`
    + `<th>Signing</th><th>Player</th><th>Age</th><th>Height</th><th>Original Club</th>`
    + `<th>Grade</th><th>Games</th><th>Goals</th><th>Coaches</th><th>Brownlow</th>`
    + `<th>Awards</th></tr>`;
  const rows = MOJIBAKE_PEOPLE.map((p) => `  <tr>
    <td class="category"></td>
    <td class="draft">National</td><td class="number">${p.pick}</td>
    <td class="club"><a href="/clubs/${p.club.toLowerCase()}">${p.club}</a></td>
    <td class="category"></td>
    <td class="player"><a href="${p.href}">${p.name.replace(NBSP, "&#160;")}</a></td>
    <td class="stats">18<em>yr</em></td><td class="stats height">188<em>cm</em></td>
    <td class="from-club"></td>
    <td class="grade">B</td><td>0</td><td>0</td><td>0</td><td>0</td><td></td>
  </tr>`).join("\n");
  return `<html><head><meta charset="utf-8"></head><body>
<table><thead>${head}</thead><tbody>
${rows}
</tbody></table></body></html>`;
}

/** The browser-export CSV for the same rows, with the names damaged. */
function mojibakeParityCsv(nameOf: (name: string) => string): string {
  return [
    `Pick,Draft,${SELECTION_HEADER},Club,Signing,Player,Age,Height,Original Club,Grade,Games,Goals,Coaches,Brownlow,Awards`,
    ...MOJIBAKE_PEOPLE.map((p) =>
      `,National,${p.pick}.0,${p.club},,${nameOf(p.name)},18yr,188cm,,B,0,0,0,0,`),
  ].join("\n") + "\n";
}

function makeParityDirForYear(year: number, csvContent: string): string {
  const dir = mkdtempSync(join(tmpdir(), "draftguru-parity-"));
  writeFileSync(join(dir, `${year}_AFL_Draft_and_Trade_Period_Table_1.csv`), csvContent, "utf8");
  return dir;
}

describe("browser-export mojibake parity exception", () => {
  itPy("reconciles the four damaged CSV names without altering the live values", () => {
    const snap = makeSnapshot({ 2013: { html: mojibakeSnapshotHtml() } });
    const parityDir = makeParityDirForYear(2013, mojibakeParityCsv(damage));

    // The CSV side really is damaged — otherwise this test proves nothing.
    const csvText = mojibakeParityCsv(damage);
    expect(csvText).toContain("CiarÃ¡n");          // 'Ciar' + A-tilde + inverted-!
    // Codepoints, not eyeballed literals: NBSP survives the damage untouched
    // and the lead damage character (U+00C3) follows it immediately.
    expect(codes(damage(SETANTA)).slice(7, 9)).toEqual([0x00a0, 0x00c3]);
    // (superseded literal assertion, retained only as a comment: "Setanta Ã");  // NBSP intact, O-acute damaged
    expect(csvText).not.toContain("Ciarán");            // no correct form anywhere

    const run = runParser([
      "--label", snap.label, "--snapshot-root", snap.root,
      "--parity", "--parity-dir", parityDir]);
    expect(run.stderr).toBe("");
    expect(run.status).toBe(0);
    const summary = JSON.parse(run.stdout.trim().split("\n").pop() as string);
    expect(summary.parity).toBe("PASS");
    expect(summary.total_rows).toBe(4);
    expect(summary.distinct_person_count).toBe(4);

    // The repair is comparison-only: the parsed values keep the correct
    // Unicode, and player_url keeps its verbatim percent-encoding.
    const rows = readJsonl(join(snap.dir, "parsed", "rows.jsonl"));
    const names = rows.map((r) => r.player_name_raw);
    expect(names).toContain(SETANTA);
    expect(names).toContain(CIARAN_SHEEHAN);
    expect(names).toContain(CIARAN_BYRNE);
    expect(names).toContain(RED_OG_MURPHY);
    for (const row of rows) {
      expect(row.player_name_raw).not.toContain("Ã");   // never re-damaged
    }
    expect(rows.map((r) => r.player_url)).toEqual(
      MOJIBAKE_PEOPLE.map((p) => `${BASE}${p.href}`));
  });

  itPy("still fails when a CSV name differs by more than the known damage", () => {
    // 'Ciaran Sheehan' (plain ASCII 'a') is NOT the damaged form of
    // 'Ciarán Sheehan' — and 'Ciaran Kilkenny' is a real, separate person in
    // the corpus. The exception must be the double-encoding pattern only,
    // never accent or Unicode equivalence.
    const snap = makeSnapshot({ 2013: { html: mojibakeSnapshotHtml() } });
    const parityDir = makeParityDirForYear(2013, mojibakeParityCsv(
      (name) => name === CIARAN_SHEEHAN ? `Ciaran${NBSP}Sheehan` : damage(name)));
    const run = runParser([
      "--label", snap.label, "--snapshot-root", snap.root,
      "--parity", "--parity-dir", parityDir]);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("parity failed");
    expect(run.stderr).toContain("player display names");
  });

  itPy("still fails on an unrelated name difference among the damaged rows", () => {
    const snap = makeSnapshot({ 2013: { html: mojibakeSnapshotHtml() } });
    const parityDir = makeParityDirForYear(2013, mojibakeParityCsv(
      (name) => name === RED_OG_MURPHY ? damage(`Red Óg${NBSP}Murphys`) : damage(name)));
    const run = runParser([
      "--label", snap.label, "--snapshot-root", snap.root,
      "--parity", "--parity-dir", parityDir]);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("parity failed");
    expect(run.stderr).toContain("player display names");
  });
});

// ---------------------------------------------------------------------------
// Adapter fail-before-network paths (spawned; no network is ever attempted)
// ---------------------------------------------------------------------------

describe("acquisition adapter (fail-before-network spawns)", () => {
  itPy("aborts on an existing manifest label before touching anything", () => {
    const manifestDir = mkdtempSync(join(tmpdir(), "draftguru-manifest-"));
    const snapRoot = mkdtempSync(join(tmpdir(), "draftguru-snaproot-"));
    writeFileSync(join(manifestDir, "annual-html-20990101.json"), "{}\n", "utf8");
    const run = runAdapter([
      "--label", "annual-html-20990101",
      "--manifest-dir", manifestDir, "--snapshot-root", snapRoot]);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("already exists. Snapshots are immutable");
    expect(readdirSync(snapRoot)).toEqual([]);
  });

  itPy("rejects labels outside the pinned pattern (the frozen CSV path is unreachable)", () => {
    const manifestDir = mkdtempSync(join(tmpdir(), "draftguru-manifest-"));
    const snapRoot = mkdtempSync(join(tmpdir(), "draftguru-snaproot-"));
    const run = runAdapter([
      "--label", "full-history-20260826",
      "--manifest-dir", manifestDir, "--snapshot-root", snapRoot]);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("does not match the required pattern");
    expect(readdirSync(snapRoot)).toEqual([]);
  });

  itPy("never requests the intentional 1983-1985 coverage gaps", () => {
    const manifestDir = mkdtempSync(join(tmpdir(), "draftguru-manifest-"));
    const snapRoot = mkdtempSync(join(tmpdir(), "draftguru-snaproot-"));
    const run = runAdapter([
      "--label", "annual-html-20990101", "--years", "1983",
      "--manifest-dir", manifestDir, "--snapshot-root", snapRoot]);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("intentional coverage gaps");
    expect(readdirSync(snapRoot)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Snapshot layout and manifests
// ---------------------------------------------------------------------------

describe("snapshot layout", () => {
  it("keeps raw snapshots gitignored while manifests stay tracked", () => {
    const gitignore = readFileSync(join(root, ".gitignore"), "utf8");
    expect(gitignore).toContain("/data/*");
    expect(gitignore).not.toContain("!/data/sources");
    expect(gitignore).not.toMatch(/^docs\b/m);
  });

  it("the retrospective CSV manifest refuses identity/import without opening a file", () => {
    const manifest = JSON.parse(readFileSync(
      join(root, "docs", "rebuild-manifests", "draftguru", "csv-export-20260826.json"),
      "utf8"));
    expect(manifest.snapshot_label).toBe("csv-export-20260826");
    expect(manifest.identity_complete).toBe(false);
    expect(manifest.import_capable).toBe(false);
    expect(manifest.identity_fields_present).toEqual([]);
    expect(manifest.file_count).toBe(42);
    expect(manifest.total_rows).toBe(6810);
    expect(manifest.immutable).toBe(true);
  });

  it("the frozen CSV corpus itself is intact (42 files, expected years)", () => {
    const dir = join(root, "data", "sources", "draftguru", "full-history-20260826");
    const files = readdirSync(dir).filter((f) => f.endsWith(".csv"));
    expect(files).toHaveLength(42);
    const years = files.map((f) => Number(f.slice(0, 4))).sort((a, b) => a - b);
    expect(years).toEqual(contract.expected_years);
  });
});

// ===========================================================================
// AFLDB-ISSUE-093 Stage B1 — person-page PROFILING (runbook §30)
//
// Stage B1 asks one question: does a DraftGuru person page carry a
// deterministic player_url -> AFL Tables identity bridge? Everything below is
// offline. Person-page STRUCTURE is deliberately NOT asserted here: the
// fixtures are synthetic and exercise parser mechanics only. Tests against
// real person-page bytes stay pending until the bounded Brad Miller probe.
// ===========================================================================

const sampleToolPath = join(root, "tools", "rebuild", "draftguru", "stage_b1_sample.py");
const personsAdapterPath = join(root, "tools", "rebuild", "draftguru", "acquire_persons.py");
const profilerPath = join(root, "tools", "rebuild", "draftguru", "profile_person_pages.py");
const fitzroyPath = join(root, "tools", "migration", "import_fitzroy_core.py");

const sampleToolSource = readFileSync(sampleToolPath, "utf8");
const personsAdapterSource = readFileSync(personsAdapterPath, "utf8");
const profilerSource = readFileSync(profilerPath, "utf8");
const fitzroySource = readFileSync(fitzroyPath, "utf8");

const personStage = contract.person_stage;
const B1_LABEL = "person-html-20990101";
const STAGE_A_FIXTURE_LABEL = "annual-html-20990101";

/** The AFL Tables prefix strip that import_fitzroy_core.normalise_profile_url() owns. */
const AFLTABLES_STRIP = String.raw`^https?://afltables\.com/afl/stats/`;

/** The four proven convergence pairs — both ordinals of each. */
const CONVERGENCE_URLS = [
  `${BASE}/players/adam_houlihan/1`, `${BASE}/players/adam_houlihan/2`,
  `${BASE}/players/andrew_hill/1`, `${BASE}/players/andrew_hill/2`,
  `${BASE}/players/brad_miller/1`, `${BASE}/players/brad_miller/2`,
  `${BASE}/players/michael_brown/1`, `${BASE}/players/michael_brown/2`,
];

const SYNTHETIC_BANNER =
  "<!-- SYNTHETIC fixture: exercises parser mechanics only. It asserts nothing about "
  + "live DraftGuru person-page structure, which is validated against real bytes after "
  + "the bounded Brad Miller probe. -->";

function runSampleTool(args: string[]): SpawnSyncReturns<string> {
  return spawnSync(python, [sampleToolPath, ...args], { encoding: "utf8" });
}
function runPersons(args: string[]): SpawnSyncReturns<string> {
  return spawnSync(python, [personsAdapterPath, ...args], { encoding: "utf8" });
}
function runProfiler(args: string[]): SpawnSyncReturns<string> {
  return spawnSync(python, [profilerPath, ...args], { encoding: "utf8" });
}
function sha256(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

interface B1Fixture {
  snapRoot: string; manifestDir: string; stageADir: string; personDir: string;
  residualPath: string; residualSha: string; residualBytes: number; residualUrls: string[];
  personCount: number;
}

/**
 * A synthetic Stage A snapshot large enough to satisfy the frozen 8/68/30/14
 * contract, plus a residual input file. Percent-encoded identities are included
 * deliberately: they must survive byte-exactly.
 */
function buildB1Fixture(options: { residual?: (urls: string[]) => string } = {}): B1Fixture {
  const snapRoot = mkdtempSync(join(tmpdir(), "draftguru-b1-"));
  const manifestDir = mkdtempSync(join(tmpdir(), "draftguru-b1-manifest-"));
  const stageADir = join(snapRoot, STAGE_A_FIXTURE_LABEL);
  const personDir = join(snapRoot, B1_LABEL);
  mkdirSync(join(stageADir, "parsed"), { recursive: true });
  mkdirSync(join(personDir, "input"), { recursive: true });

  const persons: unknown[] = [];
  const rows: unknown[] = [];
  const add = (slug: string, ordinal: number, year: number, games: string): string => {
    const url = `${BASE}/players/${slug}/${ordinal}`;
    persons.push({
      display_names_raw: ["Synthetic Name"], ordinal, player_url: url,
      row_count: 1, slug, years: [year],
    });
    rows.push({
      player_url: url, draft_year: year, row_index: rows.length,
      parity_only: { games, goals: "0", brownlow: "0", coaches: "0", grade: null, awards: null },
    });
    return url;
  };

  for (const url of CONVERGENCE_URLS) {
    const match = /players\/(.+)\/(\d+)$/.exec(url) as RegExpExecArray;
    add(match[1], Number(match[2]), 1995, "50");
  }

  const residualUrls: string[] = [
    add("alex_van%20wyk", 1, 2009, "12"),        // %20 must never be decoded
    add("ciar%C3%A1n_byrne", 1, 2013, "0"),      // %C3%A1 must never be decoded
    add("aiden_o'driscoll", 1, 2016, "3"),       // apostrophe slug
  ];
  while (residualUrls.length < 68) {
    const i = residualUrls.length;
    residualUrls.push(add(`residual_person_${i}`, 1, 1990 + (i % 30), i % 3 === 0 ? "0" : `${i}`));
  }
  for (const decade of [1980, 1990, 2000, 2010, 2020]) {
    for (let i = 0; i < 10; i += 1) add(`control_${decade}_${i}`, 1, decade + 1 + (i % 8), `${20 + i}`);
  }
  for (let i = 0; i < 20; i += 1) add(`zero_person_${i}`, 1, 2000 + (i % 20), "0");

  writeFileSync(join(stageADir, "parsed", "persons.jsonl"),
    `${persons.map((p) => JSON.stringify(p)).join("\n")}\n`, "utf8");
  writeFileSync(join(stageADir, "parsed", "rows.jsonl"),
    `${rows.map((r) => JSON.stringify(r)).join("\n")}\n`, "utf8");
  writeFileSync(join(manifestDir, `${STAGE_A_FIXTURE_LABEL}.json`), `${JSON.stringify({
    snapshot_label: STAGE_A_FIXTURE_LABEL,
    distinct_player_url_count: persons.length,
    identity_complete: true,
  }, null, 2)}\n`, "utf8");

  const sorted = [...residualUrls].sort();
  const content = options.residual ? options.residual(sorted) : `${sorted.join("\n")}\n`;
  const residualPath = join(personDir, "input", "residual_player_urls.txt");
  const buffer = Buffer.from(content, "utf8");
  writeFileSync(residualPath, buffer);

  return {
    snapRoot, manifestDir, stageADir, personDir, residualPath,
    residualSha: sha256(buffer), residualBytes: buffer.length,
    residualUrls: sorted, personCount: persons.length,
  };
}

function freezeSample(fixture: B1Fixture, extra: string[] = []): SpawnSyncReturns<string> {
  return runSampleTool([
    "--label", B1_LABEL,
    "--stage-a-label", STAGE_A_FIXTURE_LABEL,
    "--snapshot-root", fixture.snapRoot,
    "--manifest-dir", fixture.manifestDir,
    "--expect-residual-sha256", fixture.residualSha,
    "--expect-residual-bytes", `${fixture.residualBytes}`,
    ...extra,
  ]);
}

function readSample(fixture: B1Fixture): any {
  return JSON.parse(readFileSync(join(fixture.personDir, "sample.json"), "utf8"));
}

function synthPage(name: string, hrefs: string[]): string {
  return `${SYNTHETIC_BANNER}\n<html><head><title>${name} | DraftGuru</title></head>`
    + `<body><h1>${name}</h1>`
    + hrefs.map((href) => `<a href="${href}">profile</a>`).join("")
    + "<dl><dt>Height</dt><dd>191cm</dd></dl></body></html>";
}

/** Seed a terminal acquisition state for one identity. Filenames are storage only. */
function seedPerson(personDir: string, slug: string, ordinal: number,
                    spec: { html?: string; failure?: { status: number | null; reason: string } }): string {
  const stem = `${slug}__${ordinal}`;
  const url = `${BASE}/players/${slug}/${ordinal}`;
  mkdirSync(join(personDir, "raw", "persons"), { recursive: true });
  mkdirSync(join(personDir, "http", "persons"), { recursive: true });
  if (spec.failure) {
    writeFileSync(join(personDir, "http", "persons", `${stem}.json`), `${JSON.stringify({
      player_url: url, slug, ordinal, url, final_url: null,
      http_status: spec.failure.status, terminal_classification: "failed",
      reason: spec.failure.reason, raw_filename: `raw/persons/${stem}.html`,
      attempts: [{ attempt: 1, outcome: "error", terminal: true, reason: spec.failure.reason }],
    }, null, 2)}\n`, "utf8");
    return url;
  }
  const html = spec.html as string;
  writeFileSync(join(personDir, "raw", "persons", `${stem}.html`), html, "utf8");
  writeFileSync(join(personDir, "http", "persons", `${stem}.json`), `${JSON.stringify({
    player_url: url, slug, ordinal, url, final_url: url, http_status: 200,
    content_type: "text/html; charset=utf-8", byte_size: Buffer.byteLength(html),
    sha256: sha256(html), terminal_classification: "fetched",
    raw_filename: `raw/persons/${stem}.html`,
    attempts: [{ attempt: 1, outcome: "ok", http_status: 200 }],
  }, null, 2)}\n`, "utf8");
  return url;
}

function readProfileRecords(personDir: string): Record<string, any> {
  const text = readFileSync(join(personDir, "parsed", "person_profile.jsonl"), "utf8");
  const records: Record<string, any> = {};
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const record = JSON.parse(line);
    records[record.player_url] = record;
  }
  return records;
}

// ---------------------------------------------------------------------------
// Stage B1 contract (additive)
// ---------------------------------------------------------------------------

describe("Stage B1 person-stage contract", () => {
  it("is additive — every Stage A key it depends on is unchanged", () => {
    expect(contract.snapshot.label_pattern).toBe("^annual-html-[0-9]{8}$");
    expect(contract.canonical_player_url.regex)
      .toBe("^https://www\\.draftguru\\.com\\.au/players/[^/]+/[1-9][0-9]*$");
    expect(contract.parity_baseline.total_rows).toBe(6810);
    expect(contract.parity_baseline.distinct_persons).toBe(5057);
    // the person stage reuses the frozen identity regex rather than restating one
    expect(personStage.person_url_pattern).toBe(contract.canonical_player_url.regex);
  });

  it("pins the Stage B1 snapshot label shape and refuses Stage A labels outright", () => {
    expect(personStage.person_snapshot.label_pattern).toBe("^person-html-[0-9]{8}$");
    expect(new RegExp(personStage.person_snapshot.label_pattern).test("person-html-20260826"))
      .toBe(true);
    const refused = personStage.person_snapshot.refused_labels.map((r: any) => r.pattern);
    expect(refused).toContain("^annual-html-[0-9]{8}$");
    expect(refused).toContain("^full-history-[0-9]{8}$");
    for (const pattern of refused) {
      expect(new RegExp(pattern).test("person-html-20260826")).toBe(false);
    }
  });

  it("declares a profiling-only manifest: identity_complete and import_capable are false", () => {
    expect(personStage.manifest.identity_complete).toBe(false);
    expect(personStage.manifest.import_capable).toBe(false);
    expect(personStage.manifest.written).toContain("LAST");
    expect(personStage.manifest.completion_rule).toContain("fetched + failed = 120");
    expect(personStage.manifest.probe_rule).toContain("MUST NOT write");
  });

  it("pins the frozen 120-person sample shape", () => {
    expect(personStage.sample_contract.total).toBe(120);
    expect(personStage.sample_contract.primary_cohorts).toEqual({
      convergence: 8, residual: 68, decade_control: 30, zero_game_control: 14,
    });
    const cohorts: Record<string, number> = personStage.sample_contract.primary_cohorts;
    expect(Object.values(cohorts).reduce((a, b) => a + b, 0)).toBe(120);
    expect(personStage.sample_contract.control_ordering).toContain("sha256");
    expect(personStage.sample_contract.acquisition_ordering).toContain("slug");
  });

  it("recognises the AFL Tables vocabulary and keeps the www host a FINDING", () => {
    expect(personStage.afltables_link.hosts).toEqual(["afltables.com", "www.afltables.com"]);
    expect(personStage.afltables_link.schemes).toEqual(["http", "https"]);
    expect(personStage.afltables_link.path_shape).toBe("players/<A>/<Name>.html");
    expect(personStage.afltables_link.normalisation.strip_prefix_regex).toBe(AFLTABLES_STRIP);
    expect(personStage.afltables_link.normalisation.www_host_reduces).toBe(false);
    expect(personStage.afltables_link.normalisation.mirrors)
      .toContain("import_fitzroy_core.py");
    expect(personStage.afltables_link.identity_rule).toContain("NEVER inferred");
    expect(personStage.afltables_link.collision_rule).toContain("never an instruction to merge");
  });

  it("inherits the settled Stage A HTTP policy unchanged", () => {
    expect(contract.http_policy.min_delay_seconds).toBe(1.5);
    expect(contract.http_policy.timeout_seconds).toBe(20);
    expect(contract.http_policy.max_retries).toBe(3);
    expect(contract.http_policy.backoff_seconds).toEqual([2, 4, 8]);
    expect(contract.http_policy.concurrency).toBe(1);
    expect(contract.http_policy.redirects).toBe("same-host-only");
    expect(personStage.http_policy).toContain("inherits the Stage A http_policy");
    expect(personStage.http_policy).toContain("/players/*");
  });

  it("pins terminal-classification and resume semantics", () => {
    expect(personStage.terminal_classification.fetched).toContain("raw response file");
    expect(personStage.terminal_classification.failed).toContain("attempt evidence");
    expect(personStage.terminal_classification.resume).toContain("never silently retried");
  });
});

// ---------------------------------------------------------------------------
// Stage B1 sources (static pins)
// ---------------------------------------------------------------------------

describe("Stage B1 sources (static pins)", () => {
  it("acquisition and profiler carry zero legacy-store and zero application-database dependency", () => {
    for (const source of [personsAdapterSource, profilerSource]) {
      const lower = source.toLowerCase();
      for (const forbidden of [
        "afldb_legacy_sqlite", "sqlite", "connect_legacy",
        "psycopg", "database_url", "postgres", "psql",
        "afldb_test_pre_rebuild",
      ]) {
        expect(lower).not.toContain(forbidden);
      }
    }
  });

  it("no Stage B1 tool imports a database driver or a legacy embedded store", () => {
    const driverImport = /^\s*(?:import|from)\s+(sqlite3|psycopg[0-9a-z_]*|asyncpg|pg8000)\b/m;
    for (const source of [sampleToolSource, personsAdapterSource, profilerSource]) {
      expect(source).not.toMatch(driverImport);
    }
  });

  it("the sample freezer and the profiler import no network module at all", () => {
    const networkImport = /^\s*(?:import|from)\s+(urllib|socket|http\.client|requests|ssl|ftplib)\b/m;
    for (const source of [sampleToolSource, profilerSource]) {
      expect(source).not.toMatch(networkImport);
      expect(source).not.toContain("acquire_draft");   // never reachable, even transitively
    }
  });

  it("performs no destructive filesystem or data operation anywhere", () => {
    for (const source of [sampleToolSource, personsAdapterSource, profilerSource]) {
      for (const forbidden of [
        "DELETE", "TRUNCATE", "delete_missing", "rmtree", "os.remove", "unlink(",
      ]) {
        expect(source).not.toContain(forbidden);
      }
    }
  });

  it("mirrors normalise_profile_url() exactly — a www host does not reduce", () => {
    expect(fitzroySource).toContain(AFLTABLES_STRIP);
    expect(profilerSource).toContain(AFLTABLES_STRIP);
    expect(profilerSource).toContain('replace("../", "")');
    expect(profilerSource).toContain('lstrip("/")');
    // the mirror must not be quietly broadened to swallow the www. host
    expect(profilerSource).not.toContain("(www\\.)?afltables");
    expect(profilerSource).not.toContain("://(www.)?afltables");
  });

  it("the adapter writes the manifest LAST, after profiling and the terminal-count gate", () => {
    const iTerminalGate = personsAdapterSource.indexOf("terminal != requested");
    const iProfile = personsAdapterSource.indexOf("run_profile(");
    const iBuild = personsAdapterSource.indexOf("manifest = build_manifest(");
    const iWrite = personsAdapterSource.indexOf("atomic_write_json(manifest_path");
    expect(iTerminalGate).toBeGreaterThan(-1);
    expect(iProfile).toBeGreaterThan(iTerminalGate);
    expect(iBuild).toBeGreaterThan(iProfile);
    expect(iWrite).toBeGreaterThan(iBuild);
    expect(personsAdapterSource).toContain("already exists. Snapshots are immutable");
    expect(personsAdapterSource).toContain("appeared during the run");
    expect(personsAdapterSource).toContain('"manifest_written": False');
  });

  it("pins resume semantics: terminal states are reused, never silently retried", () => {
    expect(personsAdapterSource).toContain("never silently retried");
    expect(personsAdapterSource).toContain("terminal failure on record, reusing");
    expect(personsAdapterSource).toContain("already acquired (terminal), reusing");
    // raw bytes are written before the terminal record, so a crash resumes rather
    // than leaving a terminal record with no evidence
    expect(personsAdapterSource.indexOf("atomic_write_bytes(raw_path"))
      .toBeLessThan(personsAdapterSource.indexOf('record["terminal_classification"] = "fetched"'));
  });

  it("keeps a filename from ever becoming identity", () => {
    expect(personsAdapterSource).toContain("persons_index.json");
    expect(personsAdapterSource).toContain("never identity");
    expect(profilerSource).toContain("a filename is never identity, refusing");
    expect(personStage.person_snapshot.filename_rule).toContain("NEVER identity");
  });
});

// ---------------------------------------------------------------------------
// Sample freezer (spawned, synthetic Stage A snapshot)
// ---------------------------------------------------------------------------

describe("Stage B1 sample freezer", () => {
  itPy("freezes exactly 120 persons as 8 / 68 / 30 / 14, one primary cohort each", () => {
    const fixture = buildB1Fixture();
    const run = freezeSample(fixture);
    expect(run.stderr).toBe("");
    expect(run.status).toBe(0);

    const sample = readSample(fixture);
    expect(sample.counts.total).toBe(120);
    expect(sample.counts.by_primary_cohort).toEqual({
      convergence: 8, residual: 68, decade_control: 30, zero_game_control: 14,
    });
    expect(sample.persons).toHaveLength(120);
    expect(new Set(sample.selected_player_urls).size).toBe(120);

    for (const person of sample.persons) {
      expect(["convergence", "residual", "decade_control", "zero_game_control"])
        .toContain(person.primary_cohort);
      expect(typeof person.primary_cohort).toBe("string");   // exactly one, never a list
    }
    // six games-positive controls per decade, no shortfall anywhere
    const byDecade: Record<string, number> = {};
    for (const person of sample.persons.filter((p: any) => p.primary_cohort === "decade_control")) {
      byDecade[person.decade] = (byDecade[person.decade] ?? 0) + 1;
      expect(person.reported_games_basis.max_career_games).toBeGreaterThan(0);
    }
    expect(byDecade).toEqual({
      decade_1980s: 6, decade_1990s: 6, decade_2000s: 6, decade_2010s: 6, decade_2020s: 6,
    });
    for (const stratum of sample.selection.strata) expect(stratum.shortfall).toBe(0);
    for (const person of sample.persons.filter((p: any) => p.primary_cohort === "zero_game_control")) {
      expect(person.reported_games_basis.all_rows_zero).toBe(true);
    }
  });

  itPy("carries all eight convergence persons and both ordinals of every pair", () => {
    const fixture = buildB1Fixture();
    expect(freezeSample(fixture).status).toBe(0);
    const sample = readSample(fixture);
    const convergence = sample.persons
      .filter((p: any) => p.primary_cohort === "convergence")
      .map((p: any) => p.player_url).sort();
    expect(convergence).toEqual([...CONVERGENCE_URLS].sort());
    for (const slug of ["adam_houlihan", "andrew_hill", "brad_miller", "michael_brown"]) {
      const ordinals = sample.persons
        .filter((p: any) => p.slug === slug).map((p: any) => p.ordinal).sort();
      expect(ordinals).toEqual([1, 2]);
    }
  });

  itPy("is deterministic: a rebuild is byte-identical and --validate-only proves it", () => {
    const fixture = buildB1Fixture();
    expect(freezeSample(fixture).status).toBe(0);
    const first = readFileSync(join(fixture.personDir, "sample.json"));
    const second = freezeSample(fixture);
    expect(second.status).toBe(0);
    expect(readFileSync(join(fixture.personDir, "sample.json")).equals(first)).toBe(true);
    const validate = freezeSample(fixture, ["--validate-only"]);
    expect(validate.status).toBe(0);
    expect(validate.stdout).toContain("byte-identical");
    expect(sha256(first)).toMatch(/^[0-9a-f]{64}$/);
  });

  itPy("records the residual input evidence verbatim (lines, bytes, sha256)", () => {
    const fixture = buildB1Fixture();
    expect(freezeSample(fixture).status).toBe(0);
    const sample = readSample(fixture);
    expect(sample.residual_input.line_count).toBe(68);
    expect(sample.residual_input.bytes).toBe(fixture.residualBytes);
    expect(sample.residual_input.sha256).toBe(fixture.residualSha);
    expect(sample.residual_input.crlf_stripped_lines).toBe(0);
    expect(sample.stage_a_source.label).toBe(STAGE_A_FIXTURE_LABEL);
    expect(sample.stage_a_source.manifest_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(sample.identity_complete).toBe(false);
    expect(sample.import_capable).toBe(false);
  });

  itPy("tolerates CRLF from the query output and nothing else", () => {
    const crlf = buildB1Fixture({ residual: (urls) => `${urls.join("\r\n")}\r\n` });
    expect(freezeSample(crlf).status).toBe(0);
    const sample = readSample(crlf);
    expect(sample.residual_input.crlf_stripped_lines).toBe(68);
    expect(sample.counts.by_primary_cohort.residual).toBe(68);

    const padded = buildB1Fixture({ residual: (urls) => `${urls.map((u) => ` ${u}`).join("\n")}\n` });
    const run = freezeSample(padded);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("not a canonical player_url");
  });

  itPy("refuses a residual input that is short, blank-padded, duplicated or foreign", () => {
    const short = buildB1Fixture({ residual: (urls) => `${urls.slice(0, 67).join("\n")}\n` });
    const shortRun = freezeSample(short);
    expect(shortRun.status).toBe(1);
    expect(shortRun.stderr).toContain("67 non-empty lines, expected 68");

    const blank = buildB1Fixture({
      residual: (urls) => `${urls.slice(0, 30).join("\n")}\n\n${urls.slice(30).join("\n")}\n`,
    });
    const blankRun = freezeSample(blank);
    expect(blankRun.status).toBe(1);
    expect(blankRun.stderr).toContain("is empty");

    const duplicated = buildB1Fixture({
      residual: (urls) => `${[...urls.slice(0, 67), urls[0]].join("\n")}\n`,
    });
    const duplicateRun = freezeSample(duplicated);
    expect(duplicateRun.status).toBe(1);
    expect(duplicateRun.stderr).toContain("duplicate player_url");

    const foreign = buildB1Fixture({
      residual: (urls) => `${[...urls.slice(0, 67), `${BASE}/players/never_acquired/9`].join("\n")}\n`,
    });
    const foreignRun = freezeSample(foreign);
    expect(foreignRun.status).toBe(1);
    expect(foreignRun.stderr).toContain("absent byte-exactly from the accepted Stage A snapshot");
  });

  itPy("fails closed when the residual input hash or size drifts", () => {
    const fixture = buildB1Fixture();
    const wrongHash = runSampleTool([
      "--label", B1_LABEL, "--stage-a-label", STAGE_A_FIXTURE_LABEL,
      "--snapshot-root", fixture.snapRoot, "--manifest-dir", fixture.manifestDir,
      "--expect-residual-sha256", "0".repeat(64),
      "--expect-residual-bytes", `${fixture.residualBytes}`]);
    expect(wrongHash.status).toBe(1);
    expect(wrongHash.stderr).toContain("HALT finding");
    expect(existsSync(join(fixture.personDir, "sample.json"))).toBe(false);

    const wrongBytes = freezeSample(fixture, []);
    expect(wrongBytes.status).toBe(0);   // control: the correct pins still pass
  });

  itPy("round-trips percent-encoded identities without ever decoding them", () => {
    const fixture = buildB1Fixture();
    expect(freezeSample(fixture).status).toBe(0);
    const sample = readSample(fixture);
    const raw = readFileSync(join(fixture.personDir, "sample.json"), "utf8");
    for (const encoded of [`${BASE}/players/alex_van%20wyk/1`, `${BASE}/players/ciar%C3%A1n_byrne/1`]) {
      expect(sample.selected_player_urls).toContain(encoded);
      expect(raw).toContain(encoded);
    }
    expect(raw).not.toContain("alex_van wyk");
    expect(raw).not.toContain("ciarán_byrne");
    const person = sample.persons.find((p: any) => p.slug === "alex_van%20wyk");
    expect(person.player_url).toBe(`${BASE}/players/alex_van%20wyk/1`);
    expect(person.primary_cohort).toBe("residual");
  });

  itPy("refuses a Stage A label and writes nothing", () => {
    const fixture = buildB1Fixture();
    const run = runSampleTool([
      "--label", "annual-html-20260826",
      "--stage-a-label", STAGE_A_FIXTURE_LABEL,
      "--snapshot-root", fixture.snapRoot, "--manifest-dir", fixture.manifestDir,
      "--expect-residual-sha256", fixture.residualSha,
      "--expect-residual-bytes", `${fixture.residualBytes}`]);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("ANNUAL Stage A snapshot label");
    expect(readdirSync(fixture.snapRoot).sort())
      .toEqual([STAGE_A_FIXTURE_LABEL, B1_LABEL].sort());
    expect(existsSync(join(fixture.stageADir, "sample.json"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Person acquisition adapter (offline paths only — no page is fetched here)
// ---------------------------------------------------------------------------

describe("Stage B1 person adapter (offline paths)", () => {
  itPy("aborts on an existing manifest label before touching anything", () => {
    const fixture = buildB1Fixture();
    expect(freezeSample(fixture).status).toBe(0);
    const manifestDir = mkdtempSync(join(tmpdir(), "draftguru-b1-manifest-"));
    writeFileSync(join(manifestDir, `${B1_LABEL}.json`), "{}\n", "utf8");
    const run = runPersons([
      "--label", B1_LABEL, "--snapshot-root", fixture.snapRoot,
      "--manifest-dir", manifestDir, "--no-fetch"]);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("already exists. Snapshots are immutable");
    expect(existsSync(join(fixture.personDir, "http", "persons"))).toBe(false);
  });

  itPy("refuses a Stage A label", () => {
    const fixture = buildB1Fixture();
    const manifestDir = mkdtempSync(join(tmpdir(), "draftguru-b1-manifest-"));
    const run = runPersons([
      "--label", "annual-html-20260826", "--snapshot-root", fixture.snapRoot,
      "--manifest-dir", manifestDir, "--no-fetch"]);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("ANNUAL Stage A snapshot label");
    expect(readdirSync(manifestDir)).toEqual([]);
  });

  itPy("plans acquisition deterministically by slug then ordinal, with storage-only names", () => {
    const fixture = buildB1Fixture();
    expect(freezeSample(fixture).status).toBe(0);
    const run = runPersons([
      "--label", B1_LABEL, "--snapshot-root", fixture.snapRoot,
      "--manifest-dir", fixture.manifestDir, "--plan"]);
    expect(run.status).toBe(0);
    const plan = JSON.parse(run.stdout);
    expect(plan.manifest_written).toBe(false);
    expect(plan.requested).toBe(120);
    // A space sorts below every character the slug charset allows, so JS string order
    // here matches Python's (slug, ordinal) tuple order exactly.
    const keys = plan.entries.map((e: any) => `${e.slug} ${String(e.ordinal).padStart(4, "0")}`);
    expect(keys).toEqual([...keys].sort());
    const brad = plan.entries.filter((e: any) => e.slug === "brad_miller");
    expect(brad.map((e: any) => e.raw_filename))
      .toEqual(["raw/persons/brad_miller__1.html", "raw/persons/brad_miller__2.html"]);
    const encoded = plan.entries.find((e: any) => e.slug === "alex_van%20wyk");
    expect(encoded.player_url).toBe(`${BASE}/players/alex_van%20wyk/1`);
    expect(encoded.raw_filename).toBe("raw/persons/alex_van%20wyk__1.html");
  });

  itPy("refuses a probe target that is not in the frozen sample", () => {
    const fixture = buildB1Fixture();
    expect(freezeSample(fixture).status).toBe(0);
    const run = runPersons([
      "--label", B1_LABEL, "--snapshot-root", fixture.snapRoot,
      "--manifest-dir", fixture.manifestDir, "--no-fetch",
      "--probe", `${BASE}/players/not_sampled/1`]);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("not in the frozen sample");
  });
});

// ---------------------------------------------------------------------------
// Offline profiler — synthetic pages, parser mechanics only
// ---------------------------------------------------------------------------

describe("Stage B1 person profiler (synthetic pages)", () => {
  function profiledFixture(): { fixture: B1Fixture; records: Record<string, any>; summary: any } {
    const fixture = buildB1Fixture();
    expect(freezeSample(fixture).status).toBe(0);
    const dir = fixture.personDir;
    seedPerson(dir, "brad_miller", 1, {
      html: synthPage("Brad Miller",
        ["http://afltables.com/afl/stats/players/B/Brad_Miller.html"]),
    });
    seedPerson(dir, "brad_miller", 2, {
      html: synthPage("Brad Miller",
        ["http://afltables.com/afl/stats/players/B/Brad_Miller1.html"]),
    });
    seedPerson(dir, "adam_houlihan", 1, {
      html: synthPage("Adam Houlihan",
        ["https://www.afltables.com/afl/stats/players/A/Adam_Houlihan.html"]),
    });
    seedPerson(dir, "andrew_hill", 1, {
      html: synthPage("Andrew Hill", ["https://en.wikipedia.org/wiki/Andrew_Hill"]),
    });
    seedPerson(dir, "michael_brown", 1, {
      html: synthPage("Michael Brown", [
        "http://afltables.com/afl/stats/players/M/Michael_Brown.html",
        "http://afltables.com/afl/stats/players/M/Michael_Brown1.html",
      ]),
    });
    seedPerson(dir, "alex_van%20wyk", 1, {
      html: synthPage("Alex van Wyk",
        ["http://afltables.com/afl/stats/players/B/Brad_Miller.html"]),
    });
    seedPerson(dir, "ciar%C3%A1n_byrne", 1, {
      failure: { status: 404, reason: "HTTP Error 404: Not Found" },
    });
    const run = runProfiler([
      "--label", B1_LABEL, "--snapshot-root", fixture.snapRoot]);
    expect(run.stderr).toBe("");
    expect(run.status).toBe(0);
    const summary = JSON.parse(readFileSync(
      join(dir, "parsed", "afltables_link_profile.json"), "utf8"));
    return { fixture, records: readProfileRecords(dir), summary };
  }

  itPy("extracts an AFL Tables identity from the href alone and reduces it canonically", () => {
    const { records } = profiledFixture();
    const brad = records[`${BASE}/players/brad_miller/1`];
    expect(brad.afltables_identity).toBe("players/B/Brad_Miller.html");
    expect(brad.afltables_href_count).toBe(1);
    expect(brad.afltables_hrefs[0].href)
      .toBe("http://afltables.com/afl/stats/players/B/Brad_Miller.html");
    expect(brad.afltables_hrefs[0].classification).toBe("canonical");
    expect(brad.flags.no_afltables_link).toBe(false);
    expect(brad.page.h1).toBe("Brad Miller");
  });

  itPy("treats a www host that does not reduce as a FINDING, never a silent repair", () => {
    const { records, summary } = profiledFixture();
    const adam = records[`${BASE}/players/adam_houlihan/1`];
    expect(adam.afltables_href_count).toBe(1);
    expect(adam.afltables_hrefs[0].classification).toBe("non_reducing_host");
    expect(adam.afltables_hrefs[0].reason).toContain("FINDING");
    expect(adam.afltables_identity).toBeNull();
    expect(adam.flags.non_reducing_host).toBe(true);
    expect(summary.counts.non_reducing_host).toBe(1);
  });

  itPy("classifies a page with no AFL Tables link, and never infers identity from a name", () => {
    const { records } = profiledFixture();
    const hill = records[`${BASE}/players/andrew_hill/1`];
    expect(hill.afltables_href_count).toBe(0);
    expect(hill.flags.no_afltables_link).toBe(true);
    expect(hill.afltables_identity).toBeNull();
    expect(hill.page.h1).toBe("Andrew Hill");            // name is present…
    expect(hill.afltables_identity_reason).toContain("no AFL Tables href");  // …and unused
    expect(hill.external_vocabulary.map((v: any) => v.host)).toContain("en.wikipedia.org");
  });

  itPy("refuses to choose between multiple AFL Tables candidates on one page", () => {
    const { records, summary } = profiledFixture();
    const brown = records[`${BASE}/players/michael_brown/1`];
    expect(brown.distinct_afltables_identity_count).toBe(2);
    expect(brown.afltables_identity).toBeNull();
    expect(brown.flags.multiple_afltables_candidates).toBe(true);
    expect(brown.afltables_identity_reason).toContain("ambiguous");
    expect(summary.counts.multiple_candidates).toBe(1);
  });

  itPy("reports a two-persons-one-profile collision as a finding, never a merge", () => {
    const { summary } = profiledFixture();
    expect(summary.collisions).toHaveLength(1);
    expect(summary.collisions[0].afltables_identity).toBe("players/B/Brad_Miller.html");
    expect(summary.collisions[0].player_urls).toEqual([
      `${BASE}/players/alex_van%20wyk/1`, `${BASE}/players/brad_miller/1`,
    ]);
    expect(JSON.stringify(summary.collisions[0])).toContain("never an instruction to merge");
  });

  itPy("answers the convergence-pair question per pair", () => {
    const { summary } = profiledFixture();
    const brad = summary.convergence_pairs.find((p: any) => p.slug === "brad_miller");
    expect(brad.both_resolved).toBe(true);
    expect(brad.distinct_identities).toBe(true);
    expect(brad.members.map((m: any) => m.afltables_identity))
      .toEqual(["players/B/Brad_Miller.html", "players/B/Brad_Miller1.html"]);
  });

  itPy("keeps a terminal failure profiled as a missing page, not as an absent link", () => {
    const { records, summary } = profiledFixture();
    const failed = records[`${BASE}/players/ciar%C3%A1n_byrne/1`];
    expect(failed.terminal_classification).toBe("failed");
    expect(failed.profiled).toBe(false);
    expect(failed.flags.missing_or_dead_page).toBe(true);
    expect(failed.http_status).toBe(404);
    expect(summary.counts.failed).toBe(1);
    expect(summary.failures[0].player_url).toBe(`${BASE}/players/ciar%C3%A1n_byrne/1`);
  });

  itPy("declares itself profiling-only in the aggregate output", () => {
    const { summary } = profiledFixture();
    expect(summary.stage).toBe("B1");
    expect(summary.identity_complete).toBe(false);
    expect(summary.import_capable).toBe(false);
    // seven identities are seeded here, so coverage is reported over what was profiled
    expect(summary.counts.requested).toBe(7);
    expect(Object.keys(summary.coverage.by_primary_cohort).sort())
      .toEqual(["convergence", "decade_control", "residual", "zero_game_control"]);
    expect(summary.coverage.by_primary_cohort.convergence.persons).toBe(5);
    expect(summary.coverage.by_primary_cohort.residual.persons).toBe(2);
    // the sample basis it was drawn from is still the full frozen 120
    expect(summary.sample_basis.total).toBe(120);
    expect(summary.sample_basis.by_primary_cohort.residual).toBe(68);
    expect(Object.keys(summary.url_form_vocabulary).join(" ")).toContain("afltables.com");
  });

  itPy("refuses to profile an incomplete experiment as complete", () => {
    const { fixture } = profiledFixture();
    const run = runProfiler([
      "--label", B1_LABEL, "--snapshot-root", fixture.snapRoot, "--require-complete"]);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("no terminal classification");
  });
});

// ---------------------------------------------------------------------------
// Completion, manifest and resume semantics (offline, fully-classified snapshot)
// ---------------------------------------------------------------------------

describe("Stage B1 completion and manifest semantics", () => {
  /** Seed every sampled identity terminally: 2 terminal failures, the rest fetched. */
  function completeSnapshot(): { fixture: B1Fixture; sample: any; failures: string[] } {
    const fixture = buildB1Fixture();
    expect(freezeSample(fixture).status).toBe(0);
    const sample = readSample(fixture);
    mkdirSync(join(fixture.personDir, "http"), { recursive: true });
    writeFileSync(join(fixture.personDir, "http", "robots_txt.json"), `${JSON.stringify({
      url: `${BASE}/robots.txt`, http_status: 200, sha256: "b".repeat(64),
    }, null, 2)}\n`, "utf8");
    const failures: string[] = [];
    sample.persons.forEach((person: any, index: number) => {
      if (index < 2) {
        failures.push(seedPerson(fixture.personDir, person.slug, person.ordinal, {
          failure: { status: 404, reason: "SEEDED terminal failure — must be reused verbatim" },
        }));
      } else {
        seedPerson(fixture.personDir, person.slug, person.ordinal, {
          html: synthPage("Synthetic Person",
            [`http://afltables.com/afl/stats/players/S/Synthetic_${index}.html`]),
        });
      }
    });
    return { fixture, sample, failures };
  }

  itPy("completes with fetched + failed = 120 (failed > 0) and writes the manifest LAST", () => {
    const { fixture, failures } = completeSnapshot();
    const manifestDir = mkdtempSync(join(tmpdir(), "draftguru-b1-manifest-"));
    const run = runPersons([
      "--label", B1_LABEL, "--snapshot-root", fixture.snapRoot,
      "--manifest-dir", manifestDir, "--no-fetch"]);
    expect(run.status).toBe(0);

    const manifestPath = join(manifestDir, `${B1_LABEL}.json`);
    expect(existsSync(manifestPath)).toBe(true);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    expect(manifest.identity_complete).toBe(false);
    expect(manifest.import_capable).toBe(false);
    expect(manifest.person_pages.stage).toBe("B1");
    expect(manifest.person_pages.requested).toBe(120);
    expect(manifest.person_pages.fetched).toBe(118);
    expect(manifest.person_pages.failed).toHaveLength(2);
    expect(manifest.person_pages.failed.map((f: any) => f.player_url).sort())
      .toEqual([...failures].sort());
    expect(manifest.person_pages.fetched + manifest.person_pages.failed.length).toBe(120);
    expect(manifest.sample_basis.by_primary_cohort)
      .toEqual({ convergence: 8, residual: 68, decade_control: 30, zero_game_control: 14 });
    expect(manifest.afltables_link_profile.counts.requested).toBe(120);
    expect(manifest.parsed_outputs.person_profile.records).toBe(120);
    // the manifest is written only after both profiler artifacts exist
    expect(existsSync(join(fixture.personDir, "parsed", "person_profile.jsonl"))).toBe(true);
    expect(existsSync(join(fixture.personDir, "parsed", "afltables_link_profile.json"))).toBe(true);
  });

  itPy("writes NO manifest when fetched + failed < 120", () => {
    const { fixture, sample } = completeSnapshot();
    const victim = sample.persons[5];
    rmSync(join(fixture.personDir, "http", "persons", `${victim.slug}__${victim.ordinal}.json`));
    const manifestDir = mkdtempSync(join(tmpdir(), "draftguru-b1-manifest-"));
    const run = runPersons([
      "--label", B1_LABEL, "--snapshot-root", fixture.snapRoot,
      "--manifest-dir", manifestDir, "--no-fetch"]);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("NO manifest was written");
    expect(readdirSync(manifestDir)).toEqual([]);
    // artifacts are retained for resume, never cleaned up
    expect(existsSync(join(fixture.personDir, "raw", "persons"))).toBe(true);
  });

  itPy("reuses terminal successes and terminal failures byte-for-byte on resume", () => {
    const { fixture, sample } = completeSnapshot();
    const fetchedPerson = sample.persons[10];
    const failedPerson = sample.persons[0];
    const rawPath = join(fixture.personDir, "raw", "persons",
      `${fetchedPerson.slug}__${fetchedPerson.ordinal}.html`);
    const failedPath = join(fixture.personDir, "http", "persons",
      `${failedPerson.slug}__${failedPerson.ordinal}.json`);
    const rawBefore = readFileSync(rawPath);
    const failedBefore = readFileSync(failedPath);

    const manifestDir = mkdtempSync(join(tmpdir(), "draftguru-b1-manifest-"));
    const run = runPersons([
      "--label", B1_LABEL, "--snapshot-root", fixture.snapRoot,
      "--manifest-dir", manifestDir, "--no-fetch"]);
    expect(run.status).toBe(0);
    expect(run.stdout + run.stderr).not.toContain("Traceback");

    expect(readFileSync(rawPath).equals(rawBefore)).toBe(true);
    expect(readFileSync(failedPath).equals(failedBefore)).toBe(true);
    const failedRecord = JSON.parse(failedBefore.toString("utf8"));
    expect(failedRecord.reason).toContain("SEEDED terminal failure");
    expect(failedRecord.terminal_classification).toBe("failed");
  });

  itPy("probe mode acquires nothing beyond its targets and writes no manifest", () => {
    const { fixture } = completeSnapshot();
    const manifestDir = mkdtempSync(join(tmpdir(), "draftguru-b1-manifest-"));
    const run = runPersons([
      "--label", B1_LABEL, "--snapshot-root", fixture.snapRoot,
      "--manifest-dir", manifestDir, "--no-fetch",
      "--probe", `${BASE}/players/brad_miller/1`,
      "--probe", `${BASE}/players/brad_miller/2`]);
    expect(run.status).toBe(0);
    const summary = JSON.parse(run.stdout);
    expect(summary.mode).toBe("probe");
    expect(summary.manifest_written).toBe(false);
    expect(summary.requested).toEqual([
      `${BASE}/players/brad_miller/1`, `${BASE}/players/brad_miller/2`]);
    expect(readdirSync(manifestDir)).toEqual([]);
  });

  itPy("maps every stored filename back to its exact player_url", () => {
    const { fixture } = completeSnapshot();
    const manifestDir = mkdtempSync(join(tmpdir(), "draftguru-b1-manifest-"));
    expect(runPersons([
      "--label", B1_LABEL, "--snapshot-root", fixture.snapRoot,
      "--manifest-dir", manifestDir, "--no-fetch"]).status).toBe(0);
    const index = JSON.parse(readFileSync(
      join(fixture.personDir, "http", "persons_index.json"), "utf8"));
    expect(index.entries).toHaveLength(120);
    const encoded = index.entries.find((e: any) => e.slug === "alex_van%20wyk");
    expect(encoded.player_url).toBe(`${BASE}/players/alex_van%20wyk/1`);
    expect(encoded.raw_filename).toBe("raw/persons/alex_van%20wyk__1.html");
    expect(encoded.terminal_classification).toBe("fetched");
    for (const entry of index.entries) {
      expect(entry.player_url.startsWith(`${BASE}/players/`)).toBe(true);
      expect(entry.raw_filename).toBe(`raw/persons/${entry.slug}__${entry.ordinal}.html`);
    }
  });
});

// ---------------------------------------------------------------------------
// The real frozen Stage B1 sample (local snapshot only; gitignored data)
// ---------------------------------------------------------------------------

describe("frozen Stage B1 sample (local snapshot)", () => {
  const frozenDir = join(root, "data", "sources", "draftguru", "person-html-20260826");
  const frozenSample = join(frozenDir, "sample.json");
  const itFrozen = canSpawn && existsSync(frozenSample) ? it : it.skip;

  itFrozen("rebuilds byte-identically from the accepted Stage A snapshot", () => {
    const run = runSampleTool(["--label", "person-html-20260826", "--validate-only"]);
    expect(run.status).toBe(0);
    expect(run.stdout).toContain("byte-identical");
  });

  itFrozen("is the frozen 120 / 8 / 68 / 30 / 14 contract over the accepted Stage A label", () => {
    const sample = JSON.parse(readFileSync(frozenSample, "utf8"));
    expect(sample.counts.total).toBe(120);
    expect(sample.counts.by_primary_cohort).toEqual({
      convergence: 8, residual: 68, decade_control: 30, zero_game_control: 14,
    });
    expect(sample.stage_a_source.label).toBe("annual-html-20260826");
    expect(sample.stage_a_source.distinct_person_count).toBe(5057);
    expect(sample.stage_a_source.row_count).toBe(6810);
    expect(sample.residual_input.line_count).toBe(68);
    expect(sample.residual_input.bytes).toBe(3580);
    expect(sample.residual_input.sha256)
      .toBe("df6c9a7559bceb649e8e28e457fbe91d3351d8c1737a9042f233b1f1e3c5e841");
    for (const url of CONVERGENCE_URLS) expect(sample.selected_player_urls).toContain(url);
  });

  it("can never publish an importable Stage B1 manifest", () => {
    // Absent until the full 120-identity run completes; once present it must still
    // declare itself profiling-only. Both states are asserted, so this pin survives
    // the real run instead of pinning "not yet acquired".
    const manifestPath = join(root, "docs", "rebuild-manifests", "draftguru",
      "person-html-20260826.json");
    if (!existsSync(manifestPath)) return;
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    expect(manifest.snapshot_label).toBe("person-html-20260826");
    expect(manifest.stage).toBe("B1");
    expect(manifest.identity_complete).toBe(false);
    expect(manifest.import_capable).toBe(false);
    expect(manifest.person_pages.fetched + manifest.person_pages.failed.length).toBe(120);
  });
});

// ---------------------------------------------------------------------------
// Trimmed REAL-SOURCE person fixtures (2026-08-26 two-page probe)
//
// Unlike the synthetic pages above, these are verbatim excerpts of bytes actually
// acquired from DraftGuru. They pin the real page shape: no <h1>, the display name
// in <h2 class="heading">, one bare-host http AFL Tables href on /1, none at all on
// /2, sibling Footywire/Wikipedia links, and statistics tables around them.
// ---------------------------------------------------------------------------

describe("Stage B1 real-source person fixtures", () => {
  const realOne = join(fixtureDir, "person_brad_miller_1_real_excerpt.html");
  const realTwo = join(fixtureDir, "person_brad_miller_2_real_excerpt.html");
  const realOneHtml = readFileSync(realOne, "utf8");
  const realTwoHtml = readFileSync(realTwo, "utf8");
  const OBSERVED_HREF = "http://afltables.com/afl/stats/players/B/Brad_Miller.html";
  const OBSERVED_HEADING = '<h2 class="heading">Brad Miller</h2>';

  function profiledRealPages(): { records: Record<string, any>; summary: any } {
    const fixture = buildB1Fixture();
    expect(freezeSample(fixture).status).toBe(0);
    seedPerson(fixture.personDir, "brad_miller", 1, { html: realOneHtml });
    seedPerson(fixture.personDir, "brad_miller", 2, { html: realTwoHtml });
    const run = runProfiler(["--label", B1_LABEL, "--snapshot-root", fixture.snapRoot]);
    expect(run.stderr).toBe("");
    expect(run.status).toBe(0);
    return {
      records: readProfileRecords(fixture.personDir),
      summary: JSON.parse(readFileSync(
        join(fixture.personDir, "parsed", "afltables_link_profile.json"), "utf8")),
    };
  }

  it("are labelled real-source, carry provenance, and stay distinct from synthetic ones", () => {
    for (const html of [realOneHtml, realTwoHtml]) {
      expect(html).toContain("TRIMMED REAL-SOURCE FIXTURE (not synthetic)");
      expect(html).toContain("person-html-20260826");
      expect(html).toMatch(/sha256\s+[0-9a-f]{64}/);
      expect(html).toContain("Nothing here is invented");
      expect(html).not.toContain("SYNTHETIC fixture");
    }
    // the synthetic generator stays explicitly labelled synthetic
    expect(SYNTHETIC_BANNER).toContain("SYNTHETIC fixture");
    expect(synthPage("X", [])).not.toContain("REAL-SOURCE");
  });

  it("pin the observed structure exactly: h2 heading, no h1, one href on /1 and none on /2", () => {
    // the provenance comment DESCRIBES the markup, so structural claims are made
    // against the fixture body alone
    const stripComments = (html: string) => html.replace(/<!--[\s\S]*?-->/g, "");
    const bodyOne = stripComments(realOneHtml);
    const bodyTwo = stripComments(realTwoHtml);
    expect(bodyOne).toContain(OBSERVED_HEADING);
    expect(bodyTwo).toContain(OBSERVED_HEADING);
    expect(bodyOne).not.toMatch(/<h1\b/);
    expect(bodyTwo).not.toMatch(/<h1\b/);
    expect(bodyOne).toContain(`<a href="${OBSERVED_HREF}">AFL Tables</a>`);
    expect(bodyOne).toContain("http://www.footywire.com/afl/footy/pp-richmond-tigers--brad-miller");
    expect(bodyOne).toContain("http://en.wikipedia.org/wiki/Brad_Miller_(footballer)");
    expect(bodyTwo.toLowerCase()).not.toContain("afltables");
    // statistics-table structure is present in both, around the links
    for (const html of [bodyOne, bodyTwo]) {
      expect(html).toContain('<table class="general individual-player">');
      expect((html.match(/<th\b/g) ?? []).length).toBeGreaterThanOrEqual(9);
      expect((html.match(/<td\b/g) ?? []).length).toBeGreaterThanOrEqual(9);
    }
  });

  itPy("extracts the one real AFL Tables identity from the href, not from the name", () => {
    const { records } = profiledRealPages();
    const one = records[`${BASE}/players/brad_miller/1`];
    expect(one.afltables_href_count).toBe(1);
    expect(one.afltables_hrefs[0].href).toBe(OBSERVED_HREF);   // verbatim, bare host, http
    expect(one.afltables_hrefs[0].classification).toBe("canonical");
    expect(one.afltables_hrefs[0].anchor_text).toBe("AFL Tables");
    expect(one.afltables_identity).toBe("players/B/Brad_Miller.html");
    expect(one.flags.no_afltables_link).toBe(false);
    expect(one.flags.multiple_afltables_candidates).toBe(false);
    expect(one.flags.non_reducing_host).toBe(false);
    expect(one.flags.malformed_afltables_link).toBe(false);
    expect(one.flags.parse_error).toBe(false);
  });

  itPy("reads the real display name from <h2> with no <h1>, as evidence only", () => {
    const { records } = profiledRealPages();
    const one = records[`${BASE}/players/brad_miller/1`];
    const two = records[`${BASE}/players/brad_miller/2`];
    expect(one.page.h1).toBeNull();
    expect(one.page.h2).toBe("Brad Miller");
    expect(one.page.display_name_evidence.h2).toBe("Brad Miller");
    expect(one.page.display_name_evidence.$note).toContain("NEVER used for identity");
    expect(one.page.title).toBe("Brad Miller (born 1983) - Draftguru");
    expect(two.page.title).toBe("Brad Miller (number 2) - Draftguru");
    // identical rendered names, and the identity outcome still differs
    expect(one.page.h2).toBe(two.page.h2);
    expect(one.afltables_identity).not.toBe(two.afltables_identity);
  });

  itPy("classifies the real /2 page as no_afltables_link despite its statistics tables", () => {
    const { records } = profiledRealPages();
    const two = records[`${BASE}/players/brad_miller/2`];
    expect(two.afltables_href_count).toBe(0);
    expect(two.afltables_identity).toBeNull();
    expect(two.flags.no_afltables_link).toBe(true);
    expect(two.flags.parse_error).toBe(false);
    expect(two.afltables_identity_reason).toContain("no AFL Tables href");
    expect(two.page.visible_text_length).toBeGreaterThan(0);
    expect(two.external_vocabulary).toEqual([]);
  });

  itPy("records Footywire and Wikipedia as vocabulary only, never as identity", () => {
    const { records, summary } = profiledRealPages();
    const one = records[`${BASE}/players/brad_miller/1`];
    const hosts = one.external_vocabulary.map((v: any) => v.host).sort();
    expect(hosts).toEqual(["en.wikipedia.org", "www.footywire.com"]);
    const footywire = one.external_vocabulary.find((v: any) => v.host === "www.footywire.com");
    expect(footywire.recognised_vocabulary).toBe(false);
    expect(footywire.$note).toContain("never an identity source");
    expect(one.external_vocabulary.find((v: any) => v.host === "en.wikipedia.org")
      .recognised_vocabulary).toBe(true);
    // the AFL Tables link is an identity candidate, never vocabulary
    expect(hosts).not.toContain("afltables.com");
    expect(one.afltables_identity).toBe("players/B/Brad_Miller.html");
    expect(summary.external_vocabulary_hosts_outside_contract).toContain("www.footywire.com");
    expect(summary.$external_vocabulary_note).toContain("measurement only");
  });

  itPy("answers the real convergence pair honestly: one bridge, one absence, no collision", () => {
    const { summary } = profiledRealPages();
    expect(summary.counts.requested).toBe(2);
    expect(summary.counts.fetched).toBe(2);
    expect(summary.counts.with_afltables_identity).toBe(1);
    expect(summary.counts.without_afltables_link).toBe(1);
    expect(summary.collisions).toEqual([]);
    const pair = summary.convergence_pairs.find((p: any) => p.slug === "brad_miller");
    expect(pair.both_resolved).toBe(false);
    expect(pair.distinct_identities).toBeNull();   // unanswerable, never guessed
    expect(pair.members.map((m: any) => m.afltables_identity))
      .toEqual(["players/B/Brad_Miller.html", null]);
  });

  it("are faithful excerpts of the acquired bytes (local snapshot only)", () => {
    const rawDir = join(root, "data", "sources", "draftguru", "person-html-20260826",
      "raw", "persons");
    const rawOne = join(rawDir, "brad_miller__1.html");
    const rawTwo = join(rawDir, "brad_miller__2.html");
    if (!existsSync(rawOne) || !existsSync(rawTwo)) return;   // gitignored snapshot
    const acquiredOne = readFileSync(rawOne, "utf8");
    const acquiredTwo = readFileSync(rawTwo, "utf8");
    // nothing was invented: the pinned markup exists byte-for-byte in the real pages
    expect(acquiredOne).toContain(`<a href="${OBSERVED_HREF}">AFL Tables</a>`);
    expect(acquiredOne).toContain(OBSERVED_HEADING);
    expect(acquiredTwo).toContain(OBSERVED_HEADING);
    expect(acquiredOne).toContain("<title>Brad Miller (born 1983) - Draftguru</title>");
    expect(acquiredTwo).toContain("<title>Brad Miller (number 2) - Draftguru</title>");
    expect(acquiredTwo.toLowerCase()).not.toContain("afltables");
    expect(acquiredOne).not.toMatch(/<h1\b/);
    expect(acquiredTwo).not.toMatch(/<h1\b/);
    // and the fixtures really are trimmed, not copies
    expect(realOneHtml.length).toBeLessThan(acquiredOne.length);
    expect(realTwoHtml.length).toBeLessThan(acquiredTwo.length);
  });
});

/*
 * AFLDB-ISSUE-093 Stage B2-2 — the event-kind mapping contract.
 *
 * data/reference/draftguru-event-kinds.json is the ONE authoritative mapping from
 * the accepted Stage A source label to draft_picks.draft_type/draft_kind. These
 * tests freeze it: they reconcile its counts to the accepted 6,810-row Stage A
 * population, hold its vocabulary set-equal to the application's own
 * GRID_DRAFT_TYPES/GRID_SIGNING_KINDS so the two can never drift apart, and pin
 * the properties that make the mapping fail closed.
 *
 * No network, no database. The rows.jsonl assertions are skipped when the
 * gitignored Stage A snapshot is not present locally.
 */
describe("Stage B2-2 event-kind mapping contract", () => {
  const eventKindsPath = join(root, "data", "reference", "draftguru-event-kinds.json");
  const eventKinds = JSON.parse(readFileSync(eventKindsPath, "utf8"));
  const stageARowsPath = join(root, "data", "sources", "draftguru", "annual-html-20260826",
    "parsed", "rows.jsonl");

  function stageAEventCounts(): Map<string | null, number> | null {
    if (!existsSync(stageARowsPath)) return null;   // gitignored snapshot
    const counts = new Map<string | null, number>();
    for (const line of readFileSync(stageARowsPath, "utf8").split("\n")) {
      if (!line.trim()) continue;
      const key = JSON.parse(line).event_type_raw ?? null;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }

  it("reconciles to the accepted Stage A population exactly", () => {
    const labelled = eventKinds.events
      .reduce((sum: number, e: any) => sum + e.stage_a_rows, 0);
    expect(labelled).toBe(eventKinds.totals.labelled_rows);
    expect(eventKinds.absent_column.stage_a_rows).toBe(eventKinds.totals.absent_column_rows);
    expect(labelled + eventKinds.absent_column.stage_a_rows).toBe(6810);
    expect(eventKinds.totals.total_rows).toBe(6810);
    expect(eventKinds.evidence.total_rows).toBe(6810);

    const byYear = eventKinds.absent_column.rows_by_year;
    expect(byYear["1981"] + byYear["1982"] + byYear["1987"]).toBe(113);
    expect(eventKinds.absent_column.years).toEqual([1981, 1982, 1987]);
  });

  it("classifies every observed Stage A label, with nothing left over", () => {
    const counts = stageAEventCounts();
    if (!counts) return;

    const mapped = new Map<string | null, any>(
      eventKinds.events.map((e: any) => [e.event_type_raw, e]),
    );
    mapped.set(null, eventKinds.absent_column);

    // every observed label is mapped, and every mapped label was observed
    expect([...counts.keys()].filter((k) => !mapped.has(k))).toEqual([]);
    expect([...mapped.keys()].filter((k) => !counts.has(k))).toEqual([]);

    // and the pinned counts are the measured ones, not approximations
    for (const [label, n] of counts) {
      expect(mapped.get(label).stage_a_rows).toBe(n);
    }
    expect([...counts.values()].reduce((a, b) => a + b, 0)).toBe(6810);
  });

  it("treats the missing Draft column as null, never as a sentinel string", () => {
    const counts = stageAEventCounts();
    if (!counts) return;
    // the source really does store JSON null, not "__no_draft_column__"
    expect(counts.get(null)).toBe(113);
    for (const key of counts.keys()) {
      if (key === null) continue;
      expect(key).not.toMatch(/__|unknown|missing|none/i);
    }
    // and the contract file never invents one either
    expect(eventKinds.absent_column.event_type_raw).toBeNull();
    expect(JSON.stringify(eventKinds.events)).not.toMatch(/__no_draft_column__/);
  });

  it("maps the absent Draft column to National Draft/national", () => {
    expect(eventKinds.absent_column.draft_type).toBe("National Draft");
    expect(eventKinds.absent_column.draft_kind).toBe("national");
  });

  it("keeps the label byte-exact: no trimming, folding or case collapse", () => {
    expect(eventKinds.matching.comparison).toBe("exact");
    expect(eventKinds.matching.trim).toBe(false);
    expect(eventKinds.matching.case_fold).toBe(false);
    expect(eventKinds.matching.unicode_fold).toBe(false);

    const counts = stageAEventCounts();
    if (!counts) return;
    const labels = [...counts.keys()].filter((k): k is string => k !== null);
    for (const label of labels) {
      expect(label).toBe(label.trim());
      expect(label).not.toBe("");
      expect(label).not.toContain(NBSP);
      expect(label).not.toContain(ZWSP);
    }
    // no two labels differ only by case
    expect(new Set(labels.map((l) => l.toLowerCase())).size).toBe(labels.length);
  });

  it("fails closed on an unseen label rather than deriving a kind for it", () => {
    expect(eventKinds.unknown_label_policy.on_unknown_event_type_raw).toBe("HALT");
    expect(eventKinds.unknown_label_policy.auto_derive_new_kinds).toBe(false);
    expect(eventKinds.unknown_label_policy.accept_case_or_whitespace_variants).toBe(false);
  });

  it("cannot be replaced by a mechanical draft_type -> draft_kind rule", () => {
    // The whole reason this file is an enumeration: a lowercase-and-underscore
    // rule disagrees with the stored vocabulary, and would break migration 069's
    // reload key silently.
    const mechanical = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, "_");
    const disagreements = eventKinds.events
      .filter((e: any) => mechanical(e.draft_type) !== e.draft_kind)
      .map((e: any) => e.draft_type);
    expect(disagreements).toContain("Pre-Season");
    expect(disagreements).toContain("Mid-Season");
    for (const c of eventKinds.draft_kind_is_not_derivable.counter_examples) {
      expect(mechanical(c.draft_type)).toBe(c.mechanical_rule_would_give);
      expect(mechanical(c.draft_type)).not.toBe(c.correct);
    }
  });

  it("collapses National and National Draft onto one kind, and only those two", () => {
    const kindsByType = new Map<string, string>(
      eventKinds.events.map((e: any) => [e.draft_type, e.draft_kind]),
    );
    kindsByType.set(eventKinds.absent_column.draft_type, eventKinds.absent_column.draft_kind);

    const typesPerKind = new Map<string, string[]>();
    for (const [type, kind] of kindsByType) {
      typesPerKind.set(kind, [...(typesPerKind.get(kind) ?? []), type]);
    }
    const collapsed = [...typesPerKind.entries()].filter(([, types]) => types.length > 1);
    expect(collapsed).toHaveLength(1);
    expect(collapsed[0][0]).toBe("national");
    expect(collapsed[0][1].sort()).toEqual(["National", "National Draft"]);

    expect(kindsByType.size).toBe(eventKinds.totals.distinct_draft_type);
    expect(new Set(kindsByType.values()).size).toBe(eventKinds.totals.distinct_draft_kind);
  });

  it("keeps the mapping's draft_type vocabulary set-equal to GRID_DRAFT_TYPES", () => {
    const spec = readFileSync(join(root, "src", "search", "grid-solver-spec.ts"), "utf8");
    const block = /export const GRID_DRAFT_TYPES = \[([\s\S]*?)\] as const;/.exec(spec);
    expect(block).not.toBeNull();
    const gridTypes = [...block![1].matchAll(/'([^']+)'/g)].map((m) => m[1]);

    const mappingTypes = [
      ...eventKinds.events.map((e: any) => e.draft_type),
      eventKinds.absent_column.draft_type,
    ];
    // Both directions: the Grid Solver can offer nothing the importer cannot write,
    // and the importer can write nothing the Grid Solver cannot offer.
    expect([...new Set(mappingTypes)].sort()).toEqual([...new Set(gridTypes)].sort());
    expect(gridTypes).toHaveLength(11);
  });

  it("keeps the signing head vocabulary set-equal to GRID_SIGNING_KINDS", () => {
    const spec = readFileSync(join(root, "src", "search", "grid-solver-spec.ts"), "utf8");
    const block = /export const GRID_SIGNING_KINDS = \[([\s\S]*?)\] as const;/.exec(spec);
    expect(block).not.toBeNull();
    const gridKinds = [...block![1].matchAll(/'([^']+)'/g)].map((m) => m[1]);

    const vocab = eventKinds.signing.signing_kind.vocabulary;
    expect([...vocab].sort()).toEqual([...gridKinds].sort());
    expect(vocab).toHaveLength(18);
    expect(eventKinds.signing.signing_kind.on_unknown_head).toBe("HALT");
  });

  it("reproduces every derivable signing_kind from Stage A by the frozen head rule", () => {
    if (!existsSync(stageARowsPath)) return;   // gitignored snapshot
    const heads = new Set<string>();
    let present = 0;
    let withParenthetical = 0;
    for (const line of readFileSync(stageARowsPath, "utf8").split("\n")) {
      if (!line.trim()) continue;
      const raw: string | null = JSON.parse(line).signing_raw ?? null;
      if (raw === null) continue;
      present += 1;
      if (raw.includes("(")) withParenthetical += 1;
      heads.add(raw.replace(/\s*\(.*$/, "").trim());
    }
    expect(present).toBe(eventKinds.signing.signing.stage_a_rows);
    expect(present).toBe(995);
    expect(withParenthetical).toBe(eventKinds.signing.signing_detail.stage_a_rows_with_parenthetical);

    // the head rule lands exactly on the closed vocabulary, with no residue either way
    const vocab: string[] = eventKinds.signing.signing_kind.vocabulary;
    expect([...heads].sort()).toEqual([...vocab].sort());
    // and no head carries the NBSP that father-son qualifiers embed
    for (const head of heads) expect(head).not.toContain(NBSP);
  });

  it("does not pretend signing_detail is settled", () => {
    // Measured: no candidate reproduces the stored column exactly (best was D4 at
    // 470/593). It is classified D — not imported — rather than frozen on a guess.
    expect(eventKinds.signing.signing_detail.status).toBe("NOT_IMPORTED");
    expect(eventKinds.signing.signing_detail.derivation_class).toBe("D");
    expect(eventKinds.signing.signing_detail).not.toHaveProperty("rule");
  });
});

/*
 * AFLDB-ISSUE-093 Stage B2-2b — the club resolution contract.
 *
 * G7 is CLOSED (B2 handoff §35.3). These tests freeze its representation: exact
 * club_slug == clubs.slug equality with one reviewed exception, and no new mapping
 * table. They deliberately assert the ABSENCE of alias/era/year mechanisms as well
 * as the presence of the rule, because the failure mode this contract guards
 * against is a helpful fallback quietly reappearing.
 *
 * No network, no database. Snapshot assertions skip when the gitignored Stage A
 * snapshot is absent locally.
 */
describe("Stage B2-2b club resolution contract", () => {
  const clubResolution = contract.club_resolution;
  const clubs = JSON.parse(
    readFileSync(join(root, "data", "reference", "clubs.json"), "utf8"),
  );
  const clubSlugs: string[] = clubs.identities.map((c: any) => c.slug);
  const stageARowsPath = join(root, "data", "sources", "draftguru", "annual-html-20260826",
    "parsed", "rows.jsonl");

  function stageAClubCounts(): Map<string, number> | null {
    if (!existsSync(stageARowsPath)) return null;   // gitignored snapshot
    const counts = new Map<string, number>();
    for (const line of readFileSync(stageARowsPath, "utf8").split("\n")) {
      if (!line.trim()) continue;
      const slug = JSON.parse(line).club_slug;
      counts.set(slug, (counts.get(slug) ?? 0) + 1);
    }
    return counts;
  }

  it("resolves by exact slug equality and needs no new mapping table", () => {
    expect(clubResolution.rule).toBe("exact string equality: stage_a.club_slug == clubs.slug");
    expect(clubResolution.new_mapping_table_required).toBe(false);
    expect(clubResolution.source_of_truth).toContain("data/reference/clubs.json");
    // the 18 working mappings are NOT restated here — that would be a second source
    expect(JSON.stringify(clubResolution)).not.toContain("collingwood");
    expect(JSON.stringify(clubResolution)).not.toContain("carlton");
  });

  it("reconciles to the accepted Stage A population exactly", () => {
    const m = clubResolution.measured;
    expect(m.exact_mapped_rows + m.deliberate_null_rows).toBe(6810);
    expect(m.total_rows).toBe(6810);
    expect(m.exact_mapped_rows).toBe(6388);
    expect(m.deliberate_null_rows).toBe(422);
    expect(m.exact_mapped_slugs + m.deliberate_null_slugs).toBe(m.distinct_stage_a_club_slugs);
    expect(m.exact_mapped_slugs).toBe(18);
    expect(m.deliberate_null_slugs).toBe(1);
    expect(m.distinct_stage_a_club_slugs).toBe(19);
    expect(m.rows_with_null_club_field).toBe(0);
  });

  it("declares exactly one deliberate NULL, and it is brisbane", () => {
    expect(clubResolution.deliberate_null).toHaveLength(1);
    const [only] = clubResolution.deliberate_null;
    expect(only.club_slug).toBe("brisbane");
    expect(only.club_id).toBeNull();
    expect(only.policy).toBe("NULL");
    expect(only.stage_a_rows).toBe(422);
    // it is an exception precisely because nothing tracked can resolve it
    expect(clubSlugs).not.toContain("brisbane");
    expect(clubSlugs).toContain("brisbane-bears");
    expect(clubSlugs).toContain("brisbane-lions");
  });

  it("cannot resolve brisbane through any other clubs.json field either", () => {
    const fields = clubs.identities.flatMap(
      (c: any) => [c.slug, c.name, c.short_name, c.hist, c.abbreviation],
    ).map((v: string) => v.toLowerCase());
    // not a slug, not a name, not a short_name, not a hist key, not an abbreviation
    expect(fields).not.toContain("brisbane");
  });

  it("forbids every fallback mechanism by name", () => {
    const forbidden: string[] = clubResolution.forbidden_mechanisms;
    const joined = forbidden.join(" | ").toLowerCase();
    expect(joined).toContain("club_aliases");
    expect(joined).toContain("short_name");
    expect(joined).toContain("era rewriting");
    expect(joined).toContain("draft_year + 1");
    expect(joined).toContain("fuzzy");
    expect(clubResolution.measured.alias_or_fuzzy_mappings).toBe(0);
    expect(clubResolution.measured.year_conditional_mappings).toBe(0);
    // no exception may be made conditional on a year
    for (const entry of clubResolution.deliberate_null) {
      expect(entry).not.toHaveProperty("draft_year");
      expect(entry).not.toHaveProperty("effective_season");
    }
  });

  it("keeps the modernised labels mapped as-is, never era-rewritten", () => {
    const slugs: string[] = clubResolution.modernised_labels_not_era_rewritten.slugs;
    expect(slugs.sort()).toEqual(["north-melbourne", "sydney", "western-bulldogs"]);
    // each maps to a real current identity, and its historical partner is NOT used
    for (const slug of slugs) expect(clubSlugs).toContain(slug);
    for (const historical of ["footscray", "kangaroos", "south-melbourne"]) {
      expect(clubSlugs).toContain(historical);   // the identity exists in AFLDB...
      expect(slugs).not.toContain(historical);   // ...but the mapping never targets it
    }
  });

  it("fails closed on an unknown slug, as a bare machine token", () => {
    expect(clubResolution.on_unknown_club_slug).toBe("HALT");
    // an unknown slug and a reviewed exception must stay distinguishable
    expect(clubResolution.unknown_club_slug_note).toContain("never silently written as NULL");
  });

  it("matches the real Stage A club population", () => {
    const counts = stageAClubCounts();
    if (!counts) return;

    const observed = [...counts.keys()];
    expect(observed).toHaveLength(19);
    expect(observed.some((s) => s === null || s === undefined || s === "")).toBe(false);

    const mapped = observed.filter((s) => clubSlugs.includes(s));
    const unmapped = observed.filter((s) => !clubSlugs.includes(s));
    expect(mapped).toHaveLength(18);
    expect(unmapped).toEqual(["brisbane"]);

    const mappedRows = mapped.reduce((sum, s) => sum + counts.get(s)!, 0);
    const unmappedRows = unmapped.reduce((sum, s) => sum + counts.get(s)!, 0);
    expect(mappedRows).toBe(6388);
    expect(unmappedRows).toBe(422);
    expect(mappedRows + unmappedRows).toBe(6810);

    // every declared deliberate_null slug really is one of the observed unmapped ones
    for (const entry of clubResolution.deliberate_null) {
      expect(unmapped).toContain(entry.club_slug);
      expect(counts.get(entry.club_slug)).toBe(entry.stage_a_rows);
    }
  });
});

/*
 * AFLDB-ISSUE-093 Stage B2-3 — the explicit-decision ledger contract.
 *
 * Two halves. The exporter pins always run: they hold the runner to its read-only
 * envelope and its fail-closed gates. The ledger assertions run only once the
 * controlled export has actually produced the file — the six decision VALUES are
 * never fabricated here, so these tests cannot pass by agreeing with a fixture
 * this suite wrote itself.
 *
 * No network, no database.
 */
describe("Stage B2-3 explicit-decision ledger contract", () => {
  const exporterPath = join(root, "tools", "rebuild", "draftguru", "export_link_decisions.py");
  const exporterSource = readFileSync(exporterPath, "utf8");
  const ledgerPath = join(root, "data", "reference", "draftguru-link-decisions.json");

  const PLAYER_URL = /^https:\/\/www\.draftguru\.com\.au\/players\/[^/]+\/[1-9][0-9]*$/;
  const AFLTABLES_PATH = /^players\/[A-Za-z]\/[^/]+\.html$/;

  function ledgerOrNull(): any | null {
    return existsSync(ledgerPath) ? JSON.parse(readFileSync(ledgerPath, "utf8")) : null;
  }

  it("exporter issues no write statement of any kind", () => {
    for (const forbidden of [/\bINSERT\s+INTO\b/i, /\bUPDATE\s+\w/i, /\bDELETE\s+FROM\b/i,
                             /\bTRUNCATE\b/i, /\bCOPY\b/i, /\bCOMMIT\b/i, /\bALTER\b/i,
                             /\bCREATE\s+(TABLE|INDEX)\b/i]) {
      expect(exporterSource).not.toMatch(forbidden);
    }
    expect(exporterSource).toContain("conn.rollback()");
  });

  it("exporter keeps the mandatory safety envelope", () => {
    expect(exporterSource).toContain("default_transaction_read_only=on");
    expect(exporterSource).toContain("REPEATABLE_READ");
    expect(exporterSource).toContain("conn.read_only = True");
    expect(exporterSource).toContain('REQUIRED_DB = "afldb_dev"');
    expect(exporterSource).toContain("afldb_test_pre_rebuild");
    expect(exporterSource).toContain("AFLDB_OWNER_DATABASE_URL");
    // .env is parsed, never sourced, and the DSN is never printed
    expect(exporterSource).toContain("never sourced");
    expect(exporterSource).not.toMatch(/print\([^)]*dsn/i);
  });

  it("exporter pins the expected population and distribution as hard gates", () => {
    expect(exporterSource).toContain("EXPECTED_DECISIONS = 6");
    expect(exporterSource).toContain('EXPECTED_DISTRIBUTION = {"afltables": 3, "draftguru": 2, None: 1}');
    // the canonical forms are enforced, not assumed
    expect(exporterSource).toContain("PLAYER_URL_RE");
    expect(exporterSource).toContain("AFLTABLES_PATH_RE");
  });

  it("exporter treats the Stage B1 oracle as opt-in, never a default source", () => {
    expect(exporterSource).toContain("--admit-b1-bridge-identity");
    expect(exporterSource).toContain("stage_b1_person_page_bridge");
    // default is False, so an unresolvable identity fails closed rather than being invented
    expect(exporterSource).toContain('action="store_true"');
  });

  it("exporter proves the B1 evidence is the accepted snapshot, not a local file", () => {
    // chain of custody pinned in code: sha256 -> manifest -> manifest's own parsed-output hash
    expect(exporterSource).toContain("B1_MANIFEST_SHA256 = ");
    expect(exporterSource).toMatch(/hashlib\.sha256\(manifest_bytes\)/);
    expect(exporterSource).toMatch(/hashlib\.sha256\(payload\)/);
    expect(exporterSource).toContain('declared.get("sha256")');
    expect(exporterSource).toContain("B1_EXPECTED_RECORDS = 120");
    // and the promotion must not quietly depend on Stage B1 being reclassified
    expect(exporterSource).toContain('manifest.get("identity_complete") is not False');
    expect(exporterSource).toContain('manifest.get("import_capable") is not False');
  });

  it("exporter admits a B1 bridge only under the full §14 contract", () => {
    expect(exporterSource).toContain('record.get("distinct_afltables_identity_count") != 1');
    expect(exporterSource).toContain('any(record.get("flags", {}).values())');
    expect(exporterSource).toContain('record.get("terminal_classification") != "fetched"');
    expect(exporterSource).toContain('href.get("host") != "afltables.com"');
    // a sample-wide collision disqualifies both sides rather than choosing one
    expect(exporterSource).toContain("if claimed[identity] == 1");
  });

  it("exporter caps the reviewed promotion at exactly one decision", () => {
    expect(exporterSource).toContain("EXPECTED_PROMOTIONS = 1");
    expect(exporterSource).toContain("promotions != EXPECTED_PROMOTIONS");
  });

  // ---- the ledger itself: only once the controlled export has produced it ----

  it("has the frozen schema shape", () => {
    const ledger = ledgerOrNull();
    if (!ledger) return;
    expect(ledger.schema_version).toBe(1);
    expect(ledger.source_key).toBe("draftguru");
    expect(Array.isArray(ledger.decisions)).toBe(true);
    expect(Object.keys(ledger).sort())
      .toEqual(["$comment", "decisions", "schema_version", "source_key"]);
  });

  it("carries exactly six decisions on six distinct persons", () => {
    const ledger = ledgerOrNull();
    if (!ledger) return;
    expect(ledger.decisions).toHaveLength(6);
    const urls = ledger.decisions.map((d: any) => d.player_url);
    expect(new Set(urls).size).toBe(6);
    for (const url of urls) expect(url).toMatch(PLAYER_URL);
  });

  it("is 5 linked + 1 confirmed_unlinked, distributed 3 afltables / 2 draftguru / 1 null", () => {
    const ledger = ledgerOrNull();
    if (!ledger) return;
    const decisions = ledger.decisions;
    expect(decisions.filter((d: any) => d.decision === "linked")).toHaveLength(5);
    expect(decisions.filter((d: any) => d.decision === "confirmed_unlinked")).toHaveLength(1);

    const counts = new Map<string, number>();
    for (const d of decisions) {
      const key = d.target === null ? "null" : d.target.source;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    expect(counts.get("afltables")).toBe(3);
    expect(counts.get("draftguru")).toBe(2);
    expect(counts.get("null")).toBe(1);
  });

  it("uses only the settled decision and source vocabulary", () => {
    const ledger = ledgerOrNull();
    if (!ledger) return;
    for (const d of ledger.decisions) {
      expect(["linked", "confirmed_unlinked"]).toContain(d.decision);
      if (d.decision === "confirmed_unlinked") {
        expect(d.target).toBeNull();               // creates no canonical player
      } else {
        expect(["afltables", "draftguru"]).toContain(d.target.source);
      }
    }
  });

  it("keeps each target identity in its canonical form", () => {
    const ledger = ledgerOrNull();
    if (!ledger) return;
    for (const d of ledger.decisions) {
      if (d.target === null) continue;
      if (d.target.source === "afltables") {
        expect(d.target.external_id).toMatch(AFLTABLES_PATH);
      } else {
        // a draftguru target mints the person as itself: the key IS the identity
        expect(d.target.external_id).toBe(d.player_url);
        expect(d.target.external_id).toMatch(PLAYER_URL);
      }
    }
    // and no two decisions claim one AFL Tables identity
    const aflIds = ledger.decisions
      .filter((d: any) => d.target?.source === "afltables")
      .map((d: any) => d.target.external_id);
    expect(new Set(aflIds).size).toBe(aflIds.length);
  });

  it("carries no surrogate id and no private or seed metadata", () => {
    const ledger = ledgerOrNull();
    if (!ledger) return;
    const forbiddenKeys = ["id", "player_id", "target_id", "draft_pick_id", "draft_person_id",
      "admin_user_id", "dob", "weight_kg", "height_cm", "birth_year", "birth_year_min",
      "birth_year_max", "notes", "note", "seed", "seed_player", "display_name", "decided_at"];

    const walk = (node: any) => {
      if (Array.isArray(node)) return node.forEach(walk);
      if (node && typeof node === "object") {
        for (const [k, v] of Object.entries(node)) {
          expect(forbiddenKeys).not.toContain(k);
          // schema_version is the only number the ledger may hold: no surrogate ids
          if (typeof v === "number") expect(k).toBe("schema_version");
          walk(v);
        }
      }
    };
    walk(ledger);
  });

  it("is deterministically ordered by the durable key", () => {
    const ledger = ledgerOrNull();
    if (!ledger) return;
    const urls: string[] = ledger.decisions.map((d: any) => d.player_url);
    const sorted = [...urls].sort((a, b) =>
      Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8")));
    expect(urls).toEqual(sorted);
    // no timestamp, so a re-run over unchanged data reproduces the bytes
    expect(JSON.stringify(ledger)).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
  });

  it("records provenance only where an identity did not come from external_identities", () => {
    const ledger = ledgerOrNull();
    if (!ledger) return;
    for (const d of ledger.decisions) {
      if (!("identity_evidence" in d)) continue;
      // the only admitted non-database source, and only for an afltables target
      expect(d.identity_evidence).toBe("stage_b1_person_page_bridge");
      expect(d.target.source).toBe("afltables");
    }
  });
});
