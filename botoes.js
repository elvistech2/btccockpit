// Contador dos botoes de humor (panico, rage, money baby). Fica no servidor, e nao no
// navegador, pra sobreviver a troca de navegador e entrar no backup junto com o resto:
// com o tempo vira um diario emocional do trader, dia a dia.
const fs = require('fs');
const path = require('path');
const { DATA } = require('./paths');

const ARQ = path.join(DATA, 'botoes.json');
const NOMES = ['panico', 'rage', 'money'];

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
  }
  return out;
}
function apertar(nome) {
  if (!NOMES.includes(nome)) throw new Error('botao desconhecido');
  const d = ler(), h = hoje();
  const b = d[nome] || (d[nome] = { total: 0, dias: {} });
  b.total = (b.total || 0) + 1;
  b.dias = b.dias || {};
  b.dias[h] = (b.dias[h] || 0) + 1;
  b.ultimo = Date.now();
  // guarda um ano e pouco de dias; o total nunca zera
  const dias = Object.keys(b.dias).sort();
  for (const k of dias.slice(0, Math.max(0, dias.length - 400))) delete b.dias[k];
  try { fs.mkdirSync(DATA, { recursive: true }); } catch (e) { }
  fs.writeFileSync(ARQ, JSON.stringify(d));
  return resumo();
}

module.exports = { NOMES, resumo, apertar };
