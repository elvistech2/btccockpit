// Quem compra e quem vende: junta as fontes publicas que dizem QUEM esta do outro lado
// da ordem. Cada bloco e uma classe de participante e mede uma coisa diferente
// (dinheiro liquidado de verdade x agressao no futuro) - a UI nao pode misturar os dois.
const fs = require('fs');
const path = require('path');
const CAMINHOS = require('./paths');

const DATA = CAMINHOS.DATA;
const TES_FILE = path.join(DATA, 'tesourarias.jsonl');   // foto diaria das empresas de capital aberto
const TAPE_FILE = path.join(DATA, 'tape.jsonl');          // fita de negocios por faixa de tamanho, por hora
const PREM_FILE = path.join(DATA, 'premios.jsonl');       // premio Coinbase e Coreia, a cada 10 min

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) btc-radar';
const cache = new Map();
async function cached(key, ttl, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < ttl) return hit.v;
  try {
    const v = await fn();
    cache.set(key, { t: Date.now(), v });
    return v;
  } catch (e) {
    if (hit) return hit.v;                 // fonte caiu: serve o ultimo bom
    throw e;
  }
}
async function jget(url, opts = {}) {
  const c = new AbortController();
  const to = setTimeout(() => c.abort(), opts.timeout || 20000);
  try {
    const r = await fetch(url, {
      method: opts.method || 'GET',
      headers: { 'user-agent': UA, accept: 'application/json', ...(opts.headers || {}) },
      body: opts.body, signal: c.signal
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } finally { clearTimeout(to); }
}
const post = (url, body) => jget(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const num = v => { const n = +(v && v.value !== undefined ? v.value : v); return isFinite(n) ? n : null; };
const dias = n => n * 864e5;
function lerJsonl(file, desde) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)
    .map(l => { try { return JSON.parse(l); } catch (e) { return null; } })
    .filter(x => x && (!desde || x.t >= desde));
}
const gravar = (file, row) => { try { fs.appendFileSync(file, JSON.stringify(row) + '\n'); } catch (e) { } };

/* ================= 1. ETFs a vista: fundos e gestoras ================= */
// SoSoValue abre a API sem chave. dailyNetInflow ja e dinheiro liquido criado/resgatado
// no fundo - isso e compra de verdade, nao volume negociado na bolsa.
const SOSO = 'https://api.sosovalue.xyz/openapi/v2/etf/';
async function etfAtivo(tipo) {
  const j = await post(SOSO + 'currentEtfDataMetrics', { type: tipo });
  const d = (j && j.data) || {};
  const fundos = (d.list || []).map(f => ({
    ticker: f.ticker, gestora: String(f.institute || '').trim(),
    patrimonio: num(f.netAssets), fluxoDia: num(f.dailyNetInflow),
    fluxoAcumulado: num(f.cumNetInflow), negociado: num(f.dailyValueTraded),
    taxa: num(f.fee), premio: num(f.discountPremiumRate)
  })).filter(f => f.ticker);
  fundos.sort((a, b) => (b.patrimonio || 0) - (a.patrimonio || 0));
  return {
    data: (d.totalNetAssets || {}).lastUpdateDate || null,
    patrimonio: num(d.totalNetAssets), fluxoDia: num(d.dailyNetInflow),
    fluxoAcumulado: num(d.cumNetInflow), negociado: num(d.dailyTotalValueTraded),
    moedas: num(d.totalTokenHoldings), dominancia: num(d.totalNetAssetsPercentage), fundos
  };
}
async function etfSerie(tipo, nDias) {
  const j = await post(SOSO + 'historicalInflowChart', { type: tipo });
  const corte = Date.now() - dias(nDias + 1);
  return (j && j.data ? j.data : [])
    .map(d => ({ t: Date.parse(d.date + 'T00:00:00Z'), dia: d.date, fluxo: +d.totalNetInflow, patrimonio: +d.totalNetAssets, negociado: +d.totalValueTraded }))
    .filter(d => isFinite(d.t) && d.t >= corte && isFinite(d.fluxo))
    .sort((a, b) => a.t - b.t);
}
async function etfs(nDias) {
  return cached('etf:' + nDias, 30 * 6e4, async () => {
    const out = {};
    for (const [nome, tipo] of [['btc', 'us-btc-spot'], ['eth', 'us-eth-spot'], ['sol', 'us-sol-spot']]) {
      try {
        const [atual, serie] = await Promise.all([etfAtivo(tipo), etfSerie(tipo, nDias)]);
        const soma = serie.reduce((s, d) => s + d.fluxo, 0);
        const positivos = serie.filter(d => d.fluxo > 0).length;
        out[nome] = { ...atual, serie, periodo: { soma, dias: serie.length, diasDeEntrada: positivos, diasDeSaida: serie.length - positivos } };
      } catch (e) { out[nome] = { erro: String(e.message || e).slice(0, 80) }; }
    }
    return out;
  });
}

/* ================= 2. Empresas de capital aberto (tesouraria) ================= */
// CoinGecko so devolve a foto de hoje. Guardamos uma foto por dia pra ter a variacao
// no periodo - por isso o delta so existe depois do primeiro dia de coleta.
async function tesouraria(moeda) {
  const j = await jget('https://api.coingecko.com/api/v3/companies/public_treasury/' + moeda);
  return {
    moeda, total: j.total_holdings, valor: j.total_value_usd, dominancia: j.market_cap_dominance,
    empresas: (j.companies || []).map(c => ({
      nome: c.name, ticker: c.symbol, pais: c.country, moedas: c.total_holdings,
      custo: c.total_entry_value_usd, valor: c.total_current_value_usd, pctSupply: c.percentage_of_total_supply
    }))
  };
}
async function empresas(nDias) {
  return cached('emp:' + nDias, 3 * 3.6e6, async () => {
    const out = {};
    for (const moeda of ['bitcoin', 'ethereum', 'solana']) {
      try {
        const atual = await tesouraria(moeda);
        const hoje = new Date().toISOString().slice(0, 10);
        const antigas = lerJsonl(TES_FILE).filter(r => r.moeda === moeda);
        if (!antigas.length || antigas[antigas.length - 1].dia !== hoje) {
          gravar(TES_FILE, { t: Date.now(), dia: hoje, moeda, total: atual.total, valor: atual.valor, n: atual.empresas.length });
        }
        const janela = antigas.filter(r => r.t >= Date.now() - dias(nDias));
        const base = janela[0] || antigas[0];
        atual.variacao = base ? { moedas: atual.total - base.total, desde: base.dia, dias: Math.round((Date.now() - base.t) / 864e5) } : null;
        atual.historico = antigas.slice(-90).map(r => ({ t: r.t, dia: r.dia, total: r.total }));
        out[moeda] = atual;
      } catch (e) { out[moeda] = { erro: String(e.message || e).slice(0, 80) }; }
    }
    return out;
  });
}

/* ================= 3. Varejo x contas grandes (futuros Binance) ================= */
// globalLongShortAccountRatio = todas as contas (a massa). topLongShortAccountRatio =
// as maiores contas da corretora. Divergencia entre as duas e o retrato classico de
// varejo de um lado e dinheiro grande do outro. Binance so guarda 30 dias.
const BFAPI = 'https://fapi.binance.com/futures/data/';
// Mesma janela da fita, pra comparar corretora com corretora sem trapaca.
// Klines dao o volume comprado a mercado (takerBuyBase) e o volume total de cada vela:
// venda a mercado = total - compra. E o dado exato, sem o atraso do endpoint de estatistica.
async function takerJanela(horas) {
  return cached('taker:' + horas.toFixed(2), 3 * 6e4, async () => {
    const intervalo = horas <= 12 ? '1m' : horas <= 72 ? '5m' : '1h';
    const porHora = intervalo === '1m' ? 60 : intervalo === '5m' ? 12 : 1;
    const limite = Math.min(1000, Math.max(2, Math.ceil(horas * porHora)));
    try {
      const j = await jget('https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=' + intervalo + '&limit=' + limite);
      const corte = Date.now() - horas * 3.6e6;
      let compra = 0, venda = 0, velas = 0, preco = 0;
      for (const k of (j || [])) {
        if (+k[0] < corte - 6e4) continue;
        const vol = +k[5], comprado = +k[9];
        compra += comprado; venda += vol - comprado; velas++; preco = +k[4];
      }
      return {
        fonte: 'binance klines ' + intervalo, velas, horas,
        compra: compra * preco, venda: venda * preco,
        ratio: venda ? compra / venda : null
      };
    } catch (e) { return { erro: String(e.message || e).slice(0, 60) }; }
  });
}

async function posicionamento(nDias) {
  return cached('pos:' + nDias, 10 * 6e4, async () => {
    const periodo = nDias <= 3 ? '1h' : nDias <= 10 ? '4h' : '1d';
    const porDia = periodo === '1h' ? 24 : periodo === '4h' ? 6 : 1;
    const limite = Math.min(500, Math.max(8, nDias * porDia));
    const q = 'symbol=BTCUSDT&period=' + periodo + '&limit=' + limite;
    const pega = async (rota, campo) => {
      try {
        const j = await jget(BFAPI + rota + '?' + q);
        return (j || []).map(d => ({ t: +d.timestamp, v: +d[campo] }));
      } catch (e) { return []; }
    };
    const [massa, topContas, topPos, taker] = await Promise.all([
      pega('globalLongShortAccountRatio', 'longShortRatio'),
      pega('topLongShortAccountRatio', 'longShortRatio'),
      pega('topLongShortPositionRatio', 'longShortRatio'),
      (async () => {
        try {
          const j = await jget(BFAPI + 'takerlongshortRatio?' + q);
          return (j || []).map(d => ({ t: +d.timestamp, v: +d.buySellRatio, compra: +d.buyVol, venda: +d.sellVol }));
        } catch (e) { return []; }
      })()
    ]);
    const ult = a => a.length ? a[a.length - 1].v : null;
    const somaTaker = taker.reduce((s, d) => ({ compra: s.compra + (d.compra || 0), venda: s.venda + (d.venda || 0) }), { compra: 0, venda: 0 });
    return {
      periodo, cobertura: '30 dias e o maximo que a Binance guarda nesses dados',
      massa, topContas, topPos, taker,
      agora: { massa: ult(massa), topContas: ult(topContas), topPos: ult(topPos), taker: ult(taker) },
      takerPeriodo: { ...somaTaker, liquidoBTC: somaTaker.compra - somaTaker.venda }
    };
  });
}

/* ================= 4. Fita de negocios por tamanho de ordem ================= */
// Coletada no servidor a partir do stream da Bybit (ver server.js). Cada negocio entra
// numa faixa de tamanho em dolar: e a leitura mais direta de "quem esta agredindo o
// livro agora", separando ordem de varejo de ordem de baleia.
const FAIXAS = [
  { id: 'varejo', nome: 'varejo', ate: 1e4, desc: 'ordens abaixo de $10 mil' },
  { id: 'medio', nome: 'médio', ate: 1e5, desc: '$10 mil a $100 mil' },
  { id: 'grande', nome: 'grande', ate: 1e6, desc: '$100 mil a $1 milhão' },
  { id: 'baleia', nome: 'baleia', ate: Infinity, desc: 'acima de $1 milhão' }
];
const faixaDe = usd => (FAIXAS.find(f => usd < f.ate) || FAIXAS[FAIXAS.length - 1]).id;
let horaAtual = () => null;                       // o servidor injeta a hora ainda aberta
const setHoraAtual = fn => { horaAtual = fn; };
function fita(nDias, horasJanela) {
  // A fita so existe desde que o servidor comecou a rodar: a janela dela e propria,
  // nao a do seletor de dias dos ETFs. Rotular como "30 dias" seria mentira.
  const corte = horasJanela ? Date.now() - horasJanela * 3.6e6 : Date.now() - dias(nDias);
  const linhas = lerJsonl(TAPE_FILE, corte);
  const aberta = horaAtual();
  if (aberta && aberta.t >= corte) linhas.push(aberta);
  const total = {};
  for (const f of FAIXAS) total[f.id] = { compra: 0, venda: 0, n: 0 };
  for (const l of linhas) for (const f of FAIXAS) {
    const b = (l.b || {})[f.id]; if (!b) continue;
    total[f.id].compra += b.c || 0; total[f.id].venda += b.v || 0; total[f.id].n += b.n || 0;
  }
  const faixas = FAIXAS.map(f => ({
    id: f.id, nome: f.nome, desc: f.desc,
    compra: total[f.id].compra, venda: total[f.id].venda, n: total[f.id].n,
    liquido: total[f.id].compra - total[f.id].venda
  }));
  const bruto = faixas.reduce((s, f) => s + f.compra + f.venda, 0);
  const compra = faixas.reduce((s, f) => s + f.compra, 0);
  const venda = faixas.reduce((s, f) => s + f.venda, 0);
  const todas = lerJsonl(TAPE_FILE);
  return {
    janelaHoras: horasJanela || nDias * 24,
    ratio: venda ? compra / venda : null,
    compra, venda,
    coletandoDesde: todas.length ? todas[0].t : (aberta ? aberta.t : null),
    faixas: faixas.map(f => ({ ...f, participacao: bruto ? (f.compra + f.venda) / bruto : 0 })),
    horas: linhas.length, desde: linhas.length ? linhas[0].t : null,
    serie: linhas.slice(-24 * 14).map(l => ({ t: l.t, b: l.b })),
    aviso: 'fita da Bybit, coletada por este servidor - so existe desde que ele comecou a rodar'
  };
}

/* ================= 5. Premios geograficos ================= */
// Coinbase acima da Binance = comprador dos EUA (onde estao os fundos) pagando mais caro.
// Upbit acima do global = varejo coreano animado. Sao termometros de QUEM esta com pressa.
async function premios() {
  return cached('prem', 3 * 6e4, async () => {
    const out = { coinbase: null, coreia: null, erros: [] };
    try {
      const [cb, bin] = await Promise.all([
        jget('https://api.coinbase.com/v2/prices/BTC-USD/spot'),
        jget('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT')
      ]);
      const a = +cb.data.amount, b = +bin.price;
      out.coinbase = { coinbase: a, binance: b, premio: (a / b - 1) * 100 };
    } catch (e) { out.erros.push('coinbase: ' + String(e.message || e).slice(0, 40)); }
    try {
      const [up, fx, bin] = await Promise.all([
        jget('https://api.upbit.com/v1/ticker?markets=KRW-BTC'),
        cached('usdkrw', 3.6e6, () => jget('https://query1.finance.yahoo.com/v8/finance/chart/KRW=X?interval=1d&range=5d')),
        jget('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT')
      ]);
      const krw = up[0].trade_price;
      const taxa = fx.chart.result[0].meta.regularMarketPrice;
      const emUsd = krw / taxa, global = +bin.price;
      out.coreia = { krw, usdkrw: taxa, emUsd, global, premio: (emUsd / global - 1) * 100 };
    } catch (e) { out.erros.push('upbit: ' + String(e.message || e).slice(0, 40)); }
    out.historico = lerJsonl(PREM_FILE, Date.now() - dias(30)).map(r => ({ t: r.t, cb: r.cb, kr: r.kr }));
    return out;
  });
}
// chamado pelo servidor a cada 10 min pra virar serie
async function coletarPremios() {
  cache.delete('prem');
  const p = await premios();
  const row = { t: Date.now(), cb: p.coinbase ? +p.coinbase.premio.toFixed(4) : null, kr: p.coreia ? +p.coreia.premio.toFixed(4) : null };
  if (row.cb != null || row.kr != null) gravar(PREM_FILE, row);
  return row;
}

/* ================= 6. Polvora seca: stablecoins ================= */
async function stables(nDias) {
  return cached('stbl:' + nDias, 6 * 3.6e6, async () => {
    const j = await jget('https://stablecoins.llama.fi/stablecoincharts/all');
    const serie = (j || []).map(d => ({ t: +d.date * 1000, v: (d.totalCirculatingUSD || {}).peggedUSD }))
      .filter(d => isFinite(d.v)).sort((a, b) => a.t - b.t);
    const corte = Date.now() - dias(nDias);
    const janela = serie.filter(d => d.t >= corte);
    const base = janela[0] || serie[serie.length - 2];
    const fim = serie[serie.length - 1];
    return {
      atual: fim ? fim.v : null,
      variacao: base && fim ? fim.v - base.v : null,
      variacaoPct: base && fim ? (fim.v / base.v - 1) * 100 : null,
      serie: janela.length > 2 ? janela : serie.slice(-40)
    };
  });
}

/* ================= placar: quem dominou o periodo ================= */
// Duas contas separadas de proposito. "A vista" e dinheiro que virou moeda guardada.
// "Agressao" e quem esta batendo no livro agora - nao e a mesma unidade de medida.
function placar(etf, emp, ft, preco) {
  const aVista = [];
  if (etf.btc && !etf.btc.erro) aVista.push({ classe: 'Fundos e gestoras (ETF de bitcoin)', valor: etf.btc.periodo.soma, detalhe: etf.btc.periodo.dias + ' pregões nos ETFs à vista dos EUA' });
  if (etf.eth && !etf.eth.erro) aVista.push({ classe: 'Fundos e gestoras (ETF de ether)', valor: etf.eth.periodo.soma, detalhe: etf.eth.periodo.dias + ' pregões nos ETFs de ether' });
  if (etf.sol && !etf.sol.erro) aVista.push({ classe: 'Fundos e gestoras (ETF de solana)', valor: etf.sol.periodo.soma, detalhe: etf.sol.periodo.dias + ' pregões nos ETFs de solana' });
  const b = emp.bitcoin;
  if (b && !b.erro) {
    const v = b.variacao;
    if (v && preco && v.dias >= 1) aVista.push({
      classe: 'Empresas de capital aberto', valor: v.moedas * preco,
      detalhe: (v.moedas >= 0 ? '+' : '') + v.moedas.toFixed(0) + ' BTC em ' + v.dias + ' dia(s) de coleta'
    });
    else aVista.push({
      classe: 'Empresas de capital aberto', valor: null, coletando: true,
      detalhe: 'primeira foto da tesouraria guardada hoje - a variacao aparece na proxima coleta'
    });
  }
  const agressao = (ft.faixas || []).map(f => ({ classe: f.nome, valor: f.liquido, detalhe: f.desc, n: f.n }));
  const marcar = a => {
    a = a.filter(x => x.valor != null || x.coletando);
    const t = a.reduce((s, x) => s + Math.abs(x.valor || 0), 0) || 1;
    return [...a].sort((x, y) => Math.abs(y.valor || 0) - Math.abs(x.valor || 0)).map(x => ({ ...x, peso: Math.abs(x.valor || 0) / t }));
  };
  return { aVista: marcar(aVista), agressao: marcar(agressao) };
}

async function tudo(nDias = 7, preco = null, horasFita = null) {
  const [etf, emp, pos, prem, stbl] = await Promise.all([
    etfs(nDias).catch(e => ({ erro: String(e.message || e) })),
    empresas(nDias).catch(e => ({ erro: String(e.message || e) })),
    posicionamento(nDias).catch(e => ({ erro: String(e.message || e) })),
    premios().catch(e => ({ erro: String(e.message || e) })),
    stables(nDias).catch(e => ({ erro: String(e.message || e) }))
  ]);
  const ft = fita(nDias, horasFita);
  const cobertura = ft.coletandoDesde ? (Date.now() - ft.coletandoDesde) / 3.6e6 : 0;
  ft.horasEfetivas = Math.max(0.1, Math.min(ft.janelaHoras, cobertura));
  const confere = await takerJanela(ft.horasEfetivas).catch(() => null);
  return {
    t: Date.now(), dias: nDias, etf, empresas: emp, posicionamento: pos,
    premios: prem, stables: stbl, fita: ft, confere,
    placar: placar(etf, emp, ft, preco)
  };
}

module.exports = { FAIXAS, faixaDe, setHoraAtual, takerJanela, tudo, etfs, empresas, posicionamento, premios, coletarPremios, stables, fita, TAPE_FILE };
