#!/usr/bin/env Rscript
# ---------------------------------------------------------------------------
# AFLDB-ISSUE-118 Stage H3 — bounded AFL API roster (player details) acquisition.
#
# Acquires the AFL.com.au season squad list of EVERY AFL men's club for each
# season in an explicit --from/--to range through
# fitzRoy::fetch_player_details_afl(), writes one raw artefact per season and
# a SHA-256-bound manifest, and adjudicates nothing.
#
# Why it exists: the AFL Tables player_details register (Stage H2) is the
# canonical height source; this family is the SECOND, independent height
# evidence source (heightInCm, keyed by the stable providerId) for players
# listed by a club from 2012 onward, so a height disagreement with an
# external oracle can be adjudicated on evidence rather than on which value
# makes a test pass. It is CORROBORATING evidence, never the sole path to a
# canonical fact (afl-api-contract.json `risk`).
#
# What the endpoint is: per (compSeason, team) squad lists. The AFL API holds
# them from 2012 (the CD_ provider-id era); an earlier season returns nothing
# and the adapter refuses --from < 2012 rather than record an absence.
#
# fitzRoy 1.8.0 mechanics, measured 2026-09-05 and binding for this adapter:
#   * `current = TRUE, season = S` resolves the compSeason id for S and
#     returns THAT season's squad (2012, 2015 and 2019 probed: the `season`
#     column is S and the players are S's list, non-debuted list members
#     included). It is therefore called once per season, `current = TRUE`.
#   * `current = FALSE` expands `season` to 2012:S and then fails inside
#     dplyr::mutate ("`season` must be size 45 or 1, not 4") for every S >
#     2012, so it is unusable in the pinned version and is never called here.
#   * `team = NULL` fetches all clubs the API lists for that compSeason (18 in
#     every measured season); team names are the API's own labels
#     ("Adelaide Crows", "GWS GIANTS", ...), recorded verbatim.
#
# Both --from and --to are REQUIRED: there is deliberately no implicit current
# season and no "latest" default, because the manifest's scope is the
# completeness boundary a consumer reasons about.
#
# STAGING-ONLY. This script writes files and touches no database. The
# manifest SHAPE follows tools/rebuild/afl_api/acquire_lineups.R; the family
# contract is the `roster` block of afl-api-contract.json.
#
# Usage:
#   Rscript tools/rebuild/afl_api/acquire_rosters.R --from 2012 --to 2026
#   [--out-dir <dir>] [--label <snapshot label>]
# ---------------------------------------------------------------------------

suppressWarnings(suppressMessages({
  library(fitzRoy)
  library(jsonlite)
}))

CONTRACT_PATH <- "tools/rebuild/afl_api/afl-api-contract.json"
ADAPTER <- "tools/rebuild/afl_api/acquire_rosters.R"
ADAPTER_SCHEMA_VERSION <- 1L
SOURCE_KEY <- "afl_api"
FAMILY <- "roster"
WORKING_ROOT <- "data/sources/afl_api/rosters"
FIRST_API_SEASON <- 2012L

args <- commandArgs(trailingOnly = TRUE)

opt <- function(flag, default = NULL) {
  hit <- which(args == flag)
  if (length(hit) == 0) return(default)
  if (hit[1] == length(args)) stop(flag, " requires a value", call. = FALSE)
  args[[hit[1] + 1L]]
}

require_integer_opt <- function(flag) {
  raw <- opt(flag)
  if (is.null(raw)) {
    stop(flag, " is REQUIRED. This adapter has no implicit current season and no ",
         "implicit range: a guessed scope cannot honestly describe what was ",
         "enumerated.", call. = FALSE)
  }
  if (!grepl("^-?[0-9]+$", raw)) {
    stop(flag, " must be an integer, found '", raw, "'.", call. = FALSE)
  }
  as.integer(raw)
}

from_season <- require_integer_opt("--from")
to_season <- require_integer_opt("--to")

if (from_season < FIRST_API_SEASON) {
  stop("--from must not precede ", FIRST_API_SEASON, ": the AFL API holds no squad list ",
       "before the CD_ provider-id era, and an empty season must not be written as an ",
       "absence.", call. = FALSE)
}
if (to_season < from_season || to_season > 2200L) {
  stop("--to must be >= --from and within range, found ", to_season, ".", call. = FALSE)
}

label <- opt("--label", sprintf("afl-api-rosters-%d-%d", from_season, to_season))
out_dir <- opt("--out-dir", file.path(WORKING_ROOT, label))

if (!file.exists(CONTRACT_PATH)) {
  stop("Missing acquisition contract: ", CONTRACT_PATH, call. = FALSE)
}
contract <- jsonlite::fromJSON(CONTRACT_PATH, simplifyVector = FALSE)
if (is.null(contract$roster)) {
  stop(CONTRACT_PATH, " carries no `roster` block; this adapter implements that contract ",
       "and refuses without it.", call. = FALSE)
}
pinned_version <- contract$pinned_version
installed_version <- as.character(utils::packageVersion("fitzRoy"))
version_ok <- identical(installed_version, pinned_version)
if (!version_ok) {
  stop("fitzRoy ", installed_version, " is installed but the contract pins ", pinned_version,
       ". The current=TRUE per-season mechanics above were measured under the pinned ",
       "version only; refusing.", call. = FALSE)
}

scope_key <- sprintf("from=%d;to=%d", from_season, to_season)

sha256_file <- function(path) {
  if (requireNamespace("digest", quietly = TRUE)) {
    return(digest::digest(file = path, algo = "sha256"))
  }
  con <- file(path, open = "rb")
  on.exit(close(con), add = TRUE)
  paste(sprintf("%02x", as.integer(unclass(openssl::sha256(con)))), collapse = "")
}

write_json <- function(x, path) {
  dir.create(dirname(path), recursive = TRUE, showWarnings = FALSE)
  jsonlite::write_json(x, path, auto_unbox = TRUE, pretty = TRUE,
                       null = "null", na = "null")
}

dir.create(out_dir, recursive = TRUE, showWarnings = FALSE)

cat("AFLDB-ISSUE-118 roster acquisition\n")
cat("  seasons:", from_season, "-", to_season, "\n")
cat("  scope:", scope_key, "\n")
cat("  fitzRoy:", installed_version, "(pinned)\n")

# --- one bounded fetch per season -------------------------------------------
# A source failure is TERMINAL: the season is not written as empty, and the
# manifest is not written at all, so a partial run can never masquerade as a
# complete one.
files <- list()
seasons_acquired <- integer(0)
for (season in seq.int(from_season, to_season)) {
  t0 <- Sys.time()
  squad <- fitzRoy::fetch_player_details_afl(season = season, team = NULL,
                                             current = TRUE, comp = "AFLM")
  if (is.null(squad) || nrow(squad) == 0) {
    stop("season ", season, ": the AFL API returned no squad rows. A source failure is ",
         "terminal and must not be written as an absence.", call. = FALSE)
  }
  squad <- as.data.frame(squad, stringsAsFactors = FALSE)
  observed_columns <- names(squad)
  required <- unlist(contract$roster$required_columns)
  missing <- setdiff(required, observed_columns)
  if (length(missing) > 0) {
    stop("season ", season, ": required column(s) absent from the payload: ",
         paste(missing, collapse = ", "), ". Refusing.", call. = FALSE)
  }
  if (!all(squad$season == season)) {
    stop("season ", season, ": the payload's `season` column disagrees with the requested ",
         "season (", paste(unique(squad$season), collapse = ","), "). Refusing.",
         call. = FALSE)
  }
  dup <- sum(duplicated(squad[, c("providerId", "team")]))
  if (dup > 0) {
    stop("season ", season, ": ", dup, " duplicate (providerId, team) rows. Refusing.",
         call. = FALSE)
  }

  # JSON, not CSV, for the same reason as the lineup family: NULL, 0 and ""
  # must stay distinct (heightInCm 0 is zero-as-missing and must be seen as 0
  # by the reader, never as a blank).
  artefact_name <- sprintf("rosters_%d.json", season)
  artefact_path <- file.path(out_dir, artefact_name)
  write_json(squad, artefact_path)

  files[[length(files) + 1L]] <- list(
    dataset = FAMILY,
    filename = artefact_name,
    season = season,
    row_count = nrow(squad),
    teams_observed = length(unique(squad$team)),
    team_labels = sort(unique(squad$team)),
    distinct_provider_ids = length(unique(squad$providerId)),
    height_present = sum(!is.na(squad$heightInCm) & squad$heightInCm > 0),
    height_zero = sum(!is.na(squad$heightInCm) & squad$heightInCm == 0),
    height_na = sum(is.na(squad$heightInCm)),
    observed_columns = observed_columns,
    sha256 = sha256_file(artefact_path)
  )
  seasons_acquired <- c(seasons_acquired, season)
  cat(sprintf("  %d: %d rows, %d teams, %d with height [%.1fs]\n", season, nrow(squad),
              length(unique(squad$team)),
              sum(!is.na(squad$heightInCm) & squad$heightInCm > 0),
              as.numeric(difftime(Sys.time(), t0, units = "secs"))))
}

manifest <- list(
  source = "AFL.com.au API via fitzRoy",
  source_key = SOURCE_KEY,
  family = FAMILY,
  adapter = ADAPTER,
  adapter_schema_version = ADAPTER_SCHEMA_VERSION,
  contract_path = CONTRACT_PATH,
  contract_roster_version = contract$roster$contract_roster_version,
  fitzroy_version_installed = installed_version,
  fitzroy_version_pinned = pinned_version,
  fitzroy_version_match = version_ok,
  extraction_date = format(Sys.Date(), "%Y-%m-%d"),
  extraction_timestamp_utc = format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ", tz = "UTC"),
  mode = "acquire",
  snapshot_label = label,
  acquisition_kind = contract$roster$acquisition_kind,
  scope_key = scope_key,
  requested_range = list(from = from_season, to = to_season),
  seasons_requested = seq.int(from_season, to_season),
  seasons_acquired = seasons_acquired,
  working_directory = out_dir,
  fetch_mechanics = "fetch_player_details_afl(season = S, team = NULL, current = TRUE, comp = 'AFLM') once per season; current = FALSE is unusable in fitzRoy 1.8.0 (vector-season mutate failure) and is never called",
  completeness = "unvalidated",
  files = files
)

manifest_path <- file.path(out_dir, "manifest.json")
write_json(manifest, manifest_path)

cat("  artefacts:", length(files), "\n")
cat("  manifest:", manifest_path, "\n")
cat("  done\n")
