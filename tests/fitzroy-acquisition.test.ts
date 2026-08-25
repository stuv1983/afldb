import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// AFLDB-ISSUE-093 Phase 2 — fitzRoy core acquisition contract.
// Static/fixture validation only: no network, no R execution, no PostgreSQL.

const root = path.resolve(__dirname, "..");
const contractPath = path.join(root, "tools/rebuild/fitzroy/fitzroy-contract.json");
const scriptPath = path.join(root, "tools/rebuild/fitzroy/acquire_core.R");

const contract = JSON.parse(readFileSync(contractPath, "utf8"));
const script = readFileSync(scriptPath, "utf8");

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

  it("declares exactly the three canonical AFL Tables datasets", () => {
    expect(Object.keys(contract.datasets).sort()).toEqual([
      "player_details",
      "player_stats",
      "results",
    ]);
    expect(contract.datasets.player_stats.fitzroy_function).toBe(
      "fetch_player_stats_afltables"
    );
    expect(contract.datasets.player_details.fitzroy_function).toBe(
      "fetch_player_details_afltables"
    );
    expect(contract.datasets.results.fitzroy_function).toBe(
      "fetch_results_afltables"
    );
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
