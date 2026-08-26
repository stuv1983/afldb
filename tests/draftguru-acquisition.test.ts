import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync,
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

function runParser(args: string[]): ReturnType<typeof spawnSync> {
  return spawnSync(python, [parserPath, ...args], { encoding: "utf8" });
}

function runAdapter(args: string[]): ReturnType<typeof spawnSync> {
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
