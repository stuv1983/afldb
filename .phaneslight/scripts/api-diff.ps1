# phaneslight-generated v3.7.2 api-diff
# Thin wrapper. See regen-registry.ps1 for why the logic lives in Node.
$ErrorActionPreference = 'Stop'
& node (Join-Path $PSScriptRoot 'api-diff.js') @args
exit $LASTEXITCODE
