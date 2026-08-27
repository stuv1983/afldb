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
  datasets <- strsplit(opt("--datasets", "player_stats,player_details,results"), ",")[[1]]
  unknown <- setdiff(datasets, names(contract$datasets))
  if (length(unknown)) stop("Unknown dataset(s): ", paste(unknown, collapse = ", "))

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
    add_file("results", as.data.frame(r$data), "results.csv")
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
  ps_files <- Filter(function(f) f$dataset == "player_stats", files)
  seasons_acquired <- sort(unique(stats::na.omit(vapply(ps_files, season_of, integer(1)))))
  approved_gaps <- as.integer(unlist(fh$approved_source_gaps$seasons))
  if (length(approved_gaps) == 0) approved_gaps <- integer(0)

  required_first <- as.integer(fh$season_range$first_season)
  required_last <- as.integer(fh$season_range$last_season)
  required_seasons <- setdiff(required_first:required_last, approved_gaps)
  required_datasets <- unlist(fh$required_datasets)

  duplicate_seasons <- seasons_acquired[duplicated(
    vapply(ps_files, season_of, integer(1)))]
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
  manifest$identity_observations <- identity_obs
  # Never a verdict: only the validator may confer full-history status.
  manifest$completeness <- "unvalidated"
  manifest$full_history <- FALSE
  manifest$verdict_authority <-
    "tools/migration/import_fitzroy_core.py --validate-only --require-full-history"

  # The manifest is written LAST, after every raw artefact exists and is hashed.
  write_json(manifest, manifest_path)
  cat("\ncompleteness: unvalidated (the acquirer does not adjudicate)\n")
  not_observed <- names(observed)[!unlist(observed)]
  if (length(not_observed)) {
    cat("  observations not satisfied:", paste(not_observed, collapse = ", "), "\n")
  }
  cat("  player_stats rows:", identity_obs$rows,
      "| rows without an ID:", identity_obs$rows_without_id,
      "| rows without a profile URL:", identity_obs$rows_without_url, "\n")
  cat("\nNow validate independently:\n",
      " .venv/bin/python tools/migration/import_fitzroy_core.py --label", label,
      "--validate-only --require-full-history\n")
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
  stop("Usage: acquire_core.R --probe [--season N] | --acquire --label L [--from Y] [--to Y] [--datasets a,b] [--allow-version-mismatch]")
}
