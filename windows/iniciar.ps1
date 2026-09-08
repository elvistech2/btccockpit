<#
  Sobe o BTC Radar escondido e abre o navegador. E o que os atalhos chamam quando
  o "BTC Radar.exe" compilado nao esta presente (quem baixou so o codigo).

      windows\iniciar.ps1              sobe (se preciso) e abre o navegador
      windows\iniciar.ps1 -Silencioso  sobe sem abrir o navegador
      windows\iniciar.ps1 -Parar       para o painel que roda em segundo plano
#>
[CmdletBinding()]
param([switch]$Silencioso, [switch]$Parar)

$ErrorActionPreference = 'Stop'
$raiz = Split-Path -Parent $PSScriptRoot
$porta = if ($env:BTC_RADAR_PORT) { [int]$env:BTC_RADAR_PORT } else { 8899 }
$url = "http://localhost:$porta"

function Aviso($texto) {
  Add-Type -AssemblyName System.Windows.Forms -ErrorAction SilentlyContinue
  try { [Windows.Forms.MessageBox]::Show($texto, 'BTC Radar') | Out-Null } catch { Write-Host $texto }
}

function PortaAberta([int]$p) {
  $c = New-Object Net.Sockets.TcpClient
  try { $c.Connect('127.0.0.1', $p); $c.Close(); return $true } catch { return $false }
}

# Onde ficam os dados: ao lado do codigo se ja houver pasta data\ ou a marca de
# portatil; senao, no perfil do usuario (que sempre pode ser escrito).
if (-not $env:BTC_RADAR_DATA) {
  $aoLado = Join-Path $raiz 'data'
  if ((Test-Path (Join-Path $raiz 'portatil.txt')) -or (Test-Path $aoLado)) { $env:BTC_RADAR_DATA = $aoLado }
  else { $env:BTC_RADAR_DATA = Join-Path $env:LOCALAPPDATA 'BTC Radar\data' }
}
New-Item -ItemType Directory -Path $env:BTC_RADAR_DATA -Force | Out-Null

if ($Parar) {
  $pidFile = Join-Path $env:BTC_RADAR_DATA 'servidor.pid'
  if (-not (Test-Path $pidFile)) { Aviso 'O BTC Radar ja estava parado.'; exit 0 }
  try {
    $info = Get-Content $pidFile -Raw | ConvertFrom-Json
    $proc = Get-Process -Id $info.pid -ErrorAction Stop
    # so mata se for mesmo o node: numero de processo e reaproveitado pelo Windows
    if ($proc.ProcessName -ne 'node') { throw 'o processo anotado nao e o painel' }
    Stop-Process -Id $info.pid -Force
    Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
    Aviso 'O BTC Radar foi parado.'
  } catch {
    Aviso "Nao consegui parar o BTC Radar automaticamente.`n`nAbra o Gerenciador de Tarefas, procure por Node.js e finalize a tarefa."
    exit 1
  }
  exit 0
}

if (-not (PortaAberta $porta)) {
  $node = Join-Path $raiz 'node\node.exe'
  if (-not (Test-Path $node)) { $node = (Get-Command node.exe -ErrorAction SilentlyContinue).Source }
  if (-not $node) {
    Aviso "O motor do painel (Node.js) nao foi encontrado.`n`nRode o `"Instalar BTC Radar (Windows).cmd`" da pasta do programa: ele baixa o Node sozinho."
    exit 1
  }
  $versao = & $node -v
  if ($versao -match '^v(\d+)\.' -and [int]$Matches[1] -lt 22) {
    Aviso "O Node instalado e o $versao, velho demais para o painel (precisa do 22 ou mais novo).`n`nRode o `"Instalar BTC Radar (Windows).cmd`": ele baixa uma versao nova so pro BTC Radar, sem mexer na sua."
    exit 1
  }

  Start-Process -FilePath $node -ArgumentList "`"$raiz\server.js`"" -WorkingDirectory $raiz -WindowStyle Hidden
  $limite = (Get-Date).AddSeconds(30)
  while (-not (PortaAberta $porta) -and (Get-Date) -lt $limite) { Start-Sleep -Milliseconds 250 }
  if (-not (PortaAberta $porta)) {
    Aviso "O painel nao subiu na porta $porta.`n`nPara ver o erro, execute `"windows\BTC Radar (com janela).cmd`"."
    exit 1
  }
}

if (-not $Silencioso) { Start-Process $url }
