
$ErrorActionPreference = "Stop"
Set-Location "D:\Lauchpad\apps\web"
wrangler pages deploy out --project-name portus-app --commit-dirty=true 2>&1 | Tee-Object -FilePath "D:\Lauchpad\pages-deploy-spa-fallback.log"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Host "DEPLOY_OK"
