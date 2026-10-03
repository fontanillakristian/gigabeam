# Regenerates js/icons-fallback.js from assets/icons/*.svg (using the order in assets/icons/icons.json).
# Run this after adding or replacing icons if you want the built-in fallback to match.
#   powershell -File tools/build-icon-fallback.ps1
$ErrorActionPreference = 'Stop'
$root  = Split-Path -Parent $PSScriptRoot
$dir   = Join-Path $root 'assets\icons'
$names = Get-Content (Join-Path $dir 'icons.json') -Raw | ConvertFrom-Json
$sb = New-Object System.Text.StringBuilder
[void]$sb.AppendLine("/* Built-in copy of assets/icons/*.svg, used only when the icon files cannot be fetched (for example when index.html is opened straight from disk).`n   Regenerate with tools/build-icon-fallback.ps1 after changing icons. */`nwindow.ICON_FALLBACK={")
foreach ($n in $names) {
  $svg = [xml](Get-Content (Join-Path $dir "$n.svg") -Raw)
  $root_ = $svg.DocumentElement
  $vb = if ($root_.viewBox) { $root_.viewBox } else { '0 0 24 24' }
  $inner = ($root_.ChildNodes | ForEach-Object { $_.OuterXml -replace ' xmlns="http://www.w3.org/2000/svg"', '' }) -join ''
  [void]$sb.AppendLine("  '$n':{viewBox:'$vb',inner:'" + $inner.Replace('\', '\\').Replace("'", "\'") + "'},")
}
[void]$sb.AppendLine('};')
$out = Join-Path $root 'js\icons-fallback.js'
[IO.File]::WriteAllText($out, $sb.ToString().Replace("`r`n", "`n"), (New-Object System.Text.UTF8Encoding($false)))
Write-Host "Wrote $out ($($names.Count) icons)"
