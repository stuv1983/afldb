#!/bin/sh
# AFLDB-ISSUE-130 — deploy-time validation of the R runtime the settle unit
# will actually run under.
#
#   sh deploy/afldb-r-preflight.sh                      # from the project root
#
# and, for the service-equivalent check, through systemd-run as documented in
# docs/deployment.md §7b. Run it BEFORE the timer is enabled and after any R,
# package or .env change. It sources deploy/afldb-r-env.sh — the same fragment
# the unit sources — so it exercises the same RSCRIPT and the same optional
# AFLDB_R_LIBS, then starts R once and reports, for operator evidence:
#
#   * R.version.string and the EFFECTIVE .libPaths(), in search order;
#   * the R_LIBS* environment R saw and whether ~/.Renviron exists (the
#     supported installation must not depend on it — see docs/deployment.md);
#   * when AFLDB_R_LIBS is set, that it really is on .libPaths() — R drops a
#     missing directory silently, so setting it is not proof;
#   * jsonlite, digest and fitzRoy: visible or MISSING, and which library
#     directory each resolves from;
#   * the installed fitzRoy version against `pinned_version` READ from
#     tools/rebuild/fitzroy/fitzroy-contract.json. The version is never
#     written here: acquire_core.R is the authority on the pin and this script
#     only reports the same identical() comparison earlier.
#
# Exit status is non-zero on any failure, with every failure listed. Nothing
# is installed, written, fetched or connected to: this is a read-only question
# put to R. It cannot cure a broken host; it makes one visible before the
# nightly timer would.

set -eu

# Runnable from any directory: resolve the project root from this file's own
# location unless the settle chain's AFLDB_PROJECT_ROOT override is set.
PROJECT_ROOT=${AFLDB_PROJECT_ROOT:-$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)}
cd "$PROJECT_ROOT"

CONTRACT=tools/rebuild/fitzroy/fitzroy-contract.json

. deploy/afldb-r-env.sh

echo "AFLDB R preflight — $PROJECT_ROOT"
echo "Rscript:      $RSCRIPT"
if [ -n "${AFLDB_R_LIBS:-}" ]; then
  echo "AFLDB_R_LIBS: $AFLDB_R_LIBS (exists; prepended to R_LIBS)"
else
  echo "AFLDB_R_LIBS: unset — canonical /usr/local/lib/R/site-library layout"
fi

if [ ! -f "$CONTRACT" ]; then
  echo "contract not found: $CONTRACT (is $PROJECT_ROOT the project root?)" >&2
  exit 1
fi

if [ ! -x "$RSCRIPT" ] && ! command -v "$RSCRIPT" >/dev/null 2>&1; then
  echo "Rscript does not resolve: '$RSCRIPT' is not executable and not on PATH." >&2
  echo "Set AFLDB_RSCRIPT in .env if R is installed somewhere else." >&2
  exit 1
fi

# One R process, reading the program from stdin. The two facts it needs from
# the shell travel as environment so nothing is interpolated into R code.
AFLDB_R_PREFLIGHT_CONTRACT="$CONTRACT" \
AFLDB_R_PREFLIGHT_LIBS="${AFLDB_R_LIBS:-}" \
"$RSCRIPT" - <<'R_PREFLIGHT'
contract_path <- Sys.getenv("AFLDB_R_PREFLIGHT_CONTRACT")
extra_lib <- Sys.getenv("AFLDB_R_PREFLIGHT_LIBS")
failures <- character()
fail <- function(msg) failures <<- c(failures, msg)

cat("R:            ", R.version.string, "\n", sep = "")
cat("R_HOME:       ", R.home(), "\n", sep = "")
for (v in c("R_LIBS", "R_LIBS_USER", "R_LIBS_SITE")) {
  cat(sprintf("%-14s%s\n", paste0(v, ":"), Sys.getenv(v, unset = "(unset)")))
}

paths <- .libPaths()
cat(".libPaths() — effective, in search order:\n")
for (p in paths) cat("  ", p, "\n", sep = "")

renviron <- path.expand("~/.Renviron")
if (file.exists(renviron)) {
  cat("WARNING: ", renviron, " exists. The supported installation must not depend on\n",
      "it; if it sets R_LIBS*, move that setting to AFLDB_R_LIBS in .env or remove it.\n",
      sep = "")
}

if (nzchar(extra_lib)) {
  wanted <- normalizePath(extra_lib, mustWork = FALSE)
  have <- normalizePath(paths, mustWork = FALSE)
  if (wanted %in% have) {
    cat("AFLDB_R_LIBS is on the effective .libPaths(): OK\n")
  } else {
    fail(sprintf("AFLDB_R_LIBS=%s is NOT on the effective .libPaths(); R dropped it silently",
                 extra_lib))
  }
}

visible <- list()
for (pkg in c("jsonlite", "digest", "fitzRoy")) {
  ok <- suppressWarnings(suppressMessages(requireNamespace(pkg, quietly = TRUE)))
  visible[[pkg]] <- ok
  if (ok) {
    cat(sprintf("package %-9s %-8s from %s\n", pkg,
                as.character(utils::packageVersion(pkg)),
                dirname(system.file(package = pkg))))
  } else {
    cat(sprintf("package %-9s MISSING\n", pkg))
    fail(sprintf("package '%s' is not visible on the effective .libPaths()", pkg))
  }
}

if (isTRUE(visible$jsonlite)) {
  pinned <- jsonlite::read_json(contract_path)$pinned_version
  if (!is.character(pinned) || length(pinned) != 1L || !nzchar(pinned)) {
    fail(sprintf("%s has no usable pinned_version", contract_path))
  } else if (isTRUE(visible$fitzRoy)) {
    installed <- as.character(utils::packageVersion("fitzRoy"))
    if (identical(installed, pinned)) {
      cat(sprintf("fitzRoy pin: installed %s == contract pinned_version %s: OK\n",
                  installed, pinned))
    } else {
      fail(sprintf("fitzRoy pin mismatch: installed %s, contract pinned_version %s (%s)",
                   installed, pinned, contract_path))
    }
  }
} else {
  cat("fitzRoy pin: not checked (jsonlite is missing, so the contract cannot be read)\n")
}

if (length(failures) > 0L) {
  cat("\nR PREFLIGHT: FAILED\n", file = stderr())
  for (f in failures) cat("  - ", f, "\n", sep = "", file = stderr())
  cat("See docs/deployment.md 7b, 'R and the pinned fitzRoy'.\n", file = stderr())
  quit(save = "no", status = 1)
}
cat("\nR PREFLIGHT: OK\n")
quit(save = "no", status = 0)
R_PREFLIGHT
