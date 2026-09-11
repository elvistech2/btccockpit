// BTC Radar - servidor local: arquivos estaticos + proxy com cache + historico proprio.
// Sem dependencia externa (so Node >= 18 por causa do fetch global).
const http = require('http');
const fs = require('fs');
const path = require('path');
const SENT = require('./sentiment');
const SNAP = require('./snapshots');
const PRED = require('./preditivo');
const TEC = require('./tecnico');
const BACKUP = require('./backup');
const PAYROLL = require('./payroll');
const INFLACAO = require('./inflacao');
const ESTADO = require('./estado');
const FLUXOS = require('./fluxos');
const CAMINHOS = require('./paths');

const ROOT = __dirname;
const DATA = CAMINHOS.DATA;
const PORT = +(process.env.BTC_RADAR_PORT || 8899);
// Escuta so na propria maquina: o painel guarda a chave da IA e aceita gravar
// configuracao, entao nao pode ficar aberto pra rede sem a pessoa querer.
// Para abrir pro celular ou pra outro computador da casa: BTC_RADAR_HOST=0.0.0.0
const HOST = process.env.BTC_RADAR_HOST || '127.0.0.1';
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.ico': 'image/x-icon' };

CAMINHOS.garantir(DATA);

// Quem sobe o painel escondido (o atalho do Windows, o systemd) precisa de um jeito de
// parar depois. O arquivo abaixo diz qual processo e a porta; some sozinho ao sair.
const PID_FILE = path.join(DATA, 'servidor.pid');
function anotarPid() {
  try { fs.writeFileSync(PID_FILE, JSON.stringify({ pid: process.pid, porta: PORT, t: Date.now() })); } catch (e) { }
}
function limparPid() {
  try {
    const j = JSON.parse(fs.readFileSync(PID_FILE, 'utf8'));
    if (j.pid === process.pid) fs.unlinkSync(PID_FILE);
  } catch (e) { }
}
process.on('exit', limparPid);
for (const sinal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(sinal, () => { limparPid(); process.exit(0); });
}

const HIST_FILE = path.join(DATA, 'history.jsonl');
const LIQ_FILE = path.join(DATA, 'liquidations.jsonl');

/* ---------------- proxy com cache ---------------- */
const UPSTREAM = {
  binance: 'https://fapi.binance.com',
  spot: 'https://api.binance.com',
  bybit: 'https://api.bybit.com',
  okx: 'https://www.okx.com',
  hl: 'https://api.hyperliquid.xyz'
};
// TTL por tipo de dado: livro muda a todo instante, open interest so a cada 5min
const TTL = [
  [/depth|orderbook|books-full|l2Book/, 3000],
  [/openInterestHist|open-interest|rubik|account-ratio|metaAndAssetCtxs/, 25000],
  [/liquidation-orders/, 15000],
  [/klines|ticker|premiumIndex/, 10000]
];
const ttlFor = u => (TTL.find(([re]) => re.test(u)) || [null, 8000])[1];
const cache = new Map();

async function proxy(req, res, key, rest) {
  const base = UPSTREAM[key];
  const url = base + rest;
  let body = '';
  if (req.method === 'POST') body = await new Promise(r => { let b = ''; req.on('data', c => b += c); req.on('end', () => r(b)); });
  const ck = req.method + ' ' + url + ' ' + body;
  const hit = cache.get(ck);
  const ttl = ttlFor(url);
  if (hit && Date.now() - hit.t < ttl) return send(res, hit.status, hit.body, true);
  try {
    const r = await fetch(url, {
      method: req.method,
      headers: req.method === 'POST' ? { 'content-type': 'application/json' } : { 'accept': 'application/json' },
      body: req.method === 'POST' ? body : undefined
    });
    const txt = await r.text();
    cache.set(ck, { t: Date.now(), status: r.status, body: txt });
    send(res, r.status, txt, false);
  } catch (e) {
    if (hit) return send(res, hit.status, hit.body, true);   // serve o velho se o upstream cair
    send(res, 502, JSON.stringify({ error: String(e.message || e) }), false);
  }
}
function send(res, status, body, cached) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'X-Cache': cached ? 'HIT' : 'MISS',
    'Cache-Control': 'no-store'
  });
  res.end(body);
}
const getJSON = (url, opts) => fetch(url, opts).then(r => r.json()).catch(() => null);

/* ---------------- historico proprio ---------------- */
// Snapshot por minuto de OI (USD e BTC), funding, LSR e basis. Serve pra ter serie
// mais longa que a API entrega e pra calcular z-score em vez de limiar chutado.
let history = [];
function loadJsonl(file, hours) {
  if (!fs.existsSync(file)) return [];
  const cut = Date.now() - hours * 3.6e6;
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)
    .map(l => { try { return JSON.parse(l) } catch (e) { return null } })
    .filter(x => x && x.t >= cut);
}
history = loadJsonl(HIST_FILE, 24 * 30);

async function collect() {
  const [bin, byb, okx, hl, spot, prem] = await Promise.all([
    getJSON(UPSTREAM.binance + '/futures/data/openInterestHist?symbol=BTCUSDT&period=5m&limit=1'),
    getJSON(UPSTREAM.bybit + '/v5/market/open-interest?category=linear&symbol=BTCUSDT&intervalTime=5min&limit=1'),
    getJSON(UPSTREAM.okx + '/api/v5/public/open-interest?instType=SWAP&instId=BTC-USDT-SWAP'),
    getJSON(UPSTREAM.hl + '/info', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'metaAndAssetCtxs' }) }),
    getJSON(UPSTREAM.spot + '/api/v3/ticker/price?symbol=BTCUSDT'),
    getJSON(UPSTREAM.binance + '/fapi/v1/premiumIndex?symbol=BTCUSDT')
  ]);
  const mark = prem ? +prem.markPrice : null;
  const row = { t: Date.now(), mark, spot: spot ? +spot.price : null, funding: prem ? +prem.lastFundingRate : null, oi: {} };
  if (bin && bin[0]) row.oi.binance = { btc: +bin[0].sumOpenInterest, usd: +bin[0].sumOpenInterestValue };
  if (byb && byb.result && byb.result.list && byb.result.list[0] && mark) {
    const b = +byb.result.list[0].openInterest; row.oi.bybit = { btc: b, usd: b * mark };
  }
  if (okx && okx.data && okx.data[0]) {
    const b = +okx.data[0].oiCcy; row.oi.okx = { btc: b, usd: mark ? b * mark : null };
  }
  if (Array.isArray(hl) && hl[0] && hl[0].universe) {
    const i = hl[0].universe.findIndex(u => u.name === 'BTC');
    if (i >= 0 && hl[1][i]) { const b = +hl[1][i].openInterest; row.oi.hyperliquid = { btc: b, usd: b * (+hl[1][i].markPx) }; }
  }
  if (row.spot && row.mark) row.basisPct = (row.mark / row.spot - 1) * 100;
  if (Object.keys(row.oi).length) {
    history.push(row);
    fs.appendFile(HIST_FILE, JSON.stringify(row) + '\n', () => { });
    if (history.length > 60000) history = history.slice(-40000);
  }
}

/* ---------------- liquidacoes ---------------- */
// Bybit chega pelo WebSocket do navegador (o servidor nao tem cliente ws).
// OKX o proprio servidor busca por REST, que e o unico jeito publico.
let liqs = loadJsonl(LIQ_FILE, 48);
const liqSeen = new Set(liqs.map(l => l.k));
function addLiqs(rows) {
  const fresh = [];
  for (const r of rows) {
    if (!r || !isFinite(r.t) || !isFinite(r.px) || !isFinite(r.qty)) continue;
    const k = `${r.src}|${r.t}|${r.px}|${r.qty}`;
    if (liqSeen.has(k)) continue;
    liqSeen.add(k);
    const row = { k, t: r.t, px: r.px, qty: r.qty, side: r.side === 'short' ? 'short' : 'long', src: String(r.src || '?').slice(0, 12) };
    liqs.push(row); fresh.push(row);
  }
  if (fresh.length) fs.appendFile(LIQ_FILE, fresh.map(r => JSON.stringify(r)).join('\n') + '\n', () => { });
  if (liqs.length > 200000) liqs = liqs.slice(-150000);
  return fresh.length;
}
let okxCtVal = 0.01;
async function pollOkxLiq() {
  const j = await getJSON(UPSTREAM.okx + '/api/v5/public/liquidation-orders?instType=SWAP&instFamily=BTC-USDT&state=filled&limit=100');
  if (!j || !j.data) return;
  const rows = [];
  for (const blk of j.data) for (const d of (blk.details || [])) {
    // sz vem em contratos; ctVal do BTC-USDT-SWAP = 0,01 BTC
    rows.push({ t: +d.ts, px: +d.bkPx, qty: +d.sz * okxCtVal, side: d.posSide === 'short' ? 'short' : 'long', src: 'okx' });
  }
  addLiqs(rows);
}
// Gate.io: REST publico de liquidacao. size negativo = ordem de venda = long estourado.
// Cada contrato BTC_USDT vale 0,0001 BTC (quanto_multiplier).
let gateMult = 0.0001;
async function pollGateLiq() {
  const j = await getJSON('https://api.gateio.ws/api/v4/futures/usdt/liq_orders?contract=BTC_USDT&limit=100');
  if (!Array.isArray(j)) return;
  addLiqs(j.map(d => ({
    t: (+d.time) * 1000, px: +d.fill_price, qty: Math.abs(+d.size) * gateMult,
    side: (+d.size) < 0 ? 'long' : 'short', src: 'gate'
  })));
}
async function initGateMult() {
  const j = await getJSON('https://api.gateio.ws/api/v4/futures/usdt/contracts/BTC_USDT');
  if (j && +j.quanto_multiplier) gateMult = +j.quanto_multiplier;
}

/* ---------------- fita de negocios por tamanho de ordem ---------------- */
// Cada negocio da Bybit cai numa faixa de tamanho em dolar e vira balde de 1 hora.
// A hora fechada vai pro disco; a hora em curso fica na memoria (some se o servidor cair).
const TAPE_FILE = FLUXOS.TAPE_FILE;
const TAPE_TMP = path.join(DATA, 'tape-parcial.json');
const BALDE = 5 * 6e4;                     // 5 minutos: janela de 1h e 6h saem certas
let horaFita = null;
// se o servidor morreu no meio de um balde, retoma de onde parou
try {
  const p = JSON.parse(fs.readFileSync(TAPE_TMP, 'utf8'));
  if (p && p.t === Math.floor(Date.now() / BALDE) * BALDE) horaFita = p;
} catch (e) { }
function baldeVazio(t) {
  const b = {};
  for (const fx of FLUXOS.FAIXAS) b[fx.id] = { c: 0, v: 0, n: 0 };
  return { t, b };
}
function fecharHora() {
  if (!horaFita) return;
  const algum = Object.values(horaFita.b).some(x => x.n > 0);
  if (algum) fs.appendFile(TAPE_FILE, JSON.stringify(horaFita) + '\n', () => { });
  try { fs.unlinkSync(TAPE_TMP); } catch (e) { }
  horaFita = null;
}
function addTrade(px, qty, compra) {
  const usd = px * qty;
  if (!isFinite(usd) || usd <= 0) return;
  const hora = Math.floor(Date.now() / BALDE) * BALDE;
  if (!horaFita) horaFita = baldeVazio(hora);
  else if (horaFita.t !== hora) { fecharHora(); horaFita = baldeVazio(hora); }
  const b = horaFita.b[FLUXOS.faixaDe(usd)];
  if (compra) b.c += usd; else b.v += usd;
  b.n++;
}
FLUXOS.setHoraAtual(() => horaFita);
// grava a hora em curso a cada minuto: mesmo morto a machadada, perde-se no maximo 1 minuto
setInterval(() => { if (horaFita) fs.writeFile(TAPE_TMP, JSON.stringify(horaFita), () => { }); }, 6e4);
process.on('exit', fecharHora);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { fecharHora(); process.exit(0); });

// Bybit ao vivo direto no servidor (Node 22 ja tem WebSocket embutido): assim a coleta
// continua com o navegador fechado. Binance nao entra: fstream nao entrega mensagem
// daqui nem pelo navegador nem pelo Node, nao ha REST publico e o arquivo diario saiu do ar.
let bybitWs = null, bybitPing = null;
function conectarBybitLiq() {
  if (typeof WebSocket === 'undefined') {       // Node < 22 nao tem WebSocket global
    console.error('AVISO: este Node nao tem WebSocket embutido (precisa da versao 22 ou mais nova).');
    console.error('       O painel roda, mas sem liquidacoes da Bybit e sem a fita de negocios.');
    return;
  }
  try { bybitWs = new WebSocket('wss://stream.bybit.com/v5/public/linear'); }
  catch (e) { return setTimeout(conectarBybitLiq, 5000); }
  bybitWs.onopen = () => {
    bybitWs.send(JSON.stringify({ op: 'subscribe', args: ['allLiquidation.BTCUSDT', 'publicTrade.BTCUSDT'] }));
    clearInterval(bybitPing);
    bybitPing = setInterval(() => { try { bybitWs.send(JSON.stringify({ op: 'ping' })) } catch (e) { } }, 20000);
  };
  bybitWs.onmessage = ev => {
    let m; try { m = JSON.parse(ev.data) } catch (e) { return; }
    if (m.topic === 'publicTrade.BTCUSDT' && m.data) {
      for (const d of m.data) addTrade(+d.p, +d.v, d.S === 'Buy');
      return;
    }
    if (m.topic !== 'allLiquidation.BTCUSDT' || !m.data) return;
    addLiqs(m.data.map(d => ({
      t: +d.T, px: +d.p, qty: +d.v, side: d.S === 'Sell' ? 'long' : 'short', src: 'bybit'
    })));
  };
  bybitWs.onclose = () => { clearInterval(bybitPing); setTimeout(conectarBybitLiq, 4000); };
  bybitWs.onerror = () => { try { bybitWs.close() } catch (e) { } };
}

async function initOkxCtVal() {
  const j = await getJSON(UPSTREAM.okx + '/api/v5/public/instruments?instType=SWAP&instId=BTC-USDT-SWAP');
  if (j && j.data && j.data[0] && +j.data[0].ctVal) okxCtVal = +j.data[0].ctVal;
}

/* ---------------- http ---------------- */
const json = (res, obj) => { res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };

http.createServer(async (req, res) => {
  const url = req.url;

  const m = url.match(/^\/px\/([a-z]+)(\/.*)$/);
  if (m && UPSTREAM[m[1]]) return proxy(req, res, m[1], m[2]);

  if (url.startsWith('/api/snapshot/acervo')) return json(res, SNAP.acervo());
  if (url.startsWith('/api/snapshot/apagar') && req.method === 'POST') {
    const body = await new Promise(r => { let b = ''; req.on('data', c => b += c); req.on('end', () => r(b)); });
    let p = {};
    try { p = JSON.parse(body || '{}'); } catch (e) { }
    return json(res, SNAP.apagar({ ts: p.ts || [], tudo: !!p.tudo }));
  }
  if (url.startsWith('/api/snapshot')) {
    const q = new URLSearchParams(url.split('?')[1] || '');
    if (req.method === 'POST') {
      const body = await new Promise(r => { let b = ''; req.on('data', c => b += c); req.on('end', () => r(b)); });
      let p = {};
      try { p = JSON.parse(body || '{}'); } catch (e) { }
      try {
        const s = await SNAP.tirar({ cliente: p.cliente, nota: p.nota, tags: p.tags, origem: p.origem || 'manual', history, liqs });
        return json(res, s);
      } catch (e) { return json(res, { error: String(e.message || e).slice(0, 200) }); }
    }
    const lista = SNAP.listar({ horas: +q.get('horas') || null, limite: +q.get('limite') || 100000, tag: q.get('tag') });
    if (q.get('formato') === 'csv') {
      res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="btc-radar-snapshots.csv"' });
      return res.end(SNAP.csv(lista));
    }
    return json(res, lista);
  }
  if (url.startsWith('/api/backup')) {
    if (req.method === 'POST') { try { return json(res, BACKUP.rodar({ motivo: 'manual' })); } catch (e) { return json(res, { error: String(e.message) }); } }
    return json(res, BACKUP.status());
  }
  if (url.startsWith('/api/tecnico')) {
    try { return json(res, await TEC.ler()); }
    catch (e) { return json(res, { error: String(e.message || e).slice(0, 200) }); }
  }
  if (url.startsWith('/api/preditivo')) {
    try { return json(res, await PRED.ler()); }
    catch (e) { return json(res, { error: String(e.message || e).slice(0, 200) }); }
  }
  if (url.startsWith('/api/fluxos')) {
    const d = Math.min(90, Math.max(1, +(url.match(/dias=(\d+)/) || [])[1] || 7));
    const ultimo = history.length ? (history[history.length - 1].mark || history[history.length - 1].spot) : null;
    const h = Math.min(720, Math.max(1, +(url.match(/horasFita=(\d+)/) || [])[1] || 1));
    try { return json(res, await FLUXOS.tudo(d, ultimo, h)); }
    catch (e) { return json(res, { error: String(e.message || e).slice(0, 200) }); }
  }
  if (url.startsWith('/api/config')) {
    if (req.method === 'POST') {
      const body = await new Promise(r => { let b = ''; req.on('data', c => b += c); req.on('end', () => r(b)); });
      let p = {};
      try { p = JSON.parse(body || '{}'); } catch (e) { }
      try {
        const modelos = await SENT.validarChave(String(p.geminiKey || '').trim());
        const info = SENT.salvarChave(p.geminiKey, p.geminiModel);
        return json(res, { ok: true, ...info, modelosDisponiveis: modelos.slice(0, 40) });
      } catch (e) { return json(res, { error: String(e.message || e).slice(0, 200) }); }
    }
    return json(res, SENT.infoChave());
  }
  if (url.startsWith('/api/estado')) {
    const d = Math.min(90, Math.max(3, +(url.match(/dias=(\d+)/) || [])[1] || 14));
    try { return json(res, await ESTADO.ler(d)); }
    catch (e) { return json(res, { error: String(e.message || e).slice(0, 200) }); }
  }
  if (url.startsWith('/api/inflacao')) {
    try { return json(res, await INFLACAO.ler()); }
    catch (e) { return json(res, { error: String(e.message || e).slice(0, 200) }); }
  }
  if (url.startsWith('/api/payroll')) {
    try { return json(res, await PAYROLL.ler()); }
    catch (e) { return json(res, { error: String(e.message || e).slice(0, 200) }); }
  }
  if (url.startsWith('/api/fng')) {
    try { return json(res, await SENT.fearGreed()); }
    catch (e) { return json(res, { error: String(e.message || e) }); }
  }
  if (url.startsWith('/api/sentiment/analise')) {
    const kind = (url.match(/kind=(\w+)/) || [])[1] || 'influencers';
    try {
      return json(res, await SENT.analisar(kind));
    } catch (e) { return json(res, { error: String(e.message || e).slice(0, 300) }); }
  }
  if (url.startsWith('/api/sentiment')) {
    return json(res, { historico: SENT.ultimos(720) });
  }
  if (url.startsWith('/api/history')) {
    const hours = Math.min(720, +(url.match(/hours=(\d+)/) || [])[1] || 48);
    const cut = Date.now() - hours * 3.6e6;
    return json(res, history.filter(r => r.t >= cut));
  }
  if (url.startsWith('/api/liq')) {
    if (req.method === 'POST') {
      const body = await new Promise(r => { let b = ''; req.on('data', c => b += c); req.on('end', () => r(b)); });
      let n = 0;
      try { n = addLiqs(JSON.parse(body).slice(0, 500)) } catch (e) { }
      return json(res, { added: n });
    }
    const hours = Math.min(168, +(url.match(/hours=(\d+)/) || [])[1] || 24);
    const cut = Date.now() - hours * 3.6e6;
    return json(res, liqs.filter(r => r.t >= cut).map(({ t, px, qty, side, src }) => ({ t, px, qty, side, src })));
  }

  let file = decodeURIComponent(url.split('?')[0]);
  if (file === '/' || file === '') file = '/index.html';
  let rel = path.normalize(file);
  while (rel[0] === '/' || rel[0] === '\\') rel = rel.slice(1);
  const full = path.join(ROOT, rel);
  if (!full.startsWith(ROOT)) { res.writeHead(403); res.end('forbidden'); return; }
  fs.readFile(full, (err, buf) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('404'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(full)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(buf);
  });
}).listen(PORT, HOST, () => {
  anotarPid();
  console.log('btc-dashboard on http://localhost:' + PORT + (HOST === '127.0.0.1' ? '' : '  (aberto em ' + HOST + ')'));
  console.log(`historico: ${history.length} minutos | liquidacoes: ${liqs.length} | snapshots: ${SNAP.total()}`);
  initOkxCtVal().then(pollOkxLiq);
  collect();
  setInterval(collect, 60000);
  // snapshot so no clique do usuario quando snapshotMin = 0 (padrao atual):
  // ele olha o painel, forma opiniao e salva com a propria nota
  const cfgMin = SENT.cfg().snapshotMin;               // 0 = so manual (nao pode cair no || 15)
  const minAuto = (cfgMin === undefined || cfgMin === null) ? 15 : +cfgMin;
  if (minAuto > 0) setInterval(() => {
    SNAP.tirar({ origem: 'auto', history, liqs }).catch(() => { });
  }, minAuto * 60000);
  setInterval(pollOkxLiq, 20000);
  initGateMult().then(pollGateLiq);
  setInterval(pollGateLiq, 20000);
  conectarBybitLiq();
  try { console.log('backup:', JSON.stringify(BACKUP.rodar({ motivo: 'inicio' }))); } catch (e) { }
  setInterval(() => { try { BACKUP.rodar({ motivo: 'periodico' }) } catch (e) { } }, 6 * 3.6e6);
  FLUXOS.coletarPremios().catch(() => { });
  setInterval(() => { FLUXOS.coletarPremios().catch(() => { }); }, 10 * 6e4);
});
