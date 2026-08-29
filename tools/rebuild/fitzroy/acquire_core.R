#!/usr/bin/env Rscript
# AFLDB-ISSUE-093 Phase 2 — canonical fitzRoy / AFL Tables core source acquisition.
#
# SOURCE ACQUISITION ONLY. This script never touches PostgreSQL and has zero
# dependency on AFLDB_LEGACY_SQLITE or any preserved/legacy database.
#
# Modes:
#   Rscript tools/rebuild/fitzroy/acquire_core.R --probe [--season 2024]
#     Version-checked schema probe: fetches a small sample from each contract
#     dataset and writes the ACTUAL columns/types plus contract-candidate match
#     results to data/sources/afltables/fitzroy_core/_probe/schema-probe.json.
#     This is the evidence gate — contract field statuses are only promoted
#     from UNVERIFIED using this output.
#
#   Rscript tools/rebuild/fitzroy/acquire_core.R --acquire --label <snapshot-label> \
#       [--from 1897] [--to 2026] [--datasets player_stats,player_details,results]
#     Full acquisition. Raw CSVs land in the gitignored working area
#     data/sources/afltables/fitzroy_core/<label>/ ; the tracked provenance
#     manifest lands in docs/rebuild-manifests/afltables_fitzroy_core/<label>.json
#     with per-file row counts and SHA-256 fingerprints (AFLDB-ISSUE-093.md §4).
#     An existing manifest label is never overwritten — a reacquisition is a new
#     snapshot with a new label (§4 snapshot immutability).
#
#   Rscript tools/rebuild/fitzroy/acquire_core.R --acquire --in-season \
#       --label <snapshot-label> --from <Y> --to <Y> [--datasets player_stats,results]
#     AFLDB-ISSUE-099 in-season acquisition: a THIRD acquisition kind
#     (`in_season_partial`), not a narrowed core snapshot. Exactly one season, and
#     that season must be declared in-progress by data/reference/seasons.json.
#     No full-history gate is relaxed for it; it is measured against the contract's
#     own `in_season` block and adjudicated by
#     import_fitzroy_core.py --require-in-season. It can never be accepted as a
#     rebuild baseline.
#
# Version pin (§5): the installed fitzRoy version must equal
# fitzroy-contract.json's pinned_version; anything else fails closed unless
# --allow-version-mismatch is passed, and the version actually used is recorded
# in every probe/manifest output either way.

suppressWarnings(suppressMessages({
  ok_jsonlite <- requireNamespace("jsonlite", quietly = TRUE)
  ok_fitzroy <- requireNamespace("fitzRoy", quietly = TRUE)
}))
if (!ok_jsonlite) stop("Package 'jsonlite' is required: install.packages('jsonlite')")
if (!ok_fitzroy) stop("Package 'fitzRoy' is required: install.packages('fitzRoy')")
# fitzRoy must be ATTACHED, not just namespace-qualified: probe evidence
# (2026-08-25) showed fetch_player_stats_afltables() fails with
# "object 'dictionary_afltables' not found" when called via fitzRoy:: alone.
suppressWarnings(suppressMessages(library(fitzRoy)))

CONTRACT_PATH <- "tools/rebuild/fitzroy/fitzroy-contract.json"
SEASONS_PATH <- "data/reference/seasons.json"
WORKING_ROOT <- "data/sources/afltables/fitzroy_core"
MANIFEST_ROOT <- "docs/rebuild-manifests/afltables_fitzroy_core"
ADAPTER <- "tools/rebuild/fitzroy/acquire_core.R"
ADAPTER_SCHEMA_VERSION <- 1

if (!file.exists(CONTRACT_PATH)) {
  stop("Run from the repository root: ", CONTRACT_PATH, " not found in the working directory")
}
contract <- jsonlite::fromJSON(CONTRACT_PATH, simplifyVector = FALSE)

# --- args ---------------------------------------------------------------
args <- commandArgs(trailingOnly = TRUE)
has_flag <- function(f) f %in% args
opt <- function(name, default = NULL) {
  i <- which(args == name)
  if (length(i) == 1 && i < length(args)) args[[i + 1]] else default
}

allow_mismatch <- has_flag("--allow-version-mismatch")
# AFLDB-ISSUE-099. Opt-in only: with this flag absent every existing path below
# behaves exactly as it did before.
in_season <- has_flag("--in-season")

# --- version pin (fail closed) ------------------------------------------
installed_version <- as.character(utils::packageVersion("fitzRoy"))
pinned_version <- contract$pinned_version
version_ok <- identical(installed_version, pinned_version)
if (!version_ok) {
  msg <- sprintf(
    "fitzRoy version mismatch: installed %s, pinned %s (fitzroy-contract.json). Upstream output schemas may have changed.",
    installed_version, pinned_version)
  if (!allow_mismatch) {
    stop(msg, " Refusing to acquire. Re-pin the contract deliberately or pass --allow-version-mismatch.")
  }
  warning(msg, " Proceeding under --allow-version-mismatch; the mismatch is recorded in the output metadata.")
}

# --- helpers ------------------------------------------------------------
sha256_file <- function(path) {
  # Manifest checksums must be PLAIN lowercase hex strings: openssl::sha256()
  # returns a classed S3 object backed by a raw vector, which jsonlite refuses
  # ("No method asJSON S3 class: sha256") — proven by the trial-2024 run.
  if (requireNamespace("digest", quietly = TRUE)) {
    h <- digest::digest(file = path, algo = "sha256")
  } else if (requireNamespace("openssl", quietly = TRUE)) {
    con <- file(path, "rb"); on.exit(close(con))
    h <- paste(sprintf("%02x", as.integer(unclass(openssl::sha256(con)))), collapse = "")
  } else {
    stop("SHA-256 requires package 'digest' or 'openssl': install.packages('digest')")
  }
  h <- tolower(unclass(as.character(h)))
  if (length(h) != 1 || !grepl("^[0-9a-f]{64}$", h)) {
    stop("SHA-256 computation produced an unexpected value for ", path)
  }
  h
}

write_json <- function(x, path) {
  dir.create(dirname(path), recursive = TRUE, showWarnings = FALSE)
  jsonlite::write_json(x, path, auto_unbox = TRUE, pretty = TRUE, null = "null", na = "null")
  cat("wrote", path, "\n")
}

# IMPORTANT (NULL semantics): raw values are written exactly as fitzRoy
# returns them. Absent historical statistics stay empty/NA in the CSV —
# they are never coerced to 0 here or in any later import.
write_raw_csv <- function(df, path) {
  dir.create(dirname(path), recursive = TRUE, showWarnings = FALSE)
  utils::write.csv(df, path, row.names = FALSE, na = "")
  cat(sprintf("wrote %s (%d rows)\n", path, nrow(df)))
}

col_summary <- function(df) {
  lapply(names(df), function(n) list(column = n, type = class(df[[n]])[[1]],
                                     na_count = sum(is.na(df[[n]]))))
}

candidate_matches <- function(df, dataset_key) {
  ds <- contract$datasets[[dataset_key]]
  lapply(ds$fields, function(f) {
    cands <- unlist(f$candidate_columns)
    list(target = f$target,
         candidate_columns = as.list(cands),
         matched_columns = as.list(intersect(cands, names(df))),
         contract_status = f$status)
  })
}

try_fetch <- function(label, expr) {
  cat("fetching:", label, "...\n")
  tryCatch(list(ok = TRUE, data = expr()),
           error = function(e) list(ok = FALSE, error = conditionMessage(e)))
}

meta_common <- function() list(
  source = "AFL Tables via fitzRoy",
  adapter = ADAPTER,
  adapter_schema_version = ADAPTER_SCHEMA_VERSION,
  fitzroy_version_installed = installed_version,
  fitzroy_version_pinned = pinned_version,
  fitzroy_version_match = version_ok,
  extraction_date = format(Sys.Date()),
  extraction_timestamp_utc = format(Sys.time(), tz = "UTC", "%Y-%m-%dT%H:%M:%SZ")
)

# --- probe mode ---------------------------------------------------------
run_probe <- function() {
  season <- as.integer(opt("--season", "2024"))
  probe <- meta_common()
  probe$mode <- "probe"
  probe$probe_season <- season
  probe$datasets <- list()

  fetches <- list(
    player_stats = function() fitzRoy::fetch_player_stats_afltables(season = season),
    player_details = function() fitzRoy::fetch_player_details_afltables(),
    results = function() fitzRoy::fetch_results_afltables(season = season)
  )
  for (key in names(fetches)) {
    r <- try_fetch(key, fetches[[key]])
    if (!r$ok) {
      probe$datasets[[key]] <- list(ok = FALSE, error = r$error)
      next
    }
    df <- as.data.frame(r$data)
    probe$datasets[[key]] <- list(
      ok = TRUE,
      fitzroy_function = contract$datasets[[key]]$fitzroy_function,
      row_count = nrow(df),
      columns = col_summary(df),
      contract_field_matches = candidate_matches(df, key)
    )
  }
  write_json(probe, file.path(WORKING_ROOT, "_probe", "schema-probe.json"))
  cat("\nProbe complete. Review contract_field_matches before promoting any UNVERIFIED status.\n")
}

# --- acquire mode -------------------------------------------------------
run_acquire <- function() {
  label <- opt("--label")
  if (is.null(label) || !grepl("^[A-Za-z0-9._-]+$", label)) {
    stop("--acquire requires --label <snapshot-label> (letters/digits/._- only)")
  }
  manifest_path <- file.path(MANIFEST_ROOT, paste0(label, ".json"))
  if (file.exists(manifest_path)) {
    stop("Manifest ", manifest_path, " already exists. Snapshots are immutable (runbook §4): ",
         "reacquire under a NEW label instead of replacing an accepted baseline.")
  }
  # Immutability is anchored on the MANIFEST, not the working files: a label
  # with raw CSVs but no manifest is an incomplete/failed acquisition, and a
  # retry under the same label safely regenerates (overwrites) those working
  # files before writing the manifest last. Only a completed manifest makes a
  # snapshot immutable.
  from <- as.integer(opt("--from", "1897"))
  to <- as.integer(opt("--to", format(Sys.Date(), "%Y")))
  if (is.na(from) || is.na(to) || from > to) stop("Invalid --from/--to season range")

  # --- AFLDB-ISSUE-099 in-season preconditions ----------------------------
  # STRUCTURAL preconditions, not a verdict. The acquirer still does not adjudicate
  # (see the completeness accounting below): these only establish that the run is
  # shaped like an in-season acquisition at all, and the one adjudicator
  # import_fitzroy_core.py --require-in-season re-derives every gate afterwards.
  ins <- contract$in_season
  if (in_season) {
    if (is.null(ins)) {
      stop("--in-season requires an `in_season` block in ", CONTRACT_PATH)
    }
    if (from != to) {
      stop("--in-season acquires exactly one season: --from (", from,
           ") must equal --to (", to, ")")
    }
    if (!file.exists(SEASONS_PATH)) {
      stop("--in-season requires ", SEASONS_PATH, ", the in-progress season register")
    }
    seasons_ref <- jsonlite::fromJSON(SEASONS_PATH, simplifyVector = FALSE)
    in_progress <- as.integer(unlist(seasons_ref$in_progress_seasons))
    if (!(from %in% in_progress)) {
      stop("Season ", from, " is not declared in progress by ", SEASONS_PATH,
           " (in_progress_seasons: ", paste(in_progress, collapse = ", "),
           "). A completed season is acquired as a core snapshot, never in-season.")
    }
  }

  default_datasets <- if (in_season) {
    paste(unlist(ins$required_datasets), collapse = ",")
  } else {
    "player_stats,player_details,results"
  }
  datasets <- strsplit(opt("--datasets", default_datasets), ",")[[1]]
  unknown <- setdiff(datasets, names(contract$datasets))
  if (length(unknown)) stop("Unknown dataset(s): ", paste(unknown, collapse = ", "))
  if (in_season) {
    disallowed <- setdiff(datasets, unlist(ins$allowed_datasets))
    if (length(disallowed)) {
      stop("Dataset(s) not permitted in an in-season snapshot: ",
           paste(disallowed, collapse = ", "), " (allowed: ",
           paste(unlist(ins$allowed_datasets), collapse = ", "), ")")
    }
  }

  out_dir <- file.path(WORKING_ROOT, label)
  files <- list()
  add_file <- function(dataset, df, filename) {
    path <- file.path(out_dir, filename)
    write_raw_csv(df, path)
    files[[length(files) + 1]] <<- list(
      dataset = dataset,
      filename = filename,
      row_count = nrow(df),
      sha256 = sha256_file(path),
      columns = as.list(names(df))
    )
  }

  # Identity coverage is MEASURED during acquisition so the manifest records what the
  # source actually supplied, rather than leaving it to be discovered at import time.
  identity_obs <- list(rows = 0, rows_without_id = 0, rows_without_url = 0,
                       seasons_with_missing_id = list())

  # AFLDB-ISSUE-099. How far the in-progress season has actually run, measured from
  # the acquired results rather than asserted, so the adjudicator and the settle pass
  # can see the observed extent of the snapshot without re-reading the CSV.
  in_season_obs <- list(matches = 0L, rounds_observed = integer(0),
                        round_types_observed = character(0))

  if ("player_stats" %in% datasets) {
    # One canonical acquisition (runbook §8): identity/name, DOB, profile URL,
    # match stats and Brownlow.Votes all ride this dataset if the probe
    # confirmed them. Per-season files keep long ranges restartable.
    for (s in from:to) {
      r <- try_fetch(sprintf("player_stats %d", s),
                     function() fitzRoy::fetch_player_stats_afltables(season = s))
      if (!r$ok) stop("player_stats season ", s, " failed: ", r$error,
                      " (no partial manifest is written; rerun under the same label after fixing)")
      df <- as.data.frame(r$data)
      blank <- function(v) is.na(v) | trimws(as.character(v)) == ""
      n_no_id <- if ("ID" %in% names(df)) sum(blank(df$ID)) else nrow(df)
      n_no_url <- if ("url" %in% names(df)) sum(blank(df$url)) else nrow(df)
      identity_obs$rows <- identity_obs$rows + nrow(df)
      identity_obs$rows_without_id <- identity_obs$rows_without_id + n_no_id
      identity_obs$rows_without_url <- identity_obs$rows_without_url + n_no_url
      if (n_no_id > 0) {
        identity_obs$seasons_with_missing_id[[length(
          identity_obs$seasons_with_missing_id) + 1]] <- list(season = s, rows = n_no_id)
      }
      add_file("player_stats", df, sprintf("player_stats_%d.csv", s))
    }
  }
  if ("player_details" %in% datasets) {
    r <- try_fetch("player_details", function() fitzRoy::fetch_player_details_afltables())
    if (!r$ok) stop("player_details failed: ", r$error)
    add_file("player_details", as.data.frame(r$data), "player_details.csv")
  }
  if ("results" %in% datasets) {
    r <- try_fetch("results", function() fitzRoy::fetch_results_afltables(season = from:to))
    if (!r$ok) stop("results failed: ", r$error)
    results_df <- as.data.frame(r$data)
    if (in_season) {
      in_season_obs$matches <- nrow(results_df)
      if ("Round.Number" %in% names(results_df)) {
        in_season_obs$rounds_observed <- sort(unique(stats::na.omit(
          as.integer(results_df$Round.Number))))
      }
      if ("Round.Type" %in% names(results_df)) {
        in_season_obs$round_types_observed <- sort(unique(stats::na.omit(
          as.character(results_df$Round.Type))))
      }
    }
    add_file("results", results_df, "results.csv")
  }
  if ("ladder" %in% datasets) {
    # AFLDB-ISSUE-095. A VALIDATION WITNESS, never a fact source: the contract's
    # `ladder` provenance block records that fitzRoy computes these values from
    # results rather than reading a published ladder, so no column here is
    # imported. It is acquired so the rebuild's FINAL VALIDATION stage can
    # cross-check AFLDB's independently derived ladder against it.
    #
    # Per-season files, like player_stats: fetch_ladder_afltables takes ONE
    # season and defaults to the most recent round, which for a completed
    # season is the final home-and-away ladder. Requesting a range would
    # silently return one season's ladder.
    for (s in from:to) {
      r <- try_fetch(sprintf("ladder %d", s),
                     function() fitzRoy::fetch_ladder_afltables(season = s))
      if (!r$ok) stop("ladder season ", s, " failed: ", r$error,
                      " (no partial manifest is written; rerun under the same label after fixing)")
      df <- as.data.frame(r$data)
      # A source failure must never be recorded as an absence.
      if (nrow(df) == 0) stop("ladder season ", s, " returned zero rows")
      add_file("ladder", df, sprintf("ladder_%d.csv", s))
    }
  }

  # --- completeness accounting (AFLDB-ISSUE-093 full-history contract) -----
  # Measured facts only. `full_history` is COMPUTED from the contract's gates and
  # is never a label or an operator assertion; a snapshot that misses one required
  # season, dataset or row is `partial`, and the offline validator re-proves the
  # claim against the raw artefacts before any import may consume it.
  fh <- contract$full_history
  seasons_requested <- if (from <= to) from:to else integer(0)
  season_of <- function(f) {
    m <- regmatches(f$filename, regexpr("[0-9]{4}", f$filename))
    if (length(m) == 1) as.integer(m) else NA_integer_
  }
  # AFLDB-ISSUE-095. A VALIDATION WITNESS acquisition is not a core snapshot and must not
  # be measured as one. Acquiring only the ladder used to report seasons_acquired = [] and
  # missing_seasons = every season in the range, because the season accounting counted
  # player_stats files exclusively — so a run that acquired all 129 of its own seasons
  # described itself as having missed all 129, and then told the operator to run the CORE
  # adjudicator, which necessarily fails over datasets the witness never claimed.
  #
  # The repair is to measure the right thing, NOT to relax the core gates: when every
  # requested dataset is a witness, the per-season accounting counts the witness's own
  # files and the required range is the range that was requested. When any fact-bearing
  # dataset is present the core contract applies unchanged, exactly as before.
  is_witness <- function(d) identical(contract$datasets[[d]]$role, "VALIDATION_WITNESS")
  witness_only <- length(datasets) > 0 && all(vapply(datasets, is_witness, logical(1)))

  # AFLDB-ISSUE-099. An in-season snapshot is measured against ITS OWN one-season
  # requirement, for exactly the reason the witness repair above exists: measuring a
  # single in-progress season against the 1897-2025 core range would report 129
  # missing seasons for a run that acquired everything it claimed. This does NOT relax
  # a core gate — it applies the contract's separate, narrower `in_season` block, and
  # the core gates continue to apply unchanged to every core snapshot.
  scoped_range <- witness_only || in_season

  counted_files <- if (witness_only) {
    Filter(function(f) f$dataset %in% datasets, files)
  } else {
    Filter(function(f) f$dataset == "player_stats", files)
  }
  seasons_acquired <- sort(unique(stats::na.omit(
    vapply(counted_files, season_of, integer(1)))))
  approved_gaps <- as.integer(unlist(fh$approved_source_gaps$seasons))
  if (length(approved_gaps) == 0) approved_gaps <- integer(0)

  # A witness is required to cover exactly the range it was asked for; a core snapshot is
  # required to cover the contract's full-history range whatever was asked for.
  required_first <- if (scoped_range) from else as.integer(fh$season_range$first_season)
  required_last <- if (scoped_range) to else as.integer(fh$season_range$last_season)
  required_seasons <- setdiff(required_first:required_last,
                              if (scoped_range) integer(0) else approved_gaps)
  required_datasets <- if (witness_only) {
    datasets
  } else if (in_season) {
    unlist(ins$required_datasets)
  } else {
    unlist(fh$required_datasets)
  }

  duplicate_seasons <- seasons_acquired[duplicated(
    vapply(counted_files, season_of, integer(1)))]
  missing_seasons <- setdiff(required_seasons, seasons_acquired)
  extra_seasons <- setdiff(seasons_acquired, required_first:required_last)
  missing_datasets <- setdiff(required_datasets, unique(vapply(
    files, function(f) f$dataset, character(1))))
  empty_files <- Filter(function(f) f$row_count <= 0, files)

  range_matches <- (from == required_first && to == required_last)

  # MEASURED FACTS, NOT A VERDICT (AFLDB-ISSUE-093).
  #
  # The first full-history acquisition published `full_history: true` while the
  # independent validator rejected the snapshot, because this script implemented a
  # SMALLER gate set than the contract declares — identity completeness was never among
  # its checks. Two implementations of one contract drifted, which is exactly what the
  # single-source rule forbids.
  #
  # The acquirer therefore no longer adjudicates. It records what it measured and leaves
  # the verdict to the one adjudicator, `import_fitzroy_core.py --require-full-history`,
  # which re-derives every gate from the contract and the raw artefacts. A snapshot that
  # the validator would reject can no longer describe itself as complete.
  observed <- list(
    datasets_complete = length(missing_datasets) == 0,
    seasons_complete = length(missing_seasons) == 0,
    no_duplicate_seasons = length(duplicate_seasons) == 0,
    no_seasons_outside_range = length(extra_seasons) == 0,
    all_rows_non_zero = length(empty_files) == 0,
    version_pinned = isTRUE(version_ok),
    requested_range_matches_contract = range_matches
  )

  manifest <- meta_common()
  manifest$mode <- "acquire"
  manifest$snapshot_label <- label
  manifest$requested_range <- list(from = from, to = to)
  manifest$datasets_requested <- as.list(datasets)
  manifest$working_directory <- out_dir
  manifest$files <- files
  manifest$contract_full_history_version <- fh$contract_full_history_version
  manifest$seasons_requested <- as.list(seasons_requested)
  manifest$seasons_acquired <- as.list(seasons_acquired)
  manifest$intentional_gaps <- as.list(approved_gaps)
  manifest$missing_seasons <- as.list(missing_seasons)
  manifest$acquisition_observations <- observed
  # player_stats-only measurements. Recorded as not-applicable for a witness rather than
  # as a row of zeroes, which would read as "measured and found empty".
  manifest$identity_observations <- if (witness_only) "not_applicable" else identity_obs
  # AFLDB-ISSUE-099. The in-season block is the snapshot's own declaration of what it is:
  # one in-progress season, the datasets it carries, and the observed extent of that
  # season. It also carries, in the artefact itself, the two gates this kind of snapshot
  # may NEVER satisfy, so the exclusion travels with the manifest and not only with the
  # adjudicator's source.
  if (in_season) {
    manifest$contract_in_season_version <- ins$contract_in_season_version
    manifest$in_season <- list(
      season = from,
      datasets = as.list(datasets),
      matches = in_season_obs$matches,
      player_match_rows = identity_obs$rows,
      rounds_observed = as.list(in_season_obs$rounds_observed),
      round_types_observed = as.list(in_season_obs$round_types_observed),
      never_admissible_for = as.list(unlist(ins$never_admissible_for$gates))
    )
  }
  # Never a verdict: only a validator may confer completeness, and WHICH validator
  # depends on what was acquired. Pointing a witness at the core adjudicator manufactures
  # a false failure over datasets it never claimed, and pointing an in-season partial at
  # it would manufacture a false failure over 128 seasons it never claimed.
  manifest$acquisition_kind <- if (in_season) {
    "in_season_partial"
  } else if (witness_only) {
    "validation_witness"
  } else {
    "core_snapshot"
  }
  manifest$completeness <- "unvalidated"
  manifest$full_history <- FALSE
  manifest$verdict_authority <- if (in_season) {
    paste0("tools/migration/import_fitzroy_core.py --label ", label,
           " --validate-only --require-in-season")
  } else if (witness_only) {
    paste0("tools/rebuild/fitzroy/validate_ladder_witness.py --label ", label)
  } else {
    "tools/migration/import_fitzroy_core.py --validate-only --require-full-history"
  }

  # The manifest is written LAST, after every raw artefact exists and is hashed.
  write_json(manifest, manifest_path)
  cat("\ncompleteness: unvalidated (the acquirer does not adjudicate)\n")
  not_observed <- names(observed)[!unlist(observed)]
  if (length(not_observed)) {
    cat("  observations not satisfied:", paste(not_observed, collapse = ", "), "\n")
  }
  if (in_season) {
    cat("  acquisition kind: in_season_partial (season ", from,
        ") — NOT a core snapshot and NEVER an accepted baseline.\n", sep = "")
    cat("  matches observed:", in_season_obs$matches,
        "| rounds observed:", paste(in_season_obs$rounds_observed, collapse = ","), "\n")
    cat("  player_stats rows:", identity_obs$rows,
        "| rows without a profile URL:", identity_obs$rows_without_url,
        "| rows without an ID (enrichment only):", identity_obs$rows_without_id, "\n")
    cat("\nNow validate independently:\n",
        " .venv/bin/python tools/migration/import_fitzroy_core.py --label", label,
        "--validate-only --require-in-season\n")
    cat("  Do NOT run --require-full-history or --require-accepted-baseline against this",
        "\n  label: an in-season partial can never satisfy either gate, and both refuse it",
        "\n  explicitly.\n")
  } else if (witness_only) {
    cat("  acquisition kind: validation_witness (", paste(datasets, collapse = ", "),
        ") — NOT a core snapshot.\n", sep = "")
    cat("\nNow validate independently:\n",
        " .venv/bin/python tools/rebuild/fitzroy/validate_ladder_witness.py --label",
        label, "\n")
    cat("  Do NOT run import_fitzroy_core.py --require-full-history against this label:",
        "\n  it adjudicates the CORE snapshot and would fail over datasets a witness",
        "never claimed.\n")
  } else {
    cat("  player_stats rows:", identity_obs$rows,
        "| rows without an ID:", identity_obs$rows_without_id,
        "| rows without a profile URL:", identity_obs$rows_without_url, "\n")
    cat("\nNow validate independently:\n",
        " .venv/bin/python tools/migration/import_fitzroy_core.py --label", label,
        "--validate-only --require-full-history\n")
  }
  cat("\nAcquisition complete:", length(files), "file(s);",
      sum(vapply(files, function(f) f$row_count, integer(1))), "total rows.\n",
      "Manifest:", manifest_path, "\n",
      "Remember: raw files are gitignored; archive accepted baselines durably per runbook §4.\n")
}

# --- dispatch -----------------------------------------------------------
if (has_flag("--probe")) {
  run_probe()
} else if (has_flag("--acquire")) {
  run_acquire()
} else {
  stop("Usage: acquire_core.R --probe [--season N] | --acquire --label L [--from Y] [--to Y] [--datasets a,b] [--in-season] [--allow-version-mismatch]")
}
