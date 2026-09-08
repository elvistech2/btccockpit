<#
  Desfaz o "Instalar BTC Radar (Windows).cmd": para o painel, apaga os atalhos e o
  Node que foi baixado pra dentro da pasta. NAO apaga a pasta do programa nem os
  seus dados - o caminho deles aparece no final, pra voce decidir.
#>
$ErrorActionPreference = 'Continue'
$raiz = Split-Path -Parent $PSScriptRoot

Write-Host ''
Write-Host '  BTC RADAR - remocao' -ForegroundColor White
Write-Host '  -------------------'

try { & (Join-Path $PSScriptRoot 'iniciar.ps1') -Parar } catch { }

$menu = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\BTC Radar'
if (Test-Path $menu) { Remove-Item $menu -Recurse -Force; Write-Host '   atalhos do Menu Iniciar: removidos' }

$desktop = Join-Path ([Environment]::GetFolderPath('Desktop')) 'BTC Radar.lnk'
if (Test-Path $desktop) { Remove-Item $desktop -Force; Write-Host '   atalho da Area de Trabalho: removido' }

$startup = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup\BTC Radar.lnk'
if (Test-Path $startup) { Remove-Item $startup -Force; Write-Host '   inicializacao automatica: removida' }

$nodeDir = Join-Path $raiz 'node'
if (Test-Path $nodeDir) { Remove-Item $nodeDir -Recurse -Force; Write-Host '   Node baixado aqui: removido' }

$dados = if ($env:BTC_RADAR_DATA) { $env:BTC_RADAR_DATA } else { Join-Path $env:LOCALAPPDATA 'BTC Radar\data' }
Write-Host ''
Write-Host '  Pronto. A pasta do programa continua onde estava.' -ForegroundColor Green
Write-Host "  Seus dados (historico, snapshots, chave da IA) NAO foram apagados:"
Write-Host "    $dados"
Write-Host '  Apague a mao se nao quiser mais guardar nada.'
Write-Host ''
Read-Host '  Enter para fechar'
