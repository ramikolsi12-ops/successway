$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
$dockerExecutable = (Get-Command docker -ErrorAction SilentlyContinue).Source
if (-not $dockerExecutable) { $dockerExecutable = 'C:\Program Files\Docker\Docker\resources\bin\docker.exe' }
& $dockerExecutable compose stop db
if ($LASTEXITCODE -ne 0) { throw 'La base ne peut pas être arrêtée.' }
Write-Host 'PostgreSQL arrêté ; volume de données conservé.'
