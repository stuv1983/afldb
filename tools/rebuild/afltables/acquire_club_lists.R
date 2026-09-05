# ---------------------------------------------------------------------------
# AFLDB-ISSUE-118 Stage D1 — AFL Tables all-time club player lists.
#
# Reads the 21 club pages https://afltables.com/afl/stats/alltime/<slug>.html
# (the same pages fitzRoy 1.8.0's fetch_player_details_afltables() reads for
# the accepted register) and keeps what fitzRoy drops: the DOB column and the
# profile href that is AFLDB's AFL Tables identity key. Writes one CSV per club,
# the raw HTML bytes, and a SHA-256-bound manifest. Adjudicates nothing.
#
# Contract: tools/rebuild/afltables/afltables-contract.json (club_player_lists).
#
#   Rscript tools/rebuild/afltables/acquire_club_lists.R [--label <snapshot label>] [--out-dir <dir>]
#
# Terminal failures (no manifest is written): a non-200 page after the retry
# policy, a header that is not the contract's, a data row without a profile
# href, a duplicate profile path on one page, a club with no rows.
# ---------------------------------------------------------------------------

suppressWarnings(suppressMessages({
  library(httr)
  library(xml2)
  library(jsonlite)
}))

CONTRACT_PATH <- "tools/rebuild/afltables/afltables-contract.json"
ADAPTER <- "tools/rebuild/afltables/acquire_club_lists.R"
ADAPTER_SCHEMA_VERSION <- 1L
SOURCE_KEY <- "afltables"
FAMILY <- "club_player_list"
WORKING_ROOT <- "data/sources/afltables/club_lists"

args <- commandArgs(trailingOnly = TRUE)
opt <- function(flag, default = NULL) {
  hit <- which(args == flag)
  if (length(hit) == 0) return(default)
  if (hit[1] == length(args)) stop(flag, " requires a value", call. = FALSE)
  args[[hit[1] + 1L]]
}

if (!file.exists(CONTRACT_PATH)) stop("Missing acquisition contract: ", CONTRACT_PATH, call. = FALSE)
contract <- jsonlite::fromJSON(CONTRACT_PATH, simplifyVector = FALSE)
block <- contract$club_player_lists
if (is.null(block)) stop(CONTRACT_PATH, " carries no `club_player_lists` block; refusing.", call. = FALSE)
policy <- contract$http_policy
clubs <- block$clubs
required_header <- unlist(block$required_header)
artefact_columns <- unlist(block$artefact_columns)

label <- opt("--label", sprintf("club-lists-%s", format(Sys.Date(), "%Y%m%d")))
out_dir <- opt("--out-dir", file.path(WORKING_ROOT, label))
raw_dir <- file.path(out_dir, "raw")
parsed_dir <- file.path(out_dir, "parsed")
dir.create(raw_dir, recursive = TRUE, showWarnings = FALSE)
dir.create(parsed_dir, recursive = TRUE, showWarnings = FALSE)

ua <- policy$user_agent
pacing <- as.numeric(policy$min_pacing_seconds)
timeout_s <- as.numeric(policy$timeout_seconds)
backoff <- unlist(policy$retries$backoff_seconds)

sha256_file <- function(path) {
  con <- file(path, open = "rb")
  on.exit(close(con), add = TRUE)
  paste(sprintf("%02x", as.integer(unclass(openssl::sha256(con)))), collapse = "")
}
sha256_bytes <- function(bytes) paste(sprintf("%02x", as.integer(unclass(openssl::sha256(bytes)))), collapse = "")
write_json <- function(x, path) {
  jsonlite::write_json(x, path, auto_unbox = TRUE, pretty = TRUE, null = "null", na = "null")
}

# One GET under the contract's policy: pacing before every request, bounded
# retries on the classified transient failures only, everything else terminal.
last_request <- NULL
fetch <- function(url) {
  attempt <- 0L
  repeat {
    if (!is.null(last_request)) {
      wait <- pacing - as.numeric(difftime(Sys.time(), last_request, units = "secs"))
      if (wait > 0) Sys.sleep(wait)
    }
    last_request <<- Sys.time()
    resp <- tryCatch(httr::GET(url, httr::user_agent(ua), httr::timeout(timeout_s)),
                     error = function(e) e)
    transient <- inherits(resp, "error") ||
      httr::status_code(resp) >= 500 || httr::status_code(resp) == 429
    if (!transient) return(resp)
    attempt <- attempt + 1L
    if (attempt > length(backoff)) {
      if (inherits(resp, "error")) stop(url, ": ", conditionMessage(resp), " after ", attempt - 1L, " retries", call. = FALSE)
      return(resp)
    }
    Sys.sleep(backoff[[attempt]])
  }
}

normalise_profile_path <- function(href) {
  # Mirrors tools/migration/import_fitzroy_core.py normalise_profile_url().
  p <- gsub("../", "", trimws(href), fixed = TRUE)
  p <- sub("^https?://afltables\\.com/afl/stats/", "", p)
  sub("^/+", "", p)
}

cell_text <- function(node) trimws(gsub("\\s+", " ", xml2::xml_text(node)))

parse_page <- function(bytes, club) {
  doc <- xml2::read_html(bytes)
  tables <- xml2::xml_find_all(doc, "//table")
  if (length(tables) == 0) stop(club$slug, ": no table on the page", call. = FALSE)
  table <- tables[[1]]
  header <- vapply(xml2::xml_find_all(table, ".//tr[1]/th|.//thead/tr/th"), cell_text, character(1))
  if (!identical(header, required_header)) {
    stop(club$slug, ": header is not the contract's. Observed: ", paste(header, collapse = " | "), call. = FALSE)
  }
  rows <- xml2::xml_find_all(table, ".//tr[td]")
  out <- list()
  for (tr in rows) {
    tds <- xml2::xml_find_all(tr, "./td")
    if (length(tds) != length(required_header)) next
    a <- xml2::xml_find_first(tds[[3]], ".//a")
    href <- if (inherits(a, "xml_missing")) NA_character_ else xml2::xml_attr(a, "href")
    vals <- vapply(tds, cell_text, character(1))
    if (is.na(href)) {
      # The trailing totals row carries no link and is not data; any OTHER
      # unlinked row is a player without an identity, which is terminal.
      if (nzchar(vals[[3]])) stop(club$slug, ": data row without a profile href: ", vals[[3]], call. = FALSE)
      next
    }
    out[[length(out) + 1L]] <- c(club$label, club$slug, vals[1:2], vals[3], vals[4:11], href, normalise_profile_path(href))
  }
  if (length(out) == 0) stop(club$slug, ": no data rows", call. = FALSE)
  df <- as.data.frame(do.call(rbind, out), stringsAsFactors = FALSE)
  names(df) <- artefact_columns
  dup <- df$profile_path[duplicated(df$profile_path)]
  if (length(dup) > 0) stop(club$slug, ": duplicate profile path(s) on one page: ", paste(unique(dup), collapse = ", "), call. = FALSE)
  df
}

cat("AFLDB-ISSUE-118 AFL Tables club player list acquisition\n")
cat("  clubs:", length(clubs), "  label:", label, "\n")

# robots.txt: recorded, and honoured if it exists (it did not on 2026-09-05).
robots <- fetch("https://afltables.com/robots.txt")
robots_status <- httr::status_code(robots)
robots_sha <- NULL
if (robots_status == 200) {
  body <- httr::content(robots, as = "text", encoding = "UTF-8")
  robots_sha <- sha256_bytes(charToRaw(body))
  blocked <- grepl("(?mi)^Disallow:\\s*/(afl(/stats(/alltime)?)?)?\\s*$", body, perl = TRUE)
  if (blocked) stop("robots.txt disallows the all-time list path; refusing.", call. = FALSE)
}
cat("  robots.txt:", robots_status, "\n")

files <- list()
started <- format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ", tz = "UTC")
for (club in clubs) {
  t0 <- Sys.time()
  url <- sub("<slug>", club$slug, block$endpoint, fixed = TRUE)
  resp <- fetch(url)
  status <- httr::status_code(resp)
  if (status != 200) stop(club$slug, ": HTTP ", status, " for ", url, " — terminal, no manifest written.", call. = FALSE)
  bytes <- httr::content(resp, as = "raw")
  raw_name <- paste0(club$slug, ".html")
  writeBin(bytes, file.path(raw_dir, raw_name))
  df <- parse_page(bytes, club)
  parsed_name <- paste0(club$slug, ".csv")
  parsed_path <- file.path(parsed_dir, parsed_name)
  utils::write.csv(df, parsed_path, row.names = FALSE, fileEncoding = "UTF-8", na = "")
  files[[length(files) + 1L]] <- list(
    dataset = FAMILY,
    team_label = club$label,
    team_slug = club$slug,
    url = url,
    http_status = status,
    raw_filename = file.path("raw", raw_name),
    raw_sha256 = sha256_bytes(bytes),
    filename = file.path("parsed", parsed_name),
    sha256 = sha256_file(parsed_path),
    row_count = nrow(df),
    dob_present = sum(nzchar(df$dob)),
    dob_blank = sum(!nzchar(df$dob)),
    distinct_profile_paths = length(unique(df$profile_path)),
    observed_columns = names(df)
  )
  cat(sprintf("  %-16s %5d rows, %5d with DOB [%.1fs]\n", club$slug, nrow(df), sum(nzchar(df$dob)),
              as.numeric(difftime(Sys.time(), t0, units = "secs"))))
}

manifest <- list(
  source = "AFL Tables (afltables.com) all-time club player lists",
  source_key = SOURCE_KEY,
  family = FAMILY,
  adapter = ADAPTER,
  adapter_schema_version = ADAPTER_SCHEMA_VERSION,
  contract_path = CONTRACT_PATH,
  contract_club_player_lists_version = block$contract_club_player_lists_version,
  extraction_date = format(Sys.Date(), "%Y-%m-%d"),
  extraction_started_utc = started,
  extraction_timestamp_utc = format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ", tz = "UTC"),
  mode = "acquire",
  snapshot_label = label,
  acquisition_kind = block$acquisition_kind,
  scope_key = sprintf("clubs=%d", length(clubs)),
  clubs_requested = length(clubs),
  clubs_acquired = length(files),
  working_directory = out_dir,
  http_policy = list(user_agent = ua, concurrency = 1L, min_pacing_seconds = pacing,
                     timeout_seconds = timeout_s, retry_backoff_seconds = backoff),
  robots_txt = list(status = robots_status, sha256 = robots_sha),
  identity_rule = block$identity_rule,
  total_rows = sum(vapply(files, function(f) f$row_count, numeric(1))),
  total_dob_present = sum(vapply(files, function(f) f$dob_present, numeric(1))),
  completeness = "unvalidated",
  files = files
)
manifest_path <- file.path(out_dir, "manifest.json")
write_json(manifest, manifest_path)
cat("  artefacts:", length(files), " rows:", manifest$total_rows, " with DOB:", manifest$total_dob_present, "\n")
cat("  manifest:", manifest_path, "\n")
cat("  done\n")
