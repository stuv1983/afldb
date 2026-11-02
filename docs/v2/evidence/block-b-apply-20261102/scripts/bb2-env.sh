export PATH="/home/arm/.nvm/versions/node/v22.23.2/bin:$PATH"
R=ea98a35f20610e75c18e698bc0d9fe084c3c783d
PKGD=/home/arm/blockb-pkg-${R:0:12}/docs/v2/evidence/block-b-package-20261102
OPS=/home/arm/ops/blockb-${R:0:12}
run() { echo "##### $*"; "$@"; local x=$?; echo "##### EXIT $x"; [ $x = 0 ] || { echo "SEQUENCE STOPPED"; exit $x; }; }
