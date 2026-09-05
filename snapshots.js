// SNAPSHOT: congela o estado do mercado num instante — preco, open interest e variacao,
// LSR, livro, liquidacoes e sentimento — pra virar base de estudo depois.
// Dois caminhos: o navegador manda o que ja tem na tela (mais rico), e o servidor
// tira snapshot sozinho de tempos em tempos (funciona com o painel fechado).
const fs = require('fs');
const path = require('path');
const SENT = require('./sentiment');
const PRED = require('./preditivo');
const TEC = require('./tecnico');
const ESTADO = require('./estado');

const DATA = path.join(__dirname, 'data');
const FILE = path.join(DATA, 'snapshots.jsonl');
const BIN = 'https://fapi.binance.com';

let snaps = [];
function carregar() {
  if (!fs.existsSync(FILE)) return [];
  return fs.readFileSync(FILE, 'utf8').split('\n').filter(Boolean)
    .map(l => { try { return JSON.parse(l) } catch (e) { return null } }).filter(Boolean);
}
snaps = carregar();

const getJSON = (u, o) => fetch(u, o).then(r => r.json()).catch(() => null);
const num = v => (v == null || !isFinite(v)) ? null : +v;

// variacao percentual do OI agregado usando o historico que o servidor grava por minuto
function deltaOI(history, ms) {
  if (!history.length) return null;
  const total = r => Object.values(r.oi || {}).reduce((a, b) => a + (b.btc || 0), 0);
  const agora = history[history.length - 1];
  const alvo = agora.t - ms;
  let base = null;
  for (const r of history) if (r.t <= alvo) base = r;
  if (!base || base === agora) return null;
  const a = total(base), b = total(agora);
  return a > 0 ? +(((b / a) - 1) * 100).toFixed(3) : null;
}

async function estadoServidor(history, liqs) {
  const ultimo = history[history.length - 1] || {};
  const [g, t, tk, depth] = await Promise.all([
    getJSON(BIN + '/futures/data/globalLongShortAccountRatio?symbol=BTCUSDT&period=5m&limit=1'),
    getJSON(BIN + '/futures/data/topLongShortPositionRatio?symbol=BTCUSDT&period=5m&limit=1'),
    getJSON(BIN + '/futures/data/takerlongshortRatio?symbol=BTCUSDT&period=5m&limit=1'),
    getJSON(BIN + '/fapi/v1/depth?symbol=BTCUSDT&limit=1000')
  ]);
  const mid = num(ultimo.mark);
  let livro = null;
  if (depth && depth.bids && mid) {
    const faixa = 0.005, lo = mid * (1 - faixa), hi = mid * (1 + faixa);
    const soma = (arr, dentro) => arr.reduce((a, [p, q]) => dentro(+p) ? a + (+p) * (+q) : a, 0);
    const bid = soma(depth.bids, p => p >= lo && p <= mid);
    const ask = soma(depth.asks, p => p <= hi && p >= mid);
    livro = { bidUsd: Math.round(bid), askUsd: Math.round(ask), ratio: ask ? +(bid / ask).toFixed(3) : null, janelaPct: 0.5, fonte: 'binance' };
  }
  const oiBtc = {}, oiUsd = {};
  for (const [ex, v] of Object.entries(ultimo.oi || {})) { oiBtc[ex] = Math.round(v.btc); oiUsd[ex] = Math.round(v.usd || 0); }
  const soma = o => Object.values(o).reduce((a, b) => a + b, 0);
  const janela = (h, lado) => liqs.filter(l => l.t >= Date.now() - h * 3.6e6 && l.side === lado)
    .reduce((a, b) => a + b.px * b.qty, 0);
  return {
    preco: {
      mark: num(ultimo.mark), spot: num(ultimo.spot),
      funding: num(ultimo.funding), basisPct: num(ultimo.basisPct)
    },
    oi: {
      btc: { ...oiBtc, total: soma(oiBtc) }, usd: { ...oiUsd, total: soma(oiUsd) },
      d1hPct: deltaOI(history, 3.6e6), d24hPct: deltaOI(history, 864e5)
    },
    lsr: {
      contasBinance: g && g[0] ? +g[0].longShortRatio : null,
      longPct: g && g[0] ? +(+g[0].longAccount * 100).toFixed(1) : null,
      topTraders: t && t[0] ? +t[0].longShortRatio : null,
      taker: tk && tk[0] ? +tk[0].buySellRatio : null
    },
    livro,
    liquidacoes: {
      long1h: Math.round(janela(1, 'long')), short1h: Math.round(janela(1, 'short')),
      long24h: Math.round(janela(24, 'long')), short24h: Math.round(janela(24, 'short'))
    }
  };
}

async function sentimentoAtual(pred) {
  let fng = null;
  try { const f = await SENT.fearGreed(); fng = f && f[0] ? { valor: f[0].v, label: f[0].label, t: f[0].t } : null; } catch (e) { }
  const hist = SENT.ultimos(720);
  const ultimoDe = k => [...hist].reverse().find(r => r.kind === k) || null;
  const not = ultimoDe('noticias') || ultimoDe('influencers'), fed = ultimoDe('fed');
  const partes = [];
  if (fng) partes.push({ v: fng.valor * 2 - 100, p: 0.3 });
  if (not) partes.push({ v: not.score, p: 0.25 });
  if (fed) partes.push({ v: fed.score, p: 0.25 });
  if (pred && pred.score != null) partes.push({ v: pred.score, p: 0.2 });
  const composto = partes.length
    ? Math.round(partes.reduce((a, b) => a + b.v * b.p, 0) / partes.reduce((a, b) => a + b.p, 0)) : null;
  return {
    fng: fng ? fng.valor : null, fngLabel: fng ? fng.label : null,
    noticias: not ? { score: not.score, label: not.label, resumo: not.resumo, t: not.t } : null,
    fed: fed ? { score: fed.score, label: fed.label, resumo: fed.resumo, t: fed.t } : null,
    composto
  };
}

// Serie de estudo so presta se todo snapshot medir do mesmo jeito. Entao oi, livro e
// liquidacoes vem SEMPRE do servidor (mesmo metodo no manual e no automatico); o painel
// so acrescenta o que o servidor nao tem (preco tick a tick, LSR de mais fontes) e o
// resto do que ele enxerga fica guardado a parte, em "painel", sem sujar a serie.
function fundir(base, cliente) {
  if (!cliente) return base;
  const out = JSON.parse(JSON.stringify(base));
  for (const chave of ['preco', 'lsr']) {
    if (!cliente[chave]) continue;
    out[chave] = Object.assign({}, out[chave] || {}, limparNulos(cliente[chave]));
  }
  const extra = limparNulos({ oi: cliente.oi, livro: cliente.livro, liquidacoes: cliente.liquidacoes });
  if (Object.keys(extra).length) {
    extra.obs = 'medicao do painel: OI inclui todos os contratos BTC da OKX e o livro soma 4 exchanges';
    out.painel = extra;
  }
  return out;
}
function limparNulos(o) {
  const r = {};
  for (const [k, v] of Object.entries(o || {})) {
    if (v === null || v === undefined || (typeof v === 'number' && !isFinite(v))) continue;
    r[k] = (v && typeof v === 'object' && !Array.isArray(v)) ? limparNulos(v) : v;
  }
  return r;
}

async function tirar({ cliente = null, nota = '', tags = [], origem = 'manual', history = [], liqs = [] } = {}) {
  const base = await estadoServidor(history, liqs);
  const snap = fundir(base, cliente);
  snap.t = Date.now();
  snap.iso = new Date(snap.t).toISOString();
  snap.origem = origem;
  snap.nota = String(nota || '').slice(0, 400);
  snap.tags = (Array.isArray(tags) ? tags : String(tags).split(',')).map(s => String(s).trim().toLowerCase())
    .filter(Boolean).slice(0, 8);
  snap.preditivo = await PRED.paraSnapshot().catch(() => null);
  snap.tecnico = await TEC.paraSnapshot().catch(() => null);
  snap.estado = await ESTADO.paraSnapshot(14).catch(() => null);
  snap.sentimento = await sentimentoAtual(snap.preditivo);
  if (cliente && cliente.leitura) snap.leitura = String(cliente.leitura).slice(0, 400);
  snaps.push(snap);
  fs.appendFileSync(FILE, JSON.stringify(snap) + '\n');
  return snap;
}

// Nada e apagado nunca: o arquivo e append-only e "horas" e so filtro de leitura.
// Sem argumento, devolve TUDO o que ja foi salvo desde o primeiro snapshot.
function listar({ horas = null, limite = 100000, tag = null } = {}) {
  const corte = horas ? Date.now() - horas * 3.6e6 : 0;
  let r = corte ? snaps.filter(s => s.t >= corte) : snaps.slice();
  if (tag) r = r.filter(s => (s.tags || []).includes(String(tag).toLowerCase()));
  return r.slice(-limite);
}

// apagar reescreve o arquivo inteiro: e pequeno (uma linha por snapshot) e assim
// nao sobra linha fantasma no meio do jsonl
function apagar({ ts = [], tudo = false } = {}) {
  const antes = snaps.length;
  const alvo = new Set((Array.isArray(ts) ? ts : [ts]).map(Number));
  snaps = tudo ? [] : snaps.filter(s => !alvo.has(s.t));
  fs.writeFileSync(FILE, snaps.map(s => JSON.stringify(s)).join('\n') + (snaps.length ? '\n' : ''));
  return { apagados: antes - snaps.length, restam: snaps.length };
}

const COLUNAS = [
  ['quando', s => new Date(s.t).toISOString()],
  ['origem', s => s.origem],
  ['nota', s => (s.nota || '').replace(/[";\n]/g, ' ')],
  ['tags', s => (s.tags || []).join('|')],
  ['preco', s => s.preco?.last ?? s.preco?.mark ?? ''],
  ['chg24pct', s => s.preco?.chg24 ?? ''],
  ['funding', s => s.preco?.funding ?? ''],
  ['basis_pct', s => s.preco?.basisPct ?? ''],
  ['oi_btc_total', s => s.oi?.btc?.total ?? ''],
  ['oi_usd_total', s => s.oi?.usd?.total ?? ''],
  ['oi_d1h_pct', s => s.oi?.d1hPct ?? ''],
  ['oi_d24h_pct', s => s.oi?.d24hPct ?? ''],
  ['lsr_contas', s => s.lsr?.contasBinance ?? ''],
  ['lsr_top', s => s.lsr?.topTraders ?? ''],
  ['taker', s => s.lsr?.taker ?? ''],
  ['livro_bid_usd', s => s.livro?.bidUsd ?? ''],
  ['livro_ask_usd', s => s.livro?.askUsd ?? ''],
  ['livro_ratio', s => s.livro?.ratio ?? ''],
  ['livro_fonte', s => s.livro?.fonte ?? ''],
  ['painel_oi_btc', s => s.painel?.oi?.btc?.total ?? ''],
  ['painel_livro_ratio', s => s.painel?.livro?.ratio ?? ''],
  ['liq_long_1h', s => s.liquidacoes?.long1h ?? ''],
  ['liq_short_1h', s => s.liquidacoes?.short1h ?? ''],
  ['liq_long_24h', s => s.liquidacoes?.long24h ?? ''],
  ['liq_short_24h', s => s.liquidacoes?.short24h ?? ''],
  ['fng', s => s.sentimento?.fng ?? ''],
  ['sent_noticias', s => s.sentimento?.noticias?.score ?? ''],
  ['sent_fed', s => s.sentimento?.fed?.score ?? ''],
  ['sent_composto', s => s.sentimento?.composto ?? ''],
  ['pred_score', s => s.preditivo?.score ?? ''],
  ['tec_score', s => s.tecnico?.score ?? ''],
  ['tec_label', s => s.tecnico?.label ?? ''],
  ['rsi_1h', s => s.tecnico?.rsi1h?.toFixed?.(1) ?? ''],
  ['rsi_4h', s => s.tecnico?.rsi4h?.toFixed?.(1) ?? ''],
  ['posicao_faixa_30d', s => s.tecnico?.posicaoNaFaixa30d?.toFixed?.(1) ?? ''],
  ['estado_score', s => s.estado?.score ?? ''],
  ['estado_label', s => s.estado?.label ?? ''],
  ['estado_fase', s => s.estado?.fase ?? ''],
  ['pred_prob_corte', s => s.preditivo?.probCorteJuros ?? ''],
  ['pred_prob_alta', s => s.preditivo?.probAltaJuros ?? ''],
  ['juros_10a', s => s.preditivo?.juros10a ?? ''],
  ['dxy', s => s.preditivo?.dxy ?? ''],
  ['dxy_d30', s => s.preditivo?.dxyD30 ?? ''],
  ['nasdaq_d30', s => s.preditivo?.nasdaqD30 ?? ''],
  ['dvol', s => s.preditivo?.dvol ?? ''],
  ['corr_btc_nasdaq', s => s.preditivo?.corrBtcNasdaq ?? ''],
  ['leitura', s => (s.leitura || '').replace(/[";\n]/g, ' ')]
];
function csv(lista) {
  const linhas = [COLUNAS.map(c => c[0]).join(';')];
  for (const s of lista) linhas.push(COLUNAS.map(c => { const v = c[1](s); return v === null || v === undefined ? '' : String(v); }).join(';'));
  return linhas.join('\n');
}

// resumo do acervo, pra tela poder dizer "N guardados desde tal dia"
function acervo() {
  return {
    total: snaps.length,
    manuais: snaps.filter(s => s.origem === 'manual').length,
    primeiro: snaps.length ? snaps[0].t : null,
    ultimo: snaps.length ? snaps[snaps.length - 1].t : null
  };
}
module.exports = { tirar, listar, apagar, csv, acervo, total: () => snaps.length };
