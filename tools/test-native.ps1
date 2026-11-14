param([string]$ProjectRoot)
$ErrorActionPreference = 'Stop'
$root = if ($ProjectRoot) { $ProjectRoot } else { Split-Path $PSScriptRoot -Parent }
$shared = Join-Path $root 'vendor\inklet\native'
$out = Join-Path $root 'verification\VaultStoreTests.exe'
[void][IO.Directory]::CreateDirectory((Split-Path $out))
& "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe" /nologo /codepage:65001 /target:exe /define:INKLOOM_TEST /reference:System.Web.Extensions.dll /out:$out "$shared\FileStore.cs" "$shared\OpenHistory.cs" "$root\native\VaultStore.cs" "$root\native\VaultStoreTests.cs"
if ($LASTEXITCODE -ne 0) { throw 'Native test compilation failed' }
$lines = @(& $out $root)
if ($LASTEXITCODE -ne 0) { throw 'Native storage test failed' }
$lines | Write-Output
$metadata = Get-Content (Join-Path $root 'app\package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$name = 'native-' + [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH-mm-ss.fffZ') + '-results.json'
$report = [ordered]@{
	report = 'verification/' + $name
	passed = $true
	version = $metadata.version
	checkedAt = [DateTime]::UtcNow.ToString('o')
	environment = 'Isolated temporary profiles; .NET Framework test executable'
	nativeFaultInjection = $true
	checks = @($lines | Where-Object { $_ -match '^INKLOOM_(ROLLBACK|SNAPSHOT|VAULT_SWITCH|RECOVERY|STARTUP|MIGRATION|SCAN|ACL|CRASH|CROSS_VOLUME|WATCHER|CAPTURE|READER)_PASS ' })
	skipped = @($lines | Where-Object { $_ -match '_SKIP ' })
	baseline = @($lines | Where-Object { $_ -match '^INKLOOM_NATIVE_STORAGE_PASS ' })
	sourceSha256 = (Get-FileHash (Join-Path $root 'native\VaultStore.cs') -Algorithm SHA256).Hash.ToLowerInvariant()
	testSha256 = (Get-FileHash (Join-Path $root 'native\VaultStoreTests.cs') -Algorithm SHA256).Hash.ToLowerInvariant()
	testExecutableSha256 = (Get-FileHash $out -Algorithm SHA256).Hash.ToLowerInvariant()
} | ConvertTo-Json -Depth 5
$encoding = New-Object Text.UTF8Encoding($false)
[IO.File]::WriteAllText((Join-Path $root ('verification\' + $name)), $report + [char]10, $encoding)
[IO.File]::WriteAllText((Join-Path $root 'verification\native-results.json'), $report + [char]10, $encoding)