#!/usr/bin/env bash
# Sobe o servidor e abre o navegador. Linux Mint / Ubuntu / Debian.
cd "$(dirname "$0")/.."
if ! command -v node >/dev/null 2>&1; then
  echo "Node nao encontrado. Instale a versao 22:"
  echo "  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -"
  echo "  sudo apt install -y nodejs"
  exit 1
fi
VERSAO=$(node -p "process.versions.node.split('.')[0]")
if [ "$VERSAO" -lt 22 ]; then
  echo "Node $VERSAO e velho demais (o painel usa fetch e WebSocket nativos do Node 22)."
  echo "  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -"
  echo "  sudo apt install -y nodejs"
  exit 1
fi
node server.js &
SERVIDOR=$!
sleep 2
xdg-open http://localhost:8899 >/dev/null 2>&1 || true
wait $SERVIDOR
