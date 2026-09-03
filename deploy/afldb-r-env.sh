# AFLDB-ISSUE-130 — the R runtime the settle chain runs under.
#
# SOURCED, never executed: `. "$PROJECT_ROOT/deploy/afldb-r-env.sh"` by
#
#   deploy/afldb-settle-afltables.sh   (the unit, every nightly firing)
#   deploy/afldb-r-preflight.sh        (deploy-time validation)
#
# so the two can never resolve R differently: what the preflight proved is
# exactly what the unit runs. It resolves two things and nothing else.
#
#   RSCRIPT   the interpreter — AFLDB_RSCRIPT, default /usr/bin/Rscript
#   R_LIBS    an OPTIONAL extra library directory — AFLDB_R_LIBS, prepended
#
# The canonical library is /usr/local/lib/R/site-library (docs/deployment.md
# §7b): it is on R's default .libPaths(), outside the $HOME the unit mounts
# read-only, and never written at run time. A normal installation therefore
# sets NOTHING here and this fragment resolves RSCRIPT and stops. AFLDB_R_LIBS
# is the explicit escape hatch for a host whose packages genuinely live
# elsewhere; it belongs in the unit's EnvironmentFile (.env), never in a
# hand-written systemd drop-in, which no deployment can see.
#
# R_LIBS, not R_LIBS_SITE and not R_LIBS_USER. R_LIBS is ADDITIVE to
# .libPaths(); R_LIBS_SITE REPLACES Debian's site-library entries and would
# hide every apt-installed r-cran-* package, and R_LIBS_USER names THE user
# library rather than adding a search location.
#
# R silently drops a directory that does not exist from .libPaths(), so a
# mistyped or stale AFLDB_R_LIBS would otherwise fall through to whatever
# other library tree R finds, without a word. The directory is therefore
# required to exist here, before R starts. Whether it then actually appears on
# the effective .libPaths() is proved by the preflight — the one place that
# starts R in order to ask.
#
# No side effects: nothing is written, installed or fetched. `set -eu` safe.
# Because this file is sourced, `exit` below aborts the CALLER, which is the
# point: a settle run must not reach acquisition with a library it cannot see.

RSCRIPT=${AFLDB_RSCRIPT:-/usr/bin/Rscript}

if [ -n "${AFLDB_R_LIBS:-}" ]; then
  if [ ! -d "$AFLDB_R_LIBS" ]; then
    echo "AFLDB_R_LIBS is set to '$AFLDB_R_LIBS', but that directory does not exist." >&2
    echo "R would silently drop it from .libPaths() and search another library tree" >&2
    echo "instead. Refusing to continue. Fix or unset AFLDB_R_LIBS in .env; the" >&2
    echo "canonical library is /usr/local/lib/R/site-library (docs/deployment.md 7b)." >&2
    exit 1
  fi
  R_LIBS="$AFLDB_R_LIBS${R_LIBS:+:$R_LIBS}"
  export R_LIBS
fi
