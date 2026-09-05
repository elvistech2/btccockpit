# Sobe o servidor do BTC Radar (se ainda nao estiver de pe) e abre o navegador.
$ErrorActionPreference = 'Stop'
$dir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$port = 8899
$url  = "http://localhost:$port"

function Test-Port {
  param([int]$p)
  $c = New-Object Net.Sockets.TcpClient
  try { $c.Connect('127.0.0.1', $p); $c.Close(); return $true } catch { return $false }
}

if (-not (Test-Port $port)) {
  $node = (Get-Command node -ErrorAction SilentlyContinue).Source
  if (-not $node) {
    [void][Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms')
    [Windows.Forms.MessageBox]::Show('Node.js nao encontrado no PATH. Instale o Node.js para rodar o BTC Radar.','BTC Radar')
    exit 1
  }
  Start-Process -FilePath $node -ArgumentList "`"$dir\server.js`"" -WorkingDirectory $dir -WindowStyle Hidden
  $deadline = (Get-Date).AddSeconds(15)
  while (-not (Test-Port $port) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 250 }
}

Start-Process $url
