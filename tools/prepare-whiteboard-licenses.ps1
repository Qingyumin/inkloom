param([string]$ProjectRoot, [switch]$Dependencies)
$ErrorActionPreference = 'Stop'
$root = if ($ProjectRoot) { $ProjectRoot } else { Split-Path $PSScriptRoot -Parent }
if ($Dependencies) {
    $missing = (Get-Content (Join-Path $root 'licenses\bundled\manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json).missing | Sort-Object -Unique
    $directory = Join-Path $root 'licenses\upstream-overrides'; [IO.Directory]::CreateDirectory($directory) | Out-Null
    $client = New-Object Net.WebClient; $client.Encoding = [Text.Encoding]::UTF8; $client.Headers.Add('User-Agent', 'Inkloom-License-Preparation'); $cache = @{}; $licenseCommits = @{}; $records = @()
    try {
        foreach ($identity in $missing) {
            $separator = $identity.LastIndexOf('@'); $name = $identity.Substring(0, $separator); $version = $identity.Substring($separator + 1)
            $metadata = $client.DownloadString('https://registry.npmjs.org/' + [Uri]::EscapeDataString($name) + '/' + $version) | ConvertFrom-Json
            $repository = if ($metadata.repository -is [string]) { $metadata.repository } else { $metadata.repository.url }
            $match = [regex]::Match($repository, 'github\.com[:/]([^/]+)/([^/#]+)')
            if (-not $match.Success) { throw ('Unknown license repository: ' + $identity) }
            $repo = $match.Groups[1].Value + '/' + ($match.Groups[2].Value -replace '\.git$', '')
            $commit = $metadata.gitHead; $basis = 'published-package-gitHead'
            if ($commit -notmatch '^[0-9a-f]{40}$') {
                if ($metadata.license -ne 'MIT') { throw ('Missing package source commit for non-MIT package: ' + $identity) }
                if (-not $licenseCommits.ContainsKey($repo)) { try { $commits = $client.DownloadString('https://api.github.com/repos/' + $repo + '/commits?path=LICENSE&per_page=1') | ConvertFrom-Json; $licenseCommits[$repo] = @($commits)[0].sha } catch { $licenseCommits[$repo] = 'main' } }
                $commit = $licenseCommits[$repo]; $basis = 'package-MIT-declaration-and-pinned-root-license'
                if ($commit -eq 'main') { $basis = 'package-MIT-declaration-root-license-content-hash-no-commit' }
            }
            if ($commit -ne 'main' -and $commit -notmatch '^[0-9a-f]{40}$') { throw ('Cannot locate license revision: ' + $identity) }
            $cacheKey = $repo + '/' + $commit; $entry = $cache[$cacheKey]
            if (-not $entry) {
                $candidates = if ($name.StartsWith('micromark')) { @('license', 'LICENSE', 'LICENSE.md') } else { @('LICENSE', 'LICENSE.md', 'license') }
                foreach ($candidate in $candidates) {
                    $url = 'https://raw.githubusercontent.com/' + $cacheKey + '/' + $candidate
                    try { $text = $client.DownloadString($url); if ($text.Length -gt 500 -and $text -match 'license|LICENSE') { $entry = @{ text = $text; url = $url }; break } } catch { }
                }
                if (-not $entry) { throw ('Cannot retrieve original license: ' + $identity) }; $cache[$cacheKey] = $entry
            }
            $file = ($name.Replace('/', '__') -replace '^@', '') + '-' + $version + '-LICENSE.txt'; $target = Join-Path $directory $file
            [IO.File]::WriteAllText($target, $entry.text, (New-Object Text.UTF8Encoding($false)))
            $records += [ordered]@{ name = $name; version = $version; packageGitHead = $metadata.gitHead; licenseCommit = $(if ($commit -eq 'main') { $null } else { $commit }); basis = $basis; retrievedAt = [DateTime]::UtcNow.ToString('o'); url = $entry.url; file = $file; sha256 = (Get-FileHash $target -Algorithm SHA256).Hash.ToLowerInvariant() }
        }
    } finally { $client.Dispose() }
    [IO.File]::WriteAllText((Join-Path $directory 'manifest.json'), (ConvertTo-Json -InputObject $records -Depth 5), (New-Object Text.UTF8Encoding($false)))
    Write-Output ('DEPENDENCY_LICENSE_SOURCES ' + $records.Count); return
}
$directory = Join-Path $root 'licenses\whiteboard-fonts'
[IO.Directory]::CreateDirectory($directory) | Out-Null
$sources = [ordered]@{
    'excalidraw-LICENSE.txt' = 'https://raw.githubusercontent.com/excalidraw/excalidraw/v0.18.0/LICENSE'
    'Assistant-OFL.txt' = 'https://raw.githubusercontent.com/google/fonts/main/ofl/assistant/OFL.txt'
    'Cascadia-OFL.txt' = 'https://raw.githubusercontent.com/microsoft/cascadia-code/v2005.15/LICENSE'
    'Lilita-OFL.txt' = 'https://raw.githubusercontent.com/google/fonts/main/ofl/lilitaone/OFL.txt'
    'Nunito-OFL.txt' = 'https://raw.githubusercontent.com/google/fonts/main/ofl/nunito/OFL.txt'
    'Xiaolai-OFL.txt' = 'https://raw.githubusercontent.com/lxgw/kose-font/master/OFL.txt'
    'harfbuzz-NOTICE.txt' = 'https://raw.githubusercontent.com/excalidraw/excalidraw/v0.18.0/packages/excalidraw/subset/harfbuzz/harfbuzz-wasm.ts'
    'woff2-NOTICE.txt' = 'https://raw.githubusercontent.com/excalidraw/excalidraw/v0.18.0/packages/excalidraw/subset/woff2/woff2-wasm.ts'
}
$client = New-Object Net.WebClient
$client.Encoding = [Text.Encoding]::UTF8
$manifest = @()
try {
    foreach ($name in $sources.Keys) {
        $content = $client.DownloadString($sources[$name])
        if ($name.EndsWith('-NOTICE.txt')) { $match = [regex]::Match($content, '(?s)/\*\*.*?\*/'); if (-not $match.Success) { throw ('Missing upstream license header: ' + $name) }; $content = $match.Value }
        if ($content.Length -lt 500 -or $content -notmatch 'license|LICENSE') { throw ('Invalid license response: ' + $name) }
        $target = Join-Path $directory $name
        [IO.File]::WriteAllText($target, $content, (New-Object Text.UTF8Encoding($false)))
        $manifest += [ordered]@{ file = $name; url = $sources[$name]; sha256 = (Get-FileHash $target -Algorithm SHA256).Hash.ToLowerInvariant() }
    }
} finally { $client.Dispose() }
[IO.File]::WriteAllText((Join-Path $directory 'upstream-sources.json'), (ConvertTo-Json -InputObject $manifest -Depth 5), (New-Object Text.UTF8Encoding($false)))
Write-Output ('WHITEBOARD_LICENSE_SOURCES ' + $manifest.Count)