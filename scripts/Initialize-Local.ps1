[CmdletBinding()]
param([switch]$SkipInstall)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)

function Invoke-Checked {
  param([string]$Command, [string[]]$Arguments)
  & $Command @Arguments
  if ($LASTEXITCODE -ne 0) { throw "Échec de la commande : $Command $($Arguments -join ' ')" }
}
function New-LocalSecret {
  $secretBytes = New-Object byte[] 48
  $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $generator.GetBytes($secretBytes); return ([Convert]::ToBase64String($secretBytes)).Replace('+','a').Replace('/','b').TrimEnd('=') }
  finally { $generator.Dispose() }
}

$dockerExecutable = (Get-Command docker -ErrorAction SilentlyContinue).Source
if (-not $dockerExecutable) { $dockerExecutable = 'C:\Program Files\Docker\Docker\resources\bin\docker.exe' }
if (-not (Test-Path -LiteralPath $dockerExecutable)) { throw 'Installez Docker Desktop, puis démarrez-le.' }
Invoke-Checked $dockerExecutable @('info','--format','{{.ServerVersion}}')
if (-not (Test-Path -LiteralPath '.env')) {
  $databaseSecret = New-LocalSecret
  $authSecret = New-LocalSecret
  $template = Get-Content -LiteralPath '.env.example' -Raw -Encoding UTF8
  $template = $template.Replace('CHANGE_ME', $databaseSecret).Replace('GENERATE_AT_LEAST_32_RANDOM_BYTES', $authSecret)
  [IO.File]::WriteAllText((Join-Path (Get-Location) '.env'), $template, (New-Object Text.UTF8Encoding($false)))
  Write-Host '.env créé avec des secrets aléatoires. Ne le partagez pas.'
}
if (-not $SkipInstall) {
  if (Test-Path -LiteralPath 'package-lock.json') { Invoke-Checked 'npm.cmd' @('ci') }
  else { Invoke-Checked 'npm.cmd' @('install') }
}
Invoke-Checked $dockerExecutable @('compose','up','-d','--wait','db')
Invoke-Checked 'npm.cmd' @('run','db:generate')
Invoke-Checked 'npm.cmd' @('run','db:migrate')

$securePassword = Read-Host 'Mot de passe du premier administrateur (12 à 256 caractères ; ignoré si le compte existe)' -AsSecureString
$confirmation = Read-Host 'Confirmez ce mot de passe' -AsSecureString
$passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
$confirmPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($confirmation)
try {
  $passwordText = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
  $confirmText = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($confirmPointer)
  if ($passwordText -cne $confirmText) { throw 'Les mots de passe sont différents.' }
  if ($passwordText.Length -lt 12 -or $passwordText.Length -gt 256) { throw 'Le mot de passe doit contenir entre 12 et 256 caractères.' }
  $env:SEED_ADMIN_PASSWORD = $passwordText
  Invoke-Checked 'npm.cmd' @('run','db:seed')
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($confirmPointer)
  Remove-Item Env:\SEED_ADMIN_PASSWORD -ErrorAction SilentlyContinue
  $passwordText = $null
  $confirmText = $null
}
Write-Host 'Installation prête. Identifiant par défaut : administrateur. Lancez npm.cmd run dev puis http://localhost:3000.'
