param([string]$ReleaseName = 'Inkloom-3.1.0', [string]$ProjectRoot)
$ErrorActionPreference = 'Stop'
trap { Write-Output ($_ | Out-String); exit 1 }

$root = if ($ProjectRoot) { $ProjectRoot } else { Split-Path $PSScriptRoot -Parent }
$metadata = Get-Content (Join-Path $root 'app\package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if ($ReleaseName -ne ('Inkloom-' + $metadata.version)) { throw 'Release name does not match source version; an earlier release will not be overwritten.' }
$inklet = Resolve-Path (Join-Path $root 'vendor\inklet')
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
$fallbackNode = Join-Path $root '..\..\.venv\Lib\site-packages\playwright\driver\node.exe'
$node = if ($nodeCommand) { $nodeCommand.Source } elseif (Test-Path $fallbackNode) { (Resolve-Path $fallbackNode).Path } else { throw 'Node.js (>= 20 LTS) is required on PATH to build Inkloom.' }
$env:Path = (Split-Path $node) + ';' + $env:Path

& $node "$root\tools\build-web.mjs"
if ($LASTEXITCODE -ne 0) { throw "Frontend build failed: $LASTEXITCODE" }

$release = Join-Path (Join-Path $root 'release') $ReleaseName
if (Get-Process Inkloom -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq (Join-Path $release 'Inkloom.exe') }) {
    throw 'Save your documents and close the running Inkloom window before rebuilding.'
}
[void][IO.Directory]::CreateDirectory($release)

Add-Type -AssemblyName System.IO.Compression.FileSystem
$resources = Join-Path $release 'Inkloom.resources'
if (Test-Path $resources) { Remove-Item $resources -Force }
[IO.Compression.ZipFile]::CreateFromDirectory((Join-Path $root 'app\dist'), $resources, [IO.Compression.CompressionLevel]::Optimal, $false)

$sdk = Join-Path $inklet '.tools\webview2'
Copy-Item "$sdk\lib\net462\Microsoft.Web.WebView2.Core.dll" $release -Force
Copy-Item "$sdk\lib\net462\Microsoft.Web.WebView2.WinForms.dll" $release -Force
Copy-Item "$sdk\runtimes\win-x64\native\WebView2Loader.dll" $release -Force
Copy-Item "$root\assets\Inkloom.ico" (Join-Path $release 'Inkloom.ico') -Force
Copy-Item "$root\assets\Inkloom-dark.ico" (Join-Path $release 'Inkloom-dark.ico') -Force
Copy-Item "$inklet\assets\Markdown.ico" (Join-Path $release 'Markdown.ico') -Force
if (Test-Path (Join-Path $release 'licenses')) { Remove-Item (Join-Path $release 'licenses') -Recurse -Force }
Copy-Item "$root\licenses" (Join-Path $release 'licenses') -Recurse -Force
Copy-Item "$sdk\LICENSE.txt" (Join-Path $release 'licenses\WebView2-LICENSE.txt') -Force
Copy-Item "$root\CREATION-NOTES.md" $release -Force
Copy-Item "$root\README.md" $release -Force
Copy-Item "$root\DESIGN.md" $release -Force
Copy-Item "$root\ROADMAP.md" $release -Force
if (Test-Path "$root\LICENSE") { Copy-Item "$root\LICENSE" $release -Force }
if (Test-Path "$root\THIRD-PARTY-NOTICES.txt") { Copy-Item "$root\THIRD-PARTY-NOTICES.txt" $release -Force }
if (Test-Path "$root\QUICKSTART.md") { Copy-Item "$root\QUICKSTART.md" $release -Force }
Copy-Item "$root\shared-source-lock.json" $release -Force
if (Test-Path "$root\docs") { Copy-Item "$root\docs" $release -Recurse -Force }

$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
Add-Type -AssemblyName System.Speech
$speechReference = [System.Speech.Synthesis.SpeechSynthesizer].Assembly.Location
& $compiler /nologo /codepage:65001 /target:winexe /platform:x64 /optimize+ /win32icon:"$release\Inkloom.ico" /reference:$speechReference /reference:System.Security.dll /reference:System.Web.Extensions.dll /reference:System.Web.dll /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.IO.Compression.dll /reference:System.IO.Compression.FileSystem.dll /reference:"$release\Microsoft.Web.WebView2.Core.dll" /reference:"$release\Microsoft.Web.WebView2.WinForms.dll" /out:"$release\Inkloom.exe" "$inklet\native\FileStore.cs" "$inklet\native\WorkspaceStore.cs" "$inklet\native\OpenHistory.cs" "$inklet\native\RuntimeDiagnostics.cs" "$inklet\native\ShellIntegration.cs" "$inklet\native\ExportService.cs" "$inklet\native\ResourcePack.cs" "$root\native\VaultStore.cs" "$root\native\SpeechService.cs" "$root\native\InkloomApp.cs"
if ($LASTEXITCODE -ne 0) { throw 'Windows executable build failed.' }
Write-Output 'INKLOOM_NATIVE_BUILD_OK'

$archive = Join-Path (Join-Path $root 'release') ($ReleaseName + '-Windows-x64.zip')
if (Test-Path $archive) { Remove-Item $archive -Force }
[IO.Compression.ZipFile]::CreateFromDirectory($release, $archive, [IO.Compression.CompressionLevel]::Optimal, $true)
Write-Output "INKLOOM_BUILD_OK $release\Inkloom.exe"
