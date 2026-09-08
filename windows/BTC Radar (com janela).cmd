@echo off
rem Mesma coisa que o "BTC Radar.exe", mas com a janela preta a vista: serve pra
rem descobrir o motivo quando o painel nao sobe. Fechar esta janela para o painel.
title BTC Radar - modo diagnostico
cd /d "%~dp0"

if not defined BTC_RADAR_DATA (
  if exist "%~dp0portatil.txt" ( set "BTC_RADAR_DATA=%~dp0data" ) else ( set "BTC_RADAR_DATA=%LOCALAPPDATA%\BTC Radar\data" )
)
if exist "%~dp0data" set "BTC_RADAR_DATA=%~dp0data"

set "NODE=%~dp0node\node.exe"
if not exist "%NODE%" set "NODE=node"

echo Pasta de dados: %BTC_RADAR_DATA%
echo Abra http://localhost:8899 no navegador.
echo Feche esta janela para parar o painel.
echo.
"%NODE%" "%~dp0server.js"
echo.
echo O painel parou. Copie a mensagem acima se precisar de ajuda.
pause
