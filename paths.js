// ONDE FICAM OS DADOS.
// Por padrao a pasta data/ ao lado do codigo, como sempre foi. O instalador do Windows
// aponta BTC_RADAR_DATA para %LOCALAPPDATA%\BTC Radar\data: assim o painel continua
// funcionando quando o programa esta numa pasta sem permissao de escrita, e desinstalar
// o programa nao leva junto o historico da pessoa.
const fs = require('fs');
const path = require('path');

const RAIZ = __dirname;

function daEnv(nome) {
  const v = process.env[nome];
  return v && v.trim() ? path.resolve(v.trim()) : null;
}

const DATA = daEnv('BTC_RADAR_DATA') || path.join(RAIZ, 'data');
const BACKUPS = daEnv('BTC_RADAR_BACKUPS') || path.join(path.dirname(DATA), 'backups');

function garantir(dir) {
  try { fs.mkdirSync(dir, { recursive: true }); } catch (e) { }
  return dir;
}

module.exports = { RAIZ, DATA, BACKUPS, garantir };
