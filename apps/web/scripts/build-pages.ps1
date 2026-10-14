
$ErrorActionPreference = "Stop"
$envFile = "D:\Lauchpad\apps\web\.env.pages"
Get-Content $envFile -Encoding UTF8 | ForEach-Object {
  $line = $_.Trim()
  if (-not $line -or $line.StartsWith("#")) { return }
  $i = $line.IndexOf("=")
  if ($i -lt 1) { return }
  $k = $line.Substring(0, $i).Trim().TrimStart([char]0xFEFF)
  $v = $line.Substring($i + 1).Trim()
  Set-Item -Path "Env:$k" -Value $v
  Write-Host "set $k"
}
Set-Location "D:\Lauchpad\apps\web"
npm run build 2>&1 | Tee-Object -FilePath "D:\Lauchpad\pages-build-spa-fallback.log"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
if (-not (Test-Path "out\_redirects")) {
  Write-Host "ERROR: out/_redirects missing"
  exit 1
}
Write-Host "BUILD_OK"
Get-Content "out\_redirects"
Write-Host "launch dirs:"
Get-ChildItem "out\launch" | ForEach-Object { $_.Name }
