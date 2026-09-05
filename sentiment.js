// Sentimento de mercado: Fear & Greed, noticias de grandes portais, relatorios do Fed
// e sintese/pontuacao via Gemini. Tudo roda no servidor: a chave nunca vai pro navegador.
const fs = require('fs');
const path = require('path');
const PAYROLL = require('./payroll');

const DATA = path.join(__dirname, 'data');
const CFG_FILE = path.join(DATA, 'config.json');
const SENT_FILE = path.join(DATA, 'sentiment.jsonl');

function cfg() {
  try { return JSON.parse(fs.readFileSync(CFG_FILE, 'utf8')); } catch (e) { return {}; }
}
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) btc-radar';

/* ---------------- chave do Gemini ---------------- */
// A chave mora so no servidor, em data/config.json. O navegador nunca recebe ela
// inteira - so um pedaco mascarado, o bastante pra pessoa reconhecer qual e.
function infoChave() {
  const c = cfg();
  const k = String(c.geminiKey || '');
  const util = k && !/^COLE_AQUI/i.test(k);
  return {
    tem: !!util,
    mascara: util ? k.slice(0, 5) + '…' + k.slice(-4) : null,
    modelo: c.geminiModel || 'gemini-3.6-flash',
    fila: FILA_MODELOS
  };
}
// pergunta ao proprio Google se a chave presta, em vez de descobrir na hora da analise
async function validarChave(chave) {
  const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models', {
    headers: { 'x-goog-api-key': chave }
  });
  const t = await r.text();
  if (!r.ok) {
    let msg = t.slice(0, 160);
    try { msg = JSON.parse(t).error.message.slice(0, 160); } catch (e) { }
    throw new Error(msg);
  }
  const j = JSON.parse(t);
  const gera = (j.models || []).filter(m => (m.supportedGenerationMethods || []).includes('generateContent'));
  return gera.map(m => m.name.replace('models/', ''));
}
function salvarChave(chave, modelo) {
  const limpa = String(chave || '').trim();
  if (limpa.length < 20) throw new Error('essa chave parece curta demais');
  const c = cfg();
  c.geminiKey = limpa;
  if (modelo) c.geminiModel = modelo;
  if (c.snapshotMin === undefined) c.snapshotMin = 0;
  if (!fs.existsSync(DATA)) fs.mkdirSync(DATA, { recursive: true });
  fs.writeFileSync(CFG_FILE, JSON.stringify(c, null, 2) + '\n');
  MORTOS.clear();                 // chave nova merece a fila inteira de novo
  return infoChave();
}
const cache = new Map();
async function cached(key, ttl, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < ttl) return hit.v;
  const v = await fn();
  cache.set(key, { t: Date.now(), v });
  return v;
}
const strip = h => h.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '')
  .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'")
  .replace(/&quot;/g, '"').replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d)).replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim();

async function get(url, opts = {}) {
  const c = new AbortController();
  const to = setTimeout(() => c.abort(), opts.timeout || 20000);
  try {
    const r = await fetch(url, { headers: { 'user-agent': UA, ...(opts.headers || {}) }, signal: c.signal });
    return { status: r.status, text: await r.text() };
  } finally { clearTimeout(to); }
}

/* ---------------- Fear & Greed (alternative.me) ---------------- */
async function fearGreed() {
  return cached('fng', 20 * 6e4, async () => {
    const r = await get('https://api.alternative.me/fng/?limit=60');
    const j = JSON.parse(r.text);
    return (j.data || []).map(d => ({ t: +d.timestamp * 1000, v: +d.value, label: d.value_classification }));
  });
}

/* ---------------- Gemini ---------------- */
// O modelo gratuito vive lotando (503) ou estourando cota do dia (429). Em vez de
// desistir, a chamada desce uma fila de modelos: se o preferido nega, tenta o proximo,
// e so no fim da fila espera pra rodar tudo de novo.
const FILA_MODELOS = ['gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-flash-latest', 'gemini-3.7-flash', 'gemini-3.1-flash-lite'];
const MORTOS = new Set();   // modelo que respondeu 404: aposentado, nao adianta tentar de novo
const TEMPORARIO = new Set([408, 425, 429, 500, 502, 503, 504]);
const espera = ms => new Promise(r => setTimeout(r, ms));

async function chamarGemini(modelo, prompt) {
  const c = cfg();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`;
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.3, responseMimeType: 'application/json' }
  };
  const ctl = new AbortController();
  const to = setTimeout(() => ctl.abort(), 90000);
  try {
    const r = await fetch(url, {
      method: 'POST', signal: ctl.signal,
      headers: { 'content-type': 'application/json', 'x-goog-api-key': c.geminiKey },
      body: JSON.stringify(body)
    });
    const t = await r.text();
    if (!r.ok) {
      let msg = t.slice(0, 200);
      try { msg = JSON.parse(t).error.message.slice(0, 200); } catch (e) { }
      const err = new Error(`${modelo} ${r.status}: ${msg}`);
      err.status = r.status;
      err.temporario = TEMPORARIO.has(r.status);
      throw err;
    }
    const j = JSON.parse(t);
    const parts = (((j.candidates || [])[0] || {}).content || {}).parts || [];
    const txt = parts.map(p => p.text || '').join('').trim();
    try { return JSON.parse(txt); }
    catch (e) {
      const m = txt.match(/\{[\s\S]*\}/);
      if (m) return JSON.parse(m[0]);
      throw new Error('resposta do Gemini nao veio em JSON');
    }
  } catch (e) {
    if (e.name === 'AbortError' || e.name === 'TypeError') e.temporario = true;  // timeout ou rede
    throw e;
  } finally { clearTimeout(to); }
}

async function gemini(prompt) {
  const c = cfg();
  if (!c.geminiKey) throw new Error('sem chave do Gemini em data/config.json');
  const modelos = [...new Set([c.geminiModel, ...FILA_MODELOS].filter(Boolean))].filter(m => !MORTOS.has(m));
  if (!modelos.length) throw new Error('nenhum modelo do Gemini disponivel (todos responderam 404)');
  const recusas = [];
  for (let volta = 0; volta < 2; volta++) {
    for (const m of modelos) {
      try {
        const out = await chamarGemini(m, prompt);
        if (out && typeof out === 'object') out.modelo = m;
        return out;
      } catch (e) {
        recusas.push(e.message);
        if (e.status === 404) { MORTOS.add(m); continue; }   // modelo aposentado: pula pro proximo
        if (!e.temporario) throw e;      // chave invalida ou prompt ruim: insistir nao resolve
      }
    }
    if (volta === 0) await espera(8000);  // fila inteira lotada: respira e roda de novo
  }
  const e = new Error(`os ${modelos.length} modelos do Gemini estao lotados ou sem cota. ultimo: ${recusas.at(-1)}`);
  e.recusas = recusas;
  e.temporario = true;
  throw e;
}

const REGRAS = `Voce analisa sentimento de mercado para um painel de bitcoin. Responda SEMPRE em JSON puro,
em portugues do Brasil, linguagem simples de quem explica pra leigo, sem jargao desnecessario e sem recomendar
compra ou venda. Descreva o que os dados dizem, nunca o que a pessoa deve fazer.
Formato exigido:
{"score": <inteiro de -100 (medo extremo) a 100 (ganancia extrema)>,
 "label": "<Medo extremo|Medo|Neutro|Ganancia|Ganancia extrema>",
 "resumo": "<2 a 3 frases explicando o clima geral>",
 "pontos": [{"titulo":"<3 a 6 palavras>","texto":"<1 frase simples>","tom":"<alta|baixa|neutro>"}],
 "destaques": ["<frase curta citando quem falou o que>"]}`;

/* ---------------- noticias de portais grandes ---------------- */
// Portais com RSS aberto e estavel. Reuters e AP bloqueiam robo, por isso ficam de fora.
const PORTAIS = {
  macro: [
    { nome: 'CNBC Economia', url: 'https://www.cnbc.com/id/20910258/device/rss/rss.html' },
    { nome: 'CNBC Finance', url: 'https://www.cnbc.com/id/10000664/device/rss/rss.html' },
    { nome: 'MarketWatch', url: 'https://feeds.content.dowjones.io/public/rss/mw_topstories' },
    { nome: 'BBC Business', url: 'https://feeds.bbci.co.uk/news/business/rss.xml' },
    { nome: 'Yahoo Finance', url: 'https://finance.yahoo.com/news/rssindex' },
    { nome: 'InfoMoney', url: 'https://www.infomoney.com.br/feed/' }
  ],
  cripto: [
    { nome: 'CoinDesk', url: 'https://www.coindesk.com/arc/outboundfeeds/rss/' },
    { nome: 'Cointelegraph', url: 'https://cointelegraph.com/rss' },
    { nome: 'The Block', url: 'https://www.theblock.co/rss.xml' },
    { nome: 'Decrypt', url: 'https://decrypt.co/feed' },
    { nome: 'Bitcoin Magazine', url: 'https://bitcoinmagazine.com/feed' }
  ]
};
// so interessa manchete que fala de juro, inflacao, Fed, dolar, emprego, recessao, tarifa, bolsa...
const RELEVANTE = /(fed|federal reserve|powell|warsh|fomc|inflat|infla[cç]|juro|rate cut|rate hike|interest rate|cpi|pce|jobs|payroll|emprego|unemploy|desemprego|recess|gdp|pib|tariff|tarifa|treasury|yield|d[oó]lar|dollar|stock|bolsa|s&p|nasdaq|liquidit|liquidez|bitcoin|btc|crypto|cripto|etf)/i;

function parseFeed(xml, portal) {
  const blocos = [...xml.matchAll(/<(item|entry)>([\s\S]*?)<\/\1>/g)].map(m => m[2]);
  return blocos.map(b => {
    const pick = tag => (b.match(new RegExp('<' + tag + '[^>]*>([\\s\\S]*?)</' + tag + '>')) || [, ''])[1]
      .replace(/<!\[CDATA\[|\]\]>/g, '').trim();
    let link = pick('link');
    if (!link) link = (b.match(/<link[^>]*href="([^"]+)"/) || [, ''])[1];
    const data = pick('pubDate') || pick('published') || pick('updated') || pick('dc:date');
    return {
      portal, title: strip(pick('title')), url: link,
      date: data, ts: Date.parse(data) || 0,
      text: strip(pick('description') || pick('summary') || pick('content:encoded')).slice(0, 320)
    };
  }).filter(x => x.title && x.url);
}
async function lerPortais(grupo, porPortal = 6) {
  const lista = PORTAIS[grupo] || [];
  const res = await Promise.all(lista.map(async p => {
    try {
      const r = await cached('feed:' + p.url, 12 * 6e4, async () => {
        const x = await get(p.url, { timeout: 15000 });
        if (x.status !== 200) throw new Error('HTTP ' + x.status);
        return parseFeed(x.text, p.nome);
      });
      return { portal: p.nome, ok: true, itens: r.slice(0, porPortal) };
    } catch (e) { return { portal: p.nome, ok: false, erro: String(e.message || e).slice(0, 40), itens: [] }; }
  }));
  return res;
}
async function noticias({ horas = 36, max = 18 } = {}) {
  const [macro, cripto] = await Promise.all([lerPortais('macro'), lerPortais('cripto')]);
  const corte = Date.now() - horas * 3.6e6;
  const juntar = (grupos, grupo) => {
    const vistos = new Set();
    return grupos.flatMap(g => g.itens.map(i => ({ ...i, grupo })))
      .filter(i => !i.ts || i.ts >= corte)
      .filter(i => RELEVANTE.test(i.title + ' ' + i.text))
      .filter(i => { const k = i.title.toLowerCase().slice(0, 60); if (vistos.has(k)) return false; vistos.add(k); return true; })
      .sort((a, b) => b.ts - a.ts);
  };
  const m = juntar(macro, 'macro').slice(0, Math.ceil(max / 2));
  const c = juntar(cripto, 'cripto').slice(0, Math.floor(max / 2));
  return {
    itens: [...m, ...c],
    fontesOk: [...macro, ...cripto].filter(f => f.ok).map(f => f.portal),
    fontesFalha: [...macro, ...cripto].filter(f => !f.ok).map(f => `${f.portal}: ${f.erro}`),
    contagem: { macro: m.length, cripto: c.length }
  };
}

async function analisarNoticias() {
  const n = await noticias();
  if (!n.itens.length) throw new Error('nenhum portal devolveu manchete relevante agora');
  const bloco = g => n.itens.filter(i => i.grupo === g)
    .map(i => `- [${i.portal}] ${i.title}${i.text ? ' — ' + i.text.slice(0, 200) : ''}`).join('\n');
  const hoje = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
  const prompt = `${REGRAS}

Hoje e ${hoje}. Abaixo estao manchetes recentes de grandes portais, separadas em economia dos EUA e bitcoin/cripto.
Pontue o clima do mercado para bitcoin considerando as duas frentes: o que a macroeconomia americana esta sinalizando
(juro, inflacao, emprego, dolar, bolsa) e o que esta acontecendo no proprio mercado de bitcoin.
Em "destaques", cite o portal e o fato. Se as manchetes forem pouco conclusivas, diga isso no resumo.

ECONOMIA DOS EUA:
${bloco('macro') || '(sem manchete relevante)'}

BITCOIN E CRIPTO:
${bloco('cripto') || '(sem manchete relevante)'}`;
  const out = await gemini(prompt);
  out.fontes = n.itens.map(i => ({ tipo: 'noticia', title: `[${i.portal}] ${i.title}`, url: i.url, date: i.date, text: i.text }));
  out.cobertura = { portais: n.fontesOk.length, macro: n.contagem.macro, cripto: n.contagem.cripto };
  out.falhas = n.fontesFalha;
  return out;
}

/* ---------------- Fed: comunicados, atas e discursos ---------------- */
// A pagina do release e so o aviso; o texto que importa costuma estar num link interno
// (fomcminutes*.htm, beigebook, etc). E o miolo da pagina comeca em id="article" —
// pegar os primeiros N caracteres do HTML cru so traria o menu do site.
const FED_RELEVANTE = /(federal funds rate|target range|interest rate|rate cut|rate increase|inflation|price stability|labor market|unemploy|balance sheet|securities holdings|runoff|reserve|liquidity|financial conditions|dollar|tighten|accommodat|quantitative|asset purchase|policy stance|risks to)/i;

function corpoArtigo(html) {
  let h = html;
  const i = h.indexOf('id="article"');
  if (i >= 0) h = h.slice(i);
  const fim = h.search(/id="lastUpdate"|class="footer|<footer|Last Update:/i);
  if (fim > 500) h = h.slice(0, fim);
  return h;
}
// mantem o comeco (a decisao em si) + os trechos que falam de juro, inflacao, liquidez
function trechosRelevantes(txt, limite = 9000) {
  if (txt.length <= limite) return txt;
  const paras = txt.split(/(?<=\.)\s+(?=[A-Z])/);
  let out = txt.slice(0, 1500), usados = 1500;
  for (const p of paras) {
    if (usados >= limite) break;
    if (p.length < 80 || !FED_RELEVANTE.test(p)) continue;
    if (out.includes(p.slice(0, 60))) continue;
    out += '\n' + p; usados += p.length;
  }
  return out.slice(0, limite);
}
async function lerDocFed(url) {
  const p = await get(url);
  let corpo = corpoArtigo(p.text);
  // release que so anuncia: seguir o link do documento de verdade
  const interno = (corpo.match(/href="(\/(?:monetarypolicy|newsevents)\/[^"]*(?:minutes|beigebook|statement|report)[^"]*\.htm)"/i) || [])[1];
  if (interno && strip(corpo).length < 2500) {
    try {
      const d = await get('https://www.federalreserve.gov' + interno);
      corpo = corpoArtigo(d.text);
      url = 'https://www.federalreserve.gov' + interno;
    } catch (e) { }
  }
  const limpo = strip(corpo).replace(/^id="article">s*/, '');
  return { texto: trechosRelevantes(limpo), url };
}
async function fedDocs(n = 4) {
  return cached('fed:' + n, 2 * 3.6e6, async () => {
    const feeds = [
      { url: 'https://www.federalreserve.gov/feeds/press_monetary.xml', tipo: 'comunicado' },
      { url: 'https://www.federalreserve.gov/feeds/speeches.xml', tipo: 'discurso' }
    ];
    let itens = [];
    for (const f of feeds) {
      try {
        const r = await get(f.url);
        itens = itens.concat([...r.text.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 6).map(m => {
          const b = m[1];
          const pick = tag => (b.match(new RegExp('<' + tag + '>([\\s\\S]*?)</' + tag + '>')) || [, ''])[1]
            .replace(/<!\[CDATA\[|\]\]>/g, '').trim();
          const data = pick('pubDate') || pick('dc:date');
          return { title: strip(pick('title')), url: pick('link'), date: data, ts: Date.parse(data) || 0, tipo: f.tipo };
        }));
      } catch (e) { }
    }
    // o que move mercado primeiro: decisao do FOMC, ata, discurso de dirigente.
    // ata de discount rate e reuniao administrativa entram por ultimo.
    // o que move cripto: decisao do FOMC > ata > fala do presidente do Fed > outras falas.
    // release administrativo (nomeacao, fiscalizacao de banco) nao entra.
    const chair = /^(warsh|powell)/i;
    const lixo = /leadership|enforcement|appoint|personnel|bank holding|application by|supervis|reserve bank president/i;
    const peso = t => lixo.test(t) ? 9
      : /FOMC statement|monetary policy decision/i.test(t) ? 0
      : /Minutes of the Federal Open Market Committee/i.test(t) ? 1
      : chair.test(t) ? 2
      : /discount rate/i.test(t) ? 8 : 3;
    itens.sort((a, b) => peso(a.title) - peso(b.title) || b.ts - a.ts);
    const escolhidos = itens.filter(i => peso(i.title) < 8).slice(0, n);
    for (const it of escolhidos) {
      try {
        const d = await lerDocFed(it.url);
        it.text = d.texto; it.url = d.url;
        it.ok = d.texto.length > 800;      // menos que isso e menu de site, nao documento
      } catch (e) { it.text = ''; it.ok = false; }
    }
    return escolhidos;
  });
}

async function analisarFed(n = 4) {
  // payroll entra junto com os documentos: entre uma reuniao e outra e ele que move
  // a expectativa de corte ou de alta, e o Fed le emprego antes de qualquer outra coisa
  const [docs, pay] = await Promise.all([
    fedDocs(n),
    PAYROLL.ler().catch(e => ({ erro: String(e.message || e).slice(0, 80) }))
  ]);
  const payOk = pay && !pay.erro ? pay : null;
  const bons = docs.filter(d => d.ok);
  if (!bons.length && !payOk) throw new Error('baixei as paginas do Fed mas nao consegui extrair o texto dos documentos');
  const material = bons.map(d =>
    `[${d.tipo.toUpperCase()}] ${d.title}\nDATA: ${d.date}\nTEXTO: ${d.text}`).join('\n\n---\n\n');
  const blocoPayroll = payOk ? PAYROLL.paraPrompt(payOk) : '(dado de emprego indisponivel agora)';
  const hoje = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
  const prompt = `${REGRAS}

Hoje e ${hoje}. Abaixo estao os documentos mais recentes do Federal Reserve (comunicado do FOMC, ata e discursos de dirigentes).
Sua tarefa NAO e resumir o Fed em geral: e dizer o que ali dentro empurra o preco de bitcoin e cripto pra cima ou pra baixo.

FAVORECE cripto (score positivo): sinal de corte de juro, juro caindo, fim ou reducao do aperto quantitativo (QT),
recompra de ativos, mais reservas/liquidez no sistema, tolerancia maior com inflacao, credito afrouxando, dolar mais fraco,
preocupacao com emprego fraco que force o Fed a soltar dinheiro.
DESFAVORECE cripto (score negativo): juro alto ou subindo, discurso duro contra inflacao, QT continuando ou acelerando,
enxugar reservas, condicoes financeiras apertando, dolar forte, sinal de que corte de juro vai demorar.

Regras da resposta:
- Leve o EMPREGO em conta com o mesmo peso dos documentos: emprego fraco (pouca vaga criada, desemprego subindo)
  costuma forcar corte de juro, o que FAVORECE cripto; emprego forte com salario subindo rapido tira a pressa do Fed e DESFAVORECE.
  Compare o que os documentos dizem sobre o mercado de trabalho com o que o numero mostra: se o Fed falou em emprego
  resiliente e o payroll veio fraco (ou o contrario), diga isso, porque e ai que muda a aposta de juro.
- "score": -100 (Fed muito duro, pessimo pra cripto) a 100 (Fed muito frouxo, otimo pra cripto). Use 0 so se realmente houver equilibrio.
- "pontos": exatamente os temas que mexem com cripto — rumo do juro, inflacao, liquidez/balanco do Fed, e o que isso faz com ativo de risco.
- "destaques": cite o documento e a frase concreta que embasa cada leitura (ex: "Na ata de 29/07 o Fed disse que ...").
- Nao invente: se algum documento nao tratar de politica monetaria, ignore ele em silencio e use os outros.
- Em "pontos", um dos itens tem que ser o mercado de trabalho e o que ele faz com a chance de corte de juro.

=== EMPREGO NOS EUA ===
${blocoPayroll}

=== DOCUMENTOS DO FED ===
${material || '(nenhum documento com texto extraivel agora - use o emprego)'}`;
  const out = await gemini(prompt);
  out.payroll = payOk || (pay && pay.erro ? { erro: pay.erro } : null);
  out.fontes = docs.map(d => ({ title: `[${d.tipo}] ${d.title}`, url: d.url, date: d.date }));
  if (payOk) out.fontes.push({
    title: `[payroll] Employment Situation - ${payOk.mes}: ${payOk.vagas >= 0 ? '+' : ''}${payOk.vagas} mil vagas, desemprego ${payOk.desemprego}%`,
    url: 'https://www.bls.gov/news.release/empsit.nr0.htm', date: payOk.mes
  });
  out.cobertura = { documentos: bons.length, tentados: docs.length, payroll: !!payOk };
  out.falhas = docs.filter(d => !d.ok).map(d => `${d.title.slice(0, 50)}: sem texto extraivel`);
  return out;
}

const ULT_FILE = path.join(DATA, 'ultima-analise.json');
function ultimasAnalises() {
  try { return JSON.parse(fs.readFileSync(ULT_FILE, 'utf8')); } catch (e) { return {}; }
}
function guardarUltima(kind, out) {
  const todas = ultimasAnalises();
  todas[kind] = out;
  try { fs.writeFileSync(ULT_FILE, JSON.stringify(todas)); } catch (e) { }
}
// Roda a analise; se o Gemini nao responder, devolve a ultima boa marcada como velha
// em vez de deixar a tela vazia. Quem consome sabe a idade pelo campo t.
async function analisar(kind) {
  try {
    const out = kind === 'fed' ? await analisarFed(4) : await analisarNoticias();
    out.t = Date.now();
    salvar(kind, out);
    guardarUltima(kind, out);
    return out;
  } catch (e) {
    const msg = String(e.message || e).slice(0, 300);
    const velha = ultimasAnalises()[kind];
    if (velha) return { ...velha, velha: true, erroAtual: msg };
    return { error: msg };
  }
}

function salvar(kind, data) {
  const row = { t: Date.now(), kind, score: data.score, label: data.label, resumo: data.resumo };
  try { fs.appendFileSync(SENT_FILE, JSON.stringify(row) + '\n'); } catch (e) { }
}
function ultimos(hours = 168) {
  try {
    const cut = Date.now() - hours * 3.6e6;
    return fs.readFileSync(SENT_FILE, 'utf8').split('\n').filter(Boolean)
      .map(l => { try { return JSON.parse(l) } catch (e) { return null } })
      .filter(x => x && x.t >= cut);
  } catch (e) { return []; }
}

module.exports = { cfg, infoChave, validarChave, salvarChave, fearGreed, noticias, fedDocs, analisarNoticias, analisarFed, analisar, ultimasAnalises, salvar, ultimos };
