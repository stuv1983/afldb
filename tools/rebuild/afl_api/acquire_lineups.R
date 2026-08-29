#!/usr/bin/env Rscript
# ---------------------------------------------------------------------------
# AFLDB-ISSUE-100 L2 — bounded AFL API lineup acquisition.
#
# Acquires EXACTLY ONE season and EXACTLY ONE round of
# fitzRoy::fetch_lineup_afl(), writes the raw artefact and a SHA-256-bound
# manifest, and adjudicates nothing.
#
# Both --season and --round are REQUIRED. There is deliberately no implicit
# current season, no implicit latest round and no default for either: a lineup
# acquisition whose scope was guessed could not honestly describe what it
# enumerated, and the scope is the absence boundary.
#
# This is a SEPARATE source adapter from tools/rebuild/fitzroy/acquire_core.R.
# That one implements `fitzroy-contract.json`, whose applies_to_source is
# 'AFL Tables via fitzRoy' and whose three acquisition kinds are all
# season-ranged AFL Tables snapshots. A round-bounded AFL.com.au API lineup
# fetch is none of them; the manifest SHAPE is reused, the source contract is
# not. The per-source layout follows tools/rebuild/draftguru/.
#
# STAGING-ONLY. Lineups never become canonical participation. This script
# writes files and touches no database.
#
# Usage:
#   Rscript tools/rebuild/afl_api/acquire_lineups.R --season 2026 --round 20
#   [--out-dir <dir>] [--label <snapshot label>]
# ---------------------------------------------------------------------------

suppressWarnings(suppressMessages({
  library(fitzRoy)
  library(jsonlite)
}))

CONTRACT_PATH <- "tools/rebuild/afl_api/afl-api-contract.json"
ADAPTER <- "tools/rebuild/afl_api/acquire_lineups.R"
ADAPTER_SCHEMA_VERSION <- 1L
SOURCE_KEY <- "afl_api"
FAMILY <- "lineup"
WORKING_ROOT <- "data/sources/afl_api/lineups"

args <- commandArgs(trailingOnly = TRUE)

opt <- function(flag, default = NULL) {
  hit <- which(args == flag)
  if (length(hit) == 0) return(default)
  if (hit[1] == length(args)) stop(flag, " requires a value", call. = FALSE)
  args[[hit[1] + 1L]]
}

# --- scope: explicit, integer, no fallback ---------------------------------
# Read as text first so that a missing flag and a malformed one produce
# different, accurate messages, and so "20abc" cannot silently become 20.
require_integer_opt <- function(flag) {
  raw <- opt(flag)
  if (is.null(raw)) {
    stop(flag, " is REQUIRED. This adapter has no implicit current season and no ",
         "implicit latest round: a guessed scope cannot honestly describe what was ",
         "enumerated.", call. = FALSE)
  }
  if (!grepl("^-?[0-9]+$", raw)) {
    stop(flag, " must be an integer, found '", raw, "'.", call. = FALSE)
  }
  as.integer(raw)
}

season <- require_integer_opt("--season")
round_number <- require_integer_opt("--round")

if (season < 1897L || season > 2200L) {
  stop("--season must be within 1897-2200, found ", season, ".", call. = FALSE)
}
if (round_number < 0L) {
  stop("--round must not be negative, found ", round_number, ".", call. = FALSE)
}

label <- opt("--label", sprintf("afl-api-lineups-%d-r%d", season, round_number))
# Matches tools/rebuild/fitzroy/acquire_core.R's WORKING_ROOT convention
# (data/sources/<source>/<family>). /data/* is already gitignored, so a raw
# acquisition cannot be committed by accident.
out_dir <- opt("--out-dir", file.path(WORKING_ROOT, label))

if (!file.exists(CONTRACT_PATH)) {
  stop("Missing acquisition contract: ", CONTRACT_PATH, call. = FALSE)
}
contract <- jsonlite::fromJSON(CONTRACT_PATH, simplifyVector = FALSE)
pinned_version <- contract$pinned_version
installed_version <- as.character(utils::packageVersion("fitzRoy"))
version_ok <- identical(installed_version, pinned_version)

# The scope key is built here to exactly the contract's pinned grammar so the
# artefact, the manifest and the bundle all name the same scope.
scope_key <- sprintf("season=%d;round=%d", season, round_number)

sha256_file <- function(path) {
  # Manifest checksums must be PLAIN lowercase hex strings; the same constraint
  # and the same two-backend fallback as tools/rebuild/fitzroy/acquire_core.R.
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

cat("AFLDB-ISSUE-100 lineup acquisition\n")
cat("  season:", season, "| round:", round_number, "\n")
cat("  scope:", scope_key, "\n")
cat("  fitzRoy:", installed_version,
    if (version_ok) "(pinned)" else paste0("(PINNED IS ", pinned_version, ")"), "\n")

# --- the one bounded fetch -------------------------------------------------
lineups <- fitzRoy::fetch_lineup_afl(season = season, round_number = round_number)
lineups <- as.data.frame(lineups, stringsAsFactors = FALSE)

observed_columns <- names(lineups)
rows <- nrow(lineups)

# JSON, deliberately, NOT CSV. This family's payload contract requires NULL,
# false, 0 and "" to stay four distinct values, and a CSV field cannot carry
# that distinction: an empty field is ambiguous between "" and NA. JSON is
# lossless for exactly the three types this source returns — character, integer
# and logical — so `player.captain` stays false rather than becoming "FALSE",
# `player.playerJumperNumber` stays an integer rather than a numeric string, and
# an NA `lateChanges` becomes null while a column the provider omitted is simply
# absent from every object. The reader therefore invents no coercion rules.
artefact_name <- sprintf("lineups_%d_r%d.json", season, round_number)
artefact_path <- file.path(out_dir, artefact_name)
write_json(lineups, artefact_path)

# Measurements only. The acquirer records what it saw; whether that column set
# is projectable is decided by data/reference/source-families.json.
matches_observed <- if ("providerId" %in% observed_columns) {
  length(unique(stats::na.omit(lineups$providerId)))
} else 0L
teams_observed <- if (all(c("providerId", "teamId") %in% observed_columns)) {
  length(unique(paste(lineups$providerId, lineups$teamId)))
} else 0L

manifest <- list(
  source = "AFL.com.au API via fitzRoy",
  source_key = SOURCE_KEY,
  family = FAMILY,
  adapter = ADAPTER,
  adapter_schema_version = ADAPTER_SCHEMA_VERSION,
  contract_path = CONTRACT_PATH,
  contract_lineup_version = contract$lineup$contract_lineup_version,
  fitzroy_version_installed = installed_version,
  fitzroy_version_pinned = pinned_version,
  fitzroy_version_match = version_ok,
  # Acquisition-time metadata. It lives in the OUTER manifest and never enters
  # an observation payload or a payload hash, so a re-fetch of unchanged
  # upstream content stays idempotent at the observation grain.
  extraction_date = format(Sys.Date()),
  extraction_timestamp_utc = format(Sys.time(), tz = "UTC", "%Y-%m-%dT%H:%M:%SZ"),
  mode = "acquire",
  snapshot_label = label,
  acquisition_kind = "round_lineup_snapshot",
  season = season,
  round_number = round_number,
  scope_key = scope_key,
  working_directory = out_dir,
  files = list(list(
    dataset = FAMILY,
    file = artefact_name,
    rows = rows,
    columns = length(observed_columns),
    sha256 = sha256_file(artefact_path)
  )),
  observed_columns = as.list(observed_columns),
  acquisition_observations = list(
    rows = rows,
    columns = length(observed_columns),
    matches_observed = matches_observed,
    team_instances_observed = teams_observed,
    late_changes_column_present = "lateChanges" %in% observed_columns,
    version_pinned = isTRUE(version_ok)
  ),
  # Never a verdict. The acquirer does not adjudicate, exactly as
  # acquire_core.R does not.
  completeness = "unvalidated",
  # Carried in the artefact itself so the boundary travels with the data and
  # not only with the source-family registry.
  absence_sweepable = FALSE,
  enumeration_complete = FALSE,
  incomplete_reason = contract$lineup$absence$reason,
  never_admissible_for = contract$lineup$never_admissible_for,
  promotion_policy = "never",
  verdict_authority = paste0(
    "data/reference/source-families.json (afl_api/lineup column contract) ",
    "then src/lib/acquisition/lineup-bundle.ts"
  )
)

manifest_path <- file.path(out_dir, "manifest.json")
# The manifest is written LAST, after the raw artefact exists and is hashed.
write_json(manifest, manifest_path)

cat("  rows:", rows, "| columns:", length(observed_columns), "\n")
cat("  matches observed:", matches_observed,
    "| team instances:", teams_observed, "\n")
cat("  lateChanges column present:",
    "lateChanges" %in% observed_columns, "\n")
cat("  artefact:", artefact_path, "\n")
cat("  manifest:", manifest_path, "\n")
cat("\ncompleteness: unvalidated (the acquirer does not adjudicate)\n")
cat("absence sweeping: DISABLED for afl_api.lineup — enumeration is always complete:false\n")
cat("STAGING-ONLY: lineups never become canonical participation.\n")
