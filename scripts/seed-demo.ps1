param([switch]$Force, [switch]$Demo)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$statePath = Join-Path $root $(if ($Demo) { 'demo-seed-state-public.json' } else { 'demo-seed-state.json' })
$credentialsPath = Join-Path $root $(if ($Demo) { 'demo-credentials-public.json' } else { 'demo-credentials.json' })
if ((Test-Path $statePath) -and -not $Force) {
  Write-Output 'Los datos de demostración ya fueron cargados. Usá -Force para agregar una nueva semana de lecturas.'
  exit 0
}
$settings = @{}
$configFile = if ($Demo) { '.env.demo' } else { '.env' }
if (-not (Test-Path -LiteralPath $configFile)) { throw "Falta $configFile." }
Get-Content -LiteralPath $configFile | ForEach-Object { $parts = $_.Split('=', 2); if ($parts.Length -eq 2) { $settings[$parts[0]] = $parts[1] } }
if ($Demo -and $settings.DEMO_ENVIRONMENT -ne 'true') { throw '.env.demo no corresponde a una demo aislada.' }
if (-not $settings.BOOTSTRAP_ADMIN_EMAIL -or -not $settings.BOOTSTRAP_ADMIN_PASSWORD) { throw "Configurá el administrador inicial en $configFile antes de sembrar datos." }
$base = if ($Demo) { 'http://127.0.0.1:8081/api' } else { 'http://127.0.0.1:8080/api' }
function Call-Api([string]$method, [string]$path, $body, [string]$token = '') {
  $headers = @{}
  if ($token) { $headers.Authorization = "Bearer $token" }
  $parameters = @{ Uri = "$base$path"; Method = $method; Headers = $headers; TimeoutSec = 40 }
  if ($null -ne $body) { $parameters.Body = $body | ConvertTo-Json -Depth 20 -Compress; $parameters.ContentType = 'application/json; charset=utf-8' }
  try { return Invoke-RestMethod @parameters }
  catch {
    $status = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 0 }
    $detail = ''
    if ($_.Exception.Response) { $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream()); $detail = $reader.ReadToEnd() }
    throw "API $method $path falló ($status): $detail"
  }
}
function New-Secret {
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  $bytes = New-Object byte[] 24
  $rng.GetBytes($bytes); $rng.Dispose()
  return [BitConverter]::ToString($bytes).Replace('-', '')
}
function Iso([DateTime]$value) { return $value.ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ') }

$admin = Call-Api 'POST' '/auth/login' @{ email = $settings.BOOTSTRAP_ADMIN_EMAIL; password = $settings.BOOTSTRAP_ADMIN_PASSWORD }
$existingUsers = Call-Api 'GET' '/users' $null $admin.token
if (Test-Path $credentialsPath) { $credentials = Get-Content -LiteralPath $credentialsPath -Raw -Encoding UTF8 | ConvertFrom-Json }
else {
  $credentials = [pscustomobject]@{
    customer = [pscustomobject]@{ email = 'demo.cliente@atlasclima.local'; password = New-Secret; role = 'USER' }
    technician = [pscustomobject]@{ email = 'demo.tecnico@atlasclima.local'; password = New-Secret; role = 'TECHNICIAN' }
  }
  $credentials | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $credentialsPath -Encoding UTF8
}
foreach ($person in @(@{ record = $credentials.customer; name = 'Lucía Fernández' }, @{ record = $credentials.technician; name = 'Mateo Ríos' })) {
  $found = $existingUsers | Where-Object { $_.email -eq $person.record.email } | Select-Object -First 1
  if (-not $found) {
    Call-Api 'POST' '/auth/register' @{ fullName = $person.name; email = $person.record.email; password = $person.record.password } | Out-Null
    $existingUsers = Call-Api 'GET' '/users' $null $admin.token
  }
}
$customerRecord = $existingUsers | Where-Object { $_.email -eq $credentials.customer.email } | Select-Object -First 1
$technicianRecord = $existingUsers | Where-Object { $_.email -eq $credentials.technician.email } | Select-Object -First 1
Call-Api 'POST' "/users/$($technicianRecord.id)/roles" @{ role = 'TECHNICIAN' } $admin.token | Out-Null
$customer = Call-Api 'POST' '/auth/login' @{ email = $credentials.customer.email; password = $credentials.customer.password }
$technician = Call-Api 'POST' '/auth/login' @{ email = $credentials.technician.email; password = $credentials.technician.password }

$stations = @(
  @{ code='DEMO-BA-01'; city='Buenos Aires'; zone='Buenos Aires'; country='Argentina'; lat=-34.6037; lon=-58.3816; mean=18.0; seasonal=7.0; peak=1; daily=4.2; humidity=71; offset=-3; max=38 },
  @{ code='DEMO-ST-02'; city='Santiago'; zone='Metropolitan Region'; country='Chile'; lat=-33.4489; lon=-70.6693; mean=17.0; seasonal=8.0; peak=1; daily=5.5; humidity=59; offset=-4; max=38 },
  @{ code='DEMO-MD-03'; city='Madrid'; zone='Community of Madrid'; country='Spain'; lat=40.4168; lon=-3.7038; mean=14.5; seasonal=11.5; peak=7; daily=6.2; humidity=56; offset=2; max=32 },
  @{ code='DEMO-RK-04'; city='Reykjavik'; zone='Capital Region'; country='Iceland'; lat=64.1466; lon=-21.9426; mean=5.0; seasonal=6.5; peak=7; daily=2.0; humidity=77; offset=0; max=25 },
  @{ code='DEMO-NB-05'; city='Nairobi'; zone='Nairobi County'; country='Kenya'; lat=-1.2921; lon=36.8219; mean=19.5; seasonal=1.5; peak=2; daily=5.0; humidity=68; offset=3; max=35 },
  @{ code='DEMO-SG-06'; city='Singapore'; zone='Central Region'; country='Singapore'; lat=1.3521; lon=103.8198; mean=28.0; seasonal=1.0; peak=5; daily=2.3; humidity=79; offset=8; max=38 },
  @{ code='DEMO-TK-07'; city='Tokyo'; zone='Tokyo'; country='Japan'; lat=35.6762; lon=139.6503; mean=16.5; seasonal=11.0; peak=8; daily=4.5; humidity=68; offset=9; max=38 },
  @{ code='DEMO-SY-08'; city='Sydney'; zone='New South Wales'; country='Australia'; lat=-33.8688; lon=151.2093; mean=18.5; seasonal=6.5; peak=1; daily=4.5; humidity=65; offset=10; max=38 },
  @{ code='DEMO-NY-09'; city='New York'; zone='New York'; country='United States'; lat=40.7128; lon=-74.0060; mean=13.0; seasonal=12.0; peak=7; daily=5.0; humidity=63; offset=-4; max=38 }
)
$existingSensors = Call-Api 'GET' '/sensors' $null $admin.token
foreach ($station in $stations) {
  $found = $existingSensors | Where-Object { $_.code -eq $station.code } | Select-Object -First 1
  if (-not $found) {
    $created = Call-Api 'POST' '/sensors' @{ code=$station.code; sensorType='BOTH'; latitude=$station.lat; longitude=$station.lon; city=$station.city; zone=$station.zone; country=$station.country; maxTemperature=$station.max; minHumidity=15; maxHumidity=96 } $admin.token
    $station.id = $created.id; $station.key = $created.sensorKey
  } else {
    $station.id = $found.id
    $rotated = Call-Api 'POST' "/sensors/$($station.id)/key" @{} $admin.token
    $station.key = $rotated.sensorKey
    if ($found.status -ne 'ACTIVE') { Call-Api 'POST' "/sensors/$($station.id)/controls" @{ status='ACTIVE'; notes='Estación calibrada para la nueva demostración.' } $technician.token | Out-Null }
  }
}
Write-Output "Cargando mediciones plausibles para $($stations.Count) estaciones globales..."
$anchor = [DateTime]::UtcNow
$anchor = [DateTime]::SpecifyKind($anchor.AddMinutes(-$anchor.Minute).AddSeconds(-$anchor.Second).AddMilliseconds(-$anchor.Millisecond), [DateTimeKind]::Utc)
$readingCount = 0
foreach ($station in $stations) {
  foreach ($step in (56..0)) {
    $at = $anchor.AddHours(-3 * $step)
    $localHour = ($at.Hour + $station.offset + 24) % 24
    $season = $station.mean + $station.seasonal * [Math]::Cos(2 * [Math]::PI * ($at.Month - $station.peak) / 12)
    $cycle = $station.daily * [Math]::Sin(2 * [Math]::PI * ($localHour - 9) / 24)
    $variation = 0.65 * [Math]::Sin(($step + 1) * 1.47 + $station.lat)
    $temperature = [Math]::Round($season + $cycle + $variation, 1)
    $humidity = [Math]::Round([Math]::Max(25, [Math]::Min(94, $station.humidity - $cycle * 1.8 + 3.2 * [Math]::Cos($step * 0.73 + $station.lon))), 1)
    Call-Api 'POST' "/measurements/sensors/$($station.id)" @{ measurementId=[guid]::NewGuid().ToString(); measuredAt=(Iso $at); temperature=$temperature; humidity=$humidity } $technician.token | Out-Null
    $readingCount++
  }
  Write-Output "  $($station.city): 57 lecturas"
}
$madrid = $stations | Where-Object { $_.city -eq 'Madrid' } | Select-Object -First 1
$heatTime = $anchor.AddHours(-1)
for ($offset = 1; $offset -le 24; $offset++) {
  $candidate = $anchor.AddHours(-$offset)
  if ((($candidate.Hour + $madrid.offset + 24) % 24) -eq 15) { $heatTime = $candidate; break }
}
Call-Api 'POST' "/measurements/sensors/$($madrid.id)" @{ measurementId=[guid]::NewGuid().ToString(); measuredAt=(Iso $heatTime); temperature=34.2; humidity=34.8 } $technician.token | Out-Null
$readingCount++
$nairobi = $stations | Where-Object { $_.city -eq 'Nairobi' } | Select-Object -First 1
Call-Api 'POST' "/sensors/$($nairobi.id)/controls" @{ status='FAULT'; notes='Pérdida intermitente de alimentación; revisión técnica programada.' } $technician.token | Out-Null

$processSpecs = @(
  @{ name='Promedio termohigrométrico'; description='Temperatura y humedad promedio por día, mes o año en una ciudad, zona o país.'; type='AVERAGE'; price=12.00 },
  @{ name='Extremos por período'; description='Valores máximos y mínimos de temperatura y humedad en el rango seleccionado.'; type='MIN_MAX'; price=9.50 },
  @{ name='Eventos fuera de rango'; description='Lecturas que superan los límites de temperatura o humedad elegidos.'; type='THRESHOLD'; price=7.00 },
  @{ name='Lecturas detalladas'; description='Consulta en línea de las mediciones originales de los sensores.'; type='RAW'; price=3.00 },
  @{ name='Monitoreo periódico'; description='Informe de promedios con una ventana móvil y ejecución recurrente.'; type='PERIODIC_AVERAGE'; price=15.00 }
)
$catalog = Call-Api 'GET' '/processes' $null $admin.token
foreach ($spec in $processSpecs) {
  $found = $catalog | Where-Object { $_.name -eq $spec.name } | Select-Object -First 1
  if (-not $found) {
    $created = Call-Api 'POST' '/processes' @{ name=$spec.name; description=$spec.description; type=$spec.type; price=$spec.price; allowedRoles=@('USER','TECHNICIAN') } $admin.token
    $spec.id = $created.id
  } else { $spec.id = $found.id }
}
Call-Api 'POST' '/billing/account' @{} $customer.token | Out-Null
$from = Iso ($anchor.AddDays(-6))
$to = Iso (([DateTime]::UtcNow).AddMinutes(5))
$reportSpecs = @(
  @{ process='AVERAGE'; city='Buenos Aires'; execute=$true },
  @{ process='MIN_MAX'; city='Tokyo'; execute=$true },
  @{ process='THRESHOLD'; city='Madrid'; execute=$true },
  @{ process='RAW'; city='Singapore'; execute=$false }
)
$requestIds = @()
foreach ($entry in $reportSpecs) {
  $station = $stations | Where-Object { $_.city -eq $entry.city } | Select-Object -First 1
  $process = $processSpecs | Where-Object { $_.type -eq $entry.process } | Select-Object -First 1
  $body = @{ scopeType='CITY'; scopeKey="$($station.country)/$($station.zone)/$($station.city)"; from=$from; to=$to; granularity='DAY' }
  if ($entry.process -eq 'THRESHOLD') { $body.maxTemperature = 32 }
  $requested = Call-Api 'POST' "/processes/$($process.id)/requests" $body $customer.token
  $requestIds += $requested.id
  if ($entry.execute) { Call-Api 'POST' "/processes/requests/$($requested.id)/execute" @{} $admin.token | Out-Null }
}
$invoices = Call-Api 'GET' '/billing/invoices' $null $customer.token
$firstInvoice = $invoices | Where-Object { [decimal]$_.total -eq 12 -and $_.status -ne 'PAID' } | Select-Object -First 1
if ($firstInvoice) { Call-Api 'POST' "/billing/invoices/$($firstInvoice.id)/payments" @{ amount=12.00; method='BANK_TRANSFER'; reference="DEMO-$([guid]::NewGuid().ToString('N').Substring(0,12))" } $admin.token | Out-Null }

Call-Api 'POST' '/messages/private' @{ recipientId=$customerRecord.id; content='Hola Lucía, ya están disponibles los informes de Buenos Aires y Tokio. También registramos un pico de calor en Madrid.' } $technician.token | Out-Null
Call-Api 'POST' '/messages/private' @{ recipientId=$technicianRecord.id; content='Gracias, Mateo. Revisaré la alerta de Madrid y usaré los promedios para el informe semanal.' } $customer.token | Out-Null
$groupName = 'Operaciones climáticas'
$groups = Call-Api 'GET' '/messages/groups' $null $customer.token
$group = $groups | Where-Object { $_.name -eq $groupName } | Select-Object -First 1
if (-not $group) { $group = Call-Api 'POST' '/messages/groups' @{ name=$groupName } $admin.token }
foreach ($memberId in @($customerRecord.id, $technicianRecord.id)) { Call-Api 'POST' "/messages/groups/$($group.id)/members/$memberId" @{} $admin.token | Out-Null }
$adminRecord = $existingUsers | Where-Object { $_.email -eq $settings.BOOTSTRAP_ADMIN_EMAIL } | Select-Object -First 1
if ($adminRecord) { Call-Api 'POST' "/messages/groups/$($group.id)/members/$($adminRecord.id)" @{} $admin.token | Out-Null }
Call-Api 'POST' "/messages/groups/$($group.id)" @{ content='El tablero global ya incluye las nueve estaciones. Nairobi está en revisión técnica; las demás continúan transmitiendo.' } $technician.token | Out-Null
Call-Api 'POST' "/messages/groups/$($group.id)" @{ content='Perfecto. El seguimiento comercial y las facturas ya están disponibles en la plataforma.' } $admin.token | Out-Null

[pscustomobject]@{ seededAt=(Iso ([DateTime]::UtcNow)); sensorCount=$stations.Count; measurementCount=$readingCount; requestIds=$requestIds } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $statePath -Encoding UTF8
Write-Output "Listo: $($stations.Count) sensores, $readingCount mediciones, 5 procesos, 4 solicitudes, 3 informes, facturas, un pago, dos alertas y mensajes."
Write-Output "Credenciales de demo: $credentialsPath (ignorado por Git)."
