// OPEN INTEREST AGREGADO sem susto falso.
// O historico grava, por minuto, o OI de cada corretora que respondeu naquele minuto.
// Se tres corretoras falham juntas, a linha sai so com a Hyperliquid - e somar "o que tem"
// faz o total despencar 80% do nada (aconteceu em 11/09/2026 e virou alerta).
// Regras daqui: o "agora" e a ultima linha completa, e toda comparacao usa o MESMO grupo
// de corretoras nos dois momentos.

const chaves = r => Object.keys((r && r.oi) || {}).filter(k => r.oi[k] && r.oi[k].btc > 0);
const temTodas = (r, K) => K.every(k => r.oi && r.oi[k] && r.oi[k].btc > 0);
const somar = (r, K, campo = 'btc') => K.reduce((a, k) => a + ((r.oi[k] || {})[campo] || 0), 0);

// ultima linha com o numero "normal" de corretoras (o maximo visto nas ultimas ~2 horas)
function ultimaCompleta(hist) {
  if (!hist || !hist.length) return null;
  const recentes = hist.slice(-120);
  const cheio = Math.max(...recentes.map(r => chaves(r).length));
  for (let i = hist.length - 1; i >= 0; i--) if (chaves(hist[i]).length >= cheio) return hist[i];
  return hist[hist.length - 1];
}

// total agora (BTC e USD) com as corretoras da ultima linha completa
function total(hist) {
  const agora = ultimaCompleta(hist);
  if (!agora) return null;
  const K = chaves(agora);
  return { t: agora.t, btc: somar(agora, K), usd: somar(agora, K, 'usd'), corretoras: K };
}

// variacao % em "ms" pra tras, comparando so as mesmas corretoras
function variacao(hist, ms) {
  const agora = ultimaCompleta(hist);
  if (!agora) return null;
  const K = chaves(agora), alvo = agora.t - ms;
  let base = null;
  for (const r of hist) { if (r.t > alvo) break; if (temTodas(r, K)) base = r; }
  if (!base || base === agora) return null;
  const a = somar(base, K), b = somar(agora, K);
  return a > 0 ? (b / a - 1) * 100 : null;
}

// variacao entre a primeira e a ultima linha comparaveis de um trecho (detector de estado)
function variacaoTrecho(hist) {
  const fim = ultimaCompleta(hist);
  if (!fim) return null;
  const K = chaves(fim);
  const ini = hist.find(r => temTodas(r, K));
  if (!ini || ini === fim) return null;
  const a = somar(ini, K), b = somar(fim, K);
  return a > 0 ? (b / a - 1) * 100 : null;
}

module.exports = { chaves, ultimaCompleta, total, variacao, variacaoTrecho };
