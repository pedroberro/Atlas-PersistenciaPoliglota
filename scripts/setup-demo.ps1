$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw 'Docker Compose es necesario para preparar la demostración.' }

function New-Secret {
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  $bytes = New-Object byte[] 24
  try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
  return [BitConverter]::ToString($bytes).Replace('-', '')
}

$configPath = Join-Path $root '.env.demo'
if (-not (Test-Path -LiteralPath $configPath)) {
  $postgresPassword = New-Secret
  $mongoPassword = New-Secret
  $redisPassword = New-Secret
  $adminPassword = New-Secret
  $lines = @(
    'DEMO_ENVIRONMENT=true'
    'POSTGRES_USER=clima'
    'POSTGRES_DB=clima'
    "POSTGRES_PASSWORD=$postgresPassword"
    'POSTGRES_PORT=25432'
    'JDBC_URL=jdbc:postgresql://127.0.0.1:25432/clima'
    'MONGO_ROOT_USER=clima'
    "MONGO_ROOT_PASSWORD=$mongoPassword"
    'MONGO_PORT=27018'
    ("MONGO_URI=mongodb://clima:{0}@127.0.0.1:27018/clima?authSource=admin" -f $mongoPassword)
    'CASSANDRA_PORT=9043'
    "REDIS_PASSWORD=$redisPassword"
    'REDIS_PORT=6380'
    'SERVER_PORT=8081'
    'CORS_ORIGIN=http://127.0.0.1:5174'
    'BOOTSTRAP_ADMIN_EMAIL=demo.admin@atlasclima.local'
    "BOOTSTRAP_ADMIN_PASSWORD=$adminPassword"
  )
  [System.IO.File]::WriteAllText($configPath, ($lines -join [Environment]::NewLine) + [Environment]::NewLine, [System.Text.UTF8Encoding]::new($false))
  Write-Output 'Se creó .env.demo con credenciales nuevas para esta copia local.'
} else {
  Write-Output 'Se reutilizará .env.demo; sus credenciales no se modifican.'
}

$settings = @{}
Get-Content -LiteralPath $configPath | ForEach-Object {
  $parts = $_.Split('=', 2)
  if ($parts.Length -eq 2) { $settings[$parts[0]] = $parts[1] }
}
$expected = @{
  DEMO_ENVIRONMENT = 'true'
  POSTGRES_PORT = '25432'
  MONGO_PORT = '27018'
  CASSANDRA_PORT = '9043'
  REDIS_PORT = '6380'
  SERVER_PORT = '8081'
  BOOTSTRAP_ADMIN_EMAIL = 'demo.admin@atlasclima.local'
}
foreach ($name in $expected.Keys) {
  if ($settings[$name] -ne $expected[$name]) { throw ".env.demo debe conservar $name=$($expected[$name]) para aislar la demostración." }
}

$composeArgs = @('compose', '--project-name', 'atlasclima-demo', '--env-file', '.env.demo')
& docker @composeArgs up -d
if ($LASTEXITCODE -ne 0) { throw 'No se pudieron iniciar las bases de datos de demostración.' }

$ready = $false
$previousErrorPreference = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
try {
  for ($attempt = 1; $attempt -le 90; $attempt++) {
    & docker @composeArgs exec -T cassandra cqlsh -e 'DESCRIBE KEYSPACES' *> $null
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    if ($attempt % 6 -eq 0) { Write-Output 'Esperando a que Cassandra esté lista...' }
    Start-Sleep -Seconds 5
  }
} finally {
  $ErrorActionPreference = $previousErrorPreference
}
if (-not $ready) { throw 'Cassandra no respondió. Revisá docker compose --project-name atlasclima-demo --env-file .env.demo ps.' }

& docker @composeArgs exec -T cassandra cqlsh -f /schema.cql
if ($LASTEXITCODE -ne 0) { throw 'No se pudo crear el esquema Cassandra de la demostración.' }

Write-Output 'Bases de demostración listas. El siguiente paso es iniciar el backend con APP_ENV_FILE=.env.demo.'
Write-Output 'Las credenciales del administrador demo están en .env.demo (BOOTSTRAP_ADMIN_EMAIL y BOOTSTRAP_ADMIN_PASSWORD).'
