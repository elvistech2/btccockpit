// ANALISE TECNICA: le candles da Binance em varios timeframes e transforma em votos
// bull/bear explicitos. Nada de caixa preta — cada indicador vira um voto com peso,
// e a nota final e a soma desses votos, mostrada na tela do jeito que foi calculada.
const BIN = 'https://fapi.binance.com';
const cache = new Map();

async function cached(k, ttl, fn) {
  const h = cache.get(k);
  if (h && Date.now() - h.t < ttl) return h.v;
  const v = await fn();
  cache.set(k, { t: Date.now(), v });
  return v;
}
async function klines(tf, limite = 300) {
  return cached('k:' + tf + ':' + limite, 30000, async () => {
    const r = await fetch(`${BIN}/fapi/v1/klines?symbol=BTCUSDT&interval=${tf}&limit=${limite}`);
    if (!r.ok) throw new Error('klines ' + r.status);
    return (await r.json()).map(k => ({
      t: k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5]
    }));
  });
}

/* ---------------- indicadores ---------------- */
function ema(vals, n) {
  const k = 2 / (n + 1);
  let e = vals.slice(0, n).reduce((a, b) => a + b, 0) / n;
  const out = new Array(n - 1).fill(null);
  out.push(e);
  for (let i = n; i < vals.length; i++) { e = vals[i] * k + e * (1 - k); out.push(e); }
  return out;
}
function rsi(vals, n = 14) {
  if (vals.length < n + 1) return null;
  let g = 0, p = 0;
  for (let i = 1; i <= n; i++) { const d = vals[i] - vals[i - 1]; d >= 0 ? g += d : p -= d; }
  g /= n; p /= n;
  for (let i = n + 1; i < vals.length; i++) {
    const d = vals[i] - vals[i - 1];
    g = (g * (n - 1) + (d > 0 ? d : 0)) / n;
    p = (p * (n - 1) + (d < 0 ? -d : 0)) / n;
  }
  if (p === 0) return 100;
  return 100 - 100 / (1 + g / p);
}
function macd(vals) {
  if (vals.length < 35) return null;
  const r12 = ema(vals, 12), r26 = ema(vals, 26);
  const linha = vals.map((_, i) => (r12[i] == null || r26[i] == null) ? null : r12[i] - r26[i]);
  const limpa = linha.filter(x => x != null);
  const sinal = ema(limpa, 9);
  const hist = limpa.at(-1) - sinal.at(-1);
  return { linha: limpa.at(-1), sinal: sinal.at(-1), hist, histAnterior: limpa.at(-2) - sinal.at(-2) };
}
function atrPct(c, n = 14) {
  if (c.length < n + 1) return null;
  let soma = 0;
  for (let i = c.length - n; i < c.length; i++) {
    const tr = Math.max(c[i].h - c[i].l, Math.abs(c[i].h - c[i - 1].c), Math.abs(c[i].l - c[i - 1].c));
    soma += tr;
  }
  return (soma / n) / c.at(-1).c * 100;
}
function bollinger(vals, n = 20, k = 2) {
  if (vals.length < n) return null;
  const jan = vals.slice(-n);
  const media = jan.reduce((a, b) => a + b, 0) / n;
  const dp = Math.sqrt(jan.reduce((a, b) => a + (b - media) ** 2, 0) / n);
  const sup = media + k * dp, inf = media - k * dp, preco = vals.at(-1);
  return { media, sup, inf, larguraPct: (sup - inf) / media * 100, posicao: (preco - inf) / ((sup - inf) || 1) };
}
// topos e fundos: estrutura de alta = topo mais alto E fundo mais alto
function estrutura(c, jan = 20) {
  if (c.length < jan * 2) return null;
  const recente = c.slice(-jan), anterior = c.slice(-jan * 2, -jan);
  const topo = a => Math.max(...a.map(x => x.h)), fundo = a => Math.min(...a.map(x => x.l));
  const tR = topo(recente), tA = topo(anterior), fR = fundo(recente), fA = fundo(anterior);
  if (tR > tA && fR > fA) return { nome: 'topos e fundos subindo', voto: 1 };
  if (tR < tA && fR < fA) return { nome: 'topos e fundos descendo', voto: -1 };
  return { nome: 'estrutura embaralhada', voto: 0 };
}

/* ---------------- votos ---------------- */
// cada linha aqui vira uma frase na tela: indicador, o que ele mostra e pra que lado empurra
function analisarTF(c) {
  const fech = c.map(x => x.c), preco = fech.at(-1);
  const e20 = ema(fech, 20).at(-1), e50 = ema(fech, 50).at(-1);
  const e200 = fech.length >= 200 ? ema(fech, 200).at(-1) : null;
  const r = rsi(fech), m = macd(fech), bb = bollinger(fech), est = estrutura(c), atr = atrPct(c);
  const votos = [];
  const add = (nome, voto, leitura, peso = 1) => votos.push({ nome, voto, leitura, peso });

  if (e20) add('preço x média 20', preco > e20 ? 1 : -1,
    `${preco > e20 ? 'acima' : 'abaixo'} da média de 20 (${e20.toFixed(0)})`);
  if (e20 && e50) add('média 20 x 50', e20 > e50 ? 1 : -1,
    `média curta ${e20 > e50 ? 'acima' : 'abaixo'} da média média`, 1.2);
  if (e200) add('preço x média 200', preco > e200 ? 1 : -1,
    `${preco > e200 ? 'acima' : 'abaixo'} da média de 200 (${e200.toFixed(0)})`, 1.4);
  if (r != null) add('força (RSI)', r > 58 ? 1 : r < 42 ? -1 : 0,
    `RSI em ${r.toFixed(1)}${r > 70 ? ' — esticado pra cima' : r < 30 ? ' — esticado pra baixo' : ''}`);
  if (m) add('MACD', m.hist > 0 ? 1 : -1,
    `histograma ${m.hist > 0 ? 'positivo' : 'negativo'} e ${Math.abs(m.hist) > Math.abs(m.histAnterior) ? 'crescendo' : 'encolhendo'}`, 1.2);
  if (bb) add('bandas de Bollinger', bb.posicao > 0.8 ? 1 : bb.posicao < 0.2 ? -1 : 0,
    `preço em ${(bb.posicao * 100).toFixed(0)}% da banda, largura ${bb.larguraPct.toFixed(2)}%`);
  if (est) add('estrutura', est.voto, est.nome, 1.3);

  const pesoTotal = votos.reduce((a, b) => a + b.peso, 0) || 1;
  const score = Math.round(votos.reduce((a, b) => a + b.voto * b.peso, 0) / pesoTotal * 100);
  return {
    preco, score, votos,
    indicadores: {
      ema20: e20, ema50: e50, ema200: e200, rsi: r,
      macdHist: m ? m.hist : null, atrPct: atr,
      bandaLargura: bb ? bb.larguraPct : null, bandaPosicao: bb ? bb.posicao : null
    }
  };
}

/* ---------------- niveis que o preço respeita ---------------- */
function niveis(c1h, c1d) {
  const ult = c1h.at(-1).c;
  const janela = (arr, n) => arr.slice(-n);
  const maxMin = arr => ({ max: Math.max(...arr.map(x => x.h)), min: Math.min(...arr.map(x => x.l)) });
  const d1 = maxMin(janela(c1h, 24)), d7 = maxMin(janela(c1h, 168)), d30 = maxMin(janela(c1d, 30));
  // pivô clássico do candle diário anterior
  const ontem = c1d.at(-2);
  const pp = (ontem.h + ontem.l + ontem.c) / 3;
  const pivos = { pp, r1: 2 * pp - ontem.l, s1: 2 * pp - ontem.h, r2: pp + (ontem.h - ontem.l), s2: pp - (ontem.h - ontem.l) };
  // VWAP do dia corrente pelos candles de 1h
  const hoje = c1h.filter(x => new Date(x.t).toDateString() === new Date().toDateString());
  let pv = 0, vv = 0;
  for (const k of hoje) { const tp = (k.h + k.l + k.c) / 3; pv += tp * k.v; vv += k.v; }
  const vwap = vv ? pv / vv : null;
  return {
    preco: ult,
    max24h: d1.max, min24h: d1.min, max7d: d7.max, min7d: d7.min, max30d: d30.max, min30d: d30.min,
    posicaoNaFaixa30d: (ult - d30.min) / ((d30.max - d30.min) || 1) * 100,
    vwapDia: vwap, pivos
  };
}

const TFS = [
  { tf: '15m', nome: '15 minutos', peso: 0.15 },
  { tf: '1h', nome: '1 hora', peso: 0.25 },
  { tf: '4h', nome: '4 horas', peso: 0.30 },
  { tf: '1d', nome: '1 dia', peso: 0.30 }
];

async function ler() {
  const por = {};
  const cs = {};
  for (const t of TFS) {
    try { cs[t.tf] = await klines(t.tf, t.tf === '1d' ? 250 : 300); por[t.tf] = analisarTF(cs[t.tf]); }
    catch (e) { por[t.tf] = { erro: String(e.message).slice(0, 40) }; }
  }
  const validos = TFS.filter(t => por[t.tf] && !por[t.tf].erro);
  const pesoTotal = validos.reduce((a, b) => a + b.peso, 0) || 1;
  const score = Math.round(validos.reduce((a, t) => a + por[t.tf].score * t.peso, 0) / pesoTotal);
  const bulls = validos.filter(t => por[t.tf].score > 15).length;
  const bears = validos.filter(t => por[t.tf].score < -15).length;
  const label = score >= 50 ? 'BULL FORTE' : score >= 18 ? 'BULL' : score > -18 ? 'INDEFINIDO' : score > -50 ? 'BEAR' : 'BEAR FORTE';
  return {
    t: Date.now(), score, label, bulls, bears, timeframes: TFS.map(t => ({ ...t, ...por[t.tf] })),
    niveis: (cs['1h'] && cs['1d']) ? niveis(cs['1h'], cs['1d']) : null
  };
}
// versão enxuta pro snapshot
async function paraSnapshot() {
  const r = await ler();
  const porTf = {};
  for (const t of r.timeframes) if (!t.erro) porTf[t.tf] = t.score;
  return {
    score: r.score, label: r.label, porTimeframe: porTf,
    rsi1h: r.timeframes.find(t => t.tf === '1h')?.indicadores?.rsi ?? null,
    rsi4h: r.timeframes.find(t => t.tf === '4h')?.indicadores?.rsi ?? null,
    atrPct1h: r.timeframes.find(t => t.tf === '1h')?.indicadores?.atrPct ?? null,
    posicaoNaFaixa30d: r.niveis?.posicaoNaFaixa30d ?? null,
    vwapDia: r.niveis?.vwapDia ?? null
  };
}

module.exports = { ler, paraSnapshot };
