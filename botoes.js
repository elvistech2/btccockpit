// Contador dos botoes de humor (panico, rage, money baby). Fica no servidor, e nao no
// navegador, pra sobreviver a troca de navegador e entrar no backup junto com o resto:
// com o tempo vira um diario emocional do trader, dia a dia.
const fs = require('fs');
const path = require('path');
const { DATA } = require('./paths');

const ARQ = path.join(DATA, 'botoes.json');
const NOMES = ['panico', 'rage', 'money', 'assopra', 'moeda', 'crash'];

function ler() {
  try { return JSON.parse(fs.readFileSync(ARQ, 'utf8')); } catch (e) { return {}; }
}
function hoje() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function resumo() {
  const d = ler(), h = hoje(), out = {};
  for (const n of NOMES) {
    const b = d[n] || {};
    out[n] = { total: b.total || 0, hoje: (b.dias || {})[h] || 0, ultimo: b.ultimo || null };
    if (n === 'moeda') {                    // o que a moeda respondeu, no total e hoje
      const r = b.resultados || {}, rh = (b.resultadosDia || {})[h] || {};
      Object.assign(out[n], { sim: r.sim || 0, nao: r.nao || 0, simHoje: rh.sim || 0, naoHoje: rh.nao || 0 });
    }
  }
  return out;
}
// n: o assopra manda os cliques em lote (cada clique conta). resultado: sim/nao da moeda.
function apertar(nome, { n = 1, resultado = null } = {}) {
  if (!NOMES.includes(nome)) throw new Error('botao desconhecido');
  n = Math.max(1, Math.min(500, Math.floor(+n) || 1));
  const d = ler(), h = hoje();
  const b = d[nome] || (d[nome] = { total: 0, dias: {} });
  b.total = (b.total || 0) + n;
  b.dias = b.dias || {};
  b.dias[h] = (b.dias[h] || 0) + n;
  b.ultimo = Date.now();
  if (nome === 'moeda' && (resultado === 'sim' || resultado === 'nao')) {
    b.resultados = b.resultados || {};
    b.resultados[resultado] = (b.resultados[resultado] || 0) + 1;
    b.resultadosDia = b.resultadosDia || {};
    const rd = b.resultadosDia[h] || (b.resultadosDia[h] = {});
    rd[resultado] = (rd[resultado] || 0) + 1;
    for (const k of Object.keys(b.resultadosDia).sort().slice(0, -400)) delete b.resultadosDia[k];
  }
  // guarda um ano e pouco de dias; o total nunca zera
  const dias = Object.keys(b.dias).sort();
  for (const k of dias.slice(0, Math.max(0, dias.length - 400))) delete b.dias[k];
  try { fs.mkdirSync(DATA, { recursive: true }); } catch (e) { }
  fs.writeFileSync(ARQ, JSON.stringify(d));
  return resumo();
}

module.exports = { NOMES, resumo, apertar };
