$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
if (-not (Test-Path -LiteralPath '.env')) { throw "Exécutez d'abord scripts/Initialize-Local.ps1." }
$dockerExecutable = (Get-Command docker -ErrorAction SilentlyContinue).Source
if (-not $dockerExecutable) { $dockerExecutable = 'C:\Program Files\Docker\Docker\resources\bin\docker.exe' }
& $dockerExecutable compose up -d --wait db
if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL ne démarre pas.' }
& npm.cmd run dev
exit $LASTEXITCODE
