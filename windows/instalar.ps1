<#
  Instalador caseiro do BTC Radar, pra quem baixou o codigo do GitHub em vez de
  pegar o BTC-Radar-Setup.exe pronto. Chamado pelo "Instalar BTC Radar (Windows).cmd".

  O que ele faz, tudo dentro do seu usuario e sem pedir senha de administrador:
    1. confere se ja existe Node 22+ no computador; se nao, baixa o oficial (zip,
       conferido pelo SHA256 da nodejs.org) para dentro desta pasta, em node\
    2. cria os atalhos no Menu Iniciar e, se voce quiser, na Area de Trabalho
    3. abre o painel

  Desfazer: windows\desinstalar.ps1 (ou o atalho "Desinstalar o BTC Radar").
#>
[CmdletBinding()]
param(
  [switch]$SemAtalhoDesktop,
  [switch]$SemAbrir,
  [string]$NodeMajor = '22'
)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$raiz = Split-Path -Parent $PSScriptRoot
$nodeDir = Join-Path $raiz 'node'
$nodeLocal = Join-Path $nodeDir 'node.exe'
$porta = 8899

function Titulo($t) { Write-Host "`n== $t" -ForegroundColor Cyan }
function Ok($t)     { Write-Host "   $t" -ForegroundColor Green }
function Falha($t)  { Write-Host "`n!! $t" -ForegroundColor Red; exit 1 }

Write-Host ''
Write-Host '  BTC RADAR - instalacao' -ForegroundColor White
Write-Host '  ----------------------'
Write-Host "  Pasta do programa: $raiz"

if (-not (Test-Path (Join-Path $raiz 'server.js'))) {
  Falha "Este script precisa ficar dentro da pasta do BTC Radar (nao achei o server.js em $raiz)."
}

# ------------------------------------------------------------------ 1. o Node
function VersaoDe($exe) {
  try { $v = & $exe -v 2>$null } catch { return 0 }
  if ($v -match '^v(\d+)\.') { return [int]$Matches[1] }
  return 0
}

Titulo 'Procurando o motor do painel (Node.js)'
$node = $null
if ((Test-Path $nodeLocal) -and (VersaoDe $nodeLocal) -ge [int]$NodeMajor) {
  $node = $nodeLocal
  Ok "ja instalado aqui: $(& $node -v)"
} else {
  $doSistema = (Get-Command node.exe -ErrorAction SilentlyContinue)
  if ($doSistema -and (VersaoDe $doSistema.Source) -ge [int]$NodeMajor) {
    $node = $doSistema.Source
    Ok "encontrado no computador: $(& $node -v)"
  }
}

if (-not $node) {
  Ok "nao encontrei Node $NodeMajor ou mais novo - vou baixar o oficial (uns 30 MB)"
  $tmp = Join-Path $env:TEMP ("btc-radar-node-" + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $tmp -Force | Out-Null
  try {
    $indice = Invoke-RestMethod -Uri 'https://nodejs.org/dist/index.json' -UseBasicParsing
    $alvo = $indice | Where-Object { $_.version -match "^v$NodeMajor\." -and $_.files -contains 'win-x64-zip' } | Select-Object -First 1
    if (-not $alvo) { Falha "Nenhuma versao v$NodeMajor com pacote para Windows em nodejs.org." }
    $v = $alvo.version
    $zipNome = "node-$v-win-x64.zip"
    $zip = Join-Path $tmp $zipNome

    Ok "baixando $v"
    $antes = $ProgressPreference; $ProgressPreference = 'SilentlyContinue'
    Invoke-WebRequest -Uri "https://nodejs.org/dist/$v/$zipNome" -OutFile $zip -UseBasicParsing
    $ProgressPreference = $antes

    $shas = (Invoke-WebRequest -Uri "https://nodejs.org/dist/$v/SHASUMS256.txt" -UseBasicParsing).Content
    $linha = ($shas -split "`n" | Where-Object { $_ -match [regex]::Escape($zipNome) + '\s*$' } | Select-Object -First 1)
    if (-not $linha) { Falha "A nodejs.org nao publicou a soma de verificacao de $zipNome." }
    $esperado = ($linha -split '\s+')[0].ToLower()
    $obtido = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLower()
    if ($esperado -ne $obtido) { Falha "O arquivo baixado nao confere com o publicado pela nodejs.org. Tente de novo." }
    Ok 'assinatura conferida'

    Expand-Archive -Path $zip -DestinationPath $tmp -Force
    if (Test-Path $nodeDir) { Remove-Item $nodeDir -Recurse -Force }
    New-Item -ItemType Directory -Path $nodeDir -Force | Out-Null
    # so o node.exe: o painel nao usa npm nem nenhuma dependencia
    Copy-Item (Join-Path $tmp "node-$v-win-x64\node.exe") $nodeLocal
    $node = $nodeLocal
    Ok "instalado em $nodeDir"
  } finally {
    Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
  }
}

# ------------------------------------------------------------ 2. pasta de dados
Titulo 'Preparando a pasta de dados'
$dados = Join-Path $env:LOCALAPPDATA 'BTC Radar\data'
if (Test-Path (Join-Path $raiz 'data\history.jsonl')) {
  # ja existe historico ao lado do codigo: nao mudo o lugar dos dados de ninguem
  $dados = Join-Path $raiz 'data'
}
New-Item -ItemType Directory -Path $dados -Force | Out-Null
Ok $dados

# ------------------------------------------------------------------ 3. atalhos
Titulo 'Criando os atalhos'
$exe = Join-Path $raiz 'BTC Radar.exe'
$temExe = Test-Path $exe
$icone = Join-Path $raiz 'icon.ico'
$sh = New-Object -ComObject WScript.Shell

# ($args seria o nome natural do parametro, mas colide com a variavel automatica
# do PowerShell que guarda os argumentos soltos da funcao)
function Atalho($caminho, $alvo, $argumentos, $desc) {
  $l = $sh.CreateShortcut($caminho)
  $l.TargetPath = $alvo
  if ($argumentos) { $l.Arguments = $argumentos }
  $l.WorkingDirectory = $raiz
  $l.Description = $desc
  if (Test-Path $icone) { $l.IconLocation = $icone }
  $l.WindowStyle = 7          # minimizado: o console do powershell nao incomoda
  $l.Save()
}

# Sem o BTC Radar.exe compilado (o caso de quem so baixou o codigo), o atalho chama
# o iniciar.ps1, que faz a mesma coisa: sobe escondido e abre o navegador.
if ($temExe) { $alvo = $exe; $argsAbrir = ''; $argsParar = '--parar' }
else {
  $alvo = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $argsAbrir = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$PSScriptRoot\iniciar.ps1`""
  $argsParar = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$PSScriptRoot\iniciar.ps1`" -Parar"
}

$menu = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\BTC Radar'
New-Item -ItemType Directory -Path $menu -Force | Out-Null
Atalho (Join-Path $menu 'BTC Radar.lnk') $alvo $argsAbrir 'Abrir o painel BTC Radar'
Atalho (Join-Path $menu 'Parar o BTC Radar.lnk') $alvo $argsParar 'Parar o painel que roda em segundo plano'
Atalho (Join-Path $menu 'Modo diagnostico (com janela).lnk') (Join-Path $raiz 'windows\BTC Radar (com janela).cmd') '' 'Subir o painel mostrando as mensagens de erro'
Atalho (Join-Path $menu 'Pasta de dados do BTC Radar.lnk') $dados '' 'Historico, snapshots e configuracao'
Atalho (Join-Path $menu 'Desinstalar o BTC Radar.lnk') (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe') `
  "-NoProfile -ExecutionPolicy Bypass -File `"$PSScriptRoot\desinstalar.ps1`"" 'Remover atalhos e o Node baixado aqui'
Ok "Menu Iniciar > BTC Radar"

if (-not $SemAtalhoDesktop) {
  $desktop = [Environment]::GetFolderPath('Desktop')
  Atalho (Join-Path $desktop 'BTC Radar.lnk') $alvo $argsAbrir 'Abrir o painel BTC Radar'
  Ok 'Area de Trabalho'
}

# -------------------------------------------------------------------- 4. subir
if (-not $SemAbrir) {
  Titulo 'Abrindo o painel'
  & (Join-Path $PSScriptRoot 'iniciar.ps1')
}

Write-Host ''
Write-Host '  Pronto. O BTC Radar esta instalado.' -ForegroundColor Green
Write-Host "  Painel:  http://localhost:$porta"
Write-Host "  Dados:   $dados"
Write-Host '  Atalhos: Menu Iniciar > BTC Radar'
Write-Host ''
Write-Host '  A chave da IA (opcional) voce cola direto na aba Sentimento do painel.'
Write-Host ''
