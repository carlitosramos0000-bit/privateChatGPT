$bundledNode = "C:\Users\ramoscv\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"

if (-not (Test-Path $bundledNode)) {
  Write-Error "Nao foi encontrado o runtime Node empacotado em $bundledNode"
  exit 1
}

$env:NODE_OPTIONS = "--use-system-ca"
& $bundledNode "$PSScriptRoot\server.mjs"
