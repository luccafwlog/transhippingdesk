<#
.SYNOPSIS
  Boot the local Supabase-compatible stack for Transhipping Desk on Windows.

.DESCRIPTION
  Native Postgres 16 + a stub pg_cron extension + the sb-shim emulator, so the
  app runs without real *.supabase.co credentials. Mirrors the design-audit
  playbook, adapted for Windows (no Docker / no apt).

  Default run ("up"): ensure Postgres is running, ensure .env points at the
  proxy, then start the shim on :54321.

  -Rebuild: drop and recreate the "app" DB from scratch (bootstrap + all
  migrations + seed). Use after pulling new migrations or to reset data.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\design-audit\win\local-stack.ps1
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\design-audit\win\local-stack.ps1 -Rebuild
#>
param(
  [switch]$Rebuild,
  [string]$PgBin = "C:\Program Files\PostgreSQL\16\bin",
  [string]$Service = "postgresql-x64-16"
)

# Continue (nao Stop): psql escreve NOTICE/WARNING no stderr e, sob 2>&1 + Stop,
# o PowerShell 5.1 trata isso como erro terminante. Gate real e o $LASTEXITCODE.
$ErrorActionPreference = "Continue"
$repo = Resolve-Path (Join-Path $PSScriptRoot "..\..\..")
$psql = Join-Path $PgBin "psql.exe"
$env:PGPASSWORD = "postgres"
$H = @("-U","postgres","-h","127.0.0.1","-p","5432")

function Say($m) { Write-Host "[local-stack] $m" -ForegroundColor Cyan }
function Die($m) { Write-Host "[local-stack] ERRO: $m" -ForegroundColor Red; exit 1 }

if (-not (Test-Path $psql)) { Die "psql nao encontrado em $PgBin. Instale: winget install -e --id PostgreSQL.PostgreSQL.16" }

# 1) Postgres service up
$svc = Get-Service -Name $Service -ErrorAction SilentlyContinue
if (-not $svc) { Die "servico $Service nao existe. Reinstale o PostgreSQL 16." }
if ($svc.Status -ne "Running") { Say "iniciando servico $Service..."; Start-Service $Service; Start-Sleep 2 }
Say "Postgres OK ($Service Running)"

# 2) Fake pg_cron extension present? (needed by bootstrap + migration 031)
$extDir = Join-Path $PgBin "..\share\extension"
$ctl = Join-Path $extDir "pg_cron.control"
if (-not (Test-Path $ctl)) {
  Say "copiando stub pg_cron para $extDir (requer UAC)..."
  $src = $PSScriptRoot
  $dst = (Resolve-Path $extDir).Path
  $cmd = "Copy-Item -Path '$src\pg_cron.control','$src\pg_cron--1.0.sql' -Destination '$dst' -Force"
  Start-Process powershell -Verb RunAs -Wait -ArgumentList "-NoProfile","-Command",$cmd
  if (-not (Test-Path $ctl)) { Die "falha ao copiar stub pg_cron (UAC negado?)." }
}

if ($Rebuild) {
  Say "REBUILD: recriando banco 'app' do zero..."
  # WITH (FORCE): encerra conexoes abertas (shim/psql) para permitir o drop (PG 13+)
  & $psql @H -v ON_ERROR_STOP=1 -q -c "drop database if exists app with (force);" | Out-Null
  foreach ($r in @("authenticator","anon","authenticated","service_role")) {
    & $psql @H -v ON_ERROR_STOP=1 -q -c "drop role if exists $r;" | Out-Null
  }
  & $psql @H -v ON_ERROR_STOP=1 -q -c "create database app;" | Out-Null

  $Hdb = $H + @("-d","app")
  Say "bootstrap..."
  & $psql @Hdb -v ON_ERROR_STOP=1 -q -f (Join-Path $repo "scripts\design-audit\bootstrap.sql") | Out-Null
  if ($LASTEXITCODE -ne 0) { Die "bootstrap falhou." }
  # bootstrap cria a extensao stub (schema cron); garante a tabela cron.job usada por 181/185/190
  & $psql @Hdb -v ON_ERROR_STOP=1 -q -c "create table if not exists cron.job (jobid bigint, jobname text, schedule text, command text); grant select on cron.job to public;" | Out-Null

  Say "aplicando migrations (204)..."
  $migs = Get-ChildItem (Join-Path $repo "supabase\migrations\*.sql") | Sort-Object { [int]($_.Name -replace '^(\d+).*','$1') }
  $n = 0
  foreach ($m in $migs) {
    $out = & $psql @Hdb -v ON_ERROR_STOP=1 -q -c "set client_min_messages=warning;" -f $m.FullName 2>&1
    if ($LASTEXITCODE -ne 0) { Write-Host $out -ForegroundColor Red; Die "migration falhou: $($m.Name)" }
    $n++
  }
  Say "migrations OK ($n aplicadas)"

  Say "grants + seed..."
  & $psql @Hdb -v ON_ERROR_STOP=1 -q `
    -c "grant usage on schema public to anon, authenticated, service_role;" `
    -c "grant all on all tables in schema public to authenticated, service_role;" `
    -c "grant all on all sequences in schema public to authenticated, service_role;" `
    -c "grant select on all tables in schema public to anon;" `
    -c "grant execute on all functions in schema public to authenticated, anon, service_role;" | Out-Null
  & $psql @Hdb -v ON_ERROR_STOP=1 -q -c "set client_min_messages=warning;" -f (Join-Path $repo "supabase\seeds\validation_seed.sql") | Out-Null
  if ($LASTEXITCODE -ne 0) { Die "validation_seed falhou." }
  & $psql @Hdb -v ON_ERROR_STOP=1 -q -c "set client_min_messages=warning;" -f (Join-Path $repo "scripts\design-audit\seed_audit.sql") | Out-Null
  if ($LASTEXITCODE -ne 0) { Die "seed_audit falhou." }
  Say "banco pronto (login: auditor@local.test / audit-local)"
} else {
  # sanity: DB existe?
  $exists = & $psql @H -tAc "select 1 from pg_database where datname='app';"
  if ($exists -ne "1") { Die "banco 'app' nao existe. Rode com -Rebuild na primeira vez." }
}

# 3) .env aponta para o proxy (mesma origem que o dev server: localhost, NAO 127.0.0.1)
$envFile = Join-Path $repo ".env"
$needEnv = $true
if (Test-Path $envFile) {
  if ((Get-Content $envFile -Raw) -match "localhost:5173/sb-proxy") { $needEnv = $false }
}
if ($needEnv) {
  Say "escrevendo .env (proxy local)..."
  Set-Content -Path $envFile -Encoding UTF8 -Value @(
    "VITE_SUPABASE_URL=http://localhost:5173/sb-proxy"
    "VITE_SUPABASE_ANON_KEY=local-audit-anon-key"
  )
}

# 4) driver pg para o shim
if (-not (Test-Path (Join-Path $repo "node_modules\pg\package.json"))) {
  Say "instalando driver pg (no-save)..."
  Push-Location $repo; npm install pg@^8 --no-save | Out-Null; Pop-Location
}

# 5) shim na :54321 (nao duplicar se ja estiver de pe)
$up = Test-NetConnection -ComputerName 127.0.0.1 -Port 54321 -WarningAction SilentlyContinue
if ($up.TcpTestSucceeded) {
  Say "shim ja esta rodando na :54321"
} else {
  Say "iniciando sb-shim na :54321..."
  $env:PGHOST="127.0.0.1"; $env:PGPORT="5432"; $env:PGDATABASE="app"; $env:PGUSER="postgres"; $env:PGPASSWORD="postgres"
  Start-Process -FilePath "node" -ArgumentList (Join-Path $repo "scripts\design-audit\sb-shim.cjs") -WorkingDirectory $repo -WindowStyle Hidden
  Start-Sleep 2
  $up = Test-NetConnection -ComputerName 127.0.0.1 -Port 54321 -WarningAction SilentlyContinue
  if (-not $up.TcpTestSucceeded) { Die "shim nao subiu. Cheque o Postgres e o driver pg." }
  Say "shim OK"
}

Write-Host ""
Say "Stack pronto. Agora rode o dev server:"
Write-Host "    npm run dev" -ForegroundColor Yellow
Write-Host "  Abra http://localhost:5173  -  login: auditor@local.test / audit-local" -ForegroundColor Yellow
Write-Host "  (se cair no login com falha de conexao, de um hard refresh: Ctrl+Shift+R)" -ForegroundColor DarkGray
