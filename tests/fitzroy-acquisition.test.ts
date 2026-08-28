import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// AFLDB-ISSUE-093 Phase 2 — fitzRoy core acquisition contract.
// Static/fixture validation only: no network, no R execution, no PostgreSQL.

const root = path.resolve(__dirname, "..");
const contractPath = path.join(root, "tools/rebuild/fitzroy/fitzroy-contract.json");
const scriptPath = path.join(root, "tools/rebuild/fitzroy/acquire_core.R");

const contract = JSON.parse(readFileSync(contractPath, "utf8"));
// Normalised on read. Every source-text assertion below is about CONTENT, never about
// which line ending the checkout happens to use, and this repository is checked out
// with core.autocrlf=true on Windows. It is not cosmetic: the "zero legacy/database
// dependency" guard strips comments with /#.*$/, and JavaScript's `.` does not match
// \r, so on a CRLF checkout the strip silently removed NOTHING and the guard passed
// or failed for the wrong reason. Normalising here restores it on both conventions.
const script = readFileSync(scriptPath, "utf8").replace(/\r\n/g, "\n");

const STATUSES = [
  "SUPPORTED",
  "SUPPORTED_WITH_COVERAGE_LIMITATION",
  "WRONG_GRAIN",
  "MISSING",
  "UNVERIFIED",
];

describe("fitzRoy acquisition contract (tools/rebuild/fitzroy/fitzroy-contract.json)", () => {
  it("pins an exact semver fitzRoy version with recorded evidence", () => {
    expect(contract.pinned_version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(contract.pinned_version_evidence).toMatch(/CRAN/);
  });

  // The contract holds two KINDS of dataset and the distinction is architectural, not
  // bookkeeping: a fact-bearing dataset is a source of canonical AFLDB columns, while a
  // validation witness is acquired only to be checked against. Asserting a flat list of
  // keys conflated them, so adding a witness looked identical to adding a fact source.
  const FACT_DATASETS = {
    player_details: "fetch_player_details_afltables",
    player_stats: "fetch_player_stats_afltables",
    results: "fetch_results_afltables",
  } as const;

  it("declares exactly the three canonical fact-bearing AFL Tables datasets", () => {
    const factKeys = Object.keys(contract.datasets)
      .filter((k) => contract.datasets[k].role !== "VALIDATION_WITNESS")
      .sort();
    expect(factKeys).toEqual(["player_details", "player_stats", "results"]);
    for (const [key, fn] of Object.entries(FACT_DATASETS)) {
      expect(contract.datasets[key].fitzroy_function).toBe(fn);
    }
    // A fact dataset is exactly one that the full-history contract requires.
    expect([...contract.full_history.required_datasets].sort()).toEqual(factKeys);
  });

  it("carries the ladder as a validation witness that can never become a fact source", () => {
    // AFLDB-ISSUE-095. fetch_ladder_afltables does not read a published ladder: it
    // computes points, percentage and position from results. Its columns are therefore
    // cross-checks, and promoting any of them to a canonical value would launder a
    // local recomputation into external-source provenance.
    const ladder = contract.datasets.ladder;
    expect(ladder).toBeDefined();
    expect(ladder.role).toBe("VALIDATION_WITNESS");
    expect(ladder.fitzroy_function).toBe("fetch_ladder_afltables");
    expect(ladder.provenance.verdict).toBe("LOCALLY_COMPUTED");

    // It must never join the full-history requirement: no accepted baseline contains
    // it, so requiring it would retroactively invalidate every one of them.
    expect(contract.full_history.required_datasets).not.toContain("ladder");

    // And no ladder field may be declared an authoritative AFLDB source. Each supported
    // field says what it is for in its target or its note; the W/D/L columns simply do
    // not exist in this dataset at all.
    for (const field of ladder.fields) {
      if (field.status === "MISSING") continue;
      expect(`${field.target} ${field.note}`.toLowerCase()).toMatch(
        /cross-check|never a fact source|recomputation|free parameter|identity resolution/
      );
    }
    const wdl = ladder.fields.find((f: any) => /wins/.test(f.target));
    expect(wdl.status).toBe("MISSING");
    expect(wdl.candidate_columns).toEqual([]);
  });

  it("classifies every field with a known status and never invents support", () => {
    for (const ds of Object.values<any>(contract.datasets)) {
      expect(ds.fields.length).toBeGreaterThan(0);
      for (const field of ds.fields) {
        expect(STATUSES).toContain(field.status);
        expect(Array.isArray(field.candidate_columns)).toBe(true);
        // A field with no candidate column cannot claim any level of support.
        if (field.candidate_columns.length === 0) {
          expect(field.status).toBe("MISSING");
        }
      }
    }
  });

  it("covers all Phase-2 required targets across the datasets", () => {
    const targets = Object.values<any>(contract.datasets)
      .flatMap((ds: any) => ds.fields.map((f: any) => f.target.toLowerCase()))
      .join(" | ");
    for (const needle of [
      "identity",
      "name",
      "dob",
      "profile url",
      "statistics",
      "brownlow match votes",
      "scores",
      "venue",
      "attendance",
      "season, round",
    ]) {
      expect(targets).toContain(needle);
    }
  });

  it("records player_match_period_stats as MISSING rather than assumed", () => {
    const period = contract.datasets.player_stats.fields.find((f: any) =>
      f.target.includes("period")
    );
    expect(period.status).toBe("MISSING");
    expect(period.candidate_columns).toEqual([]);
  });
});

describe("fitzRoy acquisition adapter (tools/rebuild/fitzroy/acquire_core.R)", () => {
  it("attaches the fitzRoy package (dictionary_afltables regression, probe run 1)", () => {
    // fetch_player_stats_afltables() fails with "object 'dictionary_afltables'
    // not found" when called via fitzRoy:: without library(fitzRoy) attached —
    // proven by the 2026-08-25 probe pair. The attach must not be removed.
    expect(script).toContain("library(fitzRoy)");
  });

  it("fails closed on a fitzRoy version mismatch with an explicit override", () => {
    expect(script).toContain('packageVersion("fitzRoy")');
    expect(script).toContain("contract$pinned_version");
    expect(script).toContain("--allow-version-mismatch");
    expect(script).toMatch(/Refusing to acquire/);
  });

  it("produces the §4 manifest provenance fields", () => {
    for (const key of [
      "source =",
      "adapter =",
      "adapter_schema_version",
      "fitzroy_version_installed",
      "fitzroy_version_pinned",
      "extraction_date",
      "requested_range",
      "row_count",
      "sha256",
      "snapshot_label",
    ]) {
      expect(script).toContain(key);
    }
    expect(script).toContain("docs/rebuild-manifests/afltables_fitzroy_core");
    expect(script).toContain("data/sources/afltables/fitzroy_core");
  });

  it("writes checksums as validated plain 64-char lowercase hex strings", () => {
    // openssl::sha256() returns a classed S3 object jsonlite cannot serialize
    // (trial-2024 failure: "No method asJSON S3 class: sha256"). The adapter
    // must normalize to an unclassed character scalar and hard-validate it.
    expect(script).toContain("tolower(unclass(as.character(h)))");
    expect(script).toContain('grepl("^[0-9a-f]{64}$", h)');
    expect(script).toMatch(/length\(h\) != 1/);
  });

  it("treats an existing manifest label as immutable", () => {
    expect(script).toMatch(/already exists\. Snapshots are immutable/);
  });

  it("preserves not-recorded semantics (no coercion of absent values to 0)", () => {
    expect(script).toContain('na = ""');
    expect(script).toMatch(/never coerced to 0/);
  });

  it("has zero legacy/database dependency", () => {
    // Comments may mention what the script does NOT do; code may not.
    const code = script
      .split("\n")
      .map((line) => line.replace(/#.*$/, ""))
      .join("\n");
    for (const forbidden of [
      "AFLDB_LEGACY_SQLITE",
      "sqlite",
      "afldb_test_pre_rebuild",
      "postgres",
      "psql",
      "DBI",
      "dbConnect",
    ]) {
      expect(code.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });
});

describe("snapshot layout", () => {
  it("keeps raw snapshots gitignored while manifests stay tracked", () => {
    const gitignore = readFileSync(path.join(root, ".gitignore"), "utf8");
    // /data/* ignores the whole data tree (opt-ins excepted); no opt-in may
    // expose the raw fitzRoy working area, and docs/ is never ignored.
    expect(gitignore).toContain("/data/*");
    expect(gitignore).not.toContain("!/data/sources");
    expect(gitignore).not.toMatch(/^docs\b/m);
  });
});
