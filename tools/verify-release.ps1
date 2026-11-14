param([string]$ProjectRoot, [string]$ReleaseName = 'Inkloom-3.1.0')
$ErrorActionPreference = 'Stop'
$root = if ($ProjectRoot) { $ProjectRoot } else { Split-Path $PSScriptRoot -Parent }
$release = Join-Path $root ('release\' + $ReleaseName)
$archive = Join-Path $root ('release\' + $ReleaseName + '-Windows-x64.zip')
$metadata = Get-Content (Join-Path $root 'app\package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
Add-Type -AssemblyName System.IO.Compression.FileSystem
$sha = [Security.Cryptography.SHA256]::Create()
function StreamHash($stream) { return [BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-', '').ToLowerInvariant() }
$package = [IO.Compression.ZipFile]::OpenRead($archive)
$checked = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
try {
    foreach ($entry in $package.Entries) {
        $entryPath = $entry.FullName.Replace('\', '/')
        if ($entryPath.EndsWith('/')) { continue }
        $prefix = $ReleaseName + '/'
        if (-not $entryPath.StartsWith($prefix)) { throw ('Unexpected archive path: ' + $entry.FullName) }
        $relative = $entryPath.Substring($prefix.Length)
        $target = [IO.Path]::GetFullPath((Join-Path $release $relative))
        if (-not $target.StartsWith(([IO.Path]::GetFullPath($release) + '\'), [StringComparison]::OrdinalIgnoreCase)) { throw 'Archive path escapes release' }
        if (-not $checked.Add($relative)) { throw ('Duplicate archive entry: ' + $relative) }
        $stream = $entry.Open()
        try { $inside = StreamHash $stream } finally { $stream.Dispose() }
        $outside = (Get-FileHash $target -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($inside -ne $outside) { throw ('Archive differs from release file: ' + $relative) }
    }
} finally { $package.Dispose() }
$files = @(Get-ChildItem $release -File -Recurse)
if ($checked.Count -ne $files.Count) { throw 'Archive file count differs from release directory' }
$exe = Join-Path $release 'Inkloom.exe'
$version = [Diagnostics.FileVersionInfo]::GetVersionInfo($exe).FileVersion
if ($version -ne ($metadata.version + '.0')) { throw 'Executable version does not match package metadata' }
$nativeMetadata = [Text.Encoding]::UTF8.GetString([IO.File]::ReadAllBytes($exe))
foreach ($hook in @('get_RenameCheckpoint', 'set_RenameCheckpoint', 'get_SourceVerifiedCheckpoint', 'set_SourceVerifiedCheckpoint')) {
    if ($nativeMetadata.Contains($hook + [char]0)) { throw ('Native test hook leaked: ' + $hook) }
}
foreach ($license in @('comlink', 'd3-force', 'd3-dispatch', 'd3-quadtree', 'd3-timer', 'tanstack-table-core', 'postcss', 'postcss-value-parser', 'nanoid', 'picocolors', 'source-map-js', 'gridstack', 'preact', 'fullcalendar-core', 'fullcalendar-daygrid', 'fullcalendar-interaction')) {
    if (-not (Test-Path (Join-Path $release ('licenses\' + $license + '-LICENSE.txt')))) { throw ('Missing license: ' + $license) }
}
foreach ($license in @('rrule-LICENSE.txt', 'tslib-LICENSE.txt', 'tslib-CopyrightNotice.txt')) { if (-not (Test-Path (Join-Path $release ('licenses\' + $license)))) { throw ('Missing license: ' + $license) } }
$bundled = Get-Content (Join-Path $release 'licenses\bundled\manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if (@($bundled.missing).Count -ne 0 -or @($bundled.packages).Count -lt 100) { throw 'Bundled license coverage is incomplete' }
foreach ($packageLicense in $bundled.packages) { foreach ($file in $packageLicense.files) { if (-not (Test-Path (Join-Path $release ('licenses\bundled\' + $file)))) { throw ('Missing bundled license text: ' + $file) } } }
$fonts = Get-Content (Join-Path $release 'licenses\whiteboard-fonts\font-manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if (@($fonts.families).Count -ne 8) { throw 'Whiteboard font families are incomplete' }
$resourcesPath = Join-Path $release 'Inkloom.resources'
$resources = [IO.Compression.ZipFile]::OpenRead($resourcesPath)
$javascriptFiles = 0
$fontFiles = 0
try {
    $resourceIndex = @{}
    foreach ($entry in $resources.Entries) { $resourceIndex[$entry.FullName.Replace('\', '/')] = $entry }
    $indexEntry = $resourceIndex['index.html']
    if (-not $indexEntry) { throw 'Missing index.html in Inkloom.resources' }
    $indexStream = $indexEntry.Open()
    try { $packagedIndexHash = StreamHash $indexStream } finally { $indexStream.Dispose() }
    $distIndexHash = (Get-FileHash (Join-Path $root 'app\dist\index.html') -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($packagedIndexHash -ne $distIndexHash) { throw 'Inkloom.resources index.html is stale and does not match app/dist/index.html' }
    foreach ($family in $fonts.families) {
        foreach ($licenseFile in @($family.licenseFile, $family.noticeFile)) { if (-not (Test-Path (Join-Path $release ('licenses\whiteboard-fonts\' + $licenseFile)))) { throw ('Missing font attribution: ' + $licenseFile) } }
        foreach ($font in $family.files) {
            $entry = $resourceIndex['excalidraw/fonts/' + $font.path]
            if (-not $entry) { throw ('Missing packaged font: ' + $font.path) }
            $stream = $entry.Open()
            try { $hash = StreamHash $stream } finally { $stream.Dispose() }
            if ($hash -ne $font.sha256) { throw ('Packaged font differs from audited bytes: ' + $font.path) }
            $fontFiles++
        }
    }
    if ($fontFiles -ne 233 -or @($resourceIndex.Keys | Where-Object { $_ -like '*Liberation*' }).Count -ne 0) { throw 'Whiteboard font inventory mismatch' }
    foreach ($entry in $resources.Entries) {
        if (-not $entry.FullName.EndsWith('.js')) { continue }
        $reader = New-Object IO.StreamReader($entry.Open(), [Text.Encoding]::UTF8)
        try { $source = $reader.ReadToEnd() } finally { $reader.Dispose() }
        if ($source.Contains('window.inkloomTest') -or $source.Contains('window.inkletTest')) { throw ('Production test API leaked: ' + $entry.FullName) }
        $javascriptFiles++
    }
} finally { $resources.Dispose(); $sha.Dispose() }
$result = [ordered]@{
    passed = $true
    checkedAt = (Get-Date).ToUniversalTime().ToString('o')
    version = $metadata.version
    executableVersion = $version
    filesCompared = $checked.Count
    javascriptFiles = $javascriptFiles
    bundledLicensePackages = @($bundled.packages).Count
    whiteboardFontFiles = $fontFiles
    productionTestApi = $false
    nativeFaultInjection = $false
    archiveBytes = (Get-Item $archive).Length
    exeSha256 = (Get-FileHash $exe -Algorithm SHA256).Hash.ToLowerInvariant()
    resourcesSha256 = (Get-FileHash $resourcesPath -Algorithm SHA256).Hash.ToLowerInvariant()
    zipSha256 = (Get-FileHash $archive -Algorithm SHA256).Hash.ToLowerInvariant()
    sourceLockSha256 = (Get-FileHash (Join-Path $root 'shared-source-lock.json') -Algorithm SHA256).Hash.ToLowerInvariant()
    dependencyLockSha256 = (Get-FileHash (Join-Path $root 'app\package-lock.json') -Algorithm SHA256).Hash.ToLowerInvariant()
}
$evidence = @()
foreach ($gate in @(
    @{ File = 'creation-browser-results.json'; Count = 8; Desktop = $false },
    @{ File = 'creation-desktop-results.json'; Count = 7; Desktop = $true },
    @{ File = 'planning-browser-results.json'; Count = 4; Desktop = $false },
    @{ File = 'planning-desktop-results.json'; Count = 4; Desktop = $true },
    @{ File = 'workspace-browser-results.json'; Count = 6; Desktop = $false },
    @{ File = 'workspace-desktop-results.json'; Count = 6; Desktop = $true },
    @{ File = 'phase3-browser-results.json'; Count = 22; Desktop = $false },
    @{ File = 'phase3-desktop-results.json'; Count = 21; Desktop = $true },
    @{ File = 'appearance-desktop-results.json'; Count = 6; Desktop = $true },
    @{ File = 'appearance-browser-results.json'; Count = 7; Desktop = $false },
    @{ File = 'speech-browser-results.json'; Count = 5; Desktop = $false },
    @{ File = 'speech-desktop-results.json'; Count = 6; Desktop = $true },
    @{ File = 'ux-browser-results.json'; Count = 10; Desktop = $false },
    @{ File = 'ux-desktop-results.json'; Count = 10; Desktop = $true }
)) {
    $check = Get-Content (Join-Path $root ('verification\' + $gate.File)) -Raw -Encoding UTF8 | ConvertFrom-Json
    if (-not $check.passed -or $check.version -ne $metadata.version -or @($check.checks).Count -ne $gate.Count) { throw ('Incomplete or stale verification: ' + $gate.File) }
    if ($gate.Desktop -and $check.exeSha256 -ne $result.exeSha256) { throw ('Verification executable mismatch: ' + $gate.File) }
    if ($gate.Desktop -and $check.resourcesSha256 -ne $result.resourcesSha256) { throw ('Verification resources mismatch: ' + $gate.File) }
    if ($check.frontendEntrySha256 -ne (Get-FileHash (Join-Path $root 'app\dist\index.html') -Algorithm SHA256).Hash.ToLowerInvariant()) { throw ('Verification frontend mismatch: ' + $gate.File) }
    if ($gate.File.StartsWith('ux-') -and -not @($check.checks | Where-Object { $_.name -eq 'ux viewport shell and compact palettes remain usable across views' -and $_.status -eq 'PASS' }).Count) { throw ('Workspace layout verification missing: ' + $gate.File) }
    $evidence += [ordered]@{ file = $gate.File; report = $check.report; checks = @($check.checks).Count; passed = $true }
}
$benchmark = Get-Content (Join-Path $root 'verification\benchmark-results.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if (-not $benchmark.passed -or $benchmark.version -ne $metadata.version -or @($benchmark.results).Count -ne 3) { throw 'Performance verification incomplete' }
foreach ($property in $benchmark.sourceHashes.PSObject.Properties) { if ((Get-FileHash (Join-Path $root $property.Name) -Algorithm SHA256).Hash.ToLowerInvariant() -ne $property.Value) { throw ('Performance source mismatch: ' + $property.Name) } }
$native = Get-Content (Join-Path $root 'verification\native-results.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if (-not $native.passed -or $native.version -ne $metadata.version -or @($native.checks).Count -ne 19 -or @($native.skipped).Count -ne 0 -or $native.sourceSha256 -ne (Get-FileHash (Join-Path $root 'native\VaultStore.cs') -Algorithm SHA256).Hash.ToLowerInvariant() -or $native.testSha256 -ne (Get-FileHash (Join-Path $root 'native\VaultStoreTests.cs') -Algorithm SHA256).Hash.ToLowerInvariant()) { throw 'Native storage verification incomplete or stale' }
$docs = Get-Content (Join-Path $root 'verification\docs-results.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if (-not $docs.passed -or $docs.version -ne $metadata.version -or $docs.documents -ne 14) { throw 'Documentation verification incomplete' }
$core = Get-Content (Join-Path $root ('verification\core-' + $metadata.version + '.tap')) -Raw
if ($core -notmatch '(?m)^# tests 164\s*$' -or $core -notmatch '(?m)^# pass 164\s*$' -or $core -notmatch '(?m)^# fail 0\s*$') { throw 'Core test verification incomplete' }
$result.verification = $evidence
$visual = Get-Content (Join-Path $root 'verification\ui-review-results.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if (-not $visual.passed -or $visual.version -ne $metadata.version -or $visual.exeSha256 -ne $result.exeSha256 -or $visual.resourcesSha256 -ne $result.resourcesSha256 -or @($visual.reviewedPanels).Count -ne 15) { throw 'Visual review is missing or bound to another build' }
$uxDesktop = Get-Content (Join-Path $root 'verification\ux-desktop-results.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if ($visual.uxDesktopReport -ne $uxDesktop.report -or $visual.frontendEntrySha256 -ne $uxDesktop.frontendEntrySha256) { throw 'Visual review does not match the reviewed UX evidence' }
foreach ($panel in $visual.reviewedPanels) { if (-not (Test-Path (Join-Path (Split-Path (Join-Path $root $visual.uxDesktopReport) -Parent) $panel.image))) { throw ('Reviewed screenshot missing: ' + $panel.image) } }
$result.visualReview = $visual
$result.coreTests = 164
$result.nativeChecks = @($native.checks).Count
$result.benchmark = $benchmark.report
$result.documentation = $docs
$report = $result | ConvertTo-Json -Depth 10
[IO.File]::WriteAllText((Join-Path $root 'verification\release-results.json'), $report + [char]10, (New-Object Text.UTF8Encoding($false)))
Write-Output $report
Write-Output 'INKLOOM_RELEASE_PASS'
$node = (Resolve-Path (Join-Path $root '..\..\.venv\Lib\site-packages\playwright\driver\node.exe')).Path
& $node --test --test-reporter=tap (Join-Path $root 'tools\prune-releases.test.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Rolling retention tests failed' }
& $node (Join-Path $root 'tools\prune-releases.mjs') --apply --version $metadata.version --summary
if ($LASTEXITCODE -ne 0) { throw 'Release passed, but rolling retention requires attention' }