param(
    [string]$ProjectRoot = (Split-Path $PSScriptRoot -Parent),
    [string[]]$Packages = @('gridstack@12.3.3', '@fullcalendar/core@6.1.19', '@fullcalendar/daygrid@6.1.19', '@fullcalendar/interaction@6.1.19', 'rrule@2.8.1')
)
$ErrorActionPreference = 'Stop'
$node = Join-Path (Split-Path (Split-Path $ProjectRoot -Parent) -Parent) '.venv\Lib\site-packages\playwright\driver\node.exe'
$cache = Join-Path $ProjectRoot 'build\npm-runtime'
[System.IO.Directory]::CreateDirectory($cache) | Out-Null
$client = New-Object System.Net.WebClient
$client.Encoding = [Text.Encoding]::UTF8
try {
    if (-not (Test-Path (Join-Path $cache 'package\bin\npm-cli.js'))) {
        $metadata = $client.DownloadString('https://registry.npmjs.org/npm/11.6.1') | ConvertFrom-Json
        $archive = Join-Path $cache 'npm-11.6.1.tgz'
        $client.DownloadFile($metadata.dist.tarball, $archive)
        $hasher = [Security.Cryptography.SHA512]::Create()
        $stream = [IO.File]::OpenRead($archive)
        try { $integrity = 'sha512-' + [Convert]::ToBase64String($hasher.ComputeHash($stream)) } finally { $stream.Dispose(); $hasher.Dispose() }
        if ($integrity -ne $metadata.dist.integrity) { throw 'npm archive integrity mismatch' }
        & tar.exe -xzf $archive -C $cache
        if ($LASTEXITCODE -ne 0) { throw 'npm extraction failed' }
    }
    $arguments = @((Join-Path $cache 'package\bin\npm-cli.js'), 'install', '--prefix', (Join-Path $ProjectRoot 'app'), '--save-exact', '--ignore-scripts', '--no-audit', '--no-fund', '--progress=false', '--fetch-retries=1', '--fetch-timeout=30000') + $Packages
    $registry = [Uri]'https://registry.npmjs.org'
    $proxy = [Net.WebRequest]::DefaultWebProxy.GetProxy($registry)
    if ($proxy -ne $registry) { $arguments += '--https-proxy=' + $proxy.AbsoluteUri }
    & $node --use-system-ca @arguments
    if ($LASTEXITCODE -ne 0) { throw 'Workspace dependency installation failed' }
} finally { $client.Dispose() }