@echo off
rem Instala o BTC Radar a partir desta pasta, pra quem baixou o codigo em vez do
rem BTC-Radar-Setup.exe. Baixa o Node oficial se precisar, cria os atalhos e abre o
rem painel. Nao pede senha de administrador e nao mexe em nada fora do seu usuario.
title Instalar o BTC Radar
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0windows\instalar.ps1" %*
if errorlevel 1 (
  echo.
  echo A instalacao nao terminou. A mensagem acima diz o motivo.
  pause
)
