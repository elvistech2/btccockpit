// MERCADO PREDITIVO + MACRO: o que o mercado esta apostando pro futuro (Polymarket),
// como estao os precos que puxam bitcoin (juro de 10 anos, dolar, Nasdaq, ouro) e o que
// as opcoes dizem sobre volatilidade esperada (DVOL da Deribit). Tudo gratis e sem chave.
const cache = new Map();
async function cached(k, ttl, fn) {
  const h = cache.get(k);
  if (h && Date.now() - h.t < ttl) return h.v;
  const v = await fn();
  cache.set(k, { t: Date.now(), v });
  return v;
}
async function get(url, ms = 15000) {
  const c = new AbortController();
  const to = setTimeout(() => c.abort(), ms);
  try {
    const r = await fetch(url, { signal: c.signal, headers: { 'user-agent': 'Mozilla/5.0 btc-radar' } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } finally { clearTimeout(to); }
}
const pctVar = (a, b) => (a == null || b == null || !a) ? null : +(((b / a) - 1) * 100).toFixed(2);

/* -------- Polymarket: aposta com dinheiro de verdade -------- */
function preco(m) {
  try {
    const p = JSON.parse(m.outcomePrices || '[]');
    return p.length ? +p[0] : null;      // preco do primeiro resultado (Yes / Up)
  } catch (e) { return null; }
}
async function polymarket() {
  return cached('pm', 8 * 6e4, async () => {
    const j = await get('https://gamma-api.polymarket.com/markets?closed=false&active=true&limit=200&order=volume24hr&ascending=false');
    const lista = Array.isArray(j) ? j : [];
    const achar = re => lista.filter(m => re.test(m.question || ''));
    const prob = re => { const m = achar(re)[0]; return m ? { p: preco(m), q: m.question, slug: m.slug } : null; };
    const juros = {
      manter: prob(/no change in fed interest rates/i),
      alta25: prob(/fed increase interest rates by 25/i),
      alta50: prob(/fed increase interest rates by 50/i),
      corte25: prob(/fed decrease interest rates by 25/i),
      corte50: prob(/fed decrease interest rates by 50/i)
    };
    const soma = (...xs) => xs.reduce((a, b) => a + (b && b.p != null ? b.p : 0), 0);
    const probCorte = juros.corte25 || juros.corte50 ? +soma(juros.corte25, juros.corte50).toFixed(4) : null;
    const probAlta = juros.alta25 || juros.alta50 ? +soma(juros.alta25, juros.alta50).toFixed(4) : null;
    const btc = achar(/bitcoin|btc/i).slice(0, 6).map(m => ({
      pergunta: m.question, prob: preco(m), fim: m.endDate,
      vol24: Math.round(+m.volume24hr || 0),
      url: m.slug ? 'https://polymarket.com/event/' + m.slug : null
    }));
    return { juros, probCorte, probAlta, probManter: juros.manter ? juros.manter.p : null, btc };
  });
}

/* -------- macro pelo Yahoo Finance -------- */
const TICKERS = {
  juros10a: { s: '^TNX', nome: 'Juro 10 anos EUA' },
  dolar: { s: 'DX-Y.NYB', nome: 'Índice do dólar (DXY)' },
  nasdaq: { s: '^IXIC', nome: 'Nasdaq' },
  ouro: { s: 'GC=F', nome: 'Ouro' },
  btc: { s: 'BTC-USD', nome: 'Bitcoin' }
};
async function serie(simbolo) {
  const j = await get(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(simbolo)}?range=3mo&interval=1d`);
  const r = j?.chart?.result?.[0];
  if (!r) throw new Error('sem serie');
  const closes = (r.indicators?.quote?.[0]?.close || []).filter(v => v != null);
  return { closes, ultimo: closes.at(-1) };
}
function correlacao(a, b) {
  const n = Math.min(a.length, b.length);
  if (n < 10) return null;
  const ra = [], rb = [];
  const A = a.slice(-n), B = b.slice(-n);
  for (let i = 1; i < n; i++) { ra.push(A[i] / A[i - 1] - 1); rb.push(B[i] / B[i - 1] - 1); }
  const m = x => x.reduce((s, v) => s + v, 0) / x.length;
  const ma = m(ra), mb = m(rb);
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < ra.length; i++) { num += (ra[i] - ma) * (rb[i] - mb); da += (ra[i] - ma) ** 2; db += (rb[i] - mb) ** 2; }
  return (da && db) ? +(num / Math.sqrt(da * db)).toFixed(2) : null;
}
async function macro() {
  return cached('macro', 10 * 6e4, async () => {
    const out = {}; const series = {};
    for (const [k, v] of Object.entries(TICKERS)) {
      try {
        const s = await serie(v.s);
        series[k] = s.closes;
        out[k] = {
          nome: v.nome, valor: +s.ultimo.toFixed(2),
          d1: pctVar(s.closes.at(-2), s.ultimo),
          d30: pctVar(s.closes.at(-31) ?? s.closes[0], s.ultimo)
        };
      } catch (e) { out[k] = { nome: v.nome, erro: String(e.message).slice(0, 30) }; }
    }
    const corr = {};
    if (series.btc && series.nasdaq) corr.btcNasdaq = correlacao(series.btc.slice(-31), series.nasdaq.slice(-31));
    if (series.btc && series.dolar) corr.btcDolar = correlacao(series.btc.slice(-31), series.dolar.slice(-31));
    if (series.btc && series.ouro) corr.btcOuro = correlacao(series.btc.slice(-31), series.ouro.slice(-31));
    return { ...out, correlacao30d: corr };
  });
}

/* -------- volatilidade implicita (opcoes da Deribit) -------- */
async function dvol() {
  return cached('dvol', 8 * 6e4, async () => {
    const fim = Date.now(), ini = fim - 8 * 864e5;
    const j = await get(`https://www.deribit.com/api/v2/public/get_volatility_index_data?currency=BTC&start_timestamp=${ini}&end_timestamp=${fim}&resolution=3600`);
    const d = j?.result?.data || [];
    if (!d.length) throw new Error('sem dvol');
    const fecha = d.map(x => x[4]);
    return {
      atual: +fecha.at(-1).toFixed(2),
      d1: pctVar(fecha.at(-25) ?? fecha[0], fecha.at(-1)),
      d7: pctVar(fecha[0], fecha.at(-1))
    };
  });
}

/* -------- nota preditiva (contas, sem IA) -------- */
function pontuar({ pm, mc, dv }) {
  const comp = [];
  const add = (nome, texto, valor) => { if (valor != null && isFinite(valor)) comp.push({ nome, texto, contrib: Math.round(valor) }); };
  const lim = (v, x) => Math.max(-x, Math.min(x, v));

  if (pm?.probCorte != null || pm?.probAlta != null) {
    const corte = pm.probCorte || 0, alta = pm.probAlta || 0;
    add('Aposta de juros',
      `Mercado dá ${(corte * 100).toFixed(1)}% de chance de corte e ${(alta * 100).toFixed(1)}% de alta na próxima reunião`,
      lim((corte - alta) * 80, 32));
  }
  if (mc?.dolar?.d30 != null) add('Dólar (30d)', `DXY ${mc.dolar.d30 > 0 ? 'subiu' : 'caiu'} ${Math.abs(mc.dolar.d30).toFixed(2)}% no mês`, lim(-mc.dolar.d30 * 8, 20));
  if (mc?.juros10a?.d30 != null) add('Juro 10 anos (30d)', `Treasury de 10 anos ${mc.juros10a.d30 > 0 ? 'subindo' : 'caindo'} ${Math.abs(mc.juros10a.d30).toFixed(2)}%`, lim(-mc.juros10a.d30 * 2.5, 20));
  if (mc?.nasdaq?.d30 != null) add('Nasdaq (30d)', `Bolsa de tecnologia ${mc.nasdaq.d30 > 0 ? 'em alta' : 'em queda'} de ${Math.abs(mc.nasdaq.d30).toFixed(2)}%`, lim(mc.nasdaq.d30 * 1.5, 18));
  if (dv?.d7 != null) add('Volatilidade esperada', `DVOL em ${dv.atual} (${dv.d7 > 0 ? '+' : ''}${dv.d7}% em 7 dias)`, lim(-dv.d7 * 0.6, 15));

  const soma = comp.reduce((a, b) => a + b.contrib, 0);
  const score = Math.max(-100, Math.min(100, Math.round(soma)));
  const label = score >= 45 ? 'Vento a favor' : score >= 15 ? 'Levemente favorável'
    : score > -15 ? 'Neutro' : score > -45 ? 'Levemente contrário' : 'Vento contra';
  return { score, label, componentes: comp };
}

async function ler() {
  const [pm, mc, dv] = await Promise.all([
    polymarket().catch(e => ({ erro: String(e.message).slice(0, 40) })),
    macro().catch(e => ({ erro: String(e.message).slice(0, 40) })),
    dvol().catch(e => ({ erro: String(e.message).slice(0, 40) }))
  ]);
  const nota = pontuar({ pm: pm.erro ? null : pm, mc: mc.erro ? null : mc, dv: dv.erro ? null : dv });
  return { t: Date.now(), apostas: pm, macro: mc, volatilidade: dv, ...nota };
}
// versao enxuta pro snapshot: so os numeros que interessam pra estudar depois
async function paraSnapshot() {
  const r = await ler();
  return {
    score: r.score, label: r.label,
    probCorteJuros: r.apostas?.probCorte ?? null,
    probAltaJuros: r.apostas?.probAlta ?? null,
    probManterJuros: r.apostas?.probManter ?? null,
    juros10a: r.macro?.juros10a?.valor ?? null,
    dxy: r.macro?.dolar?.valor ?? null,
    dxyD30: r.macro?.dolar?.d30 ?? null,
    nasdaqD30: r.macro?.nasdaq?.d30 ?? null,
    ouroD30: r.macro?.ouro?.d30 ?? null,
    dvol: r.volatilidade?.atual ?? null,
    corrBtcNasdaq: r.macro?.correlacao30d?.btcNasdaq ?? null,
    corrBtcDolar: r.macro?.correlacao30d?.btcDolar ?? null
  };
}

module.exports = { ler, paraSnapshot };
