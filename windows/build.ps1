<#
  Monta os pacotes do Windows. Roda em qualquer Windows x64 com Visual Studio
  (ou Build Tools) e Inno Setup 6 instalados - e e o que a Action do GitHub executa.

      powershell -ExecutionPolicy Bypass -File windows\build.ps1

  Sai em build\saida:
    BTC-Radar-Setup-<versao>-win-x64.exe   instalador de clicar em "Avancar"
    BTC-Radar-<versao>-win-x64-portatil.zip  pasta que roda de pendrive, sem instalar

  O Node oficial e baixado e conferido pelo SHA256 publicado pela nodejs.org antes de
  entrar no pacote. Nada de npm: o painel nao tem dependencia nenhuma.
#>
[CmdletBinding()]
param(
  [string]$NodeMajor = '22',        # linha do Node que vai dentro do pacote
  [switch]$PularInstalador,         # so o portatil (util pra testar rapido)
  [switch]$PularNode                # reaproveita o Node ja baixado em build\node
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$raiz   = Split-Path -Parent $PSScriptRoot
$win    = $PSScriptRoot
$build  = Join-Path $raiz 'build'
$app    = Join-Path $build 'app'
$saida  = Join-Path $build 'saida'
$tmp    = Join-Path $build 'tmp'

function Passo($t) { Write-Host "`n==> $t" -ForegroundColor Cyan }
function Erro($t)  { Write-Host "!! $t" -ForegroundColor Red; exit 1 }

$versao = (Get-Content (Join-Path $raiz 'package.json') -Raw | ConvertFrom-Json).version
Passo "BTC Radar $versao"

foreach ($d in @($app, $saida, $tmp)) {
  if (Test-Path $d) { Remove-Item $d -Recurse -Force }
  New-Item -ItemType Directory -Path $d -Force | Out-Null
}

# ---------------------------------------------------------------- 1. Node oficial
$nodeDir = Join-Path $build 'node'
if ($PularNode -and (Test-Path (Join-Path $nodeDir 'node.exe'))) {
  Passo 'Node: reaproveitando o que ja estava baixado'
} else {
  Passo "Node: procurando a versao mais nova da linha $NodeMajor"
  $indice = Invoke-RestMethod -Uri 'https://nodejs.org/dist/index.json' -UseBasicParsing
  $alvo = $indice |
    Where-Object { $_.version -match "^v$NodeMajor\." -and $_.files -contains 'win-x64-zip' } |
    Select-Object -First 1
  if (-not $alvo) { Erro "Nenhuma versao v$NodeMajor com pacote win-x64 em nodejs.org" }
  $v = $alvo.version
  Write-Host "    $v"

  $zipNome = "node-$v-win-x64.zip"
  $zip = Join-Path $tmp $zipNome
  Invoke-WebRequest -Uri "https://nodejs.org/dist/$v/$zipNome" -OutFile $zip -UseBasicParsing

  Passo 'Node: conferindo o SHA256 publicado pela nodejs.org'
  $shas = (Invoke-WebRequest -Uri "https://nodejs.org/dist/$v/SHASUMS256.txt" -UseBasicParsing).Content
  $linha = ($shas -split "`n" | Where-Object { $_ -match [regex]::Escape($zipNome) + '\s*$' } | Select-Object -First 1)
  if (-not $linha) { Erro "SHASUMS256.txt nao lista $zipNome" }
  $esperado = ($linha -split '\s+')[0].ToLower()
  $obtido = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLower()
  if ($esperado -ne $obtido) { Erro "SHA256 nao bate.`n  esperado: $esperado`n  obtido:   $obtido" }
  Write-Host "    ok $obtido"

  if (Test-Path $nodeDir) { Remove-Item $nodeDir -Recurse -Force }
  New-Item -ItemType Directory -Path $nodeDir -Force | Out-Null
  Expand-Archive -Path $zip -DestinationPath $tmp -Force
  # So o node.exe entra: sem npm, sem npx, sem node_modules - o painel nao usa nada disso.
  Copy-Item (Join-Path $tmp "node-$v-win-x64\node.exe") $nodeDir
  Set-Content -Path (Join-Path $nodeDir 'VERSAO.txt') -Value $v -Encoding ASCII
}
$nodeVersao = (Get-Content (Join-Path $nodeDir 'VERSAO.txt') -Raw).Trim()

# ------------------------------------------------------- 2. compila o BTC Radar.exe
Passo 'Lancador: compilando o "BTC Radar.exe"'
$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
if (-not (Test-Path $vswhere)) { Erro 'vswhere.exe nao encontrado - instale o Visual Studio Build Tools (workload "Desktop development with C++").' }
$vsDir = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (-not $vsDir) { Erro 'Nenhum Visual Studio com compilador C++ (MSVC) instalado.' }
$vcvars = Join-Path $vsDir 'VC\Auxiliary\Build\vcvars64.bat'
if (-not (Test-Path $vcvars)) { Erro "vcvars64.bat nao encontrado em $vsDir" }

$objDir = Join-Path $tmp 'obj'
New-Item -ItemType Directory -Path $objDir -Force | Out-Null
Copy-Item (Join-Path $raiz 'icon.ico') (Join-Path $win 'icon.ico') -Force

$exeSaida = Join-Path $objDir 'BTC Radar.exe'
$compilar = @"
@echo off
call "$vcvars" >nul || exit /b 1
cd /d "$objDir" || exit /b 1
rc /nologo /fo "launcher.res" "$win\launcher.rc" || exit /b 1
cl /nologo /O2 /W3 /MT /DUNICODE /D_UNICODE "$win\launcher.c" launcher.res /Fe:"BTC Radar.exe" /link /SUBSYSTEM:WINDOWS || exit /b 1
"@
$bat = Join-Path $tmp 'compilar.bat'
Set-Content -Path $bat -Value $compilar -Encoding ASCII
& cmd.exe /c "`"$bat`""
if ($LASTEXITCODE -ne 0 -or -not (Test-Path $exeSaida)) { Erro 'A compilacao do lancador falhou.' }
Remove-Item (Join-Path $win 'icon.ico') -Force -ErrorAction SilentlyContinue
Write-Host "    ok $([math]::Round((Get-Item $exeSaida).Length / 1KB)) KB"

# ------------------------------------------------------------- 3. monta a pasta app
Passo 'Pacote: juntando os arquivos do painel'
# Todo .js da raiz entra: lista fixa ja deixou modulo novo de fora (inflacao.js), e o
# server.js, que da require nele, nao subia no programa instalado.
$arquivos = @(Get-ChildItem $raiz -Filter *.js -File | ForEach-Object Name) +
            @('index.html','icon.ico','package.json','LICENSE','README.md')
foreach ($f in $arquivos) {
  $de = Join-Path $raiz $f
  if (-not (Test-Path $de)) { Erro "Arquivo do painel faltando: $f" }
  Copy-Item $de (Join-Path $app $f)
}
# Sem pasta data\ dentro do programa: o lancador trata "data ao lado do exe" como modo
# portatil, e os dados iam parar na pasta do programa em vez de %LOCALAPPDATA%\BTC Radar\data,
# que e o que o LEIA-ME e o atalho do Menu Iniciar prometem. A chave da IA se cola pela tela.
# (O zip portatil continua guardando ao lado: ele leva a marca portatil.txt.)
Copy-Item $exeSaida (Join-Path $app 'BTC Radar.exe')
Copy-Item (Join-Path $win 'BTC Radar (com janela).cmd') $app
Copy-Item (Join-Path $win 'LEIA-ME.txt') $app
# sons que vem com o programa (botoes de humor)
if (Test-Path (Join-Path $raiz 'sons')) { Copy-Item (Join-Path $raiz 'sons') (Join-Path $app 'sons') -Recurse }
New-Item -ItemType Directory -Path (Join-Path $app 'node') -Force | Out-Null
Copy-Item (Join-Path $nodeDir 'node.exe') (Join-Path $app 'node\node.exe')
Set-Content -Path (Join-Path $app 'node\VERSAO.txt') -Value $nodeVersao -Encoding ASCII

# ---------------------------------------------------------------- 4. zip portatil
Passo 'Portatil: gerando o zip'
$portDir = Join-Path $tmp "BTC Radar $versao"
Copy-Item $app $portDir -Recurse
# A marca faz o lancador guardar os dados ao lado do programa, e nao no perfil:
# e o que se espera de uma pasta que anda de pendrive.
Set-Content -Path (Join-Path $portDir 'portatil.txt') -Encoding ASCII -Value @(
  'A presenca deste arquivo faz o BTC Radar guardar historico, snapshots e a chave da IA',
  'na pasta data\ aqui do lado, em vez do perfil do usuario. Apague se preferir o perfil.'
)
$zipSaida = Join-Path $saida "BTC-Radar-$versao-win-x64-portatil.zip"
Compress-Archive -Path $portDir -DestinationPath $zipSaida -CompressionLevel Optimal -Force
Write-Host "    $([math]::Round((Get-Item $zipSaida).Length / 1MB, 1)) MB"

# --------------------------------------------------------------- 5. instalador
if ($PularInstalador) {
  Passo 'Instalador: pulado (-PularInstalador)'
} else {
  Passo 'Instalador: compilando com o Inno Setup'
  $iscc = @(
    (Join-Path ${env:ProgramFiles(x86)} 'Inno Setup 6\ISCC.exe'),
    (Join-Path $env:ProgramFiles 'Inno Setup 6\ISCC.exe')
  ) | Where-Object { Test-Path $_ } | Select-Object -First 1
  if (-not $iscc) { $iscc = (Get-Command ISCC.exe -ErrorAction SilentlyContinue).Source }
  if (-not $iscc) { Erro 'ISCC.exe nao encontrado - instale o Inno Setup 6 (https://jrsoftware.org/isdl.php).' }
  & $iscc "/DVersao=$versao" (Join-Path $win 'btc-radar.iss')
  if ($LASTEXITCODE -ne 0) { Erro 'O Inno Setup falhou.' }
}

Passo 'Pronto'
Get-ChildItem $saida | ForEach-Object { Write-Host ("    {0}  ({1:N1} MB)" -f $_.Name, ($_.Length / 1MB)) }
