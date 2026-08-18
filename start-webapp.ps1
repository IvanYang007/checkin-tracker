Set-Location -Path $PSScriptRoot
Write-Host "Starting Check-In Tracker at http://localhost:8080"
python -m http.server 8080
