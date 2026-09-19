# phaneslight-generated v3.7.2 regen-registry
# Thin wrapper. The dispatcher resolves `<sub>.ps1`, but the extraction logic is
# TypeScript AST work and belongs in Node, which is guaranteed present (Claude Code is
# itself a Node program) and behaves identically in PowerShell, cmd and Git Bash.
$ErrorActionPreference = 'Stop'
& node (Join-Path $PSScriptRoot 'regen-registry.js') @args
exit $LASTEXITCODE
