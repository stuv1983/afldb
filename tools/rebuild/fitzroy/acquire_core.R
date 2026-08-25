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

  if ("player_stats" %in% datasets) {
    # One canonical acquisition (runbook §8): identity/name, DOB, profile URL,
    # match stats and Brownlow.Votes all ride this dataset if the probe
    # confirmed them. Per-season files keep long ranges restartable.
    for (s in from:to) {
      r <- try_fetch(sprintf("player_stats %d", s),
                     function() fitzRoy::fetch_player_stats_afltables(season = s))
      if (!r$ok) stop("player_stats season ", s, " failed: ", r$error,
                      " (no partial manifest is written; rerun under the same label after fixing)")
      add_file("player_stats", as.data.frame(r$data), sprintf("player_stats_%d.csv", s))
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

  manifest <- meta_common()
  manifest$mode <- "acquire"
  manifest$snapshot_label <- label
  manifest$requested_range <- list(from = from, to = to)
  manifest$datasets_requested <- as.list(datasets)
  manifest$working_directory <- out_dir
  manifest$files <- files
  write_json(manifest, manifest_path)
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
