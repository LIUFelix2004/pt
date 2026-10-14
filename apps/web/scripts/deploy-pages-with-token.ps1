Continue='Stop'
if (-not ) {
  Write-Host 'Set CLOUDFLARE_API_TOKEN first, then re-run.'
  exit 1
}
Set-Location D:\Lauchpad\apps\web
if (-not (Test-Path out\_redirects)) { Write-Host 'out/_redirects missing; run build-pages.ps1 first'; exit 1 }
wrangler pages deploy out --project-name portus-app --commit-dirty=true
