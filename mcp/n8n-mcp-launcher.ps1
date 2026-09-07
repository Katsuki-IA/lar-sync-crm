$ErrorActionPreference = 'Stop'

foreach ($name in @('N8N_API_URL', 'N8N_API_KEY')) {
    if (-not [Environment]::GetEnvironmentVariable($name, 'Process')) {
        $userValue = [Environment]::GetEnvironmentVariable($name, 'User')
        if ($userValue) {
            [Environment]::SetEnvironmentVariable($name, $userValue, 'Process')
        }
    }
}

$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if ($nodeCommand) {
    $nodePath = $nodeCommand.Source
}
else {
    $runtimeRoot = Join-Path $env:USERPROFILE '.cache\codex-runtimes'
    $nodeCandidates = @(
        Get-ChildItem -LiteralPath $runtimeRoot -Directory -ErrorAction SilentlyContinue |
            ForEach-Object {
                $candidate = Join-Path $_.FullName 'dependencies\node\bin\node.exe'
                if (Test-Path -LiteralPath $candidate) {
                    Get-Item -LiteralPath $candidate
                }
            } |
            Sort-Object LastWriteTime -Descending
    )

    if ($nodeCandidates.Count -eq 0) {
        throw 'Node.js was not found. Install Node.js 18+ or reinstall the Codex desktop runtime.'
    }

    $nodePath = $nodeCandidates[0].FullName
}

$serverPath = Join-Path $PSScriptRoot 'n8n-mcp-server.mjs'
& $nodePath $serverPath @args
exit $LASTEXITCODE
