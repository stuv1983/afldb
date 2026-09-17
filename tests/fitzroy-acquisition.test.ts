import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// AFLDB-ISSUE-093 Phase 2 — fitzRoy core acquisition contract.
// Static/fixture validation only: no network, no R execution, no PostgreSQL.

const root = path.resolve(__dirname, "..");
const contractPath = path.join(root, "tools/rebuild/fitzroy/fitzroy-contract.json");
const scriptPath = path.join(root, "tools/rebuild/fitzroy/acquire_core.R");

const contract = JSON.parse(readFileSync(contractPath, "utf8"));
const seasons = JSON.parse(
  readFileSync(path.join(root, "data/reference/seasons.json"), "utf8")
);
const acceptedBaselines = JSON.parse(
  readFileSync(path.join(root, "data/reference/fitzroy-accepted-baselines.json"), "utf8")
);
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

// AFLDB-ISSUE-099 T1 — the in-season acquisition kind. An in-season snapshot is a
// partial observation of a season still being played. It is a THIRD acquisition kind
// with its own adjudicator, never a narrowed core snapshot, and the historical
// fail-closed contract is not relaxed anywhere to accommodate it.
describe("in-season acquisition contract (AFLDB-ISSUE-099)", () => {
  const inSeason = contract.in_season;

  it("declares the third acquisition kind with its own contract version and adjudicator", () => {
    expect(inSeason).toBeDefined();
    expect(inSeason.acquisition_kind).toBe("in_season_partial");
    expect(inSeason.contract_in_season_version).toBe(1);
    expect(inSeason.verdict_authority).toContain("import_fitzroy_core.py");
    expect(inSeason.verdict_authority).toContain("--require-in-season");
    // The three kinds are distinct: the in-season adjudicator is NOT the core one and
    // NOT the witness one.
    expect(inSeason.verdict_authority).not.toContain("--require-full-history");
    expect(inSeason.verdict_authority).not.toContain("validate_ladder_witness");
  });

  it("acquires exactly one season, and only a season seasons.json declares in progress", () => {
    expect(inSeason.single_season).toBe(true);
    expect(inSeason.season_source).toContain("data/reference/seasons.json");
    expect(inSeason.season_source).toContain("in_progress_seasons");
    expect(Array.isArray(seasons.in_progress_seasons)).toBe(true);
    expect(seasons.in_progress_seasons.length).toBeGreaterThan(0);

    // The structural reason an in-season snapshot can never be part of a core one:
    // every in-progress season is explicitly excluded from the full-history range.
    const excluded = [...contract.full_history.current_season_excluded.seasons].sort();
    expect([...seasons.in_progress_seasons].sort()).toEqual(excluded);
    for (const season of seasons.in_progress_seasons) {
      expect(season).toBeGreaterThan(contract.full_history.season_range.last_season);
    }
  });

  it("carries only declared fact-bearing datasets and excludes the witness", () => {
    expect(inSeason.required_datasets).toEqual(["player_stats", "results"]);
    expect(inSeason.allowed_datasets).toEqual(["player_stats", "results"]);
    for (const key of inSeason.allowed_datasets) {
      expect(contract.datasets[key]).toBeDefined();
      // A validation witness computes its values locally and is never a fact source,
      // so it can never be part of a snapshot the settle pass consumes.
      expect(contract.datasets[key].role).not.toBe("VALIDATION_WITNESS");
    }
    expect(inSeason.excluded_datasets.datasets).toContain("ladder");
    expect(inSeason.excluded_datasets.datasets).toContain("player_details");
    for (const key of inSeason.excluded_datasets.datasets) {
      expect(inSeason.allowed_datasets).not.toContain(key);
    }
  });

  it("can never satisfy full-history or the accepted-baseline register", () => {
    expect(inSeason.never_admissible_for.gates).toEqual([
      "--require-full-history",
      "--require-accepted-baseline",
    ]);
    expect(inSeason.never_admissible_for.register).toBe(
      "data/reference/fitzroy-accepted-baselines.json"
    );
    // And no accepted baseline is, or may become, an in-season partial.
    for (const baseline of acceptedBaselines.baselines) {
      expect(baseline.acquisition.acquisition_kind ?? "core_snapshot").toBe("core_snapshot");
      expect(baseline.contract_binding.required_datasets).toEqual(
        contract.full_history.required_datasets
      );
      expect(baseline.contract_binding.required_range.last_season).toBe(
        contract.full_history.season_range.last_season
      );
    }
  });

  it("keys in-season player identity on the profile url, with ID as enrichment only", () => {
    // Probe P5 (AFLDB-ISSUE-099 §2.1): 0 NA `url`, 82 NA `ID` in the 2026 population.
    // Requiring `ID` in-season would reject real appearances.
    const identity = inSeason.identity_requirement;
    expect(identity.required_columns).toEqual(["url"]);
    expect(identity.enrichment_columns).toEqual(["ID"]);
    expect(identity.rule).toContain("never inferred from a name");
    expect(identity.profile_url_shape).toBe(
      contract.full_history.identity_requirement.profile_url_shape
    );

    // The historical contract is UNCHANGED and still stricter: it requires both.
    expect(contract.full_history.identity_requirement.required_columns).toEqual(["ID", "url"]);
  });

  it("leaves the full-history contract untouched", () => {
    const fh = contract.full_history;
    expect(fh.contract_full_history_version).toBe(1);
    expect(fh.required_datasets).toEqual(["player_stats", "player_details", "results"]);
    expect(fh.season_range.first_season).toBe(1897);
    expect(fh.season_range.last_season).toBe(2025);
    expect(fh.approved_source_gaps.seasons).toEqual([]);
    // No full-history gate mentions or accommodates the in-season kind.
    for (const gate of fh.completeness_gates) {
      expect(gate).not.toContain("in_season");
    }
  });
});

describe("in-season acquisition adapter (AFLDB-ISSUE-099)", () => {
  it("is opt-in and acquires exactly one in-progress season", () => {
    expect(script).toContain("--in-season");
    expect(script).toContain('in_season <- has_flag("--in-season")');
    expect(script).toContain('SEASONS_PATH <- "data/reference/seasons.json"');
    expect(script).toContain("seasons_ref$in_progress_seasons");
    expect(script).toMatch(/--in-season acquires exactly one season/);
    expect(script).toMatch(/is not declared in progress by/);
    // The datasets a witness carries are refused in-season.
    expect(script).toMatch(/Dataset\(s\) not permitted in an in-season snapshot/);
  });

  it("writes the third acquisition kind and its own verdict authority", () => {
    expect(script).toContain('"in_season_partial"');
    // All three kinds remain representable and distinct.
    expect(script).toContain('"core_snapshot"');
    expect(script).toContain('"validation_witness"');
    expect(script).toContain("--require-in-season");
    // The existing adjudicators are unchanged.
    expect(script).toContain(
      "tools/migration/import_fitzroy_core.py --validate-only --require-full-history"
    );
    expect(script).toContain("tools/rebuild/fitzroy/validate_ladder_witness.py --label ");
    // The acquirer still never adjudicates: completeness is unvalidated and
    // full_history is FALSE for every kind it writes.
    expect(script).toContain('manifest$completeness <- "unvalidated"');
    expect(script).toContain("manifest$full_history <- FALSE");
  });

  it("records the in-season observations and keeps the identity measurement", () => {
    expect(script).toContain("manifest$in_season <- list(");
    expect(script).toContain("rounds_observed");
    expect(script).toContain("in_season_obs$matches <- nrow(results_df)");
    // identity_observations stays a real measurement in-season — it is only
    // "not_applicable" for a witness, which acquires no player_stats at all.
    expect(script).toContain(
      'manifest$identity_observations <- if (witness_only) "not_applicable" else identity_obs'
    );
  });
});

describe("snapshot layout", () => {
  it("keeps raw snapshots gitignored while manifests stay tracked", () => {
    const gitignore = readFileSync(path.join(root, ".gitignore"), "utf8");
    // /data/* ignores the whole data tree (opt-ins excepted); docs/ is never
    // ignored.
    expect(gitignore).toContain("/data/*");
    expect(gitignore).not.toMatch(/^docs\b/m);
    // AFLDB-ISSUE-118 §23.28 tracks two small parsed coach CSVs under a deep
    // scoped opt-in. That is the ONLY thing un-ignored under data/sources/: the
    // raw fitzRoy / DraftGuru / AFL API working areas beside them stay ignored.
    // A new opt-in that exposed one of those would change this list and fail.
    const sourceOptIns = gitignore.split(/\r?\n/).filter((l) => l.startsWith("!/data/sources"));
    expect(sourceOptIns).toEqual([
      "!/data/sources/",
      "!/data/sources/afltables/",
      "!/data/sources/afltables/coaches/",
      "!/data/sources/afltables/coaches/*/",
      "!/data/sources/afltables/coaches/*/parsed/",
    ]);
  });
});
