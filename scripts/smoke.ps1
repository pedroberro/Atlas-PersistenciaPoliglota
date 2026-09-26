$ErrorActionPreference='Stop'
$settings=@{}
Get-Content -LiteralPath .env | ForEach-Object { $pair=$_.Split('=',2); if($pair.Length -eq 2){$settings[$pair[0]]=$pair[1]} }
$base='http://localhost:8080/api'
function Post-Json($url,$body,$headers=@{}) { Invoke-RestMethod -Uri "$base$url" -Method Post -ContentType 'application/json' -Headers $headers -Body ($body|ConvertTo-Json -Depth 12 -Compress) }
function Get-Json($url,$headers=@{}) { Invoke-RestMethod -Uri "$base$url" -Headers $headers }
$adminLogin=Post-Json '/auth/login' @{email=$settings.BOOTSTRAP_ADMIN_EMAIL;password=$settings.BOOTSTRAP_ADMIN_PASSWORD}
$adminHeader=@{Authorization="Bearer $($adminLogin.token)"}
$suffix=[guid]::NewGuid().ToString('N').Substring(0,8)
$userEmail="smoke-$suffix@example.test"
$userPassword=[guid]::NewGuid().ToString('N')
$registered=Post-Json '/auth/register' @{fullName='Smoke User';email=$userEmail;password=$userPassword}
$userLogin=Post-Json '/auth/login' @{email=$userEmail;password=$userPassword}
$userHeader=@{Authorization="Bearer $($userLogin.token)"}
$sensor=Post-Json '/sensors' @{code="smoke-$suffix";sensorType='BOTH';latitude=-34.6;longitude=-58.4;city='Buenos Aires';zone='Buenos Aires';country='Argentina';maxTemperature=30} $adminHeader
$now=[DateTime]::UtcNow
$reading=Post-Json "/measurements/sensors/$($sensor.id)/ingest" @{measurementId=[guid]::NewGuid().ToString();measuredAt=$now.ToString('o');temperature=22.5;humidity=61.2} @{'X-Sensor-Key'=$sensor.sensorKey}
$from=$now.AddHours(-1).ToString('o')
$to=$now.AddHours(1).ToString('o')
$scope='Argentina/Buenos Aires/Buenos Aires'
$measurements=Get-Json "/measurements?scopeType=CITY&scopeKey=$([uri]::EscapeDataString($scope))&from=$([uri]::EscapeDataString($from))&to=$([uri]::EscapeDataString($to))" $userHeader
if(@($measurements).Count -lt 1){throw 'Measurement query returned no rows'}
$process=Post-Json '/processes' @{name="Smoke Avg $suffix";description='Smoke average';type='AVERAGE';price=10.00;allowedRoles=@('USER')} $adminHeader
$request=Post-Json "/processes/$($process.id)/requests" @{scopeType='CITY';scopeKey=$scope;from=$from;to=$to;granularity='DAY'} $userHeader
$execution=Post-Json "/processes/requests/$($request.id)/execute" @{} $adminHeader
$history=Get-Json "/processes/requests/$($request.id)/executions" $userHeader
if($history[0].status -ne 'COMPLETED'){throw 'Execution failed'}
$report=Get-Json "/processes/reports/$($history[0].report_id)" $userHeader
if(@($report.result).Count -lt 1){throw 'Report is empty'}
$account=Post-Json '/billing/account' @{} $userHeader
$invoices=Get-Json '/billing/invoices' $userHeader
if(@($invoices).Count -lt 1){throw 'Invoice missing'}
$payment=Post-Json "/billing/invoices/$($invoices[0].id)/payments" @{amount=10.00;method='MANUAL_TEST';reference="smoke-$suffix"} $adminHeader
$accountAfter=Get-Json '/billing/account' $userHeader
if([decimal]$accountAfter.balance -ne 0){throw 'Account balance did not return to zero'}
$invoicesAfter=Get-Json '/billing/invoices' $userHeader
if($invoicesAfter[0].status -ne 'PAID'){throw 'Invoice was not marked paid'}
$messages=Post-Json '/messages/private' @{recipientId=$registered.id;content='Smoke message'} $adminHeader
$conversation=Get-Json "/messages/private/$($registered.id)" $adminHeader
if(@($conversation).Count -lt 1){throw 'Message missing'}
$hotReading=Post-Json "/measurements/sensors/$($sensor.id)/ingest" @{measurementId=[guid]::NewGuid().ToString();measuredAt=[DateTime]::UtcNow.ToString('o');temperature=35.0;humidity=50.0} @{'X-Sensor-Key'=$sensor.sensorKey}
$alerts=Get-Json '/alerts?status=ACTIVE' $adminHeader
if(@($alerts | Where-Object { $_.measurementId -eq $hotReading.id }).Count -lt 1){throw 'Climate alert missing'}
Write-Output "Smoke passed: sensor=$($sensor.id), measurement=$($reading.id), execution=$($execution.executionId), invoice=$($invoices[0].id), payment=$($payment.id), message=$($messages.id)"
