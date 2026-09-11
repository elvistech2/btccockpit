// BACKUP: a pasta data/ e a parte insubstituivel do projeto (historico por minuto,
// liquidacoes, snapshots, analises). Aqui ela e copiada compactada pra backups/,
// com rotacao — o dado bruto nunca e apagado, so as copias velhas.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const CAMINHOS = require('./paths');

const DATA = CAMINHOS.DATA;
const DEST = CAMINHOS.BACKUPS;
const MANTER = 14;                 // quantas copias guardar
const ARQUIVOS = ['history.jsonl', 'liquidations.jsonl', 'snapshots.jsonl', 'sentiment.jsonl',
  'tape.jsonl', 'tesourarias.jsonl', 'premios.jsonl', 'ultima-analise.json', 'botoes.json', 'config.json'];

function pastaAgora() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}
function tamanho(f) { try { return fs.statSync(f).size } catch (e) { return 0 } }

function rodar({ motivo = 'automatico' } = {}) {
  if (!fs.existsSync(DEST)) fs.mkdirSync(DEST, { recursive: true });
  const alvo = path.join(DEST, pastaAgora());
  if (fs.existsSync(alvo)) return { pulado: 'ja existe copia deste minuto', pasta: alvo };
  fs.mkdirSync(alvo);
  const feitos = [];
  for (const nome of ARQUIVOS) {
    const origem = path.join(DATA, nome);
    if (!fs.existsSync(origem)) continue;
    // config.json guarda a chave da IA: vai junto porque a copia fica na mesma maquina,
    // mas nao mande a pasta backups/ pra lugar nenhum sem tirar esse arquivo antes.
    const bruto = fs.readFileSync(origem);
    fs.writeFileSync(path.join(alvo, nome + '.gz'), zlib.gzipSync(bruto, { level: 9 }));
    feitos.push({ arquivo: nome, bytes: bruto.length, comprimido: tamanho(path.join(alvo, nome + '.gz')) });
  }
  if (!feitos.length) { fs.rmdirSync(alvo); return { pulado: 'nada pra copiar' }; }
  fs.writeFileSync(path.join(alvo, 'info.json'), JSON.stringify({ t: Date.now(), motivo, feitos }, null, 1));
  limpar();
  return { pasta: path.basename(alvo), motivo, arquivos: feitos.length, bytes: feitos.reduce((a, b) => a + b.comprimido, 0) };
}

// Guarda as MANTER copias recentes e, alem delas, a PRIMEIRA copia de cada mes pra
// sempre: assim o acervo de snapshots tem como ser recuperado meses depois, nao so
// nos ultimos dias de rotacao.
function limpar() {
  const copias = listar();                      // mais nova primeiro
  const recentes = new Set(copias.slice(0, MANTER).map(c => c.pasta));
  const mensais = new Set();
  for (const c of [...copias].reverse()) {      // do mais velho pro mais novo
    const mes = c.pasta.slice(0, 7);            // AAAA-MM
    if (!mensais.has(mes)) mensais.add(mes + '|' + c.pasta);
  }
  const guardarMensal = new Set([...mensais].map(x => x.split('|')[1]));
  for (const c of copias) {
    if (recentes.has(c.pasta) || guardarMensal.has(c.pasta)) continue;
    try { fs.rmSync(path.join(DEST, c.pasta), { recursive: true, force: true }); } catch (e) { }
  }
}
function listar() {
  if (!fs.existsSync(DEST)) return [];
  return fs.readdirSync(DEST)
    .filter(p => fs.statSync(path.join(DEST, p)).isDirectory())
    .map(p => {
      const dir = path.join(DEST, p);
      let info = {};
      try { info = JSON.parse(fs.readFileSync(path.join(dir, 'info.json'), 'utf8')); } catch (e) { }
      const bytes = fs.readdirSync(dir).reduce((a, f) => a + tamanho(path.join(dir, f)), 0);
      return { pasta: p, t: info.t || fs.statSync(dir).mtimeMs, motivo: info.motivo || '?', bytes, arquivos: (info.feitos || []).length };
    })
    .sort((a, b) => b.t - a.t);
}
function status() {
  const l = listar();
  const mensais = new Set(l.map(c => c.pasta.slice(0, 7)));
  return { copias: l.length, ultima: l[0] || null, mantem: MANTER, mensaisGuardados: mensais.size, pasta: DEST, lista: l.slice(0, 10) };
}

module.exports = { rodar, listar, status };
